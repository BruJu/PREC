'use strict';

const N3            = require('n3');
const graphyFactory = require('@graphy/core.data.factory');
const namespace     = require('@rdfjs/namespace');

const storeAlterer  = require("./store-alterer-from-pattern.js");
const Context       = require("./vocabulary-reader.js");
const precUtils     = require("./utils.js")
const quadStar      = require('./quad-star.js');

const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);
const rdfs = namespace("http://www.w3.org/2000/01/rdf-schema#"      , N3.DataFactory);
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#"                  , N3.DataFactory);
const prec = namespace("http://bruy.at/prec#"                       , N3.DataFactory);
const pvar = namespace("http://bruy.at/prec-trans#"                 , N3.DataFactory);

const variable = N3.DataFactory.variable;
const defaultGraph = N3.DataFactory.defaultGraph;
const QUAD = N3.DataFactory.quad;

// =============================================================================

/**
 * 
 * @param {N3.Store} store 
 * @param {*} contextQuads The list of quads that are part of the context
 */
function applyVocabulary(store, contextQuads) {
    const context = new Context(contextQuads);

    // -- Blank nodes transformation
    for (let typeOfNode in context.blankNodeMapping) {
        blankNodeMapping(
            store,
            N3.DataFactory.namedNode(typeOfNode),
            context.blankNodeMapping[typeOfNode]
        );
    }

    // -- Map generated IRI to existing IRIs
    transformProperties   (store, context);
    transformRelationships(store, context);
    transformNodeLabels   (store, context);

    // -- Remove the info that generated IRI were generated if there don't
    // appear anymore

    // Property: ?p a createdProp, ?p a Property, ?p rdfs.label Thing
    // Relationship Label: ?p a createdRelationShipLabel, ?p rdfs.label Thing
    // Node label : same
    removeUnusedCreatedVocabulary(store, prec.CreatedProperty, 3, 0, 0);
    removeUnusedCreatedVocabulary(store, prec.CreatedRelationshipLabel, 2, 0, 0);
    removeUnusedCreatedVocabulary(store, prec.CreatedNodeLabel, 2, 0, 0);

    // -- Remove provenance information if they are not required by the user
    if (context.getStateOf("KeepProvenance") === false) {
        removePGO(store);
    }
}

// =============================================================================
// =============================================================================

/**
 * Converts a term to its Graphy concise representation
 * @param {*} term The term I guess?
 */
function concise(term) { return graphyFactory.term(term).concise(); }

function _findTripleAbleRelations(requestResult) {
    // 1.
    const predicates = {};

    for (let bindings of requestResult) {
        const key = concise(bindings.p);

        if (predicates[key] === undefined) {
            predicates[key] = new N3.Store();
        } else if (predicates[key] === "HadDuplicates") {
            continue;
        }

        if (predicates[key].countQuads(bindings.s, bindings.p, bindings.o) >= 1) {
            predicates[key] = "HadDuplicates";
        } else {
            predicates[key].addQuad(bindings.s, bindings.p, bindings.o);
        }
    }

    // 2.
    const result = new Set();

    for (const key in predicates) {
        if (predicates[key] !== "HadDuplicates") {
            result.add(key);
        }
    }

    return result;
}


/**
 * Deletes every occurrence of pgo:Edge pgo:Node, prec:Property and prec:PropertyValue.
 * 
 * While the PGO ontology is usefull to describe the PG structure, and to
 * specify the provenance of the 
 */
function removePGO(store) {
    storeAlterer.deleteMatches(store, null, rdf.type, pgo.Edge);
    storeAlterer.deleteMatches(store, null, rdf.type, pgo.Node);
    storeAlterer.deleteMatches(store, null, rdf.type, prec.Property);
    storeAlterer.deleteMatches(store, null, rdf.type, prec.PropertyValue);
}

/**
 * Deletes form the store every occurrences of a named node whose type is
 * type and who appears expectedSubject times in subject position, ...
 */
function removeUnusedCreatedVocabulary(store, type, expectedSubject, expectedPredicate, expectedObject) {
    let r = storeAlterer.matchAndBind(store, [[variable("voc"), rdf.type, type]]);

    for (let bind1 of r) {
        let asSubject   = store.getQuads(bind1.voc, null, null).length;
        let asPredicate = store.getQuads(null, bind1.voc, null).length;
        let asObject    = store.getQuads(null, null, bind1.voc).length;

        // console.log(`${bind1.voc.value} : ${asSubject}, ${asPredicate}, ${asObject}`);

        if (asSubject == expectedSubject
            && asPredicate == expectedPredicate
            && asObject == expectedObject) {
            storeAlterer.deleteMatches(store, bind1.voc, null, null);
            storeAlterer.deleteMatches(store, null, bind1.voc, null);
            storeAlterer.deleteMatches(store, null, null, bind1.voc);
        }
    }

    if (store.countQuads(null, rdf.type, type) == 0) {
        storeAlterer.deleteMatches(store, type, null, null);
        storeAlterer.deleteMatches(store, null, type, null);
        storeAlterer.deleteMatches(store, null, null, type);
    }
}

function _listContains(pattern, searched) {
    return pattern.find(e => searched.find(s => quadStar.containsTerm(e, s)) !== undefined) !== undefined;
}


function transformRelationships(store, addedVocabulary) {
    // `prec.__targetDescriptionModel` is added to note during the relationship
    // loop the list of descriptionModels to apply later.
    // We don't apply them now so the transformation into the target models does
    // not conflict with the processing of other edges.
    // Instead, the `prec:__targetDescriptionModel` object will changed if it
    // should be and `modifyRelationships` will actually do the replacement.

    // Add an annotation to every quad
    {
        const q = store.getQuads(null, rdf.type, pgo.Edge)
            .map(quad => quad.subject)
            .map(term => N3.DataFactory.quad(term, prec.__appliedEdgeRule, prec.__unknownRule));

        store.addQuads(q);
    }

    //let candidateEdgeLabelsForDeletion = {};

    addedVocabulary.forEachRelation(
        relationship => {
            storeAlterer.findFilterReplace(
                store,
                relationship.getTransformationSource(),
                relationship.getTransformationConditions(),
                relationship.getTransformationTarget()
            );

            //for (let bind of binds) {
            //    const seenEdgeLabel = bind.edgeLabel;
            //    const key = JSON.stringify(seenEdgeLabel);
            //    candidateEdgeLabelsForDeletion[key] = bind.edgeLabel;
            //}
        }
    );

    //filterOutDeletedEdgeLabel(store, Object.values(candidateEdgeLabelsForDeletion));

    modifyRelationships(store, addedVocabulary);
}

/**
 * Process every `prec:__targetDescriptionModel` request registered in the
 * store.
 * 
 * In other words, this function will map the PREC-0 representation of a
 * property graph edge to the representation requested by the user, through the
 * specified model in the context.
 * 
 * @param {N3.Store} store The store that contains the quads to process
 * @param {Context} context The `Context` that contains the information about
 * the context given by the user
 */
function modifyRelationships(store, context) {
    const relations = storeAlterer.matchAndBind(store,
        [
            [variable("relation"), rdf.type, pgo.Edge],
            [variable("relation"), prec.__appliedEdgeRule, variable("targetDescriptionModel")],
            [variable("relation"), rdf.subject       , variable("subject")  ],
            [variable("relation"), rdf.predicate     , variable("predicate")],
            [variable("relation"), rdf.object        , variable("object")   ]
        ]
    );

    for (const relation of relations) {
        const behaviour = context.findRelationshipModel(relation.targetDescriptionModel);

        if (Array.isArray(behaviour)) {
            // Build the patterns to map to
            let r = behaviour.map(term => quadStar.remapPatternWithVariables(
                term,
                [
                    [variable('relation')     , pvar.self           ],
                    [variable('subject')      , pvar.source         ],
                    [variable('predicate')    , pvar.relationshipIRI],
                    [variable('object')       , pvar.destination    ],
                    [variable('propertyKey')  , pvar.propertyKey    ],
                    [variable('propertyValue'), pvar.propertyValue  ]
                ]
            ))
                .map(q => [q.subject, q.predicate, q.object])
                .map(l => [l, _listContains(l, [variable('propertyKey'), variable('propertyValue')])]);

            const nonPropertiesDependantPattern = r.filter(e => !e[1]).map(e => e[0]);
            const    propertiesDependantPattern = r.filter(e =>  e[1]).map(e => e[0]);

            // Find every properties to map them later
            let propertyQuads = store.getQuads(relation.relation, null, null, N3.DataFactory.defaultGraph())
                .filter(
                    quad => !precUtils.termIsIn(quad.predicate, [
                        rdf.type, prec.__appliedEdgeRule, rdf.subject, rdf.predicate, rdf.object
                    ])
                );

            // Replace non property dependant quads
            storeAlterer.replaceOneBinding(store, relation, nonPropertiesDependantPattern);

            // Replace property dependants quads
            if (propertyQuads.length !== 0) {
                store.removeQuads(propertyQuads);
                relation['@quads'] = []; // No more quad to delete during replaceOneBinding

                for (let propertyQuad of propertyQuads) {
                    relation.propertyKey   = propertyQuad.predicate;
                    relation.propertyValue = propertyQuad.object;

                    storeAlterer.replaceOneBinding(store, relation, propertiesDependantPattern);
                }
            }
        }
    }

    // Remove target model to prec:Relationships if its definition is not explicit
    store.removeQuads(store.getQuads(null, prec.__appliedEdgeRule, prec.Relationships));
}

/**
 * 
 * @param {N3.Store} store 
 * @param {*} nodesToDelete 
 */
function filterOutDeletedEdgeLabel(store, nodesToDelete) {
    let components = [];
    function addIfComposed(term) {
        if (term.termType === 'Quad') {
            components.push(term);
        }
    }

    function isDeletable(term) {
        // Find as P O G
        let inOtherPositions = store.getQuads(null, term).length !== 0
            || store.getQuads(null, null, term).length !== 0
            || store.getQuads(null, null, null, term).length !== 0;

        if (inOtherPositions) return null;
        
        // Find as S
        let asSubject = store.getQuads(term);
        if (asSubject.length !== 1) return null;

        // Is label quad?
        let labelQuad = asSubject[0];
        if (!rdfs.label.equals(labelQuad.predicate) || !N3.DataFactory.defaultGraph().equals(labelQuad.graph)) return null;

        // Is part of a component?
        const inComponent = components.find(q => quadStar.containsTerm(q, term));
        if (inComponent !== undefined) return null;

        return labelQuad;
    }

    for (let quad of store.getQuads()) {
        addIfComposed(quad.subject);
        addIfComposed(quad.predicate);
        addIfComposed(quad.object);
        addIfComposed(quad.graph);
    }

    for (let nodeToDelete of nodesToDelete) {
        let deletable = isDeletable(nodeToDelete);
        if (deletable !== null) {
            store.removeQuad(deletable);
        }
    }
}

function transformNodeLabels(store, addedVocabulary) {
    addedVocabulary.forEachNodeLabel(
        (nodeLabel, correspondingIRI) => {
            const pattern = [
                [variable("nodeLabel"), rdf.type, prec.CreatedNodeLabel],
                [variable("nodeLabel"), rdfs.label, N3.DataFactory.literal(nodeLabel)],
            ];

            for (const bind of storeAlterer.matchAndBind(store, pattern)) {
                storeAlterer.findFilterReplace(
                    store,
                    [[variable("node"), rdf.type, bind.nodeLabel]],
                    [],
                    [[variable("node"), rdf.type, correspondingIRI]]
                )
            }
        }
    );
}


function transformProperties(store, addedVocabulary) {
    {
        const q = store.getQuads(null, rdf.type, prec.Property, defaultGraph())
            .map(quad => quad.subject)
            .flatMap(propertyType => store.getQuads(null, propertyType, null, defaultGraph()))
            .map(quad => quad.object)
            .map(propertyBlankNode => QUAD(propertyBlankNode, prec.__appliedPropertyRule, prec._NoRuleFound));

        store.addQuads(q);
    }

    addedVocabulary.forEachProperty(propertyManager => {
        storeAlterer.findFilterReplace(
            store,
            propertyManager.getTransformationSource(),
            propertyManager.getTransformationConditions(),
            propertyManager.getTransformationTarget()
        );
    });
  
//  TODO:
//    if (asSet) {
//        for (const bind of newB) {
//            noList(store, bind.x);
//        }
//    }

    applyPropertyModels(store, addedVocabulary);
}

/**
 * Transform the properties models to the required models.
 * 
 * The required model is noted with the quad
 * `?propertyBlankNode prec:__targetDescriptionModel ?descriptionNode`.
 * @param {N3.Store} store The store that contains the quads
 * @param {Context} context The context to apply
 */
function applyPropertyModels(store, context) {
    const properties = storeAlterer.matchAndBind(store,
        [
            [variable("property"), prec.__appliedPropertyRule, variable("targetDescriptionModel")],
            [variable("entity")  , variable("propertyKey")   , variable("property")],
            [variable("property"), rdf.value                 , variable("propertyValue")]
        ]
    );

    const typeFinder = entity => {
        let qs = store.getQuads(entity, rdf.type, null, defaultGraph());
        for (let quad of qs) {
            let object = quad.object;
            if (pgo.Node.equals(object)) return prec.NodeProperties;
            if (pgo.Edge.equals(object)) return prec.RelationshipProperties;
        }
        return undefined;
    };

    for (const property of properties) {
        const model = context.findPropertyModel(property.targetDescriptionModel, () => typeFinder(property.entity));

        if (Array.isArray(model)) {
            // Build the patterns to map to
            let r = model.map(term => quadStar.remapPatternWithVariables(term,
                [
                    [variable("entity")       , pvar.entity       ],
                    [variable("propertyKey")  , pvar.propertyKey  ],
                    [variable("property")     , pvar.property     ],
                    [variable("propertyValue"), pvar.propertyValue]
                ]
            ))
                .map(q => [q.subject, q.predicate, q.object]);

            storeAlterer.replaceOneBinding(store, property, r);
        } else {
            store.removeQuad(QUAD(property.property, prec.__appliedPropertyRule, property.targetDescriptionModel));
        }
    }

    store.removeQuads(store.getQuads(null, prec.__appliedPropertyRule, null, defaultGraph()));
}

function noList(store, firstNode) {
    const listHeads = storeAlterer.matchAndBind(store,
        [
            [firstNode    , rdf.type     , rdf.List ],
            [variable("s"), variable("p"), firstNode]
        ]
    );

    if (listHeads.length !== 1) {
        console.error("noList: Not exactly one match");
        return;
    }

    const listHead = listHeads[0];;

    const l = storeAlterer.extractRecursive(
        store,
        firstNode,
        [
            [variable("(R) current"), rdf.type , rdf.List            ],
            [variable("(R) current"), rdf.first, variable("value")   ],
            [variable("(R) current"), rdf.rest , variable("(R) next")]
        ],
        rdf.nil,
        []
    );

    storeAlterer.replace(store, listHeads, []);

    for (const element of l) {
        store.addQuad(listHead.s, listHead.p, element);
    }
}

function searchUnmapped(store) {
    const r = storeAlterer.matchAndBind(store,
        [[variable("word"), rdf.type, prec.CreatedVocabulary]]
    );

    let unmapped = [];

    for (let r1 of r) {
        const word = r1.word;

        if (store.countQuads(null, word, null) > 0
        || store.countQuads(null, rdf.predicate, word) > 0) {
            unmapped.push(word);
        }
    }

    let quads = store.getQuads();
    store.removeQuads(quads);

    for (const term of unmapped) {
        store.addQuad(term, rdf.type, prec.CreatedVocabulary);
    }
}

/**
 * Transform the blank nodes of the given type to named nodes, by appending to
 * the given prefix the current name of the blank node.
 * @param {N3.Store} store The store that contains the quads
 * @param {*} typeOfMappedNodes The type of the IRIs to map
 * @param {*} prefixIRI The prefix used
 */
function blankNodeMapping(store, typeOfMappedNodes, prefixIRI) {
    let remapping = {};

    store.getQuads(null, rdf.type, typeOfMappedNodes)
        .filter(quad => quad.subject.termType === "BlankNode")
        .map(quad => quad.subject.value)
        .forEach(blankNodeValue => remapping[blankNodeValue] = N3.DataFactory.namedNode(prefixIRI + blankNodeValue))
    
    
    let newContent = store.getQuads().map(quad => _quadBNMap(remapping, quad));
    
    store.removeQuads(store.getQuads());
    store.addQuads(newContent);
}

/**
 * Provided a mapping blank node value => named node, maps the quad to another
 * quad, in which every blank node in the mapping is mapped to the named node
 */
function _quadBNMap(map, quad) {
    return quadStar.eventuallyRebuildQuad(quad, term => {
        if (term.termType === "BlankNode") {
            let mappedTo = map[term.value];
            if (mappedTo === undefined) return term;
            return mappedTo;
        } else {
            return term;
        }
    });
}


module.exports = applyVocabulary;
