'use strict';

const gremlin = require("gremlin");
const { ArgumentParser } = require('argparse');

const traversal = gremlin.process.AnonymousTraversalSource.traversal;
const DriverRemoteConnection = gremlin.driver.DriverRemoteConnection;
const RDFGraphBuilder = require("./prec3/graph-builder.js");
const graphReducer    = require("./prec3/graph-reducer.js");

const { EnumValue } = gremlin.process;
const precMain = require('./prec.js');


/**
 * Check if the given object is a string
 *
 * Source: https://stackoverflow.com/a/9436948
 * @param {any} object
 * @returns true if object is a string
 */
function _isString(object) {
    return typeof object === "string" || object instanceof String;
}

/**
 * Returns the id of the node. Throws if there are no id.
 * @param {*} node The Gremlin node
 * @returns The id
 */
function _getGremlinNodeId(node) {
    for (let p of node) {
        if (p[0].typeName === "T" && p[0].elementName === "id") {
            return p[1];
        }
    }

    throw "No id in node " + node;
}

/**
 * Converts a node extracted from a traversal to a node with a format similar
 * to Neo4J cypher query.
 * @param {*} node The traversal node
 * @returns A Neo4j Cypher answer like node
 */
function convertNodeToNeo4jJsonFormat(node) {
    let neoNode = {
        identity: undefined,
        labels: [],
        properties: {},
    };

    for (let prop of node) {
        let [propKey, propValue] = prop;

        if (propKey instanceof EnumValue) {
            // Special Field
            if (propKey.typeName !== "T")
                throw "Unknown typename for propKey " + propKey;
            if (propKey.elementName === "id") {
                neoNode.identity = propValue;
            } else if (propKey.elementName === "label") {
                if (_isString(propValue)) {
                    neoNode.labels = [propValue];
                } else {
                    throw "Unknown type for label " + propValue;
                }
            } else {
                throw "Unknown element name for propKey " + propKey;
            }
        } else if (_isString(propKey)) {
            // Regular property
            if (_isString(propValue) || typeof propValue === "number") {
                neoNode.properties[propKey] = propValue;
            } else {
                throw "Unknown element value for property " + prop;
            }
        } else {
            throw "Unknown property key type " + propKey;
        }
    }

    return neoNode;
}

/**
 * Converts an edge extracted from a traversal to an edge with a format similar
 * to the Neo4J Cypher Query format.
 * @param {*} edge The traversal edge
 * @returns A Neo4J Cypher answer like edge
 */
function convertEdgeToNeo4JJsonFormat(edge) {
    let neoEdge = {
        identity: undefined,
        start: undefined,
        end: undefined,
        type: undefined,
        properties: {},
    };

    for (let prop of edge) {
        let [propKey, propValue] = prop;

        if (propKey instanceof EnumValue) {
            // Special Field
            if (propKey.typeName === "T") {
                if (propKey.elementName === "id") {
                    neoEdge.identity = propValue;
                } else if (propKey.elementName === "label") {
                    if (_isString(propValue)) {
                        neoEdge.type = propValue;
                    } else {
                        throw "Unknown type for label " + propValue;
                    }
                } else {
                    throw "Unknown propKey " + propKey;
                }
            } else if (propKey.typeName === "Direction") {
                if (propKey.elementName === "IN") {
                    neoEdge.start = _getGremlinNodeId(propValue);
                } else if (propKey.elementName === "OUT") {
                    neoEdge.end = _getGremlinNodeId(propValue);
                } else {
                    throw "Unknown propKey " + propKey;
                }
            } else {
                throw "Unknown propKey " + propKey;
            }
        } else if (_isString(propKey)) {
            // Regular property
            if (_isString(propValue) || typeof propValue === "number") {
                neoEdge.properties[propKey] = propValue;
            } else {
                throw "Unknown element value for property " + prop;
            }
        } else {
            throw "Unknown property key type " + propKey;
        }
    }

    return neoEdge;
}


async function extract_from_gremlin(uri) {
    // const authenticator = new gremlin.driver.auth.PlainTextSaslAuthenticator('myuser', 'mypassword');
    // const g = traversal().withRemote(new DriverRemoteConnection('uri', { authenticator });

    let connection = new DriverRemoteConnection(uri);
    const g = traversal().withRemote(connection);

    let nodes = [];
    let edges = [];

    for (let node of await g.V().elementMap().toList()) {
        const neoNode = convertNodeToNeo4jJsonFormat(node);

        if (neoNode[identity] === undefined) {
            throw "A node has no identity";
        }

        nodes.push(neoNode);
    }

    for (let edge of await g.E().elementMap().toList()) {
        let neoEdge = convertEdgeToNeo4JJsonFormat(edge);

        for (const k of ["identity", "type", "start", "end"]) {
            if (neoEdge[k] === undefined) {
                throw "An edge has no " + k;
            }
        }

        edges.push(neoEdge);
    }

    await connection.close();

    return { nodes, edges };
}


async function main() {
    const parser = new ArgumentParser({
        description: 'Property Graph -> RDF Experimental Parser: From a Gremlin interface'
    });

    parser.add_argument(
        "uri",
        {
            help: "IRI to connect to",
            default: "ws://localhost:8182/gremlin",
            nargs: "?"
        }
    );
    
    parser.add_argument("-c", "--context", {
        help: "Context file in turtle format",
        default: "", nargs: "?"
    });

    let args = parser.parse_args();

    let result = await extract_from_gremlin(args.uri);
    if (result === null) return;

    let [store, prefixes] = RDFGraphBuilder.neo4JProtocoleToStore(result.nodes, result.edges);

    if (args.context !== "") {
        graphReducer(store, precMain.filenameToArrayOfQuads(args.context));
    }

    precMain.outputTheStore(store, prefixes);
}


if (require.main === module) {
    main();
}
