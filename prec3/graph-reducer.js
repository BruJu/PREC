'use strict';

const N3            = require('n3');
const graphyFactory = require('@graphy/core.data.factory');
const namespace     = require('@rdfjs/namespace');

const storeAlterer  = require("./store-alterer-from-pattern.js");
const vocabReader   = require("../vocabulary-expansion.js");

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
 * Deletes every occurrence of pgo:Edgee pgo:Node and pgo:Property.
 * 
 * While the PGO ontology is usefull to describe the PG structure, and to
 * specify the provenance of the 
 */
function removePGO(store) {
    storeAlterer.deleteMatches(store, null, rdf.type, pgo.Edge);
    storeAlterer.deleteMatches(store, null, rdf.type, pgo.Node);
    storeAlterer.deleteMatches(store, null, rdf.type, pgo.Property);
}


function applyVocabulary(store, vocabularyPath) {
    const variable = N3.DataFactory.variable;
    const addedVocabulary = vocabReader(vocabularyPath);

    for (const knownProperty of addedVocabulary["propertyIRI"]) {
        let pattern = [
            [variable("property"), rdf.type  , pgo.Property],
            [variable("property"), rdfs.label, N3.DataFactory.literal(knownProperty.target)],
        ];

        if (knownProperty.when !== "always") {
            if (knownProperty.when.On == "Nodes") {
                pattern.push([variable("node"), variable("property"), variable("_propertyValue")]);
                pattern.push([variable("node"), rdf.type            , pgo.Node                  ]);

                if (knownProperty.when.Labelled !== undefined) {
                    pattern.push([variable("node"), rdf.type, variable("label")]);
                    //pattern.push([variable("label"), rdf.type, pgo.Label]); pgo.Label does not exist
                    pattern.push([variable("label"), rdfs.label, N3.DataFactory.literal(knownProperty.when.Labelled)]);
                }

                console.log(pattern);
            } else {
                console.error("non always propertyIRI are not yet supported");
                exit(0);
                continue;
            }
        }

        const bind = storeAlterer.matchAndBind(store, pattern);

        for (const bind1 of bind) {
            storeAlterer.substitute(store, bind1.property, knownProperty.replacement);
        }
    }

    for (const knownProperty of addedVocabulary["relationshipIRI"]) {
        if (knownProperty.when !== "always") {
            console.error("non always relationshipIRI are not yet supported");
            continue;
        }

        // we can't request wildcards in "quad-stars"
        //[N3.DataFactory.quad(variable("s"), variable("relLabel"), variable("o")), rdf.type  , pgo.Edge],

        const bind = storeAlterer.matchAndBind(
            store,
            [
                [variable("node"), rdf.type, pgo.Edge],
                [variable("node"), rdf.predicate, variable("relLabel")],
                [variable("relLabel"), rdfs.label, N3.DataFactory.literal(knownProperty.target)],
            ]
        );

        for (const bind1 of bind) {
            storeAlterer.substitute(store, bind1.relLabel, knownProperty.replacement);
        }
    }

}

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

    const r = storeAlterer.matchAndBind(store,
        [
            [
                variable("firstNode"),
                rdf.type,
                rdf.List
            ],
            [
                variable("s"),
                variable("p"),
                variable("firstNode")
            ]
        ]
    );

    for (const d of r) {
        const l = storeAlterer.extractRecursive(
            store,
            d["firstNode"],
            [
                [
                    variable("(R) current"),
                    rdf.type,
                    rdf.List,
                ],
                [
                    variable("(R) current"),
                    rdf.first,
                    variable("value")
                ],
                [
                    variable("(R) current"),
                    rdf.rest,
                    variable("(R) next")
                ]
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


const availableTransformations = {
    "RRA"    : store => transformationAttributes(store, false),
    "RRAstar": store => transformationAttributes(store, true),
    "RRR"    : store => transformationRelationship(store, false),
    "RRRstar": store => transformationRelationship(store, true),
    "NoLabel": store => storeAlterer.deleteMatches(store, null, rdfs.label, null),
    "NoPGO"  : store => removePGO(store),
    "Vocab"  : (store, filename) => applyVocabulary(store, filename),
    "Flatten": store => flatten(store),
    "NoList" : store => noList(store),
    "Missing": store => searchUnmapped(store)
};

function listOfTransformations() {
    const r = [];
    for (const name in availableTransformations) {
        r.push(name);
    }
    return r;
}

function applyTransformations(store, transformationNames) {
    for (let i = 0 ; i != transformationNames.length; ++i) {
        const transformationName = transformationNames[i];
        const transformer = availableTransformations[transformationName];
        
        if (transformationName !== "Vocab") {
            transformer(store);
        } else {
            const parameter = transformationNames[++i];
            transformer(store, parameter);
        }
    }
}

module.exports = {
    listOfTransformations: listOfTransformations,
    applyTransformations: applyTransformations
};
