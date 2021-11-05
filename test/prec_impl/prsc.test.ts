import { PropertyGraph, PGBuild } from "../mock-pg/pg-implem";
import { fromTinkerPop } from '../../src/prec/graph-builder';
import { turtleToQuads, turtleToDStar, generateMessage } from "../utility";
import graphReducer from "../../src/prec/graph-reducer";
import assert from 'assert';
import { revertPrecC } from "../../src/prec-c/PrscContext";
import { isomorphic } from "rdf-isomorphic";

enum RevertableType {
  ShouldThrow,
  /** Operations that could be reverted with a better algorithm */
  ShouldThrowForNow
};

function test(
  name: string, source: PropertyGraph, context: string, expected: string,
  revertable?: boolean | RevertableType
) {
  it(name, () => {
    const { nodes, edges } = source.convertToProductFromTinkerProp() as any;
    const store = fromTinkerPop(nodes, edges)[0];
    const cleanSource = store.match();
    const ctx = turtleToQuads(context);
    graphReducer(store, ctx);

    const expectedStore = turtleToDStar(expected);
    const r = isomorphic(store.getQuads(), expectedStore.getQuads());
    let msg = "";
    if (!r) {
      msg = generateMessage("", context, store, expectedStore);
    }

    assert.ok(r, msg);

    if (revertable === true) {
      const o = revertPrecC(expectedStore, ctx);

      const iso = isomorphic(o.dataset.getQuads(), cleanSource.getQuads());
      let msg = "";
      if (!iso) {
        msg = generateMessage("PRSC reversiblity", context, o.dataset, cleanSource);
      }
      assert.ok(iso, msg);
    } else if (revertable === RevertableType.ShouldThrow
      || revertable === RevertableType.ShouldThrowForNow) {
      assert.throws(() => revertPrecC(expectedStore, ctx));
    }
  });
}

function badPGToRDF(name: string, source: PropertyGraph, context: string) {
  it(name, () => {
      const { nodes, edges } = source.convertToProductFromTinkerProp();
      const store = fromTinkerPop(nodes as any, edges as any)[0];
      const ctx = turtleToQuads(context);
      assert.throws(() => graphReducer(store, ctx));
  });
}

module.exports = () => {
  describe('PRSC', () => {

    describe("Simple cases", () => {

      test("Empty all", new PropertyGraph(),
        "prec:this_is a prec:prscContext .",
        "",
        true
      );

      test(
        "A node with compatible schema",
        (() => {
          const pg = new PropertyGraph();
          pg.addNode();
          return pg;
        })(),
        `
        prec:this_is a prec:prscContext .

        [] a prec:prsc_node ;
          prec:composedOf << pvar:node :exists :inthepg >> .
        `,
        ` _:thenode :exists :inthepg . `,
        true
      );

      test("A PG without a schema for the edge (bad label)",
        PGBuild()
        .addNode("toto", ["person"])
        .addNode("titi", ["person"])
        .addEdge("toto", "knows", "titi")
        .build(),
        `
        prec:this_is a prec:prscContext .

        :person a prec:prsc_node ;
          prec:nodeLabel "person" .

        [] a prec:prsc_edge ;
          prec:prscSource :person ;
          prec:prscDestination :person ;
          prec:edgeLabel "knows" ;
          prec:composedOf << pvar:source :knows pvar:destination >>,
            << pvar:edge :is :discarded  >> .
        `,
        " _:toto :knows _:titi . _:theedgeblanknode :is :discarded . ",
        undefined
      );


      test("A property is used",
        PGBuild().addNode(null, [], { name: "toto" }).build(),
        `prec:this_is a prec:prscContext .
        
        [] a prec:prsc_node ;
          prec:propertyName "name" ;
          prec:composedOf << pvar:node :name [ prec:prsc_valueOf "name" ] >> .
        `,
        '_:toto :name "toto" . ',
        true
      );
      
      test("Map the property of an edge",
        (() => {
          const pg = new PropertyGraph();
          const toto = pg.addNode("person");
          const titi = pg.addNode("person");
          const edge = pg.addEdge(toto, "knows", titi);
          edge.addProperty("since", "yesterday")
          return pg;
        })(),
        `
        prec:this_is a prec:prscContext .

        :person a prec:prsc_node ;
          prec:nodeLabel "person" .

        [] a prec:prsc_edge ;
          prec:prscSource :person ;
          prec:prscDestination :person ;
          prec:edgeLabel "knows" ;
          prec:propertyName "since" ;
          prec:composedOf << pvar:source :knows pvar:destination >>,
            << << pvar:destination :isStalkedBy pvar:source >> :since [ prec:prsc_valueOf "since" ] >> .
        `,
        ' _:toto :knows _:titi . \n ' +
        '<< _:titi :isStalkedBy _:toto >> :since "yesterday" .'
      );

      test("Translate labels",
        PGBuild()
        .addNode("toto", ["person"], { name: "Toto" })
        .addNode("alice", ["knight"], { name: "Alice", number: 30 })
        .addEdge("toto", "knows", "alice", { since: "2021" })
        .build(),
        `
        prec:this_is a prec:prscContext .

        :PersonPGType a prec:prsc_node ;
          prec:nodeLabel "person" ;
          prec:propertyName "name" ;
          prec:composedOf
            << pvar:node rdf:type :Person >> ,
            << pvar:node :name [ prec:prsc_valueOf "name" ] >> .
        
        :KnightPGType a prec:prsc_node ;
          prec:nodeLabel "knight" ;
          prec:propertyName "name" ;
          prec:propertyName "number" ;
          prec:composedOf
            << pvar:node rdf:type :Knight >> ,
            << pvar:node :name [ prec:prsc_valueOf "name" ] >> ,
            << pvar:node :number [ prec:prsc_valueOf "number" ] >> .
        
        :KnowsPGEdge a prec:prsc_edge ;
          prec:edgeLabel "knows" ;
          prec:propertyName "since" ;
          prec:composedOf
               << pvar:source :knows pvar:destination >> ,
            << << pvar:source :knows pvar:destination >> :since [ prec:prsc_valueOf "since" ]  >> .
        `,
        `
          _:toto a :Person ; :name "Toto" .
          _:alice a :Knight ; :name "Alice" ; :number 30 .

          _:toto :knows _:alice .
          << _:toto :knows _:alice >> :since "2021" .
        `
        ,
        true
      );

      test("Twice the same property name",
        PGBuild()
        .addNode(null, [], { name: "Tintin" })
        .addNode(null, [], { name: "Mille Loups" })
        .build(),
        `
        prec:this_is a prec:prscContext .

        [] a prec:prsc_node ;
          prec:propertyName "name" ;
          prec:composedOf << pvar:node :name "name"^^prec:_valueOf  >> .
        `,
        ' _:tintin :name "Tintin" . _:milou :name "Mille Loups" .',
        true
      );

      test("A label",
        PGBuild()
        .addNode(null, ["Letter"], { value: "A" })
        .build(),
        `
        prec:this_is a prec:prscContext .

        [] a prec:prsc_node ;
          prec:nodeLabel "Letter" ;
          prec:propertyName "value" ;
          prec:composedOf << pvar:node :isTheLetter "value"^^prec:_valueOf >> .
        `,
        ` _:a :isTheLetter "A" . `,
        true
      );

      test("Two labels",
        PGBuild()
        .addNode(null, ["Letter", "Vowel"], { value: "A" })
        .build(),
        `
        prec:this_is a prec:prscContext .

        [] a prec:prsc_node ;
          prec:nodeLabel "Letter", "Vowel" ;
          prec:propertyName "value" ;
          prec:composedOf << pvar:node :isTheLetter "value"^^prec:_valueOf >> .
        `,
        ` _:a :isTheLetter "A" . `,
        true
      );

      test("Twice the same label",
        PGBuild()
        .addNode(null, ["Letter"], { value: "A" })
        .addNode(null, ["Letter"], { value: "B" })
        .build(),
        `
        prec:this_is a prec:prscContext .

        [] a prec:prsc_node ;
          prec:nodeLabel "Letter" ;
          prec:propertyName "value" ;
          prec:composedOf << pvar:node :isTheLetter "value"^^prec:_valueOf >> .
        `,
        ` _:a :isTheLetter "A" . _:b :isTheLetter "B" . `,
        true
      );
    });

    describe("Cases with bad PG to RDF convertion", () => {
      badPGToRDF("A PG but no context",
        (() => {
          const pg = new PropertyGraph();
          const toto = pg.addNode("toto");
          const titi = pg.addNode("titi");
          pg.addEdge(toto, "knows", titi);
          return pg;
        })(),
        "prec:this_is a prec:prscContext ."
      );

      badPGToRDF(
        "A node with incompatible schema",
        (() => {
          const pg = new PropertyGraph();
          pg.addNode();
          return pg;
        })(),
        `
        prec:this_is a prec:prscContext .

        [] a prec:prsc_node ;
          prec:nodeLabel "You need a label" ;
          prec:composedOf << pvar:node :exists :inthepg >> .
        `
      );

      badPGToRDF(
        "A node with incompatible schema (strict schema requirement)",
        (() => {
          const pg = new PropertyGraph();
          pg.addNode("FirstLabel");
          pg.addNode("OtherLabel")
          return pg;
        })(),
        `
        prec:this_is a prec:prscContext .

        [] a prec:prsc_node ;
          prec:nodeLabel "First Label" ;
          prec:composedOf << pvar:node :exists :inthepg >> .
        `
      );

      badPGToRDF("A PG without a schema for the edge (bad node schema)",
        (() => {
          const pg = new PropertyGraph();
          const toto = pg.addNode("person");
          const titi = pg.addNode("person");
          pg.addEdge(toto, "knows", titi);
          return pg;
        })(),
        `
        prec:this_is a prec:prscContext .

        [] a prec:prsc_node ;
          prec:nodeLabel "person" .

        :otherSchema a prec:prsc_node .

        [] a prec:prsc_edge ;
          prec:prscSource :otherSchema .
        `
      );

      badPGToRDF("A PG without a schema for the edge (bad label)",
        (() => {
          const pg = new PropertyGraph();
          const toto = pg.addNode("person");
          const titi = pg.addNode("person");
          pg.addEdge(toto, "knows", titi);
          return pg;
        })(),
        `
        prec:this_is a prec:prscContext .

        :person a prec:prsc_node ;
          prec:nodeLabel "person" .

        [] a prec:prsc_edge ;
          prec:prscSource :person ;
          prec:prscDestination :person ;
          prec:edgeLabel "connait" .
        `
      );

      badPGToRDF("A bad context format (invalid blank node)",
        (() => {
          const pg = new PropertyGraph();
          pg.addNode();
          return pg;
        })(),
        `prec:this_is a prec:prscContext .
        
        [] a prec:prsc_node ;
          prec:composedOf << pvar:node a [ :hello :work ] >> .
        `
      );

      badPGToRDF("A bad context format (property name is not a literal)",
        (() => {
          const pg = new PropertyGraph();
          pg.addNode();
          return pg;
        })(),
        `prec:this_is a prec:prscContext .
        
        [] a prec:prsc_node ;
          prec:composedOf << pvar:node a [ prec:prsc_valueOf :hey ] >> .
        `
      );

      badPGToRDF("A bad context format (property name is not found in the node / schema)",
        (() => {
          const pg = new PropertyGraph();
          pg.addNode();
          return pg;
        })(),
        `prec:this_is a prec:prscContext .
        
        [] a prec:prsc_node ;
          prec:composedOf << pvar:node a [ prec:prsc_valueOf "name" ] >> .
        `
      );
      
      badPGToRDF("Node lacks the property in the schema",
        (() => {
          const pg = new PropertyGraph();
          pg.addNode();
          return pg;
        })(),
        `prec:this_is a prec:prscContext .
        
        [] a prec:prsc_node ;
          prec:propertyName "name" ;
          prec:composedOf << pvar:node a [ prec:prsc_valueOf "name" ] >> .
        `
      );

    });

    describe("Ambiguous reversion", () => {
      test(
        "A context that add a value for a property",
        PGBuild()
        .addNode(null, [], { name: "Thomas" })
        .build(),
        `
        prec:this_is a prec:prscContext .

        :something a prec:prsc_node ;
          prec:propertyName "name" ;
          prec:composedOf
            << pvar:node :is_named [ prec:prsc_valueOf "name" ] >> ,
            << pvar:node :is_named "Grove" >> ,
            << pvar:node :is_named "Thomas" >> .
        `,
        ' _:thomas :is_named "Thomas", "Grove" . ',
        RevertableType.ShouldThrow
      );

      test(
        "Same template form with swapped blank node placeholders",
        PGBuild()
        .addNode("node", [], {})
        .addEdge("node", "to", "node", {})
        .build(),
        `
        prec:this_is a prec:prscContext .

        :node a prec:prsc_node ; prec:composedOf << pvar:node a :node >> .

        :edgeHey a prec:prsc_edge ;
          prec:edgeLabel "hey" ;
          prec:composedOf << << pvar:edge :src pvar:source >> :to pvar:destination >> .

        :edgeTo a prec:prsc_edge ;
          prec:edgeLabel "to" ;
          prec:composedOf << << pvar:source :src pvar:edge >> :to pvar:destination >> .
        `,
        `
        _:node a :node .
        << _:node :src _:edge >> :to _:node .
        `
      );

      test(
        "Same template form with swapped blank node placeholders",
        PGBuild()
        .addNode("node", [], {})
        .addEdge("node", "to", "node", {})
        .build(),
        `
        prec:this_is a prec:prscContext .

        :node a prec:prsc_node ; prec:composedOf << pvar:node a :node >> .

        :edgeHey a prec:prsc_edge ;
          prec:edgeLabel "hey" ;
          prec:composedOf << << pvar:destination :and pvar:source >> :edge_is pvar:self >> .

        :edgeTo a prec:prsc_edge ;
          prec:edgeLabel "to" ;
          prec:composedOf << << pvar:source :and pvar:destination >> :edge_is pvar:self >> .
        `,
        `
        _:node a :node .
        << _:node :and _:node >> :edge_is _:edge .
        `,
        RevertableType.ShouldThrow
      );
    });
  });
};
