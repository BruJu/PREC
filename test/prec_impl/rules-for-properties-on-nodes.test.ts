import { PrecCApplicationTester } from "./test-function";

module.exports = function (test: PrecCApplicationTester) {
  describe("Node property convertion", function () {
    const graphs = {
      oneNodeWithProperty: `
        :node a pgo:Node ; :p [ rdf:value "v1" ; a prec:PropertyKeyValue ] .
        :p a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "P1" .
      `,
      oneNodeWithTwoProperties: `
        :node a pgo:Node ;
          :p1 [ rdf:value "v1" ; a prec:PropertyKeyValue ] ;
          :p2 [ rdf:value "v2" ; a prec:PropertyKeyValue ] .
        
        :p1 a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "P1" .
        :p2 a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "P2" .
      `,
      oneNodeWithAMultiValuedProperty: `
        :node a pgo:Node ;
          :p [ rdf:value "v1" ; a prec:PropertyKeyValue ] ;
          :p [ rdf:value "v2" ; a prec:PropertyKeyValue ] .
        :p a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "P1" .
      `,

    };

    const contexts = {
      longP1isKnows: `
        [] a prec:PropertyRule ;
          prec:propertyIRI :knows ;
          prec:propertyKey "P1"  .
      `,

      PGOProperty: `
        prec:Properties prec:templatedBy [
          prec:produces
            << pvar:entity       pgo:hasProperty pvar:propertyNode  >> ,
            << pvar:propertyNode pgo:key         pvar:label         >> ,
            << pvar:propertyNode pgo:value       pvar:propertyValue >>
        ] .
      `
    }

    describe("Idempotency", function () {
      test('Idempotency on a node with no property with no context',
        ':node a pgo:Node .', '', ':node a pgo:Node .'
      );

      test('Idempotency on a node with one property with no context',
        graphs.oneNodeWithProperty,
        '',
        graphs.oneNodeWithProperty
      );

      test('Idempotency on a node with two properties with no context',
        graphs.oneNodeWithTwoProperties,
        '',
        graphs.oneNodeWithTwoProperties
      );

      test('Idempotency on a note with a multi valued property with no context',
        graphs.oneNodeWithAMultiValuedProperty,
        '',
        graphs.oneNodeWithAMultiValuedProperty,
      );

      test('A rule on a property should do nothing on an empty graph',
        '',
        ':knows prec:IRIOfProperty "P1" .',
        ''
      );
    });
    

    describe('Tests with a context', function () {
      test('One node with one property and one abbreviated rule on this property',
        graphs.oneNodeWithProperty,
        ':knows prec:IRIOfProperty "P1" .',
        ':node a pgo:Node ; :knows [ rdf:value "v1" ; a prec:PropertyKeyValue ] .'
      );

      test('One node with one property materialized like in PGO',
        graphs.oneNodeWithProperty,
        contexts.PGOProperty,
        `
          :node a pgo:Node .
          :node pgo:hasProperty [
            pgo:key "P1" ;
            pgo:value "v1"
          ] .
        `
      );

      test('One node with two properties and one abbreviated rule for one of them',
        graphs.oneNodeWithTwoProperties,
        ':loves prec:IRIOfProperty "P1" .',
        `
          :node a pgo:Node ;
            :loves [ rdf:value "v1" ; a prec:PropertyKeyValue ] ;
            :p2    [ rdf:value "v2" ; a prec:PropertyKeyValue ] .
          :p2 a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "P2" .
        `
      );

      test('It should also work with the non abbreviated version',
        graphs.oneNodeWithTwoProperties,
        contexts.longP1isKnows,
        `
          :node a pgo:Node ;
            :knows [ rdf:value "v1" ; a prec:PropertyKeyValue ] ;
            :p2    [ rdf:value "v2" ; a prec:PropertyKeyValue ] .
          :p2 a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "P2" .
        `
      );

      test('One node with two properties mapped by PGO',
          graphs.oneNodeWithTwoProperties,
          contexts.PGOProperty,
          `
            :node a pgo:Node .
            :node pgo:hasProperty _:theProperty1 .
            _:theProperty1 pgo:key "P1" .
            _:theProperty1 pgo:value "v1" .

            :node pgo:hasProperty _:theProperty2 .
            _:theProperty2 pgo:key "P2" .
            _:theProperty2 pgo:value "v2" .
          `
      );

      test('Every property value of a multi valued property should be affected',
        graphs.oneNodeWithAMultiValuedProperty,
        ':talks prec:IRIOfProperty "P1" .',
        `
          :node a pgo:Node ;
            :talks [ rdf:value "v1" ; a prec:PropertyKeyValue ] ;
            :talks [ rdf:value "v2" ; a prec:PropertyKeyValue ] .
        `
      );

      test('Multi valued property with the non abbreviated context',
        graphs.oneNodeWithAMultiValuedProperty,
        contexts.longP1isKnows,
        `
          :node a pgo:Node ;
            :knows [ rdf:value "v1" ; a prec:PropertyKeyValue ] ;
            :knows [ rdf:value "v2" ; a prec:PropertyKeyValue ] .
        `
      );
    });
  });
};
