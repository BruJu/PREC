'use strict';

const N3            = require('n3');
const DStar         = require('../dataset/index.js');
const namespace     = require('@rdfjs/namespace');

const Context  = require("./context-loader.js");
const QuadStar = require('../rdf/quad-star');
const TermDict = require('../TermDict.js');

const RulesForProperties = require('./rules-for-properties');
const RulesForEdges      = require('./rules-for-edges');
const RulesForNodeLabels = require('./rules-for-nodelabels');

const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#"                  , N3.DataFactory);
const prec = namespace("http://bruy.at/prec#"                       , N3.DataFactory);

const $defaultGraph = N3.DataFactory.defaultGraph;

/**
 * @typedef { import("rdf-js").Term } Term
 * @typedef { import("rdf-js").Quad } Quad
 * @typedef { import("./context-loader") } Context
 */

// =============================================================================

/**
 * Transform the dataset by applying the given context.
 * @param {DStar} dataset The DStar dataset that contains the quad
 * @param {Context} contextQuads The list of quads that are part of the context
 */
function applyContext(dataset, contextQuads) {
    const context = new Context(contextQuads);

    // -- Blank nodes transformation
    for (let typeOfNode in context.blankNodeMapping) {
        blankNodeMapping(
            dataset,
            N3.DataFactory.namedNode(typeOfNode),
            context.blankNodeMapping[typeOfNode]
        );
    }

    // -- Map generated IRI to existing IRIs + apply the templates
    const newDataset = ruleBasedProduction(dataset, context);
    dataset.deleteMatches();
    dataset.addAll(newDataset.getQuads());

    // -- Remove provenance information if they are not required by the user
    if (context.getStateOf("KeepProvenance") === false) {
        removePGO(dataset);
    }
}

/**
 * Build a new dataset by translating the PREC-0 triples in the source `dataset`
 * according to the rules described in the passed `context`.
 * @param {DStar} dataset The source dataset
 * @param {Context} context The context
 * @returns {DStar} The new dataset 
 */
function ruleBasedProduction(dataset, context) {
    RulesForEdges.produceMarks(dataset, context);
    RulesForProperties.produceMarks(dataset, context);
    RulesForNodeLabels.produceMarks(dataset, context);
    
    const newDataset = new DStar();

    const preservedLabels = new TermDict();
    
    for (const [markKind, functionToCall] of [
        [prec.__appliedNodeRule    , RulesForNodeLabels.applyMark],
        [prec.__appliedEdgeRule    , RulesForEdges.applyMark     ],
        [prec.__appliedPropertyRule, RulesForProperties.applyMark]
    ]) {
        for (const mark of dataset.getQuads(null, markKind, null, $defaultGraph())) {
            const ts = functionToCall(newDataset, mark, dataset, context);
            ts.forEach(t => preservedLabels.set(t, true));
        }
    }

    preservedLabels.forEach((label, _) => newDataset.addAll(dataset.getQuads(label)));
    
    // As it is impossible to write a rule that catches a node without any label and property, we add back the nodes here
    newDataset.addAll(dataset.getQuads(null, rdf.type, pgo.Node, $defaultGraph()));

    return newDataset;
}

// =============================================================================
// =============================================================================

// ==== Blank Node Mapping

/**
 * Transform the blank nodes of the given type to named nodes, by appending to
 * the given prefix the current name of the blank node.
 * @param {DStar} dataset The dataset that contains the quads
 * @param {Term} typeOfMappedNodes The type of the IRIs to map
 * @param {string} prefixIRI The prefix used
 */
 function blankNodeMapping(dataset, typeOfMappedNodes, prefixIRI) {
    let remapping = {};

    dataset.getQuads(null, rdf.type, typeOfMappedNodes, $defaultGraph())
        .filter(quad => quad.subject.termType === "BlankNode")
        .map(quad => quad.subject.value)
        .forEach(blankNodeValue => remapping[blankNodeValue] = N3.DataFactory.namedNode(prefixIRI + blankNodeValue))
    
    let newContent = dataset.getQuads().map(quad => _quadBNMap(remapping, quad));
    
    dataset.removeQuads(dataset.getQuads());
    dataset.addAll(newContent);
}

/**
 * Provided a mapping blank node value => named node, maps the quad to another
 * quad, in which every blank node in the mapping is mapped to the named node
 */
function _quadBNMap(map, quad) {
    return QuadStar.eventuallyRebuildQuad(quad, term => {
        if (term.termType === "BlankNode") {
            let mappedTo = map[term.value];
            if (mappedTo === undefined) return term;
            return mappedTo;
        } else {
            return term;
        }
    });
}


// ==== AG

/**
 * Deletes every occurrence of pgo:Edge pgo:Node, prec:PropertyKey and prec:PropertyKeyValue.
 * 
 * While the PGO ontology is usefull to describe the PG structure, and to
 * specify the provenance of the data, some user may want to discard these
 * provenance information.
 * @param {DStar} dataset The dataset 
 */
function removePGO(dataset) {
    dataset.deleteMatches(null, rdf.type, pgo.Edge             , $defaultGraph());
    dataset.deleteMatches(null, rdf.type, pgo.Node             , $defaultGraph());
    dataset.deleteMatches(null, rdf.type, prec.PropertyKey     , $defaultGraph());
    dataset.deleteMatches(null, rdf.type, prec.PropertyKeyValue, $defaultGraph());
}

module.exports = applyContext;
