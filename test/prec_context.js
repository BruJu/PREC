
const utility = require("./utility.js");
const graphReducer = require("../prec3/graph-reducer.js");
const assert = require('assert');
const { isSubstituableGraph } = require('../graph-substitution.js');
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
        :type1 prec:IRIOfRelationship [ prec:relationshipLabel "type1" ] .
    `,
    type1modelAs: `
        prec:Relationships prec:modelAs prec:RdfStarOccurrence .
        :type1 prec:IRIOfRelationship [
            prec:modelAs prec:RdfStarUnique ;
            prec:relationshipLabel "type1" 
        ] .
    `,
    predicateOnPerson: `
        prec:Relationships prec:modelAs prec:RdfStarOccurrence .
        :NewPredicate prec:IRIOfRelationship [
            prec:modelAs prec:RdfStarUnique ;
            prec:relationshipLabel "Predicate" ;
            prec:sourceLabel "Person"
        ] .
    `,
    bothSpecialization: `
        :type1 prec:IRIOfRelationship [
            prec:relationshipLabel "type1" ;
            prec:modelAs prec:RdfStarUnique
        ] .
        
        :type2 prec:IRIOfRelationship [
            prec:relationshipLabel "type2" ;
            prec:modelAs prec:RdfStarUnique
        ] .
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
                << pvar:destination pvar:relationLabel pvar:source >>
        ] .
    `,
    modelAsCustomWithRenaming: `
        prec:Relationships prec:modelAs [
            prec:composedOf << rdf:subject rdf:predicate rdf:object >> ,
                << pvar:destination pvar:relationLabel pvar:source >>
        ] ;
            prec:subject :source ;
            prec:predicate :label ;
            prec:object :target .
    `
}

/**
 * 
 * @param {String} s1 
 * @param {String} s2 
 */
function badColorize(s1, s2) {
    let s1_ = s1.split(/\r?\n/);
    let s2_ = s2.split(/\r?\n/);

    for (let i = 0 ; i < Math.min(s1_.length, s2_.length); ++i) {
        let str = s1_[i];
        let i2 = s2_.indexOf(str);

        if (i2 !== -1) {
            let newS = "\x1b[36m" + str + "\x1b[0m";
            s1_[i] = newS;
            s2_[i2] = newS;
        }
    }

    return [s1_.join("\n"), s2_.join("\n")]
}

function print(store, d1, graphName, d2, contextName, expectedStore) {
    console.error("Error on " + graphName + " x " + contextName);
    console.error("• Base Graph:");
    console.error(d1[graphName]);
    console.error("• Context:");
    console.error(d2[contextName]);

    let result   = precUtils.badToString(store.getQuads(), 8);
    let expected = precUtils.badToString(expectedStore.getQuads(), 8);

    [result, expected] = badColorize(result, expected);

    console.error("• Result:");
    console.error(result);
    console.error("• Expected:");
    console.error(expected);
}

function runATest(graphName, contextName, expected) {
    it(graphName + " x " + contextName, function() {
        const store         = utility.turtleToStore(basicGraphs[graphName]);
        const context       = utility.turtleToQuads(contexts[contextName]);
        graphReducer(store, context);

        const expectedStore = utility.turtleToStore(expected);
        const r = isSubstituableGraph(store.getQuads(), expectedStore.getQuads());
        if (!r) print(store, basicGraphs, graphName, contexts, contextName, expectedStore);
        assert.ok(r);
    });
}


function runATest_(dict, graphName, contextName, expected) {
    it(graphName + " x " + contextName, function() {
        const store         = utility.turtleToStore(dict[graphName]);
        const context       = utility.turtleToQuads(dict[contextName]);
        graphReducer(store, context);

        const expectedStore = utility.turtleToStore(expected);
        const r = isSubstituableGraph(store.getQuads(), expectedStore.getQuads());
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
            :node a pgo:Node ; :p [ rdf:value "v1" ] .
            :p a prec:Property, prec:CreatedProperty ; rdfs:label "P1" .
        `,
        oneNodeWithTwoProperties: `
            :node a pgo:Node ; :p1 [ rdf:value "v1" ] ; :p2 [ rdf:value "v2" ] .
            :p1 a prec:Property, prec:CreatedProperty ; rdfs:label "P1" .
            :p2 a prec:Property, prec:CreatedProperty ; rdfs:label "P2" .
        `,
        oneNodeWithMultiValuedProperty: `
            :node a pgo:Node ; :p [ rdf:value "v1" ] ; :p [ rdf:value "v2" ] .
            :p a prec:Property, prec:CreatedProperty ; rdfs:label "P1" .
        `,
        oneSimpleGraph: `
            :edge a pgo:Edge ;
              rdf:subject :s ;
              rdf:predicate :p ;
              rdf:object :o .
            
            :s a pgo:Node ; :propertyA [ rdf:value "VANode" ] ; a [ rdfs:label "Subject" ] .
            :o a pgo:Node ; :propertyB [ rdf:value "VBNode" ] ; a [ rdfs:label "Object"  ] .
            :p rdfs:label "LabelOfEdge" .
            :edge :propertyA [ rdf:value "VAEdge" ] .
            :edge :propertyB [ rdf:value "VBEdge" ] .
            :propertyA a prec:Property, prec:CreatedProperty ; rdfs:label "PropertyA" .
            :propertyB a prec:Property, prec:CreatedProperty ; rdfs:label "PropertyB" .
        `,
        contextForP1: ` :knows prec:IRIOfProperty "P1" . `,
        contextForPB: ` :knows prec:IRIOfProperty "PropertyB" . `,
        contextForPASubjectNodes: `
            :mappedA prec:IRIOfProperty [
                prec:propertyName "PropertyA" ;
                prec:nodeLabel    "Subject"
            ] .
        `,
        contextForPAOnLabelOfEdge: `
            :mappedA prec:IRIOfProperty [
                prec:propertyName      "PropertyA" ;
                prec:relationshipLabel "LabelOfEdge"
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
    });

    describe("Simple properties", function() {
        runATest_(graphs, 'empty', 'contextForP1', ``);

        runATest_(graphs, 'oneNodeWithProperty', 'contextForP1',
        `
            :node a pgo:Node ; :knows [ rdf:value "v1" ] .
        `
        );

        runATest_(graphs, 'oneNodeWithTwoProperties', 'contextForP1',
        `
            :node a pgo:Node ; :knows [ rdf:value "v1" ] ; :p2 [ rdf:value "v2" ] .
            :p2 a prec:Property, prec:CreatedProperty ; rdfs:label "P2" .
        `
        );

        runATest_(graphs, 'oneNodeWithMultiValuedProperty', 'contextForP1',
        `
            :node a pgo:Node ; :knows [ rdf:value "v1" ] ; :knows [ rdf:value "v2" ] .
        `
        );

        runATest_(graphs, 'oneSimpleGraph', 'contextForPB',
        `
            :edge a pgo:Edge ;
              rdf:subject :s ;
              rdf:predicate :p ;
              rdf:object :o .

            :s a pgo:Node ; :propertyA [ rdf:value "VANode" ] ; a [ rdfs:label "Subject" ] .
            :o a pgo:Node ; :knows     [ rdf:value "VBNode" ] ; a [ rdfs:label "Object"  ] .
            :p rdfs:label "LabelOfEdge" .
            :edge :propertyA [ rdf:value "VAEdge" ] .
            :edge :knows [ rdf:value "VBEdge" ] .
            :propertyA a prec:Property, prec:CreatedProperty ; rdfs:label "PropertyA" .
            `
        );
    
        runATest_(graphs, 'oneSimpleGraph', 'contextForPASubjectNodes',
        `
            :edge a pgo:Edge ;
            rdf:subject :s ;
            rdf:predicate :p ;
            rdf:object :o .
            
            :s a pgo:Node ; :mappedA   [ rdf:value "VANode" ] ; a [ rdfs:label "Subject" ] .
            :o a pgo:Node ; :propertyB [ rdf:value "VBNode" ] ; a [ rdfs:label "Object"  ] .
            :p rdfs:label "LabelOfEdge" .
            :edge :propertyA [ rdf:value "VAEdge" ] .
            :edge :propertyB [ rdf:value "VBEdge" ] .
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
            
            :s a pgo:Node ; :propertyA [ rdf:value "VANode" ] ; a [ rdfs:label "Subject" ] .
            :o a pgo:Node ; :propertyB [ rdf:value "VBNode" ] ; a [ rdfs:label "Object"  ] .
            :p rdfs:label "LabelOfEdge" .
            :edge :mappedA   [ rdf:value "VAEdge" ] .
            :edge :propertyB [ rdf:value "VBEdge" ] .
            :propertyA a prec:Property, prec:CreatedProperty ; rdfs:label "PropertyA" .
            :propertyB a prec:Property, prec:CreatedProperty ; rdfs:label "PropertyB" .
        `
        );
    });

    describe("Meta properties", function() {

    });


})

