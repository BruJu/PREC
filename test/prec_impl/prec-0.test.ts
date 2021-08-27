import { PropertyGraph } from '../mock-pg/pg-implem';

const PREFIX_NODE_LABEL = 'PREFIX nl: <http://www.example.org/vocab/node/label/> \n';
const PREFIX_NODE_PROP  = 'PREFIX np: <http://www.example.org/vocab/node/property/> \n';
const PREFIX_EDGE_LABEL = 'PREFIX el: <http://www.example.org/vocab/edge/label/> \n';
const PREFIX_EDGE_PROP  = 'PREFIX ep: <http://www.example.org/vocab/edge/property/> \n';
const PREFIXES = PREFIX_NODE_LABEL + PREFIX_NODE_PROP + PREFIX_EDGE_LABEL + PREFIX_EDGE_PROP;


module.exports = (test_: (name: string, pg: PropertyGraph, _: string, rdf: string) => void) => {
  const test = (name: string, pg: PropertyGraph, rdf: string) => test_(name, pg, '', rdf);

  describe('PREC-0', () => {
    test("EmptyGraph", new PropertyGraph(), '');

    test("OneNode",
      (() => {
        const pg = new PropertyGraph();
        pg.addNode("Person", "Father", "President");
        return pg;
      })(),
      PREFIXES + 
      `
        _:node a nl:Person, nl:Father, nl:President, pgo:Node .
        nl:Person rdfs:label "Person" ; a prec:CreatedNodeLabel .
        nl:President rdfs:label "President" ; a prec:CreatedNodeLabel .
        nl:Father rdfs:label "Father" ; a prec:CreatedNodeLabel .
      `
    );

    test("AliceIsNamed",
      (() => {
        const pg = new PropertyGraph();
        const alice = pg.addNode("Person");
        alice.addProperty("name", "Alice");
        return pg;
      })(),
      PREFIXES + 
      `
        _:alice a nl:Person, pgo:Node .
        nl:Person rdfs:label "Person" ; a prec:CreatedNodeLabel .

        _:alice np:name\\/Person [
          a prec:PropertyKeyValue ;
          rdf:value "Alice"
        ] .
        
        np:name\\/Person a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "name" .
      `
    );

    false && test("AliceWorksForAcme",
      (() => {
        const pg = new PropertyGraph();
        const alice = pg.addNode("Person");
        alice.addProperty("name", "Alice");
        const acme = pg.addNode("Incorporation");
        acme.addProperty("name", "acme");
        pg.addEdge(alice, "worksFor", acme);
        return pg;
      })(),
      PREFIXES + 
      `
        _:alice a nl:Person, pgo:Node .
        nl:Person rdfs:label "Person" ; a prec:CreatedNodeLabel .

        _:alice np:name\\/Person [
          a prec:PropertyKeyValue ;
          rdf:value "Alice"
        ] .
        
        np:name\\/Person a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "name" .
        
        _:acme a pgo:Node, nl:Incorporation .
        nl:Incorporation rdfs:label "Incorporation" ; a prec:CreatedNodeLabel .

        _:acme np:name\\/Incorporation [
          a prec:PropertyKeyValue ;
          rdf:value "ACME"
        ] .

        np:name\\/Incorporation a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "name"  .

        _:edge a pgo:Edge ;
          rdf:subject _:alice ;
          rdf:predicate el:worksFor ;
          rdf:object _:acme .
      
        el:worksFor rdfs:label "worksFor" ; a prec:CreatedEdgeLabel .
      `
    );

  });
};



/*
TODO: test meta properties
, _:oldacmename .

        _:oldacmename
          a prec:PropertyKeyValue ;
          rdf:value "Another Company Moving Enterprises" .
*/