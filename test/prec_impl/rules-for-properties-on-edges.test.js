
module.exports = function (test) {
  describe("Edge property convertion", function () {


    describe("Corner cases", function () {
      test('Property is mapped to rdf:subject',
        `
          :source      a pgo:Node .
          :destination a pgo:Node .
          
          :edge a pgo:Edge ;
              rdf:subject   :source ;
              rdf:predicate :predicate ;
              rdf:object    :destination ;
              :property     :property_vn .
          
          :predicate rdfs:label "Label" .
          :property rdfs:label "Subject" ; a prec:PropertyKey, prec:CreatedPropertyKey .
          :property_vn a prec:PropertyKeyValue ; rdf:value "Value" .
        `,
        `
          [] a prec:PropertyRule ;
            prec:propertyName "Subject" ;
            prec:propertyIRI rdf:subject ;
            prec:templatedBy prec:DirectTriples .

          prec:Edges prec:templatedBy prec:RdfStarUnique .
        `,
        `
          :source      a pgo:Node .
          :destination a pgo:Node .
      
          :source :predicate :destination .
          << :source :predicate :destination >> a pgo:Edge .
          << :source :predicate :destination >> rdf:subject "Value" .    
          
          :predicate rdfs:label "Label" .
        `
      );

      test('A very timid translation with a lot of nesting',
      `
        :edge a pgo:Edge ;
          rdf:subject   :s ;
          rdf:object    :o ;
          rdf:predicate :p .

        :s a pgo:Node .
        :o a pgo:Node .
        :p rdfs:label "TheEdge" ; a prec:CreatedEdgeLabel .
      
        :edge :flies :propertyNode .
        :flies a prec:CreatedPropertyKey, prec:PropertyKey ; rdfs:label "theProp" .

        :propertyNode a prec:PropertyKeyValue ; rdf:value "Hey" .
      `,
      `
        prec:Edges prec:templatedBy [
          prec:composedOf << << pvar:source pvar:edgeIRI pvar:destination >> :isA :triple >> ;
          prec:composedOf << << pvar:destination pvar:edgeIRI pvar:source >> pvar:propertyPredicate pvar:propertyObject >>
        ] .

        prec:Properties prec:templatedBy [
          prec:composedOf
            <<
              <<
                << pvar:propertyKey :isA :property >>
                :withTheValue
                << :thatIs :valued pvar:propertyValue >>
              >>
              :isOnTheReversed
              << :theThing :named pvar:entity >>
            >>
        ] .
      `,
      `
        << :s :p :o >> :isA :triple .

        <<
          << :flies :isA :property >>
          :withTheValue
          << :thatIs :valued "Hey" >>
        >>
        :isOnTheReversed
        << :theThing :named << :o :p :s >> >> .
      
        :flies a prec:CreatedPropertyKey, prec:PropertyKey ; rdfs:label "theProp" .
        
        :s a pgo:Node .
        :o a pgo:Node .
        :p rdfs:label "TheEdge" ; a prec:CreatedEdgeLabel .
      `
      )

    });

  });
}
