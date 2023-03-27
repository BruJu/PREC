import { PrecCApplicationTester } from "./test-function";

module.exports = (test: PrecCApplicationTester) => {
  describe("Edge convertion", () => {
    const basicGraphs = {
      oneEdge: `
          :edge  a pgo:Edge ; rdf:subject :s  ; rdf:predicate :p  ; rdf:object :o  .
      `,
      twoEdges: `
          :edge1 a pgo:Edge ; rdf:subject :s1 ; rdf:predicate :p1 ; rdf:object :o1 .
          :edge2 a pgo:Edge ; rdf:subject :s2 ; rdf:predicate :p2 ; rdf:object :o2 .
      `,
      oneEdgeType: `
          :edge  a pgo:Edge ; rdf:subject :s  ; rdf:predicate :p  ; rdf:object :o  .
          :p rdfs:label "type1" .
      `,
      edgeDiff: `
          :edge1 a pgo:Edge ; rdf:subject :s1 ; rdf:predicate :p1 ; rdf:object :o1 .
          :edge2 a pgo:Edge ; rdf:subject :s2 ; rdf:predicate :p2 ; rdf:object :o2 .
          
          :p1 rdfs:label "type1" .
          :p2 rdfs:label "type2" .
      `,
      differentSourceLabel: `
          :edge1 a pgo:Edge ; rdf:subject :person ; rdf:predicate :p ; rdf:object :o .
          :edge2 a pgo:Edge ; rdf:subject :animal ; rdf:predicate :p ; rdf:object :o .
          :p rdfs:label "Predicate" .

          :person a [ rdfs:label "Person" ], pgo:Node .
          :animal a [ rdfs:label "Animal" ], pgo:Node .
      `,
      // The following original graphs are not relevant anymore as PREC-C is
      // now more strict on the graphs it takes (it now accepts way less
      // intermediate results graphs)
      oneEdgeWith1Property: `
          :edge a pgo:Edge ; rdf:subject :s ; rdf:predicate :p ; rdf:object :o ;
              :propKey1 :propValue1 .
      `,
      oneEdgeWith2Properties: `
          :edge a pgo:Edge ; rdf:subject :s ; rdf:predicate :p ; rdf:object :o ;
              :propKey1 :propValue1 ; :propKey2 :propValue2 .
      `,
      edgeWithMetaProperty: `
          :edge a pgo:Edge ; rdf:subject :s ; rdf:predicate :p ; rdf:object :o ;
              :propKey :propValue .
          
          << :edge :propKey :propValue >> :metaPropKey :metaPropValue .
      `
    };

    const contexts = {
      emptyContext  : ``,
      allUnique     : `prec:Edges prec:templatedBy prec:RdfStarUnique . `,
      allOccurences : `prec:Edges prec:templatedBy prec:RdfStarOccurrence . `,
      type1specialization: `
          prec:Edges prec:templatedBy prec:RdfStarUnique .
          :type1 prec:IRIOfEdgeLabel "type1" .
      `,
      type1templatedBy: `
          prec:Edges prec:templatedBy prec:RdfStarOccurrence .
          [] a prec:EdgeRule ;
              prec:edgeIRI   :type1 ;
              prec:label "type1" ;
              prec:templatedBy prec:RdfStarUnique .
      `,
    }

    describe('Lack of context', () => {
      const graphs = [
        'oneEdge',
        'twoEdges',
        'oneEdgeType',
        'edgeDiff',
        'differentSourceLabel',
        //'oneEdgeWith1Property',       // Not relevant anymore
        //'oneEdgeWith2Properties',     // Not relevant anymore
        //'edgeWithMetaProperty'        // Not relevant anymore
      ];

      for (const graph of graphs) {
        // @ts-ignore
        test('Idempotency on basicGraphs.' + graph, basicGraphs[graph], '', basicGraphs[graph]);
      }
    });

    describe("PG without properties", function () {
      test('OneEdge with prec:RdfStarUnique',
        basicGraphs.oneEdge, contexts.allUnique,
        ':s :p :o . << :s :p :o  >> a pgo:Edge .'
      );

      test('TwoEdges with prec:RdfStarUnique',
        basicGraphs.twoEdges, contexts.allUnique, 
        `:s1 :p1 :o1 . << :s1 :p1 :o1  >> a pgo:Edge .
        :s2 :p2 :o2 . << :s2 :p2 :o2  >> a pgo:Edge .`
      );

      test('OneEdge with prec:RdfStarOccurrence',
        basicGraphs.oneEdge, contexts.allOccurences,
        ` :edge a pgo:Edge . :edge prec:occurrenceOf << :s :p :o  >> .`
      );

      test('One typed edge with a rule',
        basicGraphs.oneEdgeType, contexts.type1specialization,
        ':s :type1 :o . << :s :type1 :o >> a pgo:Edge .'
      );

      test('One type edge with a specific template for it',
        basicGraphs.oneEdgeType, contexts.type1templatedBy,
        ':s :type1 :o . << :s :type1 :o >> a pgo:Edge .'
      );

      test('Two typed edges with one that is unaffected by the implicit rule',
        basicGraphs.edgeDiff, contexts.type1specialization,
        `:s1 :type1 :o1 . << :s1 :type1 :o1  >> a pgo:Edge .

        :s2 :p2 :o2 . << :s2 :p2 :o2  >> a pgo:Edge .
        :p2 rdfs:label "type2" .`
      );

      test('Two typed edges with one that is unaffected by the explicit rule',
        basicGraphs.edgeDiff,
        `
          prec:Edges prec:templatedBy prec:RdfStarUnique .
          [] a prec:EdgeRule ; prec:edgeIRI :type1 ; prec:label "type1" .
        `,
        `:s1 :type1 :o1 . << :s1 :type1 :o1  >> a pgo:Edge .

        :s2 :p2 :o2 . << :s2 :p2 :o2  >> a pgo:Edge .
        :p2 rdfs:label "type2" .`
      );
      
      test('Two typed edges with only one affected by a rule with template',
        basicGraphs.edgeDiff, contexts.type1templatedBy,
        `:s1 :type1 :o1 . << :s1 :type1 :o1  >> a pgo:Edge .

          :edge2 a pgo:Edge .
          :edge2 prec:occurrenceOf << :s2 :p2 :o2  >> .
          :p2 rdfs:label "type2" .`
      );

      test('A rule that targets edges with a specific souce node label',
        basicGraphs.differentSourceLabel,
        `
          prec:Edges prec:templatedBy prec:RdfStarOccurrence .
          [] a prec:EdgeRule ;
              prec:edgeIRI :NewPredicate ;
              prec:templatedBy prec:RdfStarUnique ;
              prec:label "Predicate" ;
              prec:sourceLabel "Person"
          .
        `,
        `
          << :person :NewPredicate :o  >> a pgo:Edge .
          :person :NewPredicate :o .

          :edge2 a pgo:Edge .
          :edge2 prec:occurrenceOf << :animal :p :o  >> .
          :p rdfs:label "Predicate" .

          :person a [ rdfs:label "Person" ], pgo:Node .
          :animal a [ rdfs:label "Animal" ], pgo:Node .
        `
      );

      test('A rule for the two edges in the graph',
        basicGraphs.edgeDiff,
        `
        [] a prec:EdgeRule ;
          prec:edgeIRI :type1 ;
          prec:label "type1" ;
          prec:templatedBy prec:RdfStarUnique
        .
        
        [] a prec:EdgeRule ;
          prec:edgeIRI :type2 ;
          prec:label "type2" ;
          prec:templatedBy prec:RdfStarUnique
        .
        `,
        `
          << :s1 :type1 :o1  >> a pgo:Edge .
          :s1 :type1 :o1 .

          << :s2 :type2 :o2  >> a pgo:Edge .
          :s2 :type2 :o2 .
        `
      );
          
      test('Substitution within the RDFReification template',
        basicGraphs.oneEdge,
        `prec:Edges prec:templatedBy prec:RDFReification ;
          prec:subject :source ;
          prec:predicate :label ;
          prec:object :target .`,
        `:edge a pgo:Edge ;
          :source :s ;
          :label  :p ;
          :target :o .`
      );
          
      test("One edge with an user defined template", 
        basicGraphs.oneEdge,    
        `prec:Edges prec:templatedBy [ prec:produces
            << rdf:subject rdf:predicate rdf:object >> ,
            << pvar:destination pvar:edgeIRI pvar:source >>
        ] .`,
        'rdf:subject rdf:predicate rdf:object . :o :p :s . '
      );
        
      test("One edge with an user defined template and with substitutions",
        basicGraphs.oneEdge,
        `prec:Edges prec:templatedBy [ prec:produces
          << rdf:subject rdf:predicate rdf:object >> ,
          << pvar:destination pvar:edgeIRI pvar:source >>
        ] ;
          prec:subject   :source ;
          prec:predicate :label ;
          prec:object    :target .
        `,
        ':source :label :target . :o :p :s .'
      );

      test("One edge with implicit renaming of the RDF Reification model",
        basicGraphs.oneEdge,
        `
          prec:Edges
            prec:subject   :source ;
            prec:predicate :label ;
            prec:object    :target .
        `,
        `
          :edge a pgo:Edge ;
          :source :s ;
          :label  :p ;
          :target :o .
        `
      );

      test('Change the direction of every edge with substitutions',
        basicGraphs.oneEdge,
        'prec:Edges prec:subject rdf:object ; prec:object rdf:subject .',
        ':edge a pgo:Edge ; rdf:object :s ; rdf:predicate :p ; rdf:subject :o .'
      );
      
      test('Use the label in an edge template',
        basicGraphs.edgeDiff,
        `
        prec:Edges prec:templatedBy [ prec:produces
          << :anEdge :holdsTheLabel pvar:label  >>
        ] .
        `,
        ':anEdge :holdsTheLabel "type1", "type2" .'
      );
    })

    describe("PG with properties on edges", function () {
      // These tests are ok as unit tests, but bad in the whole process
      // and they are not relevant anymore
      return;
      test('One edge with one property',
        basicGraphs.oneEdgeWith1Property,
        contexts.allUnique,
        `
          :s :p :o .
          << :s :p :o >> a pgo:Edge ; :propKey1 :propValue1 .
        `
      );

      test("One edge with two properties",
        basicGraphs.oneEdgeWith2Properties,
        contexts.allUnique, 
        `
          :s :p :o .
          << :s :p :o >> a pgo:Edge ; 
            :propKey1 :propValue1 ;
            :propKey2 :propValue2 .
        `
      );

      test("One edge with one property with one meta property",
        basicGraphs.edgeWithMetaProperty,
        contexts.allUnique,
        `
          :s :p :o .
          << :s :p :o >> a pgo:Edge ; :propKey :propValue .
          << << :s :p :o >> :propKey :propValue >> :metaPropKey :metaPropValue .
        `
      );
    });
  });
};
