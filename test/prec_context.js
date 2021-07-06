const utility = require("./utility.js");
const graphReducer = require("../src/prec/graph-reducer.js");
const assert = require('assert');
const { isomorphic } = require("rdf-isomorphic");
const precUtils = require('../src/rdf/utils')

function badToColorizedToStrings(quads1, quads2, indent = 8) {
    function badToColorizedToString(quads, match, indent) {
        let asString = precUtils.badToString(quads, indent).split(/\r?\n/);
    
        for (let i = 0 ; i != quads.length ; ++i) {
            if (match[i] === undefined) continue;
    
            if (match[i] >= 0) asString[i] = "\x1b[36m" + asString[i] + "\x1b[0m";
        }
    
        return asString.join("\n");
    }

    let [s1, s2] = precUtils.approximateIsomorphism(quads1, quads2)
    return [
        badToColorizedToString(quads1, s1, indent),
        badToColorizedToString(quads2, s2, indent)
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

function test(name, source, context, expected) {
    it(name, function () {
        const store         = utility.turtleToDStar(source);
        const ctx           = utility.turtleToQuads(context);
        graphReducer(store, ctx);

        const expectedStore = utility.turtleToDStar(expected);
        const r = isomorphic(store.getQuads(), expectedStore.getQuads());
        let msg = "";
        if (!r) {
            msg = "Error on " + name;
            msg += '\n' + '\x1b[0m' + "• Base Graph:";
            msg += '\n' + source;
            msg += '\n' + "• Context:";
            msg += '\n' + context;
        
            [result, expected] = badToColorizedToStrings(store.getQuads(), expectedStore.getQuads(), 2);
        
            msg += '\n' + `• Result (${store.size} quads):`;
            msg += '\n' + result;
            msg += '\n' + `• Expected (${expectedStore.size} quads):`;
            msg += '\n' + expected;
        }
        
        assert.ok(r, msg);
    });
}

describe('Context Applier', function () {
  require('./prec_impl/rules-for-edges.test')(test);
  require('./prec_impl/rules-for-properties-with-edges')(test);
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
        oneNodeWithMultiValuedProperty: `
            :node a pgo:Node ;
                :p [ rdf:value "v1" ; a prec:PropertyKeyValue ] ;
                :p [ rdf:value "v2" ; a prec:PropertyKeyValue ] .
            :p a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "P1" .
        `,
        oneSimpleGraph: `
            :edge a pgo:Edge ;
              rdf:subject :s ;
              rdf:predicate :p ;
              rdf:object :o .
            
            :s a pgo:Node ; :propertyA [ rdf:value "VANode" ; a prec:PropertyKeyValue ] ; a [ rdfs:label "Subject" ] .
            :o a pgo:Node ; :propertyB [ rdf:value "VBNode" ; a prec:PropertyKeyValue ] ; a [ rdfs:label "Object"  ] .
            :p rdfs:label "LabelOfEdge" .
            :edge :propertyA [ rdf:value "VAEdge" ; a prec:PropertyKeyValue ] .
            :edge :propertyB [ rdf:value "VBEdge" ; a prec:PropertyKeyValue ] .
            :propertyA a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "PropertyA" .
            :propertyB a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "PropertyB" .
        `,
        oneNodeWithMetaProperty: `    
            :name a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "NAME" .
            :town a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "TOWN" .
            :description a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "DESCRIPTION" .

            :node a pgo:Node ;
                :name :name_value_1 ;
                :name :name_value_2 ;
                :town :town_value   .
            
            :name_value_1 a prec:PropertyKeyValue ;
                rdf:value "NAME VALUE 1" .
            
            :name_value_2 a prec:PropertyKeyValue ;
                rdf:value "NAME VALUE 2" ;
                prec:hasMetaProperties :name_value_2_meta_properties .
            
            :town_value a prec:PropertyKeyValue ;
                rdf:value "LYON" ;
                prec:hasMetaProperties :town_value_meta_properties .
            
            :name_value_2_meta_properties :description :name_value_2_meta_properties_description .

            :name_value_2_meta_properties_description a prec:PropertyKeyValue ;
                rdf:value "NAME VALUE 2: Meta Property" .
            
            :town_value_meta_properties
                :description :town_value_meta_properties_description ;
                :name :town_value_meta_properties_name .
            
            :town_value_meta_properties_description a prec:PropertyKeyValue ;
                rdf:value "Not like the animal" .

            :town_value_meta_properties_name a prec:PropertyKeyValue ;
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
                prec:propertyIRI  :mappedA ;
                prec:propertyName "PropertyA" ;
                prec:edgeLabel    "LabelOfEdge"
            .
        `,
        contextCollapseMetaProperties: `
            prec:MetaProperties prec:templatedBy prec:DirectTriples .
        `,
        contextPGOProperty: `
            prec:Properties prec:templatedBy [
                prec:composedOf
                    << pvar:entity       pgo:hasProperty pvar:propertyNode  >> ,
                    << pvar:propertyNode pgo:key         pvar:label         >> ,
                    << pvar:propertyNode pgo:value       pvar:propertyValue >>
            ] .
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
            :node a pgo:Node ; :knows [ rdf:value "v1" ; a prec:PropertyKeyValue ] .
        `
        );

        runATest_(graphs, 'oneNodeWithTwoProperties', 'contextForP1',
        `
            :node a pgo:Node ;
                :knows [ rdf:value "v1" ; a prec:PropertyKeyValue ] ;
                :p2    [ rdf:value "v2" ; a prec:PropertyKeyValue ] .
            :p2 a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "P2" .
        `
        );

        runATest_(graphs, 'oneNodeWithMultiValuedProperty', 'contextForP1',
        `
            :node a pgo:Node ;
                :knows [ rdf:value "v1" ; a prec:PropertyKeyValue ] ;
                :knows [ rdf:value "v2" ; a prec:PropertyKeyValue ] .
        `
        );

        runATest_(graphs, 'oneNodeWithTwoProperties', 'contextForP1bis',
        `
            :node a pgo:Node ;
                :knows [ rdf:value "v1" ; a prec:PropertyKeyValue ] ;
                :p2    [ rdf:value "v2" ; a prec:PropertyKeyValue ] .
            :p2 a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "P2" .
        `
        );

        runATest_(graphs, 'oneNodeWithMultiValuedProperty', 'contextForP1bis',
        `
            :node a pgo:Node ;
                :knows [ rdf:value "v1" ; a prec:PropertyKeyValue ] ;
                :knows [ rdf:value "v2" ; a prec:PropertyKeyValue ] .
        `
        );

        runATest_(graphs, 'oneSimpleGraph', 'contextForPB',
        `
            :edge a pgo:Edge ;
              rdf:subject :s ;
              rdf:predicate :p ;
              rdf:object :o .

            :s a pgo:Node ; :propertyA [ rdf:value "VANode" ; a prec:PropertyKeyValue ] ; a [ rdfs:label "Subject" ] .
            :o a pgo:Node ; :knows     [ rdf:value "VBNode" ; a prec:PropertyKeyValue ] ; a [ rdfs:label "Object"  ] .
            :p rdfs:label "LabelOfEdge" .
            :edge :propertyA [ rdf:value "VAEdge" ; a prec:PropertyKeyValue ] .
            :edge :knows     [ rdf:value "VBEdge" ; a prec:PropertyKeyValue ] .
            :propertyA a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "PropertyA" .
        `
        );

        runATest_(graphs, 'oneSimpleGraph', 'contextForNodes',
        `
            :edge a pgo:Edge ;
              rdf:subject :s ;
              rdf:predicate :p ;
              rdf:object :o .

            :s a pgo:Node ; :knows     [ rdf:value "VANode" ; a prec:PropertyKeyValue ] ; a [ rdfs:label "Subject" ] .
            :o a pgo:Node ; :propertyB [ rdf:value "VBNode" ; a prec:PropertyKeyValue ] ; a [ rdfs:label "Object"  ] .
            :p rdfs:label "LabelOfEdge" .
            :edge :propertyA [ rdf:value "VAEdge" ; a prec:PropertyKeyValue ] .
            :edge :propertyB [ rdf:value "VBEdge" ; a prec:PropertyKeyValue ] .
            :propertyA a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "PropertyA" .
            :propertyB a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "PropertyB" .
        `
        );
    
        runATest_(graphs, 'oneSimpleGraph', 'contextForPASubjectNodes',
        `
            :edge a pgo:Edge ;
            rdf:subject :s ;
            rdf:predicate :p ;
            rdf:object :o .
            
            :s a pgo:Node ; :mappedA   [ rdf:value "VANode" ; a prec:PropertyKeyValue ] ; a [ rdfs:label "Subject" ] .
            :o a pgo:Node ; :propertyB [ rdf:value "VBNode" ; a prec:PropertyKeyValue ] ; a [ rdfs:label "Object"  ] .
            :p rdfs:label "LabelOfEdge" .
            :edge :propertyA [ rdf:value "VAEdge" ; a prec:PropertyKeyValue ] .
            :edge :propertyB [ rdf:value "VBEdge" ; a prec:PropertyKeyValue ] .
            :propertyA a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "PropertyA" .
            :propertyB a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "PropertyB" .

        `
        );

        runATest_(graphs, 'oneSimpleGraph', 'contextForPAOnLabelOfEdge',
        `
            :edge a pgo:Edge ;
            rdf:subject :s ;
            rdf:predicate :p ;
            rdf:object :o .
            
            :s a pgo:Node ; :propertyA [ rdf:value "VANode" ; a prec:PropertyKeyValue ] ; a [ rdfs:label "Subject" ] .
            :o a pgo:Node ; :propertyB [ rdf:value "VBNode" ; a prec:PropertyKeyValue ] ; a [ rdfs:label "Object"  ] .
            :p rdfs:label "LabelOfEdge" .
            :edge :mappedA   [ rdf:value "VAEdge" ; a prec:PropertyKeyValue ] .
            :edge :propertyB [ rdf:value "VBEdge" ; a prec:PropertyKeyValue ] .
            :propertyA a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "PropertyA" .
            :propertyB a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "PropertyB" .
        `
        );


        runATest_(graphs, 'oneNodeWithProperty', 'contextPGOProperty',
        `
            :node a pgo:Node .
            :node pgo:hasProperty _:theProperty .
            _:theProperty pgo:key "P1" .
            _:theProperty pgo:value "v1" .
        `
        )
        
        runATest_(graphs, 'oneNodeWithTwoProperties', 'contextPGOProperty',
        `
            :node a pgo:Node .
            :node pgo:hasProperty _:theProperty1 .
            _:theProperty1 pgo:key "P1" .
            _:theProperty1 pgo:value "v1" .

            :node pgo:hasProperty _:theProperty2 .
            _:theProperty2 pgo:key "P2" .
            _:theProperty2 pgo:value "v2" .
        `
        )
    });

    describe("Meta properties", function() {

        runATest_(graphs, 'oneNodeWithMetaProperty', 'contextCollapseMetaProperties',
        `
        :name a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "NAME" .
        :town a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "TOWN" .
        :description a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "DESCRIPTION" .

        :node a pgo:Node ;
            :name :name_value_1 ;
            :name :name_value_2 ;
            :town :town_value   .
        
        :name_value_1 a prec:PropertyKeyValue ;
            rdf:value "NAME VALUE 1" .
        
        :name_value_2 a prec:PropertyKeyValue ;
            rdf:value "NAME VALUE 2" ;
            prec:hasMetaProperties :name_value_2_meta_properties .
        
        :town_value a prec:PropertyKeyValue ;
            rdf:value "LYON" ;
            prec:hasMetaProperties :town_value_meta_properties .
        
        :name_value_2_meta_properties :description "NAME VALUE 2: Meta Property" .
        
        :town_value_meta_properties
            :description "Not like the animal" ;
            :name "Capital of Lights" .
        `
        );

    });

    describe('Property list', function () {
        const simpleProperty = `
            :node a pgo:Node .
            :node :pName :pBlankNode .
            :pBlankNode rdf:value ( "a" "b" "c" ) ; a prec:PropertyKeyValue .
            :pName rdfs:label "key" ; a prec:PropertyKey, prec:CreatedPropertyKey .
        `;

        const templatedBy = function (template) {
            return `
                prec:Properties prec:templatedBy [ prec:composedOf ${template} ] .
                [] a prec:PropertyRule ;
                    prec:propertyName "key" ;
                    prec:propertyIRI :k .
            `;
        };

        test(
            "Regular property conversion",
            simpleProperty,
            templatedBy("<< pvar:entity pvar:propertyKey pvar:propertyValue >>"),
            `
            :node a pgo:Node .
            :node :k ( "a" "b" "c" ) .
            `
        );

        test(
            "Only keep individual values",
            simpleProperty,
            templatedBy("<< pvar:entity pvar:propertyKey pvar:individualValue >>"),
            ` :node a pgo:Node ; :k "a", "b", "c" . `
        );

        test(
            "Keep both",
            simpleProperty,
            templatedBy("<< pvar:entity pvar:propertyKey pvar:individualValue >> ,"
                + "\n << pvar:entity :usedList pvar:propertyValue >>"),
            ` :node a pgo:Node ; :k "a", "b", "c" ; :usedList ( "a" "b" "c" ).`
        );

    })

})


describe("Edge and Property convertion", function() {
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

            :property1 a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "Property 1" .
            :property2 a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "Property 2" .

            :property1_bn a prec:PropertyKeyValue ; rdf:value "Value 1" .
            :property2_bn a prec:PropertyKeyValue ; rdf:value "Value 2" .
            
            :property2_bn prec:hasMetaProperties :meta_property .

            :meta_property :property1 :meta_property_bn .
            :meta_property_bn a prec:PropertyKeyValue ; rdf:value "TheMetaProperty" .
        `,

        contextSPOPartial: `
            prec:Properties     prec:templatedBy prec:DirectTriples .
            prec:KeepProvenance prec:flagState false .

            [] a prec:PropertyRule ;
                prec:propertyName "Property 1" ;
                prec:propertyIRI  :Z_FIRST .
            
            [] a prec:PropertyRule ;
                prec:propertyName "Property 2" ;
                prec:propertyIRI  :Z_SECOND .
        `,

        contextSPO: `
            prec:Properties     prec:templatedBy prec:DirectTriples .
            prec:Edges          prec:templatedBy prec:RdfStarUnique .
            prec:KeepProvenance prec:flagState false .

            [] a prec:EdgeRule ;
                prec:edgeLabel "The Predicate Label" ;
                prec:edgeIRI :Z_PREDICATE .
                
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
            :property a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "Property" .
            :property_bn a prec:PropertyKeyValue ; rdf:value ( "A" "B" "C" "D" "E" ) .

            :property_bn prec:hasMetaProperties :meta_property_bn .

            :meta_property_bn :property :numbers_bn .
            :numbers_bn a prec:PropertyKeyValue ; rdf:value ( 1 2 3 ) .
        `,
        cartesianProductOfMetaLists:
        `
            prec:Properties     prec:templatedBy prec:CartesianProduct .
            prec:KeepProvenance prec:flagState false .
        
            prec:CartesianProduct a prec:PropertyTemplate ;
                prec:composedOf
                       << pvar:entity pvar:propertyKey pvar:individualValue >> ,
                    << << pvar:entity pvar:propertyKey pvar:individualValue >> pvar:metaPropertyPredicate pvar:metaPropertyObject >> .
                
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
});



describe('Node label rules', function () {
    describe('Template redefinition', function () {
        test('should let the user defined how node labels are defined',
        `
            :alice rdf:type pgo:Node, _:person .
            _:person a prec:CreatedNodeLabel ; rdfs:label "Person" .
        `,
        `
            prec:NodeLabels prec:templatedBy [
                prec:composedOf
                    << pvar:node :somePGsaysThatTheyAreA pvar:nodeLabelIRI >> ,
                    << pvar:nodeLabelIRI :labelsTheNode pvar:node  >> ,
                    << << pvar:node pvar:node pvar:node >> rdf:type :rdfstartriple >>
            ] .
        `,
        `
            :alice rdf:type pgo:Node .
            :alice :somePGsaysThatTheyAreA _:person .
            _:person :labelsTheNode :alice .
            << :alice :alice :alice >> rdf:type :rdfstartriple .
            _:person a prec:CreatedNodeLabel ; rdfs:label "Person" .
        `
        )

        test('should let the user use string literal labels',
        `
            :myNode rdf:type pgo:Node ;
              rdf:type pgo:myLabel .
            
            :myOtherNode rdf:type pgo:Node ;
              rdf:type pgo:myLabel, pgo:myOtherLabel .
            
            pgo:myLabel      a prec:CreatedNodeLabel ; rdfs:label "Cat" .
            pgo:myOtherLabel a prec:CreatedNodeLabel ; rdfs:label "Kitten" .
        `,
        `
            prec:NodeLabels prec:templatedBy [
                prec:composedOf << pvar:node :isLabeled pvar:label >>
            ] .
        `,
        `
            :myNode      rdf:type pgo:Node ; :isLabeled "Cat" .
            :myOtherNode rdf:type pgo:Node ; :isLabeled "Cat", "Kitten" .        
        `
        );
    });
});

describe('Synonyms', function () {
    test('should properly map relationship to edge', 
    `
        :edge1 a pgo:Edge ;
          rdf:subject :nodes ;
          rdf:object  :node1o ;
          rdf:predicate :knows .
    
        :edge2 a pgo:Edge ;
          rdf:subject :nodes ;
          rdf:object  :node2o ;
          rdf:predicate :ignores .
        
        :nodes a pgo:Node .
        :node1o a pgo:Node .
        :node2o a pgo:Node .

        :knows   a prec:CreatedEdgeLabel ; rdfs:label "WhoKnows" .
        :ignores a prec:CreatedEdgeLabel ; rdfs:label "DoesntKnow" .
    `,
    `
        :worstTemplate a prec:RelationshipTemplate ;
          prec:composedOf
            << pvar:source          :startArrow pvar:relationship >> ,
            << pvar:relationship    :endArrow   pvar:destination  >> ,
            << pvar:relationshipIRI :labels     pvar:relationship >> .
        
        prec:Relationships prec:templatedBy :worstTemplate .

        :whoKnows prec:IRIOfRelationshipLabel "WhoKnows" .

        :doesntRule a prec:RelationshipRule ;
          prec:relationshipLabel "DoesntKnow" ;
          prec:relationshipIRI :imlost ;
          prec:templatedBy prec:RdfStarUnique .
    `,
    `
        :nodes a pgo:Node .
        :node1o a pgo:Node .
        :node2o a pgo:Node .

        # First edge
        :nodes :startArrow :edge1 .
        :edge1 :endArrow :node1o .
        :whoKnows :labels :edge1 .

        # Second edge
        :nodes :imlost :node2o .
        << :nodes :imlost :node2o >> rdf:type pgo:Edge .
    `
    );


})