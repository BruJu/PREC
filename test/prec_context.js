
const utility = require("./utility.js");
const graphReducer = require("../prec3/graph-reducer.js");
const assert = require('assert');
const { isomorphic } = require("rdf-isomorphic");
const precUtils = require('../prec3/utils.js')


const basicGraphs = {
    oneEdge:  `
        :edge  a pgo:Edge ; rdf:subject :s  ; rdf:predicate :p  ; rdf:object :o  .
    `,
    twoEdges: `
        :edge1 a pgo:Edge ; rdf:subject :s1 ; rdf:predicate :p1 ; rdf:object :o1 .
        :edge2 a pgo:Edge ; rdf:subject :s2 ; rdf:predicate :p2 ; rdf:object :o2 .
    `,
    oneEdgeType:  `
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

        :person a [ rdfs:label "Person" ] .
        :animal a [ rdfs:label "Animal" ] .
    `,
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
            :edge :propKey :propValue .
        
        << :edge :propKey :propValue >> :metaPropKey :metaPropValue .
    `
};

const contexts = {
    emptyContext  : ``,
    allUnique     : `prec:Relationships prec:modelAs prec:RdfStarUnique . `,
    allOccurences : `prec:Relationships prec:modelAs prec:RdfStarOccurrence . `,
    type1specialization: `
        prec:Relationships prec:modelAs prec:RdfStarUnique .
        :type1 prec:IRIOfRelationship "type1" .
    `,
    type1specializationBN: `
        prec:Relationships prec:modelAs prec:RdfStarUnique .
        [] a prec:RelationshipRule ;
            prec:relationshipIRI   :type1 ;
            prec:relationshipLabel "type1" .
    `,
    type1modelAs: `
        prec:Relationships prec:modelAs prec:RdfStarOccurrence .
        [] a prec:RelationshipRule ;
            prec:relationshipIRI   :type1 ;
            prec:relationshipLabel "type1" ;
            prec:modelAs prec:RdfStarUnique .
    `,
    predicateOnPerson: `
        prec:Relationships prec:modelAs prec:RdfStarOccurrence .
        [] a prec:RelationshipRule ;
            prec:relationshipIRI :NewPredicate ;
            prec:modelAs prec:RdfStarUnique ;
            prec:relationshipLabel "Predicate" ;
            prec:sourceLabel "Person"
        .
    `,
    bothSpecialization: `
        [] a prec:RelationshipRule ;
            prec:relationshipIRI :type1 ;
            prec:relationshipLabel "type1" ;
            prec:modelAs prec:RdfStarUnique
        .
        
        [] a prec:RelationshipRule ;
            prec:relationshipIRI :type2 ;
            prec:relationshipLabel "type2" ;
            prec:modelAs prec:RdfStarUnique
        .
    `,


    useRdfStarrenameTermsImplicit: `
        prec:Relationships prec:subject :source ;
            prec:predicate :label ;
            prec:object :target .
    `,
    modelAsPG: `
        prec:Relationships prec:modelAs prec:RDFReification ;
            prec:subject :source ;
            prec:predicate :label ;
            prec:object :target .
    `,
    modelAsCustom: `
        prec:Relationships prec:modelAs [
            prec:composedOf << rdf:subject rdf:predicate rdf:object >> ,
                << pvar:destination pvar:relationshipIRI pvar:source >>
        ] .
    `,
    modelAsCustomWithRenaming: `
        prec:Relationships prec:modelAs [
            prec:composedOf << rdf:subject rdf:predicate rdf:object >> ,
                << pvar:destination pvar:relationshipIRI pvar:source >>
        ] ;
            prec:subject :source ;
            prec:predicate :label ;
            prec:object :target .
    `,
    modelSwapSO: `
        prec:Relationships prec:subject rdf:object ; prec:object rdf:subject .
    `
}

function badToColorizedToString(quads, match, indent) {
    let asString = precUtils.badToString(quads, indent).split(/\r?\n/);

    for (let i = 0 ; i != quads.length ; ++i) {
        if (match[i] === undefined) continue;

        if (match[i] >= 0) asString[i] = "\x1b[36m" + asString[i] + "\x1b[0m";
    }

    return asString.join("\n");
}

function badToColorizedToStrings(quads1, quads2) {
    let [s1, s2] = precUtils.approximateIsomorphism(quads1, quads2)
    return [
        badToColorizedToString(quads1, s1, 8),
        badToColorizedToString(quads2, s2, 8)
    ];
}

function print(store, d1, graphName, d2, contextName, expectedStore) {
    console.error("Error on " + graphName + " x " + contextName);
    console.error("• Base Graph:");
    console.error(d1[graphName]);
    console.error("• Context:");
    console.error(d2[contextName]);

    [result, expected] = badToColorizedToStrings(store.getQuads(), expectedStore.getQuads());

    console.error(`• Result (${store.size} quads):`);
    console.error(result);
    console.error(`• Expected (${expectedStore.size} quads):`);
    console.error(expected);
}

function runATest(graphName, contextName, expected) {
    it(graphName + " x " + contextName, function() {
        const store         = utility.turtleToDStar(basicGraphs[graphName]);
        const context       = utility.turtleToQuads(contexts[contextName]);
        graphReducer(store, context);

        const expectedStore = utility.turtleToDStar(expected);
        const r = isomorphic(store.getQuads(), expectedStore.getQuads());
        if (!r) print(store, basicGraphs, graphName, contexts, contextName, expectedStore);
        assert.ok(r);
    });
}


function runATest_(dict, graphName, contextName, expected) {
    it(graphName + " x " + contextName, function() {
        const store         = utility.turtleToDStar(dict[graphName]);
        const context       = utility.turtleToQuads(dict[contextName]);
        graphReducer(store, context);

        const expectedStore = utility.turtleToDStar(expected);
        const r = isomorphic(store.getQuads(), expectedStore.getQuads());
        if (!r) print(store, dict, graphName, dict, contextName, expectedStore);
        assert.ok(r);
    });
}

describe("Relationship convertion", function () {
    describe('Lack of context', function() {
        runATest("oneEdge", "emptyContext", basicGraphs['oneEdge']);
        runATest("twoEdges", "emptyContext", basicGraphs['twoEdges']);
        runATest("oneEdgeType", "emptyContext", basicGraphs['oneEdgeType']);
        runATest("edgeDiff", "emptyContext", basicGraphs['edgeDiff']);
        runATest("differentSourceLabel", "emptyContext", basicGraphs['differentSourceLabel']);
    })

    describe("Simple graphs modelAs", function() {
        runATest("oneEdge", "allUnique",
            `
                << :s :p :o  >> a pgo:Edge .
                :s :p :o .
            `
        );
    
        runATest("twoEdges", "allUnique",
            `
                << :s1 :p1 :o1  >> a pgo:Edge .
                :s1 :p1 :o1 .
                << :s2 :p2 :o2  >> a pgo:Edge .
                :s2 :p2 :o2 .
            `
        );

        runATest("oneEdge", "allOccurences",
            `
                :edge a pgo:Edge .
                :edge prec:occurrenceOf << :s :p :o  >> .
            `
        );

        runATest("oneEdgeType", "type1specialization",
            `
                << :s :type1 :o >> a pgo:Edge .
                :s :type1 :o .
            `
        );

        runATest("oneEdgeType", "type1modelAs",
            `
                << :s :type1 :o >> a pgo:Edge .
                :s :type1 :o .
            `
        );

        runATest("edgeDiff", "type1specialization",
            `
                << :s1 :type1 :o1  >> a pgo:Edge .
                :s1 :type1 :o1 .

                << :s2 :p2 :o2  >> a pgo:Edge .
                :s2 :p2 :o2 .
                :p2 rdfs:label "type2" .
            `
        );
    
        runATest("edgeDiff", "type1specializationBN",
            `
                << :s1 :type1 :o1  >> a pgo:Edge .
                :s1 :type1 :o1 .

                << :s2 :p2 :o2  >> a pgo:Edge .
                :s2 :p2 :o2 .
                :p2 rdfs:label "type2" .
            `
        );
    
        runATest("edgeDiff", "type1modelAs",
            `
                << :s1 :type1 :o1  >> a pgo:Edge .
                :s1 :type1 :o1 .

                :edge2 a pgo:Edge .
                :edge2 prec:occurrenceOf << :s2 :p2 :o2  >> .
                :p2 rdfs:label "type2" .
            `
        );

        runATest("differentSourceLabel", "predicateOnPerson",
            `
                << :person :NewPredicate :o  >> a pgo:Edge .
                :person :NewPredicate :o .

                :edge2 a pgo:Edge .
                :edge2 prec:occurrenceOf << :animal :p :o  >> .
                :p rdfs:label "Predicate" .

                :person a [ rdfs:label "Person" ] .
                :animal a [ rdfs:label "Animal" ] .
            `
        );

        runATest("edgeDiff", "bothSpecialization",
            `
                << :s1 :type1 :o1  >> a pgo:Edge .
                :s1 :type1 :o1 .
        
                << :s2 :type2 :o2  >> a pgo:Edge .
                :s2 :type2 :o2 .
            `
        );
        
        runATest("oneEdge", "modelAsPG",
            `
            :edge a pgo:Edge ;
            :source :s ;
            :label  :p ;
            :target :o .
            `
        );
        
        runATest("oneEdge", "modelAsCustom",
            `
                rdf:subject rdf:predicate rdf:object .
                :o :p :s .
            `
        );
        
        runATest("oneEdge", "modelAsCustomWithRenaming",
            `
                :source :label :target .
                :o :p :s .
            `
        );

        runATest("oneEdge", "useRdfStarrenameTermsImplicit",
            `
                :edge a pgo:Edge ;
                :source :s ;
                :label  :p ;
                :target :o .
            `
        );

        // Subsitutions should be operated at the same time
        // - In a real application, this test checks if it is possible to revert the direction of every edge.
        runATest("oneEdge", "modelSwapSO",
            `
                :edge  a pgo:Edge ; rdf:object :s  ; rdf:predicate :p  ; rdf:subject :o  .
            `
        );
    })

    describe("Meta properties", function() {
        runATest("oneEdgeWith1Property"  , "emptyContext", basicGraphs["oneEdgeWith1Property"]  );
        runATest("oneEdgeWith2Properties", "emptyContext", basicGraphs["oneEdgeWith2Properties"]);

        runATest("oneEdgeWith1Property", "allUnique", 
            `
                :s :p :o .
                << :s :p :o >> a pgo:Edge ; :propKey1 :propValue1 .
            `
        );

        runATest("oneEdgeWith2Properties", "allUnique", 
            `
                :s :p :o .
                << :s :p :o >> a pgo:Edge ; :propKey1 :propValue1 ; :propKey2 :propValue2 .
            `
        );

        /*
        This test currently can not pass as N3.Store does not support multi
        nested RDF Quads

        runATest("edgeWithMetaProperty", "allUnique", 
            `
            :s :p :o .
            << :s :p :o >> a pgo:Edge ; :propKey :propValue .
            << << :s :p :o >> :propKey :propValue >> :metaPropKey :metaPropValue .
            `
        );
        */
    })
});

describe("Property convertion", function() {
    const graphs = {
        empty: ``,
        oneNode: ` :node a pgo:Node . `,
        oneEdge: `
            :edge a pgo:Edge ;
              rdf:subject :s ;
              rdf:predicate :p ;
              rdf:object :o .
        `,
        oneNodeWithProperty: `
            :node a pgo:Node ; :p [ rdf:value "v1" ; a prec:PropertyValue ] .
            :p a prec:Property, prec:CreatedProperty ; rdfs:label "P1" .
        `,
        oneNodeWithTwoProperties: `
            :node a pgo:Node ;
                :p1 [ rdf:value "v1" ; a prec:PropertyValue ] ;
                :p2 [ rdf:value "v2" ; a prec:PropertyValue ] .
            
            :p1 a prec:Property, prec:CreatedProperty ; rdfs:label "P1" .
            :p2 a prec:Property, prec:CreatedProperty ; rdfs:label "P2" .
        `,
        oneNodeWithMultiValuedProperty: `
            :node a pgo:Node ;
                :p [ rdf:value "v1" ; a prec:PropertyValue ] ;
                :p [ rdf:value "v2" ; a prec:PropertyValue ] .
            :p a prec:Property, prec:CreatedProperty ; rdfs:label "P1" .
        `,
        oneSimpleGraph: `
            :edge a pgo:Edge ;
              rdf:subject :s ;
              rdf:predicate :p ;
              rdf:object :o .
            
            :s a pgo:Node ; :propertyA [ rdf:value "VANode" ; a prec:PropertyValue ] ; a [ rdfs:label "Subject" ] .
            :o a pgo:Node ; :propertyB [ rdf:value "VBNode" ; a prec:PropertyValue ] ; a [ rdfs:label "Object"  ] .
            :p rdfs:label "LabelOfEdge" .
            :edge :propertyA [ rdf:value "VAEdge" ; a prec:PropertyValue ] .
            :edge :propertyB [ rdf:value "VBEdge" ; a prec:PropertyValue ] .
            :propertyA a prec:Property, prec:CreatedProperty ; rdfs:label "PropertyA" .
            :propertyB a prec:Property, prec:CreatedProperty ; rdfs:label "PropertyB" .
        `,
        oneNodeWithMetaProperty: `    
            :name a prec:Property, prec:CreatedProperty ; rdfs:label "NAME" .
            :town a prec:Property, prec:CreatedProperty ; rdfs:label "TOWN" .
            :description a prec:Property, prec:CreatedProperty ; rdfs:label "DESCRIPTION" .

            :node a pgo:Node ;
                :name :name_value_1 ;
                :name :name_value_2 ;
                :town :town_value   .
            
            :name_value_1 a prec:PropertyValue ;
                rdf:value "NAME VALUE 1" .
            
            :name_value_2 a prec:PropertyValue ;
                rdf:value "NAME VALUE 2" ;
                prec:hasMetaProperties :name_value_2_meta_properties .
            
            :town_value a prec:PropertyValue ;
                rdf:value "LYON" ;
                prec:hasMetaProperties :town_value_meta_properties .
            
            :name_value_2_meta_properties :description :name_value_2_meta_properties_description .

            :name_value_2_meta_properties_description a prec:PropertyValue ;
                rdf:value "NAME VALUE 2: Meta Property" .
            
            :town_value_meta_properties
                :description :town_value_meta_properties_description ;
                :name :town_value_meta_properties_name .
            
            :town_value_meta_properties_description a prec:PropertyValue ;
                rdf:value "Not like the animal" .

            :town_value_meta_properties_name a prec:PropertyValue ;
                rdf:value "Capital of Lights" .
        `,
        contextForP1: ` :knows prec:IRIOfProperty "P1" . `,
        contextForP1bis: `
            [] a prec:PropertyRule ;
                prec:propertyIRI :knows ;
                prec:propertyName "P1"  .
        `,
        contextForPB: ` :knows prec:IRIOfProperty "PropertyB" . `,
        contextForNodes: `
            [] a prec:PropertyRule ;
                prec:propertyIRI  :knows ;
                prec:propertyName "PropertyA" ; 
                prec:nodeLabel    prec:any
            .
        `,
        contextForPASubjectNodes: `
            [] a prec:PropertyRule ;
                prec:propertyIRI  :mappedA ;
                prec:propertyName "PropertyA" ;
                prec:nodeLabel    "Subject"
            .
        `,
        contextForPAOnLabelOfEdge: `
            [] a prec:PropertyRule ;
                prec:propertyIRI       :mappedA ;
                prec:propertyName      "PropertyA" ;
                prec:relationshipLabel "LabelOfEdge"
            .
        `,
        contextCollapseMetaProperties: `
            prec:MetaProperties prec:modelAs prec:DirectTriples .
        `
    };

    describe('Empty context', function() {
        runATest_(graphs, 'empty'                         , 'empty', graphs.empty);
        runATest_(graphs, 'oneNode'                       , 'empty', graphs.oneNode);
        runATest_(graphs, 'oneEdge'                       , 'empty', graphs.oneEdge);
        runATest_(graphs, 'oneNodeWithProperty'           , 'empty', graphs.oneNodeWithProperty);
        runATest_(graphs, 'oneNodeWithTwoProperties'      , 'empty', graphs.oneNodeWithTwoProperties);
        runATest_(graphs, 'oneNodeWithMultiValuedProperty', 'empty', graphs.oneNodeWithMultiValuedProperty);
        runATest_(graphs, 'oneSimpleGraph'                , 'empty', graphs.oneSimpleGraph);
        runATest_(graphs, 'oneNodeWithMetaProperty'       , 'empty', graphs.oneNodeWithMetaProperty);
    });

    describe("Simple properties", function() {
        runATest_(graphs, 'empty', 'contextForP1', ``);

        runATest_(graphs, 'oneNodeWithProperty', 'contextForP1',
        `
            :node a pgo:Node ; :knows [ rdf:value "v1" ; a prec:PropertyValue ] .
        `
        );

        runATest_(graphs, 'oneNodeWithTwoProperties', 'contextForP1',
        `
            :node a pgo:Node ;
                :knows [ rdf:value "v1" ; a prec:PropertyValue ] ;
                :p2    [ rdf:value "v2" ; a prec:PropertyValue ] .
            :p2 a prec:Property, prec:CreatedProperty ; rdfs:label "P2" .
        `
        );

        runATest_(graphs, 'oneNodeWithMultiValuedProperty', 'contextForP1',
        `
            :node a pgo:Node ;
                :knows [ rdf:value "v1" ; a prec:PropertyValue ] ;
                :knows [ rdf:value "v2" ; a prec:PropertyValue ] .
        `
        );

        runATest_(graphs, 'oneNodeWithTwoProperties', 'contextForP1bis',
        `
            :node a pgo:Node ;
                :knows [ rdf:value "v1" ; a prec:PropertyValue ] ;
                :p2    [ rdf:value "v2" ; a prec:PropertyValue ] .
            :p2 a prec:Property, prec:CreatedProperty ; rdfs:label "P2" .
        `
        );

        runATest_(graphs, 'oneNodeWithMultiValuedProperty', 'contextForP1bis',
        `
            :node a pgo:Node ;
                :knows [ rdf:value "v1" ; a prec:PropertyValue ] ;
                :knows [ rdf:value "v2" ; a prec:PropertyValue ] .
        `
        );

        runATest_(graphs, 'oneSimpleGraph', 'contextForPB',
        `
            :edge a pgo:Edge ;
              rdf:subject :s ;
              rdf:predicate :p ;
              rdf:object :o .

            :s a pgo:Node ; :propertyA [ rdf:value "VANode" ; a prec:PropertyValue ] ; a [ rdfs:label "Subject" ] .
            :o a pgo:Node ; :knows     [ rdf:value "VBNode" ; a prec:PropertyValue ] ; a [ rdfs:label "Object"  ] .
            :p rdfs:label "LabelOfEdge" .
            :edge :propertyA [ rdf:value "VAEdge" ; a prec:PropertyValue ] .
            :edge :knows     [ rdf:value "VBEdge" ; a prec:PropertyValue ] .
            :propertyA a prec:Property, prec:CreatedProperty ; rdfs:label "PropertyA" .
        `
        );

        runATest_(graphs, 'oneSimpleGraph', 'contextForNodes',
        `
            :edge a pgo:Edge ;
              rdf:subject :s ;
              rdf:predicate :p ;
              rdf:object :o .

            :s a pgo:Node ; :knows     [ rdf:value "VANode" ; a prec:PropertyValue ] ; a [ rdfs:label "Subject" ] .
            :o a pgo:Node ; :propertyB [ rdf:value "VBNode" ; a prec:PropertyValue ] ; a [ rdfs:label "Object"  ] .
            :p rdfs:label "LabelOfEdge" .
            :edge :propertyA [ rdf:value "VAEdge" ; a prec:PropertyValue ] .
            :edge :propertyB [ rdf:value "VBEdge" ; a prec:PropertyValue ] .
            :propertyA a prec:Property, prec:CreatedProperty ; rdfs:label "PropertyA" .
            :propertyB a prec:Property, prec:CreatedProperty ; rdfs:label "PropertyB" .
        `
        );
    
        runATest_(graphs, 'oneSimpleGraph', 'contextForPASubjectNodes',
        `
            :edge a pgo:Edge ;
            rdf:subject :s ;
            rdf:predicate :p ;
            rdf:object :o .
            
            :s a pgo:Node ; :mappedA   [ rdf:value "VANode" ; a prec:PropertyValue ] ; a [ rdfs:label "Subject" ] .
            :o a pgo:Node ; :propertyB [ rdf:value "VBNode" ; a prec:PropertyValue ] ; a [ rdfs:label "Object"  ] .
            :p rdfs:label "LabelOfEdge" .
            :edge :propertyA [ rdf:value "VAEdge" ; a prec:PropertyValue ] .
            :edge :propertyB [ rdf:value "VBEdge" ; a prec:PropertyValue ] .
            :propertyA a prec:Property, prec:CreatedProperty ; rdfs:label "PropertyA" .
            :propertyB a prec:Property, prec:CreatedProperty ; rdfs:label "PropertyB" .

        `
        );

        runATest_(graphs, 'oneSimpleGraph', 'contextForPAOnLabelOfEdge',
        `
            :edge a pgo:Edge ;
            rdf:subject :s ;
            rdf:predicate :p ;
            rdf:object :o .
            
            :s a pgo:Node ; :propertyA [ rdf:value "VANode" ; a prec:PropertyValue ] ; a [ rdfs:label "Subject" ] .
            :o a pgo:Node ; :propertyB [ rdf:value "VBNode" ; a prec:PropertyValue ] ; a [ rdfs:label "Object"  ] .
            :p rdfs:label "LabelOfEdge" .
            :edge :mappedA   [ rdf:value "VAEdge" ; a prec:PropertyValue ] .
            :edge :propertyB [ rdf:value "VBEdge" ; a prec:PropertyValue ] .
            :propertyA a prec:Property, prec:CreatedProperty ; rdfs:label "PropertyA" .
            :propertyB a prec:Property, prec:CreatedProperty ; rdfs:label "PropertyB" .
        `
        );
    });

    describe("Meta properties", function() {

        runATest_(graphs, 'oneNodeWithMetaProperty', 'contextCollapseMetaProperties',
        `
        :name a prec:Property, prec:CreatedProperty ; rdfs:label "NAME" .
        :town a prec:Property, prec:CreatedProperty ; rdfs:label "TOWN" .
        :description a prec:Property, prec:CreatedProperty ; rdfs:label "DESCRIPTION" .

        :node a pgo:Node ;
            :name :name_value_1 ;
            :name :name_value_2 ;
            :town :town_value   .
        
        :name_value_1 a prec:PropertyValue ;
            rdf:value "NAME VALUE 1" .
        
        :name_value_2 a prec:PropertyValue ;
            rdf:value "NAME VALUE 2" ;
            prec:hasMetaProperties :name_value_2_meta_properties .
        
        :town_value a prec:PropertyValue ;
            rdf:value "LYON" ;
            prec:hasMetaProperties :town_value_meta_properties .
        
        :name_value_2_meta_properties :description "NAME VALUE 2: Meta Property" .
        
        :town_value_meta_properties
            :description "Not like the animal" ;
            :name "Capital of Lights" .
        `
        );

    });


})


describe("Relationship and Property convertion", function() {
    const anEdge =
    `
        :source      a pgo:Node .
        :destination a pgo:Node .

        :edge rdf:subject   :source       ;
              rdf:predicate :predicate    ;
              rdf:object    :destination  ;
              rdf:type      pgo:Edge      ;
    `;

    const graphs = {
        edgeWithMetaProperty: `
            :source      a pgo:Node .
            :destination a pgo:Node .

            :edge rdf:subject   :source       ;
                  rdf:predicate :predicate    ;
                  rdf:object    :destination  ;
                  rdf:type      pgo:Edge      ;
                  :property1    :property1_bn ;
                  :property2    :property2_bn .

            :predicate rdfs:label "The Predicate Label" .

            :property1 a prec:Property, prec:CreatedProperty ; rdfs:label "Property 1" .
            :property2 a prec:Property, prec:CreatedProperty ; rdfs:label "Property 2" .

            :property1_bn a prec:PropertyValue ; rdf:value "Value 1" .
            :property2_bn a prec:PropertyValue ; rdf:value "Value 2" .
            
            :property2_bn prec:hasMetaProperties :meta_property .

            :meta_property :property1 :meta_property_bn .
            :meta_property_bn a prec:PropertyValue ; rdf:value "TheMetaProperty" .
        `,

        contextSPOPartial: `
            prec:Properties     prec:modelAs prec:DirectTriples .
            prec:KeepProvenance prec:flagState false .

            [] a prec:PropertyRule ;
                prec:propertyName "Property 1" ;
                prec:propertyIRI  :Z_FIRST .
            
            [] a prec:PropertyRule ;
                prec:propertyName "Property 2" ;
                prec:propertyIRI  :Z_SECOND .
        `,

        contextSPO: `
            prec:Properties     prec:modelAs prec:DirectTriples .
            prec:Relationships  prec:modelAs prec:RdfStarUnique .
            prec:KeepProvenance prec:flagState false .

            [] a prec:RelationshipRule ;
                prec:relationshipLabel "The Predicate Label" ;
                prec:relationshipIRI :Z_PREDICATE .
                
            [] a prec:PropertyRule ;
                prec:propertyName "Property 1" ;
                prec:propertyIRI  :Z_FIRST .
            
            [] a prec:PropertyRule ;
                prec:propertyName "Property 2" ;
                prec:propertyIRI  :Z_SECOND .
        `,

        edgeWithList:
            //anEdge +
        `
            :node a pgo:Node ; :property :property_bn .
            :property a prec:Property, prec:CreatedProperty ; rdfs:label "Property" .
            :property_bn a prec:PropertyValue ; rdf:value ( "A" "B" "C" "D" "E" ) .

            :property_bn prec:hasMetaProperties :meta_property_bn .

            :meta_property_bn :property :numbers_bn .
            :numbers_bn a prec:PropertyValue ; rdf:value ( 1 2 3 ) .
        `,
        cartesianProductOfMetaLists:
        `
            prec:Properties     prec:modelAs prec:CartesianProduct .
            prec:KeepProvenance prec:flagState false .
        
            prec:CartesianProduct a prec:PropertyModel ;
                prec:composedOf
                       << pvar:entity pvar:propertyKey pvar:individualValue >> ,
                    << << pvar:entity pvar:propertyKey pvar:individualValue >> pvar:metaPropertyKey pvar:metaPropertyValue >> .
                
            [] a prec:PropertyRule ;
                prec:propertyName "Property" ;
                prec:propertyIRI :element .
            
        `
    };

    runATest_(graphs, 'edgeWithMetaProperty', 'contextSPO',
        `
                  :source :Z_PREDICATE :destination .
               << :source :Z_PREDICATE :destination >> :Z_FIRST  "Value 1" .
               << :source :Z_PREDICATE :destination >> :Z_SECOND "Value 2" .
            << << :source :Z_PREDICATE :destination >> :Z_SECOND "Value 2" >> :Z_FIRST "TheMetaProperty" .
        `
    );


    runATest_(graphs, 'edgeWithMetaProperty', 'contextSPOPartial',
        `
            # Predicate Label is untouched
            :predicate rdfs:label "The Predicate Label" .

            # The edge, not yet as S P O
                  :edge rdf:subject   :source       ;
                        rdf:predicate :predicate    ;
                        rdf:object    :destination  .

                  :edge                                :Z_FIRST  "Value 1" .
                  :edge                                :Z_SECOND "Value 2" .
            <<    :edge                                :Z_SECOND "Value 2" >> :Z_FIRST "TheMetaProperty" .
        `
    );

    runATest_(graphs, 'edgeWithList', 'cartesianProductOfMetaLists',
    `
           <http://test/node> <http://test/element> "A" .
           <http://test/node> <http://test/element> "B" .
           <http://test/node> <http://test/element> "C" .
           <http://test/node> <http://test/element> "D" .
           <http://test/node> <http://test/element> "E" .
        << <http://test/node> <http://test/element> "A" >> <http://test/element> 1 .
        << <http://test/node> <http://test/element> "B" >> <http://test/element> 1 .
        << <http://test/node> <http://test/element> "C" >> <http://test/element> 1 .
        << <http://test/node> <http://test/element> "D" >> <http://test/element> 1 .
        << <http://test/node> <http://test/element> "E" >> <http://test/element> 1 .
        << <http://test/node> <http://test/element> "A" >> <http://test/element> 2 .
        << <http://test/node> <http://test/element> "B" >> <http://test/element> 2 .
        << <http://test/node> <http://test/element> "C" >> <http://test/element> 2 .
        << <http://test/node> <http://test/element> "D" >> <http://test/element> 2 .
        << <http://test/node> <http://test/element> "E" >> <http://test/element> 2 .
        << <http://test/node> <http://test/element> "A" >> <http://test/element> 3 .
        << <http://test/node> <http://test/element> "B" >> <http://test/element> 3 .
        << <http://test/node> <http://test/element> "C" >> <http://test/element> 3 .
        << <http://test/node> <http://test/element> "D" >> <http://test/element> 3 .
        << <http://test/node> <http://test/element> "E" >> <http://test/element> 3 .
    `
);

})