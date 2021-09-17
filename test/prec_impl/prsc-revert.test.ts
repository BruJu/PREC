import { PropertyGraph } from "../mock-pg/pg-implem";

export type TestFromPG = (
  name: string,
  pg: PropertyGraph,
  context: string
) => void;

export type TestBad = (
  name: string,
  pg: PropertyGraph,
  context: string
) => void;


module.exports = (test: TestFromPG, _bad: TestBad) => {
  describe('PRSC', () => {

    describe("Simple cases", () => {

//      test("Empty all", new PropertyGraph(),
//        "prec:this_is a prec:prscContext ."
//      );



//      test(
//        "A node with compatible schema",
//        (() => {
//          const pg = new PropertyGraph();
//          pg.addNode();
//          return pg;
//        })(),
//        `
//        prec:this_is a prec:prscContext .
//
//        [] a prec:prsc_node ;
//          prec:composedOf << pvar:node :exists :inthepg >> .
//        `
//      );
//
//      test("A PG without a schema for the edge (bad label)",
//        (() => {
//          const pg = new PropertyGraph();
//          const toto = pg.addNode("person");
//          const titi = pg.addNode("person");
//          pg.addEdge(toto, "knows", titi);
//          return pg;
//        })(),
//        `
//        prec:this_is a prec:prscContext .
//
//        :person a prec:prsc_node ;
//          prec:nodeLabel "person" .
//
//        [] a prec:prsc_edge ;
//          prec:prscSource :person ;
//          prec:prscDestination :person ;
//          prec:edgeLabel "knows" ;
//          prec:composedOf << pvar:source :knows pvar:destination >>,
//            << pvar:edge :is :discarded  >> .
//        `
//      );
//
//      test("A property is used",
//        (() => {
//          const pg = new PropertyGraph();
//          const node = pg.addNode();
//          node.addProperty("name", "toto");
//          return pg;
//        })(),
//        `prec:this_is a prec:prscContext .
//        
//        [] a prec:prsc_node ;
//          prec:propertyName "name" ;
//          prec:composedOf << pvar:node :name [ prec:prsc_valueOf "name" ] >> .
//        `
//      );
//      
//      test("Map the property of an edge",
//        (() => {
//          const pg = new PropertyGraph();
//          const toto = pg.addNode("person");
//          const titi = pg.addNode("person");
//          const edge = pg.addEdge(toto, "knows", titi);
//          edge.addProperty("since", "yesterday")
//          return pg;
//        })(),
//        `
//        prec:this_is a prec:prscContext .
//
//        :person a prec:prsc_node ;
//          prec:nodeLabel "person" .
//
//        [] a prec:prsc_edge ;
//          prec:prscSource :person ;
//          prec:prscDestination :person ;
//          prec:edgeLabel "knows" ;
//          prec:propertyName "since" ;
//          prec:composedOf << pvar:source :knows pvar:destination >>,
//            << << pvar:destination :isStalkedBy pvar:source >> :since [ prec:prsc_valueOf "since" ] >> .
//        `
//      );
    });
  });
};
