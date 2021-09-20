import { PropertyGraph, PGBuild } from "../mock-pg/pg-implem";

export type TestFromPG = (
  name: string,
  pg: PropertyGraph,
  context: string, expected: string,
  revertible?: boolean
) => void;

export type TestBad = (
  name: string,
  pg: PropertyGraph,
  context: string
) => void;


module.exports = (test: TestFromPG, bad: TestBad) => {
  describe('PRSC', () => {

    describe("Simple cases", () => {

      test("Empty all", new PropertyGraph(),
        "prec:this_is a prec:prscContext .",
        "",
        true
      );

      bad("A PG but no context",
        (() => {
          const pg = new PropertyGraph();
          const toto = pg.addNode("toto");
          const titi = pg.addNode("titi");
          pg.addEdge(toto, "knows", titi);
          return pg;
        })(),
        "prec:this_is a prec:prscContext ."
      );

      bad(
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

      bad(
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

      bad("A PG without a schema for the edge (bad node schema)",
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

      bad("A PG without a schema for the edge (bad label)",
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

      bad("A bad context format (invalid blank node)",
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

      bad("A bad context format (property name is not a literal)",
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

      bad("A bad context format (property name is not found in the node / schema)",
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
      
      bad("Node lacks the property in the schema",
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
  });
};
