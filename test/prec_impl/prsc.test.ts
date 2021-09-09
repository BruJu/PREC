import { PropertyGraph } from "../mock-pg/pg-implem";

export type TestFromPG = (
  name: string,
  pg: PropertyGraph,
  context: string, expected: string
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
        ""
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
        ` _:thenode :exists :inthepg . `
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
          prec:edgeLabel "knows" ;
          prec:composedOf << pvar:source :knows pvar:destination >>,
            << pvar:edge :is :discarded  >> .
        `,
        " _:toto :knows _:titi . _:theedgeblanknode :is :discarded . "
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
        (() => {
          const pg = new PropertyGraph();
          const node = pg.addNode();
          node.addProperty("name", "toto");
          return pg;
        })(),
        `prec:this_is a prec:prscContext .
        
        [] a prec:prsc_node ;
          prec:propertyName "name" ;
          prec:composedOf << pvar:node :name [ prec:prsc_valueOf "name" ] >> .
        `,
        '_:toto :name "toto" . '
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
    });
  });
};
