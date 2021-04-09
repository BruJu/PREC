'use strict';

const N3            = require('n3');
const graphyFactory = require('@graphy/core.data.factory');
const namespace     = require('@rdfjs/namespace');

const storeAlterer  = require("./store-alterer-from-pattern.js");
const Context       = require("./vocabulary-reader.js");

const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);
const rdfs = namespace("http://www.w3.org/2000/01/rdf-schema#"      , N3.DataFactory);
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#"                  , N3.DataFactory);
const prec = namespace("http://bruy.at/prec#"                       , N3.DataFactory);
const pvar = namespace("http://bruy.at/prec-trans#"                 , N3.DataFactory);

const variable = N3.DataFactory.variable;

// =============================================================================

/**
 * 
 * @param {N3.Store} store 
 * @param {*} contextQuads 
 */
function applyVocabulary(store, contextQuads) {
    const addedVocabulary = new Context(contextQuads);

    // -- Blank nodes transformation
    for (let typeOfNode in addedVocabulary.blankNodeMapping) {
        blankNodeMapping(
            store,
            N3.DataFactory.namedNode(typeOfNode),
            addedVocabulary.blankNodeMapping[typeOfNode]
        );
    }

    // -- Map generated IRI to existing IRIs

    if (addedVocabulary.getStateOf("MetaProperty") == false) {
        removeMetaProperties(store);
    }
    transformProperties   (store, addedVocabulary);
    
    transformRelationships(store, addedVocabulary);
    transformNodeLabels   (store, addedVocabulary);

    // -- Remove the info that generated IRI were generated if there don't
    // appear anymore

    // Property: ?p a createdProp, ?p a Property, ?p rdfs.label Thing
    // Relationship Label: ?p a createdRelationShipLabel, ?p rdfs.label Thing
    // Node label : same
    removeUnusedCreatedVocabulary(store, prec.CreatedProperty, 3, 0, 0);
    removeUnusedCreatedVocabulary(store, prec.CreatedRelationshipLabel, 2, 0, 0);
    removeUnusedCreatedVocabulary(store, prec.CreatedNodeLabel, 2, 0, 0);

    // -- Transform relationship format
    modifyRelationships(store, addedVocabulary);

    // Remove prec.useRdfStar from renamed reification
    storeAlterer.deleteMatches(store, null, prec.useRdfStar, null);

    // -- Remove provenance information if they are not required by the user
    if (addedVocabulary.getStateOf("KeepProvenance") === false) {
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

function remapPatternWithVariables(term, mapping) {
    function remapTerm(t) {
        let dest = mapping.find(e => e[1].equals(t));

        if (dest !== undefined) {
            return dest[0];
        } else if (t.termType !== 'Quad') {
            return t;
        } else {
            return N3.DataFactory.quad(
                remapTerm(t.subject),
                remapTerm(t.predicate),
                remapTerm(t.object),
                remapTerm(t.graph)
            );
        }
    }

    return remapTerm(term);
}

function modifyRelationships(store, context) {
    const relations = storeAlterer.matchAndBind(store,
        [
            [variable("relation"), rdf.type, pgo.Edge],
            [variable("relation"), rdf.subject  , variable("subject")  ],
            [variable("relation"), rdf.predicate, variable("predicate")],
            [variable("relation"), rdf.object   , variable("object")   ]
        ]
    );

    for (const relation of relations) {
        const behaviour = context.getModelForRelationship(relation.relation);

        if (Array.isArray(behaviour)) {
            // TODO: we also have to map properties:
            // prec:metaPropertyKey    prec:metaPropertyValue

            let remappingOfDest = behaviour.map(term => remapPatternWithVariables(
                term,
                [
                    [variable('relation') , pvar.self       ],
                    [variable('subject')  , pvar.source     ],
                    [variable('predicate'), pvar.relationLabel  ],
                    [variable('object')   , pvar.destination]
                ]
            ))
                .map(q => [q.subject, q.predicate, q.object]);

            storeAlterer.replaceOneBinding(store, relation, remappingOfDest);
        } else if (prec.AsOccurrences.equals(behaviour)) {
            // Remove every quads
            storeAlterer.replaceOneBinding(store, relation, []);

            // Make a new quad
            const rdfStarQuad = N3.DataFactory.quad(relation.subject, relation.predicate, relation.object);

            store.addQuad(rdfStarQuad, prec.occurrenceOf, relation.relation);
            store.addQuad(relation.relation, rdf.type, pgo.Edge);
        } else if (prec.AsUnique.equals(behaviour)) {
            // Remove every quads
            storeAlterer.replaceOneBinding(store, relation, []);

            // Make a new quad
            const rdfStarQuad = N3.DataFactory.quad(relation.subject, relation.predicate, relation.object);

            store.addQuad(relation.subject, relation.predicate, relation.object);
            store.addQuad(rdfStarQuad, rdf.type, pgo.Edge);
        }
    }
}

function transformProperties(store, addedVocabulary) {
    addedVocabulary.forEachProperty(
        (propertyName, mappedIRI, extraConditions) => {
            let asSet = false;
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
                } else if (extraCondition["@category"] === "RelationshipLabel") {
                    conditions.push(
                        [
                            [variable("rel")  , rdf.type  , variable("label")                               ],
                            [variable("rel")  , rdf.type  , pgo.Edge                                        ],
                            [variable("label"), rdfs.label, N3.DataFactory.literal(extraCondition.nodeLabel)]
                        ]
                    );
                } else if (extraCondition["@category"] === "AsSet") {
                    asSet = true;
                }
            }

            let pattern = [
                [variable("property"), rdf.type  , prec.Property],
                [variable("property"), rdfs.label, N3.DataFactory.literal(propertyName)]
            ];
            
            const bind = storeAlterer.matchAndBind(store, pattern);

            for (const bind1 of bind) {
                let newB = storeAlterer.findFilterReplace(
                    store,
                    [[variable("node"), bind1.property, variable("x")]],
                    conditions,
                    [[variable("node"), mappedIRI     , variable("x")]]
                )

                if (asSet) {
                    for (const bind of newB) {
                        noList(store, bind.x);
                    }
                }
            }
        }
    );
}


function onSubjectOrPredicate_nodeType(labelTarget, patternMatching, subjectOrObject) {
    if (labelTarget.termType !== "Literal") return false;

    const predicate = rdf[subjectOrObject];
    const object = variable(subjectOrObject);

    patternMatching.conditions.push(
        [
            [variable("relationship")           , predicate , object                             ],
            [object                             , rdf.type  , variable("label" + subjectOrObject)],
            [variable("label" + subjectOrObject), rdfs.label, labelTarget                        ]
        ]
    );

    return true;
}

function onSubjectOrPredicate_rename(target, patternMatching, subjectOrObject) {
    if (target.termType !== "NamedNode") return false;

    const predicate = rdf[subjectOrObject];
    const object = variable(subjectOrObject);

    patternMatching.extraSource.push([variable("relationship"), predicate, object]);
    patternMatching.dest       .push([variable("relationship"), target   , object]);

    return true;
}



function transformRelationships(store, addedVocabulary) {

    addedVocabulary.forEachRelation(
        (relationName, mappedIRI, extraConditions) => {
            function invalidCondition(extraCondition) {
                console.error("Conditions are not supported on relation labels:");
                console.error(relationName);
                console.error(mappedIRI);
                console.error(extraCondition);
            }

            let patternMatching = {
                // Extra conditions for match patterns (not deleted)
                conditions: [],
                // Added patterns to the transformation source pattern (they will be deleted)
                extraSource: [],
                // Transformation destination match pattern
                dest: []
            };

            for (const extraCondition of extraConditions) {
                let ok = false;

                if (extraCondition[0].equals(prec.useRdfStar)) {
                    patternMatching.dest.push(
                        [variable("relationship"), prec.useRdfStar, extraCondition[1]]
                    );
                    ok = true;
                } else if (prec.subject.equals(extraCondition[0])) {
                    ok = onSubjectOrPredicate_rename(extraCondition[1], patternMatching, "subject");
                } else if (prec.object.equals(extraCondition[0])) {
                    ok = onSubjectOrPredicate_rename(extraCondition[1], patternMatching, "object");
                } else if (prec.predicate.equals(extraCondition[0])) {
                    if (extraCondition[1].termType === "NamedNode") {
                        ok = true;
                        patternMatching.renamePredicate = extraCondition[1];
                    }
                } else if (prec.sourceLabel.equals(extraCondition[0])) {
                    ok = onSubjectOrPredicate_nodeType(extraCondition[1], patternMatching, "subject");
                } else if (prec.destinationLabel.equals(extraCondition[0])) {
                    ok = onSubjectOrPredicate_nodeType(extraCondition[1], patternMatching, "object");
                } else {
                    invalidCondition(extraCondition);
                }

                if (!ok) {
                    invalidCondition(extraCondition);
                }
            }

            if (patternMatching.renamePredicate !== undefined) {
                patternMatching.dest.push([variable("relationship"), patternMatching.renamePredicate, mappedIRI]);
            } else {
                patternMatching.dest.push([variable("relationship"), rdf.predicate                  , mappedIRI]);
            }

            let pattern = [
                [variable("node"), rdf.type, pgo.Edge],
                [variable("node"), rdf.predicate, variable("relLabel")],
                [variable("relLabel"), rdfs.label, N3.DataFactory.literal(relationName)],
            ];

            for (const bind1 of storeAlterer.matchAndBind(store, pattern)) {
                let source = [
                    [variable("relationship"), rdf.predicate, bind1.relLabel],
                    ...patternMatching.extraSource
                ];

                storeAlterer.findFilterReplace(
                    store,
                    source,
                    patternMatching.conditions,
                    patternMatching.dest
                );
            }
        }
    );
}

function transformNodeLabels(store, addedVocabulary) {
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
        .map(quad => quad.subject)
        .filter(node => node.termType === "BlankNode")
        .map(node => node.value)
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
    function _termBNMap(term) {
        if (term.termType === "Quad") {
            return N3.DataFactory.quad(
                _termBNMap(term.subject),
                _termBNMap(term.predicate),
                _termBNMap(term.object),
                _termBNMap(term.graph)
            )
        } else if (term.termType === "BlankNode") {
            let mappedTo = map[term.value];
            if (mappedTo === undefined) return term;
            return mappedTo;
        } else {
            return term;
        }
    }
    
    return _termBNMap(quad);
}


module.exports = applyVocabulary;
