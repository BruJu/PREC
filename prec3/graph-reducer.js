'use strict';

const N3            = require('n3');
const graphyFactory = require('@graphy/core.data.factory');
const namespace     = require('@rdfjs/namespace');

const storeAlterer  = require("./store-alterer-from-pattern.js");
const vocabReader   = require("./vocabulary-reader.js");

const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);
const rdfs = namespace("http://www.w3.org/2000/01/rdf-schema#"      , N3.DataFactory)
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#"                  , N3.DataFactory);
const prec = namespace("http://bruy.at/prec#"                       , N3.DataFactory);


const variable = N3.DataFactory.variable;

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

function transformationRelationship(store, star) {
    const variable = N3.DataFactory.variable;

    let request = storeAlterer.matchAndBind(store,
        [
            [variable("rel"), rdf.subject  , variable("s")],
            [variable("rel"), rdf.predicate, variable("p")],
            [variable("rel"), rdf.object   , variable("o")],
            [variable("rel"), rdf.type     , pgo.Edge]
        ]
    );

    const tripleAbleRelations = _findTripleAbleRelations(request);

    request = request.filter(dict => tripleAbleRelations.has(concise(dict.p)));

    if (!star) {
        request = request.filter(dict => store.countQuads(dict["rel"], null, null) === 4);
    }

    let r = storeAlterer.replace(store, request,
        [
            [variable("s"), variable("p"), variable("o")],
            [N3.DataFactory.quad(variable("s"), variable("p"), variable("o")), rdf.type, pgo.Edge],
        ]
    );

    if (star) {
        storeAlterer.toRdfStar(store, r, r1 => r1.binds.rel, r1 => r1.quads[0]);
    }
}

function transformationAttributes(store, star) {
    const variable = N3.DataFactory.variable;

    let request = storeAlterer.matchAndBind(store,
        [
            [variable("property")     , rdf.type            , pgo.Property],
            [variable("node")         , variable("property"), variable("propertyValue")],
            [variable("propertyValue"), rdfs.label          , variable("value")]
        ]
    );

    request = storeAlterer.filterBinds(request, "value", node => node.termType === "Literal");

    if (!star) {
        request = request.filter(dict => store.countQuads(dict["propertyValue"], null, null) === 1);
    }

    let r = storeAlterer.replace(store, request,
        [
            [variable("property")     , rdf.type            , pgo.Property],
            [variable("node")         , variable("property"), variable("value")],
        ]
    );

    if (star) {
        storeAlterer.toRdfStar(store, r, r1 => r1.binds.propertyValue, r1 => r1.quads[1]);
    }
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
    storeAlterer.deleteMatches(store, null, prec.GenerationModel, null);
}

function removeMetaProperties(store) {
    storeAlterer.directReplace(store,
        [
            [variable("propertyNode"), rdf.value, variable("value")],
            [variable("propertyNode"), rdf.type , prec.PropertyValue],
            [variable("node"), variable("prop"), variable("propertyNode")]
        ],
        [
            [variable("node"), variable("prop"), variable("value")]
        ]
    );
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

function applyVocabulary(store, vocabularyPath) {
    const addedVocabulary = vocabReader(vocabularyPath);

    if (addedVocabulary.getStateOf("MetaProperty") == false) {
        removeMetaProperties(store);
    }

    addedVocabulary.forEachProperty(
        (propertyName, mappedIRI, extraConditions) => {
            let conditions = [];

            for (const extraCondition of extraConditions) {
                if (extraCondition["@category"] === "NodeLabel") {
                    conditions.push(
                        [
                            [variable("node")     , rdf.type  , variable("nodeLabel")                           ],
                            [variable("node")     , rdf.type  , pgo.Node                                        ],
                            [variable("nodeLabel"), rdfs.label, N3.DataFactory.literal(extraCondition.nodeLabel)]
                        ]
                    );
                }
            }

            let pattern = [
                [variable("property"), rdf.type  , prec.Property],
                [variable("property"), rdfs.label, N3.DataFactory.literal(propertyName)]
            ];
            
            const bind = storeAlterer.matchAndBind(store, pattern);

            for (const bind1 of bind) {
                storeAlterer.findFilterReplace(
                    store,
                    [[variable("node"), bind1.property, variable("x")]],
                    conditions,
                    [[variable("node"), mappedIRI     , variable("x")]]
                )
            }
        }
    );

    addedVocabulary.forEachRelation(
        (relationName, mappedIRI, extraConditions) => {
            if (extraConditions.length != 0) {
                // TODO
                console.error("Conditions are not supported on relation labels:");
                console.error(relationName);
                console.error(mappedIRI);
                console.error(extraConditions);
                return;
            }

            let conditions = [];

            let pattern = [
                [variable("node"), rdf.type, pgo.Edge],
                [variable("node"), rdf.predicate, variable("relLabel")],
                [variable("relLabel"), rdfs.label, N3.DataFactory.literal(relationName)],
            ];
            
            const bind = storeAlterer.matchAndBind(store, pattern);

            for (const bind1 of bind) {
                storeAlterer.findFilterReplace(
                    store,
                    [[variable("relationship"), rdf.predicate, bind1.relLabel]],
                    conditions,
                    [[variable("relationship"), rdf.predicate, mappedIRI]]
                )
            }
        }
    );

    addedVocabulary.forEachNodeLabel(
        (nodeLabelName, mappedIRI, extraConditions) => {
            if (extraConditions.length != 0) {
                // TODO
                console.error("Conditions are not supported on node labels:");
                console.error(nodeLabelName);
                console.error(mappedIRI);
                console.error(extraConditions);
                return;
            }

            let pattern = [
                [variable("nodeLabel"), rdf.type, prec.CreatedNodeLabel],
                [variable("nodeLabel"), rdfs.label, N3.DataFactory.literal(nodeLabelName)],
            ];

            for (const bind of storeAlterer.matchAndBind(store, pattern)) {
                storeAlterer.findFilterReplace(
                    store,
                    [[variable("node"), rdf.type, bind.nodeLabel]],
                    [],
                    [[variable("node"), rdf.type, mappedIRI]]
                )
            }

        }
    );

    // Property: ?p a createdProp, ?p a Property, ?p rdfs.label Thing
    removeUnusedCreatedVocabulary(store, prec.CreatedProperty, 3, 0, 0);
    
    // Relationship Label: ?p a createdRelationShipLabel, ?p rdfs.label Thing
    removeUnusedCreatedVocabulary(store, prec.CreatedRelationshipLabel, 2, 0, 0);
    
    removeUnusedCreatedVocabulary(store, prec.CreatedNodeLabel, 2, 0, 0);



    if (addedVocabulary.getStateOf("KeepProvenance") === false) {
        removePGO(store);
    }
}

/// From an Expanded RDF-* store, remove the prec:occurrence node for relations that
/// occured only once
function flatten(store) {
    if (store.countQuads(prec.MetaData, prec.GenerationModel, prec.RelationshipAsRDFStar) != 1) {
        console.error("Can't flatten this store");
        return false;
    }

    let occurrences = storeAlterer.matchAndBind(
        store,
        [
            [variable("rdfTriple"), prec.occurrence, variable("relation")]
        ]
    );

    occurrences = occurrences.filter(dict => store.countQuads(dict["rdfTriple"], prec.occurrence, null) == 1);

    for (const uniqueOccurrence of occurrences) {
        storeAlterer.directReplace(
            store,
            [
                [uniqueOccurrence.rdfTriple, prec.occurrence, variable("rel")],
                [variable("rel"), variable("p"), variable("o")]
            ],
            [
                [uniqueOccurrence.rdfTriple, variable("p"), variable("o")]
            ]
        );
    }
    
    return true;
}

function noList(store) {
    const listHeads = storeAlterer.matchAndBind(store,
        [
            [variable("firstNode")     , rdf.type     , rdf.List             ],
            [variable("s")             , variable("p"), variable("firstNode")]
        ]
    );

    for (const d of listHeads) {
        const l = storeAlterer.extractRecursive(
            store,
            d["firstNode"],
            [
                [variable("(R) current"), rdf.type , rdf.List            ],
                [variable("(R) current"), rdf.first, variable("value")   ],
                [variable("(R) current"), rdf.rest , variable("(R) next")]
            ],
            rdf.nil
        );

        console.error(l);
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


//const availableTransformations = {
//    "RRA"    : store => transformationAttributes(store, false),
//    "RRAstar": store => transformationAttributes(store, true),
//    "RRR"    : store => transformationRelationship(store, false),
//    "RRRstar": store => transformationRelationship(store, true),
//    "NoLabel": store => storeAlterer.deleteMatches(store, null, rdfs.label, null),
//    "NoPGO"  : store => removePGO(store),
//    "Vocab"  : (store, filename) => applyVocabulary(store, filename),
//    "Flatten": store => flatten(store),
//    "NoList" : store => noList(store),
//    "Missing": store => searchUnmapped(store)
//};

function applyTransformations(store, transformationNames) {
    if (transformationNames.length == 0) {
        return;
    } else if (transformationNames.length == 1) {
        applyVocabulary(store, transformationNames[0]);
    } else {
        console.error("Too much arguments");
    }
}

module.exports = applyTransformations;
