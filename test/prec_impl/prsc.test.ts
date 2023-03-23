import { PropertyGraph, PGBuild } from "../mock-pg/pg-implem";
import { fromTinkerPop } from '../../src/prec/graph-builder';
import { turtleToQuads, turtleToDStar, checkOutput } from "../utility";
import { applyPRSC, ContextType, getContextType } from "../../src/prec/graph-reducer";
import assert from 'assert';
import { revertPrecC } from "../../src/prsc/PrscContext";
import * as RDF from "@rdfjs/types";

enum RevertableType {
  ShouldThrow,
  /** Operations that could be reverted with a better algorithm */
  ShouldThrowForNow
};

function isPrscContext(contextQuads: RDF.Quad[]) {
  const type = getContextType(contextQuads);
  return type === ContextType.PRSC || type === ContextType.Empty;
}

function test(
  name: string, source: PropertyGraph, context: string, expected: string,
  revertable?: boolean | RevertableType
) {
  it(name, () => {
    const { nodes, edges } = source.convertToProductFromTinkerProp() as any;
    const store = fromTinkerPop(nodes, edges)[0];
    const cleanSource = store.match();
    const ctx = turtleToQuads(context);

    assert.ok(isPrscContext(ctx), "The context should be a PRSC context");

    applyPRSC(store, ctx);

    const expectedStore = turtleToDStar(expected);
    checkOutput("", context, store, expectedStore);

    if (revertable === true) {
      const prec0Graph = revertPrecC(expectedStore, ctx);
      checkOutput("PRSC reversiblity", context, prec0Graph, cleanSource);
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
      assert.ok(isPrscContext(ctx), "The context should be a PRSC context");
      assert.throws(() => applyPRSC(store, ctx));
  });
}

module.exports = () => {
  describe('PRSC', () => {

    describe("Simple cases", () => {

      test("Empty all", new PropertyGraph(),
        "",
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
        [] a prec:PRSCNodeRule ;
          prec:produces << pvar:node :exists :inthepg >> .
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
        :person a prec:PRSCNodeRule ;
          prec:label "person" .

        [] a prec:PRSCEdgeRule ;
          prec:prscSource :person ;
          prec:prscDestination :person ;
          prec:label "knows" ;
          prec:produces << pvar:source :knows pvar:destination >>,
            << pvar:edge :is :discarded  >> .
        `,
        " _:toto :knows _:titi . _:theedgeblanknode :is :discarded . ",
        undefined
      );


      test("A property is used",
        PGBuild().addNode(null, [], { name: "toto" }).build(),
        `
        [] a prec:PRSCNodeRule ;
          prec:propertyKey "name" ;
          prec:produces << pvar:node :name "name"^^prec:_valueOf >> .
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
        :person a prec:PRSCNodeRule ;
          prec:label "person" ;
          prec:produces << pvar:self a :Person >> .

        [] a prec:PRSCEdgeRule ;
          prec:prscSource :person ;
          prec:prscDestination :person ;
          prec:label "knows" ;
          prec:propertyKey "since" ;
          prec:produces << pvar:source :knows pvar:destination >>,
            << << pvar:destination :isStalkedBy pvar:source >> :since "since"^^prec:_valueOf >> .
        `,
        ' _:toto :knows _:titi . \n ' +
        '<< _:titi :isStalkedBy _:toto >> :since "yesterday" . \n' +
        ' _:toto a :Person . _:titi a :Person . ',
        true
      );

      test("Translate labels",
        PGBuild()
        .addNode("toto", ["person"], { name: "Toto" })
        .addNode("alice", ["knight"], { name: "Alice", number: 30 })
        .addEdge("toto", "knows", "alice", { since: "2021" })
        .build(),
        `
        :PersonPGType a prec:PRSCNodeRule ;
          prec:label "person" ;
          prec:propertyKey "name" ;
          prec:produces
            << pvar:node rdf:type :Person >> ,
            << pvar:node :name "name"^^prec:_valueOf >> .
        
        :KnightPGType a prec:PRSCNodeRule ;
          prec:label "knight" ;
          prec:propertyKey "name" ;
          prec:propertyKey "number" ;
          prec:produces
            << pvar:node rdf:type :Knight >> ,
            << pvar:node :name   "name"^^prec:_valueOf >> ,
            << pvar:node :number "number"^^prec:_valueOf >> .
        
        :KnowsPGEdge a prec:PRSCEdgeRule ;
          prec:label "knows" ;
          prec:propertyKey "since" ;
          prec:produces
               << pvar:source :knows pvar:destination >> ,
            << << pvar:source :knows pvar:destination >> :since "since"^^prec:_valueOf >> .
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
        [] a prec:PRSCNodeRule ;
          prec:propertyKey "name" ;
          prec:produces << pvar:node :name "name"^^prec:_valueOf  >> .
        `,
        ' _:tintin :name "Tintin" . _:milou :name "Mille Loups" .',
        true
      );

      test("A label",
        PGBuild()
        .addNode(null, ["Letter"], { value: "A" })
        .build(),
        `
        [] a prec:PRSCNodeRule ;
          prec:label "Letter" ;
          prec:propertyKey "value" ;
          prec:produces << pvar:node :isTheLetter "value"^^prec:_valueOf >> .
        `,
        ` _:a :isTheLetter "A" . `,
        true
      );

      test("Two labels",
        PGBuild()
        .addNode(null, ["Letter", "Vowel"], { value: "A" })
        .build(),
        `
        [] a prec:PRSCNodeRule ;
          prec:label "Letter", "Vowel" ;
          prec:propertyKey "value" ;
          prec:produces << pvar:node :isTheLetter "value"^^prec:_valueOf >> .
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
        [] a prec:PRSCNodeRule ;
          prec:label "Letter" ;
          prec:propertyKey "value" ;
          prec:produces << pvar:node :isTheLetter "value"^^prec:_valueOf >> .
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
        ""
      );

      badPGToRDF(
        "A node with incompatible schema",
        (() => {
          const pg = new PropertyGraph();
          pg.addNode();
          return pg;
        })(),
        `
        [] a prec:PRSCNodeRule ;
          prec:label "You need a label" ;
          prec:produces << pvar:node :exists :inthepg >> .
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
        [] a prec:PRSCNodeRule ;
          prec:label "First Label" ;
          prec:produces << pvar:node :exists :inthepg >> .
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
        [] a prec:PRSCNodeRule ;
          prec:label "person" .

        :otherSchema a prec:PRSCNodeRule .

        [] a prec:PRSCEdgeRule ;
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
        :person a prec:PRSCNodeRule ;
          prec:label "person" .

        [] a prec:PRSCEdgeRule ;
          prec:prscSource :person ;
          prec:prscDestination :person ;
          prec:label "connait" .
        `
      );

      test("A bad context format (invalid blank node)",
        (() => {
          const pg = new PropertyGraph();
          pg.addNode();
          return pg;
        })(),
        `
        [] a prec:PRSCNodeRule ;
          prec:produces << pvar:node a [ :hello :work ] >> .
        `,
        `
        _:the_node a [ :hello :work ] .
        `
      );

      test("A context with a nested property",
        (() => {
          const pg = new PropertyGraph();
          pg.addNode().addProperty("name", "toto");
          pg.addNode().addProperty("name", "titi");
          return pg;
        })(),
        `
        [] a prec:PRSCNodeRule ;
          prec:propertyKey "name" ;
          prec:produces << pvar:node :has_prop [ :name "name"^^prec:_valueOf ] >> .
        `,
        `
        _:toto :has_prop [ :name "toto" ] .
        _:titi :has_prop [ :name "titi" ] .
        `
      );

      badPGToRDF("A bad context format (property name is not found in the node / schema)",
        (() => {
          const pg = new PropertyGraph();
          pg.addNode();
          return pg;
        })(),
        `
        [] a prec:PRSCNodeRule ;
          prec:produces << pvar:node a "name"^^prec:_valueOf >> .
        `
      );
      
      badPGToRDF("Node lacks the property in the schema",
        (() => {
          const pg = new PropertyGraph();
          pg.addNode();
          return pg;
        })(),
        `
        [] a prec:PRSCNodeRule ;
          prec:propertyKey "name" ;
          prec:produces << pvar:node a "name"^^prec:_valueOf >> .
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
        :something a prec:PRSCNodeRule ;
          prec:propertyKey "name" ;
          prec:produces
            << pvar:node :is_named "name"^^prec:_valueOf >> ,
            << pvar:node :is_named "Grove" >> .
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
        :node a prec:PRSCNodeRule ; prec:produces << pvar:node a :node >> .

        :edgeHey a prec:PRSCEdgeRule ;
          prec:label "hey" ;
          prec:produces << << pvar:edge :src pvar:source >> :to pvar:destination >> .

        :edgeTo a prec:PRSCEdgeRule ;
          prec:label "to" ;
          prec:produces << << pvar:source :src pvar:edge >> :to pvar:destination >> .
        `,
        `
        _:node a :node .
        << _:node :src _:edge >> :to _:node .
        `,
        RevertableType.ShouldThrowForNow
      )
    });

    const pgNodeEdgeNode = PGBuild()
      .addNode("node1", [], {})
      .addNode("node2", [], {})
      .addEdge("node1", "to", "node2", {})
      .build();

    describe("Trick reversions", () => {
      test(
        "The signature is not unique",
        pgNodeEdgeNode,
        `
          :node a prec:PRSCNodeRule ; prec:produces << pvar:self a :node >> .

          :edgeTo a prec:PRSCEdgeRule ;
            prec:label "to" ;
            prec:produces
              << pvar:source :to pvar:self >> ,
              << pvar:self :to pvar:destination >> ,
              << pvar:self rdf:subject pvar:source >> ,
              << pvar:self rdf:object pvar:destination >> .

            
          :edgeFrom a prec:PRSCEdgeRule ;
            prec:label "from" ;
            prec:produces
              << pvar:destination :from pvar:self >> ,
              << pvar:self :from pvar:source >> ,
              << pvar:self rdf:subject pvar:source >> ,
              << pvar:self rdf:object pvar:destination >> .
        `,
        `
          _:n1 a :node .
          _:n2 a :node .
          _:n1 :to _:e1 .
          _:e1 :to _:n2 .
          _:e1 rdf:subject _:n1 .
          _:e1 rdf:object _:n2 .
        `,
        true
      );

      test(
        "Edge unique edges should be translated back correctly",
        pgNodeEdgeNode,
        `
          :node a prec:PRSCNodeRule ; prec:produces << pvar:self a :node >> .

          :edgeTo a prec:PRSCEdgeRule ;
            prec:label "to" ;
            prec:produces
              << pvar:source :connected_to pvar:destination >> ,
              << pvar:destination :connected_to pvar:source >> ,
              << pvar:source :to pvar:destination >> .
        `,
        `
          _:n1 a :node. _:n2 a :node.
          _:n1 :connected_to _:n2 .
          _:n2 :connected_to _:n1 .
          _:n1 :to _:n2 .
        `,
        true
      );
    })
  });
};
