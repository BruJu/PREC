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


async function extract_from_gremlin(uri) {
    // const authenticator = new gremlin.driver.auth.PlainTextSaslAuthenticator('myuser', 'mypassword');
    // const g = traversal().withRemote(new DriverRemoteConnection('ws://localhost:8182/gremlin', { authenticator });

  let connection = new DriverRemoteConnection("ws://localhost:8182/gremlin");
  const g = traversal().withRemote(connection);

  let list = await g.V().elementMap().toList();

  let propertyGraphStructure = {
    nodes: [],
    edges: [],
  };

  for (let node of list) {
    let altNode = {
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
          altNode.identity = propValue;
        } else if (propKey.elementName === "label") {
          if (_isString(propValue)) {
            altNode.labels = [propValue];
          } else {
            throw "Unknown type for label " + propValue;
          }
        } else {
          throw "Unknown element name for propKey " + propKey;
        }
      } else if (_isString(propKey)) {
        // Regular property
        if (_isString(propValue) || typeof propValue === "number") {
          altNode.properties[propKey] = propValue;
        } else {
          throw "Unknown element value for property " + prop;
        }
      } else {
        throw "Unknown property key type " + propKey;
      }
    }

    if (altNode.identity === undefined) {
      throw "A node has no identity " + node;
    }

    propertyGraphStructure.nodes.push(altNode);
  }

  function getId(node) {
    for (let p of node) {
      if (p[0].typeName === "T" && p[0].elementName === "id") {
        return p[1];
      }
    }

    throw "No id in node " + node;
  }

  let edges = await g.E().elementMap().toList();

  for (let edge of edges) {
    let edgeInfo = {
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
            edgeInfo.identity = propValue;
          } else if (propKey.elementName === "label") {
            if (_isString(propValue)) {
              edgeInfo.type = propValue;
            } else {
              throw "Unknown type for label " + propValue;
            }
          } else {
            throw "Unknown propKey " + propKey;
          }
        } else if (propKey.typeName === "Direction") {
          if (propKey.elementName === "IN") {
            edgeInfo.start = getId(propValue);
          } else if (propKey.elementName === "OUT") {
            edgeInfo.end = getId(propValue);
          } else {
            throw "Unknown propKey " + propKey;
          }
        } else {
          throw "Unknown propKey " + propKey;
        }
      } else if (_isString(propKey)) {
        // Regular property
        if (_isString(propValue) || typeof propValue === "number") {
          edgeInfo.properties[propKey] = propValue;
        } else {
          throw "Unknown element value for property " + prop;
        }
      } else {
        throw "Unknown property key type " + propKey;
      }
    }

    for (const k of ["identity", "type", "start", "end"]) {
      if (edgeInfo[k] === undefined) {
        throw "An edge has no " + k;
      }
    }

    propertyGraphStructure.edges.push(edgeInfo);
  }

  await connection.close();

    return propertyGraphStructure
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
