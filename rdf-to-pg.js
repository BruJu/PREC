"use strict";

// RDF -> Property Graph Experimental Converter
// Or more like PREC-1

// This file extensively uses the concept of "(simple) path following".
// Following a path is a cute way of saying that we know the subject, and:
// - We know the predicate, we want to know the unique object that coresponds
// to (subject, predicate, ?object).
// - We don't know the predicate, we want to retrieve every path that starts
// with subject ie every triple that has subject as the subject.

////////////////////////////////////////////////////////////////////////////////
// ==== Imports

const { ArgumentParser } = require('argparse');
const fs = require('fs');
const precMain  = require('./prec.js');
const precUtils = require('./prec3/utils.js');

// -- RDF
const graphyFactory = require('@graphy/core.data.factory');
const N3            = require("n3");
const WasmTree      = require("@bruju/wasm-tree");
const namespace     = require('@rdfjs/namespace');

const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);
const rdfs = namespace("http://www.w3.org/2000/01/rdf-schema#"      , N3.DataFactory);
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#"                  , N3.DataFactory);
const prec = namespace("http://bruy.at/prec#"                       , N3.DataFactory);

const QUAD = N3.DataFactory.quad;

// -- Property Graph API
const neo4j = require('neo4j-driver');

const gremlin = require("gremlin");
const traversal = gremlin.process.AnonymousTraversalSource.traversal;
const DriverRemoteConnection = gremlin.driver.DriverRemoteConnection;
const { EnumValue } = gremlin.process;


////////////////////////////////////////////////////////////////////////////////
// ==== Helper functions and extension of dataset

/** Read the turtle (not star) file in filepath and builds a WT Dataset from it */
function readDataset(filepath) {
    const parser = new N3.Parser();
    let quads = parser.parse(fs.readFileSync(filepath, "utf8"));

    const dataset = new WasmTree.Dataset();
    dataset.addAll(quads);
    return dataset;
}

/** Return true if searchedTerm is in the term list. */
function containsTerm(termList, searchedTerm) {
    return termList.some(listedTerm => listedTerm.equals(searchedTerm));
}

/** Adds new methods to datasetInstance that relies on RDF.JS Dataset methods */
function _extendMethods(datasetInstance) {
    extendDataset_PathTravelling(datasetInstance);
    extendDataset_RWPRECGenerated(datasetInstance);
}

/**
 * Adds news method to datasetInstance that relies on RDF.JS dataset methods
 * 
 * These methods are related to path travelling and basic checking of the
 * content of the dataset.
 */
function extendDataset_PathTravelling(datasetInstance) {
    /** Returns true if one of the quad is not in the default graph */
    datasetInstance.hasNamedGraph = function() {
        return this.some(quad => !N3.DataFactory.defaultGraph().equals(quad.graph));
    }

    /** Returns true if one of the quad has a embedded quad */
    datasetInstance.isRdfStar = function() {
        if (datasetInstance.free !== undefined) {
            // Probably WasmTree. WT doesn't supported embedded quads
            return false;
        }

        return this.some(quad =>
            quad.subject.termType !== "Quad"
            && quad.predicate.termType !== "Quad"
            && quad.object.termType !== "Quad"
            && quad.graph.termType !== "Quad");
    }

    /**
     * Returns true if the given types are disjoints, ie if all nodes that have
     * one of them as a type doesn't have the others as type.
     */
    datasetInstance.areDisjointTypes = function(types) {
        let set = new Set();

        for (let type of types) {
            let dataset = this.match(null, rdf.type, type);

            for (let quad of dataset) {
                let s = graphyFactory.fromTerm(quad.subject).concise();
                
                if (set.has(s)) {
                    return false;
                }

                set.add(s);
            }
        }

        return true;
    }

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

    /**
     * Check every paths from the subject node are the expected one, ie every
     * requiredPath exists and there are no unlisted paths.
     * 
     * Paths can use null as an object as an unique wildcard.
     * 
     * @param {*} subject The subject of every studied quad
     * @param {*} requiredPaths The list of required path, ie for each path in
     * requiredPaths, a quad in the form
     * (subject, path[0], path[1], defaultGraph)
     * must be in the dataset. If path[1] is null, the function will bind it
     * to the first ?object it find in a triple (subject, path[0], ?object) of
     * the graph
     * @param {*} optionalPaths The list of optional paths. See requiredPaths
     * for format. The only difference is that not finding optional paths won't
     * result in a false
     * @param {*} outFoundPaths If an array is provided as this parameter, the
     * actually found paths will be written here
     * @returns True if every requiredPaths is found and there exists no path
     * that is not either in requiredPaths or optionalPaths.
     */
    datasetInstance.hasExpectedPaths = function(subject, requiredPaths, optionalPaths, outFoundPaths) {
        if (outFoundPaths !== undefined) outFoundPaths.length = 0;

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
                && (path[1] === null || quad.object.equals(path[1]))
                && quad.graph.equals(N3.DataFactory.defaultGraph())
            );

            if (iPath === -1) return false;

            if (outFoundPaths !== undefined) outFoundPaths.push([quad.predicate, quad.object]);
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
     * @param {*} requiredPaths The list of required paths
     * @param {*} optionalPaths The list of paths that are allowed to be found
     * @returns The object of the (subject, predicate, null) match, or null 
     * either if not unique or if not all the requiredPaths where found or some
     * extra unspecified paths were found.
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

/**
 * Adds new method to the dataseInstance related to consuming a RDF graph
 * generated by PREC
 */
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

/**
 * Consumes a propertyValue = reads it from the dataset, removes it from it and
 * return its content as a pure Javascript object.
 */
function extractAndDeletePropertyValue(dataset, value) {
    if (dataset.has(QUAD(value, rdf.type, rdf.List))) {
        let r = _extractAndDeleteRdfList(dataset, value);
        return r.map(quad => extractAndDeletePropertyValue(dataset, quad));
    } else if (dataset.has(QUAD(value, rdf.type, prec.PropertyValue))) {
        dataset.delete(QUAD(value, rdf.type, prec.PropertyValue));

        let v = dataset.checkAndFollow(value, rdf.value, [], []);
        if (v == null) throw "Invalid RDF Graph - " + value.value + " has meta properties (not yet supported)";

        dataset.delete(QUAD(value, rdf.value, v));

        return precUtils.rdfLiteralToValue(v);
    } else {
        throw "Invalid RDF Graph - " + value.value + " is not a valid property value";
    }
}

/**
 * For a given node in the RDF graph that was an export from PREC, return the
 * subject node, the object node and the label.
 * 
 * The rdf:subject, rdf:predicate and rdf:object must be unique.
 *
 * The type of the subject and the object are checked to be as type pgo:Node.
 * For the predicate, both the node and its label are retrieved. Some checks
 * are applied if is a relationship label.
 * 
 * Returns null on error.
 * @returns [subject node, object node, [ predicate node, predicate label ]]
 */
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

/**
 * Remove all subject that have the given paths and match the given predicate.
 */
function remvoeSubjectIfMatchPaths(dataset, requiredPaths, optionalPaths, extraPredicate) {
    if (requiredPaths.length == 0) {
        throw "Empty required path is not yet implemented";
    }

    function removePaths(dataset, subject, paths) {
        paths.map(path => N3.DataFactory.quad(subject, path[0], path[1]))
            .forEach(q => dataset.delete(q));
    }

    // Default parameters
    if (optionalPaths === undefined) optionalPaths = [];
    if (extraPredicate === undefined) extraPredicate = (_a, _b) => true;

    // Find subjects that match the first pattern
    let match = dataset.match(null, requiredPaths[0][0], requiredPaths[0][1], N3.DataFactory.defaultGraph());

    let old01 = requiredPaths[0][1];

    for (let quad of match) {
        const subject = quad.subject;
        if (old01 == null) requiredPaths[0][1] = quad.object;

        let foundMappings = [];

        if (dataset.hasExpectedPaths(subject, requiredPaths, optionalPaths, foundMappings) && extraPredicate(dataset, subject)) {
            removePaths(dataset, subject, foundMappings);
        }
    }

    requiredPaths[0][1] = old01;
}


////////////////////////////////////////////////////////////////////////////////
// ==== Pseudo PG builder

/**
 * Builder for a property graph structure.
 */
class PseudoPGBuilder {
    /** Build the builder */
    constructor() {
        this.propertyGraphStructure = {
            nodes: [],
            edges: []
        };

        this.iriToNodes = {};
    }

    /**
     * Returns a dictionnary with the nodes and the edges in the form of
     * { nodes: [node...], edges: [edge...] }
     */
    toPropertyGraph() {
        return this.propertyGraphStructure;
    }

    /**
     * Ensures a node corresponding to the given identifier exists and returns
     * it. The identifier format is a string.
     */
    addNode(identifier) {
        if (this.iriToNodes[identifier] === undefined) {
            this.iriToNodes[identifier] = {};
            this.iriToNodes[identifier].id = identifier;

            this.propertyGraphStructure.nodes.push(this.iriToNodes[identifier]);
        }

        return this.iriToNodes[identifier];
    }

    /**
     * Creates a new edge that starts at the node identified by sourceIdentifier
     * and at the node identifier by destinationIdentifier.
     * 
     * If the edge was already present, the behaviour is undefined.
     */
    addEdge(sourceIdentifier, destinationIdentifier) {
        let edge = {};
        this.propertyGraphStructure.edges.push(edge);
        edge.source = this.addNode(sourceIdentifier);
        edge.destination = this.addNode(destinationIdentifier);
        return edge;
    }

    /**
     * Converts the RDF graph described by sourceDataset into a a Property Graph
     * structure. The given RDF graph is expected to have been generated by
     * a former call to PREC, ie to have its format ; but other RDF graphs
     * that have the same structure are also accepted.
     * 
     * This function is unable to translate a graph that has been transformed
     * by a context.
     * 
     * This function will return either a dictionnary with a
     * { "PropertyGraph": toPropertyGraph(), "Remaining Quads": remaningQuads }
     * if there was no error in the structure of the consumed quads
     * or
     * { "error": a message }
     * if there was a problem with the structure.
     */
    static from(sourceDataset) {
        let dataset = sourceDataset.match();
        _extendMethods(dataset);

        try {
            if (dataset.hasNamedGraph()) {
                throw "Found named graphs but PREC only generates in default graph";
            }

            if (dataset.isRdfStar()) {
                throw "Found embedded quad but PREC only generates RDF non star";
            }

            if (!dataset.areDisjointTypes([pgo.Node, pgo.Edge, prec.Property, prec.PropertyValue])) {
                throw "pgo:Node, pgo:Edge, prec:Property and prec:PropertyValue should be disjoint types.";
            }

            let builder = new PseudoPGBuilder();

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
                    if (propertyValue === null || propertyValue === undefined)
                        throw "Invalid RDF Graph - Invalid Property Value - " + path.object.value;

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
                pgEdge.label = label[1];

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
            const noMoreInContext = (dataset, subject) =>  dataset.match(null, subject, null).size == 0
                                                        && dataset.match(null, null, subject).size == 0;
            
            remvoeSubjectIfMatchPaths(dataset,
                [
                    [rdf.type, prec.CreatedRelationshipLabel],
                    [rdfs.label, null]
                ],
                [],
                noMoreInContext
            );

            remvoeSubjectIfMatchPaths(dataset,
                [
                    [rdf.type, prec.CreatedNodeLabel],
                    [rdfs.label, null]
                ],
                [],
                noMoreInContext
            );

            remvoeSubjectIfMatchPaths(dataset,
                [
                    [rdf.type, prec.Property],
                    [rdfs.label, null]
                ],
                [
                    [rdf.type, prec.CreatedProperty]
                ],
                noMoreInContext
            );

            // Remove axioms and meta data
            dataset.deleteMatches(prec.MetaData, prec.GenerationModel);
            dataset.deleteMatches(prec.CreatedNodeLabel, rdfs.subClassOf, prec.CreatedVocabulary);
            dataset.deleteMatches(prec.CreatedRelationshipLabel, rdfs.subClassOf, prec.CreatedVocabulary);
            dataset.deleteMatches(prec.CreatedProperty, rdfs.subClassOf, prec.CreatedVocabulary);

            // End
            if (dataset.size === 0 && dataset.free !== undefined) {
                dataset.free();
            }

            return {
                "PropertyGraph": builder.toPropertyGraph(),
                "Remaining Quads": dataset
            };
        } catch (e) {
            if (dataset.free !== undefined) dataset.free();
            return { "error": e };
        }
    }
}

/**
 * 
 * This function assigns a new member to the identifier property of nodes
 */
function makeCypherQuery(propertyGraphStructure) {
    class QueryBuilder {
        constructor() {
            this.instructions = [];
        }

        getQuery() {
            if (this.instructions.length == 0) {
                return "";
            }

            return "CREATE " + this.instructions.join(",\n       ") + ";";
        }

        addInstruction(instruction) { this.instructions.push(instruction); }
    }

    function translateProperties(properties) {
        if (properties === undefined) return "";
        if (properties.length == 0) return "";

        // We rely on the fact that:
        // Cypher doesn't support different types on properties in a iist
        // Only string and numbers can appear in a list of properties

        return "{"
            + Object.keys(properties)
                .map(pName => pName + ": " + JSON.stringify(properties[pName]))
                .join(", ")
            + "}";
    }

    let builder = new QueryBuilder();

    let nodeCount = 1;
    for (let node of propertyGraphStructure.nodes) {
        node.identifier = "node" + nodeCount;
        ++nodeCount;

        const labels = node.labels.map(label => ":" + label).join(" ");
        const properties = translateProperties(node.properties);
        builder.addInstruction(`(${node.identifier} ${labels} ${properties})`)
    }

    for (let edge of propertyGraphStructure.edges) {
        const properties = translateProperties(edge.properties);
        const edgeString = `:${edge.label} ${properties}`;
        builder.addInstruction(
            `(${edge.source.identifier})-[${edgeString}]->(${edge.destination.identifier})`
        );
    }

    return builder.getQuery();
}

async function makeNeo4Jrequest(username, password, uri, query) {
    const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
    const session = driver.session();

    try {
        await session.run(query);
    } catch (error) {
        console.error("-- Make Neo4J Request");
        console.error(error);
    } finally {
        await session.close();
    }

    await driver.close();
}

/**
 * Insert the content of the property graph in the given Gremlin end point.
 * @param {*} uri The URI of the Gremlin end point
 * @param {*} propertyGraphStructure The content of the property graph, in the
 * meta property-less model
 */
async function insertIntoGremlin(uri, propertyGraphStructure) {
    let connection = new DriverRemoteConnection(uri);
    const g = traversal().withRemote(connection);

    let numberOfNodes = 0;
    let numberOfEdges = 0;

    // Properties are not inserted using specific Cardinalities as they seem to
    // only be "insertion strategies".
    
    for (const node of propertyGraphStructure.nodes) {
        let vertex;
        if (node.labels.length === 0) {
            vertex = g.addV();
        } else {
            vertex = g.addV(node.labels.join("::"));
        }

        for (let propertyKey in node.properties) {
            vertex = vertex.property(propertyKey, node.properties[propertyKey]);
        }

        node._gremlin = await vertex.next();
        ++numberOfNodes;
    }

    for (const edge of propertyGraphStructure.edges) {
        let gremlinEdge = g.V(edge.source._gremlin.value.id).addE(edge.label);
        gremlinEdge = gremlinEdge.to(edge.destination._gremlin.value);

        for (let propertyKey in edge.properties) {
            gremlinEdge = gremlinEdge.property(propertyKey, edge.properties[propertyKey]);
        }

        edge._gremlin = await gremlinEdge.iterate();
        ++numberOfEdges;
    }

    await connection.close();
    console.error(`${numberOfNodes} node${numberOfNodes===1?'':'s'} `
        + `and ${numberOfEdges} edge${numberOfEdges===1?'':'s'} `
        + `have been added to the Gremlin endpoint ${uri}`);
}

async function main() {
    const parser = new ArgumentParser({
        description: 'PREC-1 (Property Graph <- RDF Experimental Converter)'
    });

    parser.add_argument(
        "RDFPath",
        { help: "Path to the RDF graph to convert back" }
    );

    parser.add_argument(
        "-f",
        "--OutputFormat",
        {
            help: "Output format",
            default: "Cypher",
            choices: ["Cypher", "Neo4J", "PGStructure", "Gremlin"],
            nargs: "?"
        }
    );

    parser.add_argument(
        "--Neo4JLogs",
        {
            help: "Neo4J credentials in the format username:password. Only used if output is Neo4J",
            default: "", nargs: "?"
        }
    );

    parser.add_argument(
        "--Neo4JURI",
        {
            help: "Neo4J database URI. Only used if output if Neo4J.",
            default: "neo4j://localhost/neo4j", nargs: "?"
        }
    );
    
    parser.add_argument(
        "--GremlinURI",
        {
            help: "Gremlin end point URI. Only used id output is Gremlin",
            default: "ws://localhost:8182/gremlin", nargs: "?"
        }
    );

    const args = parser.parse_args();

    const dataset = readDataset(args.RDFPath);
    _extendMethods(dataset);
    
    let result = PseudoPGBuilder.from(dataset)
    
    if (result.error !== undefined) {
        console.error("Error: " + result.error);
    } else if (result["Remaining Quads"].size !== 0) {
        console.error(dataset.size + " remaining quads");
        precMain.outputTheStore(new N3.Store([...dataset]));
    } else {
        if (args.OutputFormat === "Cypher") {
            console.log(makeCypherQuery(result.PropertyGraph));
        } else if (args.OutputFormat === "PGStructure") {
            console.log(JSON.stringify(result.PropertyGraph, null, 2));
        } else if (args.OutputFormat === "Neo4J") {
            const credentials = args.Neo4JLogs.split(":");
            const query = makeCypherQuery(result.PropertyGraph);

            await makeNeo4Jrequest(
                credentials[0],
                credentials[1],
                args.Neo4JURI,
                query
            );

            result["Remaining Quads"].free();
        } else if (args.OutputFormat === 'Gremlin') {
            const uri = args.GremlinURI;
            await insertIntoGremlin(uri, result.PropertyGraph);
        } else {
            console.error("Unknown output format " + args.OutputFormat);
        }
    }
}

if (require.main === module) {
    main();

}

module.exports = {
    extendDataset_PathTravelling,
    extendDataset_RWPRECGenerated,
    PseudoPGBuilder
};

