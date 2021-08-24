'use strict';

// This file enables to convert an APOC exported Property Graph in Json format
// into a Turtle-star RDF-star file.
//
// RDF-star is used in SA mode (annotated quads are not affirmed).

// Import some libraries
const N3            = require('n3');

const RDFGraphBuilder = require("./src/prec/graph-builder");
const { default: graphReducer } = require("./src/prec/graph-reducer");

const { ArgumentParser } = require('argparse');

const fs = require('fs');

/// Returns the content of filename, line by line
function fileToString(filename) {
    return fs.readFileSync(filename, 'utf-8').split(/\r?\n/);
}

/// Transforms an array of strings, each strings being a JSON representation,
/// into an array of JS objects
function stringsToJsObjects(file_content) {
    let collection = [];

    for (const line of file_content) {
        if (line.trim() == "") {
            continue;
        }

        collection.push(JSON.parse(line));
    }

    return collection;
}

const fileReader = {
    "fromNeo4j": filename => stringsToJsObjects(fileToString(filename)),
    "fromNeo4jString": content => stringsToJsObjects(content.split(/\r?\n/))
};


function filenameToArrayOfQuads(filename) {
    const trig = fs.readFileSync(filename, 'utf-8');
    return trigToArrayOfQuads(trig);
}

function trigToArrayOfQuads(trig) {
    const parser = new N3.Parser();
    return parser.parse(trig);
}



function outputTheStore(store, prefixes) {
    const writer = new N3.Writer({ prefixes: prefixes });
    store.forEach(quad => writer.addQuad(quad.subject, quad.predicate, quad.object, quad.graph));
    writer.end((_error, result) => console.log(result));
    
    console.error(store.size + " triples");
}

function precOnNeo4J(filename, context) {
    const propertyGraphStructure = fileReader.fromNeo4j(filename);
    const store = RDFGraphBuilder.neo4jJsToStore(propertyGraphStructure)[0];
    graphReducer(store, filenameToArrayOfQuads(context));
    return store;
}

function precOnNeo4JString(json, contextAsQuads) {
    const pgStructure = fileReader.fromNeo4jString(json);
    const store = RDFGraphBuilder.neo4jJsToStore(pgStructure)[0];
    graphReducer(store, contextAsQuads);
    return store;
}

const contentFileToRDFGraph = {
    "Neo4JAPOC": path => {
        // Read the PG structure
        const propertyGraphStructure = fileReader.fromNeo4j(path);
        // Convert to an expanded RDF graph
        return RDFGraphBuilder.neo4jJsToStore(propertyGraphStructure);
    },
    "Neo4JCypher": path => {
        let fileContent = fs.readFileSync(path, 'utf-8');
        let content = JSON.parse(fileContent);
        return RDFGraphBuilder.neo4JCypherToStore(content);
    }
}

function main() {
    const parser = new ArgumentParser({
        description: 'Property Graph -> RDF Experimental Parser'
    });

    parser.add_argument(
        "PGContentPath",
        { help: "Property Graph content source file" }
    );

    parser.add_argument(
        "Context",
        { help: "Path to a turtle file with the context", default:"", nargs:"?" }
    );

    parser.add_argument(
        "-f",
        "--PGContentFormat",
        {
            help: "Method used to generation the PG Content file",
            default: "Neo4JAPOC",
            choices: [ "Neo4JAPOC", "Neo4JCypher" ],
            nargs: "?",
        }
    )

    let realArgs = parser.parse_args();

    // Convert the Property Graph content to RDF
    const [store, prefixes] = contentFileToRDFGraph[realArgs.PGContentFormat](realArgs.PGContentPath);

    // Reduce the number of triples
    if (realArgs.Context !== "") {
        graphReducer(store, filenameToArrayOfQuads(realArgs.Context));
    }

    // Done gg
    outputTheStore(store, prefixes);
}

if (require.main === module) {
    main();
}

module.exports = {
    precOnNeo4J: precOnNeo4J,
    precOnNeo4JString: precOnNeo4JString,
    outputTheStore: outputTheStore,
    filenameToArrayOfQuads: filenameToArrayOfQuads
};
