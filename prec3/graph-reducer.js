'use strict';

const N3            = require('n3');
const graphyFactory = require('@graphy/core.data.factory');
const namespace     = require('@rdfjs/namespace');

const storeAlterer  = require("./store-alterer-from-pattern.js");

const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);
const rdfs = namespace("http://www.w3.org/2000/01/rdf-schema#", N3.DataFactory)
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#", N3.DataFactory);


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

const availableTransformations = {
    "RRA"    : store => transformationAttributes(store, false),
    "RRAstar": store => transformationAttributes(store, true),
    "RRR"    : store => transformationRelationship(store, false),
    "RRRstar": store => transformationRelationship(store, true),
    "NoLabel": store => storeAlterer.deleteMatches(store, null, rdfs.label, null),
    "NoPGO"  : store => removePGO(store)
};

function listOfTransformations() {
    const r = [];
    for (const name in availableTransformations) {
        r.push(name);
    }
    return r;
}

function applyTransformations(store, transformationNames) {
    for (let transformation of transformationNames) {
        const transformer = availableTransformations[transformation];
        transformer(store);
    }
}

module.exports = {
    listOfTransformations: listOfTransformations,
    applyTransformations: applyTransformations
};
