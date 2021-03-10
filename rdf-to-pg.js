// RDF -> Property Graph Experimental Converter
// Or more like PREC-1

// This file extensively uses the concept of "(simple) path following".
// Following a path is a cute way of saying that we know the subject, and:
// - We know the predicate, we want to know the unique object that coresponds
// to (subject, predicate, ?object).
// - We don't know the predicate, we want to retrieve every path that starts
// with subject ie every triple that has subject as the subject.

// We use Graphy instead of WasmTree because currently WT 
const graphy_dataset = require("@graphy/memory.dataset.fast")
const N3 = require("n3");
const WasmTree = require("@bruju/wasm-tree");

const precMain = require('./prec.js');
const storeAlterer = require("./prec3/store-alterer-from-pattern.js");

const { ArgumentParser } = require('argparse');
const fs = require('fs');

const namespace     = require('@rdfjs/namespace');
const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);
const rdfs = namespace("http://www.w3.org/2000/01/rdf-schema#"      , N3.DataFactory);
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#"                  , N3.DataFactory);
const prec = namespace("http://bruy.at/prec#"                       , N3.DataFactory);

const QUAD = N3.DataFactory.quad;

/** Read the turtle (not star) file in filepath and builds a WT Dataset from it */
function readDataset(filepath) {
    const parser = new N3.Parser();
    let quads = parser.parse(fs.readFileSync(filepath, "utf8"));

    const dataset = new WasmTree.Dataset();
    dataset.addAll(quads);
    return dataset;
}


// TODO: forbid named graphs somewhere as PREC never generates them.


/** Return true if searchedTerm is in the term list. */
function containsTerm(termList, searchedTerm) {
    return termList.some(listedTerm => listedTerm.equals(searchedTerm));
}

/** Adds new methods to datasetInstance that relies on RDF.JS Dataset methods */
function _extendMethods(datasetInstance) {
    extendDataset_PathTravelling(datasetInstance);
    extendDataset_RWPRECGenerated(datasetInstance);
}

function extendDataset_PathTravelling(datasetInstance) {
    /**
     * Return the list of terms that are of type type in the given dataset 
     * @param {*} type The type of the wanted nodes
     * @returns The list of nodes that have the given type
     */
    datasetInstance.getNodesOfType = function(type, graph) {
        return [...this.match(null, rdf.type, type, graph)]
            .map(quad => quad.subject);
    };

    /**
     * Return the list of quads that has the given subject and the predicate is
     * not in ignoreList
     * @param {*} subject The term that is in position subject
     * @param {*} ignoreList List of predicates that should not be as predicate
     * @returns The list of quads that has the given subject and for which the
     * predicate is not in ignoreList
     */
    datasetInstance.getPathsFrom = function(subject, ignoreList) {
        return this.match(subject)
            .filter(quad => !containsTerm(ignoreList || [], quad.predicate));
    };

    /**
     * Find the triple (subject, predicate, ?object), and return the value of
     * ?object. If there is not exactly one match, this function returns null
     * instead.
     * 
     * The considered graph is the default graph
     * @param {*} subject The subject
     * @param {*} predicate The predicate
     * @returns The corresponding object if it exists and is unique
     */
    datasetInstance.followThrough = function(subject, predicate) {
        let match = this.match(subject, predicate, null, N3.DataFactory.defaultGraph());
        if (match.size !== 1) return null;

        return [...match][0].object;
    };


    datasetInstance.hasExpectedPaths = function(subject, requiredPaths, optionalPaths) {
        // Get actual paths
        const match = this.match(subject, null, null, N3.DataFactory.defaultGraph());
        if (match.size < requiredPaths.length) return null;

        // Copy the expected path to modify them
        let reqPaths = [...requiredPaths];
        let optPaths = [...optionalPaths];

        // Helper function to check and remove from the list of accepted paths
        function findInListOfPaths(quad, paths) {
            let iPath = paths.findIndex(path =>
                quad.predicate.equals(path[0])
                && quad.object.equals(path[1])
                && quad.graph.equals(N3.DataFactory.defaultGraph())
            );

            if (iPath === -1) return false;

            paths.splice(iPath, 1);
            return true;
        }
        
        // Compare the actual paths with the expected ones
        const hasAllValidQuads = match.every(quad =>
               findInListOfPaths(quad, reqPaths)
            || findInListOfPaths(quad, optPaths)
        );

        return hasAllValidQuads && reqPaths.length === 0;
    }

    /**
     * If subject, predicate is an unique path (named the followed path), and
     * if the paths of predicates are all either the followed path or included
     * in requiredPaths or optionals paths, returns the object of the followed
     * path.
     * 
     * The considered graph is the default graph.
     * 
     * followThrough(subject, predicate) if the quads were valid.
     * 
     * @param {*} subject The subject
     * @param {*} predicate The predicate to follow
     * @param {*} requiredQuads The list of required quads
     * @param {*} optionalQuads The list of quads that are allowed to be found
     * @returns The object of the (subject, predicate, null) match, or null 
     * either if not unique or if not all the requiredQuads where found or some
     * extra unspecified quads were found.
     */
    datasetInstance.checkAndFollow = function(subject, predicate, requiredPaths, optionalPaths) {
        const followUp = this.followThrough(subject, predicate);
        if (followUp === null) return null;

        const realRequiredPaths = [[predicate, followUp], ...requiredPaths];

        if (this.hasExpectedPaths(subject, realRequiredPaths, optionalPaths)) {
            return followUp;
        } else {
            return null;
        }
    };
}

function extendDataset_RWPRECGenerated(datasetInstance) {
    extendDataset_PathTravelling(datasetInstance);

    /**
     * Returns the rdfs:label value of proxyLabel. requiredPaths and
     * optionalPaths are conditions for other quads that has proxyLabel as the
     * subject, like in the checkAndFollow method.
     * 
     * Note that this function returns a string.
     */
    datasetInstance.readLabelOf = function(proxyLabel, requiredPaths, optionalPaths) {
        let realLabel = this.checkAndFollow(proxyLabel, rdfs.label, requiredPaths, optionalPaths);

        if (realLabel === null || realLabel.termType !== "Literal") {
            return null;
        }

        // TODO : check if the type of the literal is xsd:string
        return realLabel.value;
    };

    /** Return the name of the given property, if its a property. */
    datasetInstance.readPropertyName = function(property) {
        return this.readLabelOf(
            property,
            [[rdf.type, prec.Property       ]],
            [[rdf.type, prec.CreatedProperty]]
        );
    };

    /**
     * Return the name of the label, if its a label.
     * @param {*} term The node label
     * @param {*} labelType The type of label in prec:CreatedLabel
     * @returns The label as a string
     */
    datasetInstance.getRealLabel = function(term, labelType) {
        return this.readLabelOf(term, [], [[rdf.type, labelType]]);
    }
}

/**
 * Remove from the dataset the list that starts from currentNode, and return an
 * array with every node of this list.
 * 
 * Throws an error if the list is not a valid RDF list or one of its node is
 * connected to another part of the graph.
 */
function _extractAndDeleteRdfList(dataset, currentNode) {
    let result = [];

    while (!rdf.nil.equals(currentNode)) {
        if (dataset.match(null, null, currentNode).size != 0) throw "Invalid list (1)";
        if (dataset.match(null, currentNode, null).size != 0) throw "Invalid list (2)";
        if (dataset.match(currentNode, null, null).size != 3) throw "Invalid list (3)";

        if (!dataset.has(QUAD(currentNode, rdf.type, rdf.List))) throw "Prop value invalid";

        let value = dataset.followThrough(currentNode, rdf.first);
        if (value === null) throw "Invalid list - No first element";

        // TODO: check if value is not used anywhere else

        result.push(value);

        let next = dataset.followThrough(currentNode, rdf.rest);
        if (next == null) throw "Invalid list - No rest";

        dataset.delete(QUAD(currentNode, rdf.type , rdf.List));
        dataset.delete(QUAD(currentNode, rdf.first, value   ));
        dataset.delete(QUAD(currentNode, rdf.rest , next    ));

        currentNode = next;
    }

    return result;
}

function extractAndDeletePropertyValue(dataset, value) {
    if (dataset.has(QUAD(value, rdf.type, rdf.List))) {
        let r = _extractAndDeleteRdfList(dataset, value);
        return r.map(quad => extractAndDeletePropertyValue(dataset, quad));
    } else if (dataset.has(QUAD(value, rdf.type, prec.PropertyValue))) {
        dataset.delete(QUAD(value, rdf.type, prec.PropertyValue));

        let v = dataset.checkAndFollow(value, rdf.value, [], []);
        if (v == null) throw "Invalid RDF Graph - " + value.value + " has meta properties (not yet supported)";

        dataset.delete(QUAD(value, rdf.value, v));
        // TODO: check type and treat xsd:integer case
        return v.value;
    } else {
        throw "Invalid RDF Graph - " + value.value + " is not a valid property value";
    }
}


function extractEdgeSPO(dataset, rdfEdge) {
    function extractConnectedNodeToEdge(dataset, rdfEdge, predicate) {
        let result = dataset.followThrough(rdfEdge, predicate);
        if (!result) throw "Edge has no " + predicate.value + " " + rdfEdge.value;
        if (!dataset.has(QUAD(result, rdf.type, pgo.Node))) {
            throw "Edge connected to something that is not a node";
        }
        return result;
    }

    function extractLabel(dataset, rdfEdge, predicate) {
        let result = dataset.followThrough(rdfEdge, predicate);
        if (!result) throw "Edge has no " + predicate.value;
        return [result, dataset.getRealLabel(result, prec.CreatedRelationshipLabel)];
    }

    return [
        extractConnectedNodeToEdge(dataset, rdfEdge, rdf.subject),
        extractConnectedNodeToEdge(dataset, rdfEdge, rdf.object),
        extractLabel(dataset, rdfEdge, rdf.predicate)
    ];
}

class PseudoPGBuilder {
    constructor() {
        this.propertyGraphStructure = {
            nodes: [],
            edges: []
        };

        this.iriToNodes = {};
    }

    toPropertyGraph() {
        return this.propertyGraphStructure;
    }

    addNode(identifier) {
        if (this.iriToNodes[identifier] === undefined) {
            this.iriToNodes[identifier] = {};
            this.iriToNodes[identifier].id = identifier;

            this.propertyGraphStructure.nodes.push(this.iriToNodes[identifier]);
        }

        return this.iriToNodes[identifier];
    }

    addEdge(sourceIdentifier, destinationIdentifier) {
        let edge = {};
        this.propertyGraphStructure.edges.push(edge);
        edge.source = this.addNode(sourceIdentifier);
        edge.destination = this.addNode(destinationIdentifier);
        return edge;
    }

    static from(dataset) {
        try {
            let builder = new PseudoPGBuilder();

            // TODO : pgo:Node, pgo:Edge etc are disjoint types

            // A property is:
            // - _e prop propBN - propBN rdf:value a_literal
            // - prop rdf:type prec:Property
            // - propBN rdf:type propBN
            // - propBN is only used here
            // => We currently don't support meta properties
            function extractProperties(dataset, rdfNode, type) {
                let ignoreList;
                if (type == "Node") {
                    ignoreList = [ rdf.type ];
                } else if (type == "Edge") {
                    ignoreList = [ rdf.subject, rdf.predicate, rdf.object, rdf.type];
                } else {
                    throw "extractProperties invalid type" + type;
                }

                const pathsFrom = dataset.getPathsFrom(rdfNode, ignoreList);

                let properties = {};

                for (const path of pathsFrom) {
                    const propertyName = dataset.readPropertyName(path.predicate);
                    if (propertyName === null) throw "Invalid RDF Graph - readPropertyName";

                    dataset.delete(path);

                    const propertyValue = extractAndDeletePropertyValue(dataset, path.object);

                    if (properties[propertyName] !== undefined) {
                        // Note : we could relax this so several times the same
                        // predicate name means it was a list.
                        // But this wouldn't catch the case of empty and one
                        // element lists.
                        throw "Invalid RDF graph: several times the same property " + propertyName;
                    }

                    properties[propertyName] = propertyValue;
                }

                return properties;
            }

            function extractLabels(dataset, node) {
                let otherTypes = dataset.match(node, rdf.type);

                let result = [...otherTypes].map(quad => quad.object);
                for (let r of result) {
                    dataset.delete(N3.DataFactory.quad(node, rdf.type, r));
                }

                return result.map(term => dataset.getRealLabel(term, prec.CreatedNodeLabel));
            }

            // Edges should be:
            // - this rdf:subject s, s is a pgo.Node
            // - this rdf:predicate y, y is a (relationship) label
            // - this rdf:object o, o is a pgo.Node
            // Edges may have some other things that are properties
            for (let rdfEdge of dataset.getNodesOfType(pgo.Edge)) {
                // rdf:subject/predicate/object
                let [source, destination, label] = extractEdgeSPO(dataset, rdfEdge);
                let pgEdge = builder.addEdge(source.value, destination.value)
                pgEdge.label = label[1].value;

                // Remove from the RDF graph to be able to check if we consumed
                // the whole graph.
                dataset.delete(N3.DataFactory.quad(rdfEdge, rdf.subject  , source     ));
                dataset.delete(N3.DataFactory.quad(rdfEdge, rdf.predicate, label[0]   ));
                dataset.delete(N3.DataFactory.quad(rdfEdge, rdf.object   , destination));

                // Some other things that are properties
                pgEdge.properties = extractProperties(dataset, rdfEdge, "Edge");

                dataset.delete(QUAD(rdfEdge, rdf.type, pgo.Edge));
            }

            // Nodes
            // - A node is something of type pgo.Node. It may have properties
            for (let rdfNode of dataset.getNodesOfType(pgo.Node)) {
                // The node itself
                let pgNode = builder.addNode(rdfNode.value);
                dataset.delete(N3.DataFactory.quad(rdfNode, rdf.type, pgo.Node));

                // Labels and properties
                pgNode.labels = extractLabels(dataset, rdfNode);
                pgNode.properties = extractProperties(dataset, rdfNode, "Node");
            }

            // Delete from the RDF graph the triples that are "prec related".
            // TODO: ^

            // End
            console.error(dataset.size + " remaining quads");
            // TODO: fail if dataset is not empty at this point

            //dataset.forEach(console.error);

            precMain.outputTheStore(new N3.Store([...dataset]));

            return builder.toPropertyGraph();
        } catch (e) {
            console.error(e);
            return null;
        }
    }
}


function main() {
    const parser = new ArgumentParser({
        description: 'PREC-1 (Property Graph <- RDF Experimental Converter)'
    });

    parser.add_argument(
        "RDFPath",
        { help: "Path to the RDF graph to convert back" }
    );

    const args = parser.parse_args();

    const dataset = readDataset(args.RDFPath);
    _extendMethods(dataset);
    
    let pg = PseudoPGBuilder.from(dataset)

    console.log(JSON.stringify(pg, null, 2));
}

if (require.main === module) {
    main();
}


module.exports = {
    extendDataset_PathTravelling,
    extendDataset_RWPRECGenerated,
    PseudoPGBuilder
};

