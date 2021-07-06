
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


    });

  });
}
