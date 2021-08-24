'use strict'

// Connects to a Neo4J database to convert its content to an RDF graph

const neo4j = require('neo4j-driver')

const prec = require('./prec.js');
const RDFGraphBuilder = require("./src/prec/graph-builder");
const graphReducer    = require("./src/prec/graph-reducer.js");

const { ArgumentParser } = require('argparse');

async function extract_from_neo4j_protocol(uri, user, password) {
    let result = {
        nodes: {},
        edges: {}
    };

    function transformProperty(value) {
        if (typeof value === 'string' || value instanceof String) {
            return value;
        } else if (value.toNumber !== undefined) {
            return value.toNumber();
        } else if (Array.isArray(value)) {
            return value.map(v => transformProperty(v));
        } else {
            console.error("Unknown value type");
            console.error(value);
            return null;
        }
    }

    function transformProperties(properties) {
        let result = {};

        for (let pName in properties) {
            result[pName] = transformProperty(properties[pName]);
        }

        return result;
    }

    function addNode(record) {
        result.nodes[record.identity.toNumber()] = {
            identity: record.identity.toNumber(),
            labels: record.labels,
            properties: transformProperties(record.properties)
        };
    }

    function addEdge(record) {
        result.edges[record.identity.toNumber()] = {
            identity: record.identity.toNumber(),
            start: record.start.toNumber(),
            end: record.end.toNumber(),
            type: record.type,
            properties: transformProperties(record.properties)
        };
    }

    const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
    const session = driver.session();

    try {
        const result = await session.run(
            'match (src)-[edge]->(dest) return src, edge, dest;'
        );

        for (let singleRecord of result.records) {
            addNode(singleRecord.get(0 /* "src"  */));
            addEdge(singleRecord.get(1 /* "edge" */));
            addNode(singleRecord.get(2 /* "dest" */));
        };
    } catch (error) {
        console.error(error);
        result = null;
    } finally {
        await session.close();
    }

    await driver.close();

    return result;
}

module.exports = extract_from_neo4j_protocol;


async function main() {

    const parser = new ArgumentParser({
        description: 'Property Graph -> RDF Experimental Parser: From a Neo4J interface'
    });


    parser.add_argument("username", { help: "Username" });
    parser.add_argument("password", { help: "password" });

    parser.add_argument(
        "uri",
        {
            help: "IRI to connect to",
            default: "neo4j://localhost/neo4j",
            nargs: "?"
        }
    );

    parser.add_argument("-c", "--context", {
        help: "Context file in turtle format",
        default: "", nargs: "?"
    });

    let args = parser.parse_args();

    let result = await extract_from_neo4j_protocol(args.uri, args.username, args.password);
    if (result === null) return;

    let [store, prefixes] = RDFGraphBuilder.neo4JProtocoleToStore(result.nodes, result.edges);

    if (args.context !== "") {
        graphReducer(store, prec.filenameToArrayOfQuads(args.context));
    }

    prec.outputTheStore(store, prefixes);
}

if (require.main === module) {
    main();
}
