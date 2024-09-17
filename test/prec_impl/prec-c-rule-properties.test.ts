
export type TestFromPREC0 = (
  name: string,
  input: string,
  context: string,
  expected: string
) => void;


module.exports = function (testFromPREC0: TestFromPREC0) {
  describe('PREC-C ~ Rule based context ~ Properties', () => {
    testFromPREC0(
      "Cartesian product between property and meta property",
      `
        :node a pgo:Node ;
          :property [
            a prec:PropertyKeyValue ; rdf:value ( "A" "B" "C" "D" "E" ) ;
            prec:hasMetaProperties [
              :property [ a prec:PropertyKeyValue ; rdf:value ( 1 2 3 ) ]
            ]
          ] .
        
        :property a prec:PropertyKey, prec:CreatedPropertyKey ;
          rdfs:label "Property" .
      `,
      `
        prec:Properties     prec:templatedBy prec:CartesianProduct .
        prec:KeepProvenance prec:flagState false .
    
        prec:CartesianProduct a prec:PropertyTemplate ;
          prec:produces << pvar:holder pvar:propertyKey pvar:individualValue >> ;
          prec:selfIs << pvar:holder pvar:propertyKey pvar:individualValue >> .
        
        [] a prec:PropertyRule ;
          prec:propertyKey "Property" ;
          prec:propertyIRI :element .
      `,
      `
        :node :element "A", "B", "C", "D", "E" .
        << :node :element "A" >> :element 1 .
        << :node :element "B" >> :element 1 .
        << :node :element "C" >> :element 1 .
        << :node :element "D" >> :element 1 .
        << :node :element "E" >> :element 1 .
        << :node :element "A" >> :element 2 .
        << :node :element "B" >> :element 2 .
        << :node :element "C" >> :element 2 .
        << :node :element "D" >> :element 2 .
        << :node :element "E" >> :element 2 .
        << :node :element "A" >> :element 3 .
        << :node :element "B" >> :element 3 .
        << :node :element "C" >> :element 3 .
        << :node :element "D" >> :element 3 .
        << :node :element "E" >> :element 3 .
      `
    );
  });

  describe('PREC-C ~ Rule based context ~ Property List', () => {
    const simpleProperty = `
      :node a pgo:Node .
      :node :pName :pBlankNode .
      :pBlankNode rdf:value ( "a" "b" "c" ) ; a prec:PropertyKeyValue .
      :pName rdfs:label "key" ; a prec:PropertyKey, prec:CreatedPropertyKey .
    `;

    const templatedBy = function (template: string) {
      return `
        prec:Properties prec:templatedBy [ prec:produces ${template} ] .
        [] a prec:PropertyRule ;
          prec:propertyKey "key" ;
          prec:propertyIRI :k .
      `;
    };

    testFromPREC0(
      "Regular property conversion",
      simpleProperty,
      templatedBy("<< pvar:holder pvar:propertyKey pvar:propertyValue >>"),
      ':node a pgo:Node ; :k ( "a" "b" "c" ) .'
    );

    testFromPREC0(
      "Only keep individual values",
      simpleProperty,
      templatedBy("<< pvar:holder pvar:propertyKey pvar:individualValue >>"),
      ':node a pgo:Node ; :k "a", "b", "c" .'
    );

    testFromPREC0(
      "Keep both",
      simpleProperty,
      templatedBy("<< pvar:holder pvar:propertyKey pvar:individualValue >> ,"
          + "\n << pvar:holder :usedList pvar:propertyValue >>"),
      ':node a pgo:Node ; :k "a", "b", "c" ; :usedList ( "a" "b" "c" ) .'
    );
  });

  describe('PREC-C ~ Rule based context ~ Mix node and edge properties', () => {
    const edgeWithAMetaProperty = `
      :source      a pgo:Node .
      :destination a pgo:Node .

      :edge rdf:subject   :source       ;
            rdf:predicate :predicate    ;
            rdf:object    :destination  ;
            rdf:type      pgo:Edge      ;
            :property1    :property1_bn ;
            :property2    :property2_bn .

      :predicate rdfs:label "The Predicate Label" .

      :property1 a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "Property 1" .
      :property2 a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "Property 2" .

      :property1_bn a prec:PropertyKeyValue ; rdf:value "Value 1" .
      :property2_bn a prec:PropertyKeyValue ; rdf:value "Value 2" .
      
      :property2_bn prec:hasMetaProperties :meta_property .

      :meta_property :property1 :meta_property_bn .
      :meta_property_bn a prec:PropertyKeyValue ; rdf:value "TheMetaProperty" .
    `;

    testFromPREC0(
      "contextSPOPartial",
      edgeWithAMetaProperty,
      `
        prec:Properties     prec:templatedBy prec:DirectTriples .
        prec:Edges          prec:templatedBy prec:RdfStarUnique .
        prec:KeepProvenance prec:flagState false .

        :Z_PREDICATE prec:IRIOfEdgeLabel "The Predicate Label" .
        :Z_FIRST  prec:IRIOfProperty "Property 1" .
        :Z_SECOND prec:IRIOfProperty "Property 2" .
      `,
      `
              :source :Z_PREDICATE :destination .
          << :source :Z_PREDICATE :destination >> :Z_FIRST  "Value 1" .
          << :source :Z_PREDICATE :destination >> :Z_SECOND "Value 2" .
        << << :source :Z_PREDICATE :destination >> :Z_SECOND "Value 2" >> :Z_FIRST "TheMetaProperty" .
      `
    );

    testFromPREC0(
      "contextSPO",
      edgeWithAMetaProperty,
      `
        prec:Properties     prec:templatedBy prec:DirectTriples .
        prec:KeepProvenance prec:flagState false .

        [] a prec:PropertyRule ;
          prec:propertyKey "Property 1" ;
          prec:propertyIRI  :Z_FIRST .
        
        [] a prec:PropertyRule ;
          prec:propertyKey "Property 2" ;
          prec:propertyIRI  :Z_SECOND .
      `,
      `
        # Predicate Label is untouched
        :predicate rdfs:label "The Predicate Label" .

        # The edge, not yet as S P O
              :edge rdf:subject   :source       ;
                    rdf:predicate :predicate    ;
                    rdf:object    :destination  .

              :edge :Z_FIRST  "Value 1" .
              :edge :Z_SECOND "Value 2" .
        <<    :edge :Z_SECOND "Value 2" >> :Z_FIRST "TheMetaProperty" .
      `
    );
  });


};
