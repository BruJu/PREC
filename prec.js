'use strict';

// This file enables to convert an APOC exported Property Graph in Json format
// into a Turtle-star RDF-star file.
//
// RDF-star is used in SA mode (annotated quads are not affirmed).

// Import some libraries
const N3            = require('n3');

const RDFGraphBuilder = require("./prec3/graph-builder.js");
const graphReducer    = require("./prec3/graph-reducer.js");
const fileReader      = require("./file-read.js");


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
    const store = RDFGraphBuilder.neo4jJsToStore(propertyGraphStructure, "RDFReification")[0];
    graphReducer(store, filenameToArrayOfQuads(context));
    return store;
}

function precOnNeo4JString(json, contextAsQuads) {
    const pgStructure = fileReader.fromNeo4jString(json);
    const store = RDFGraphBuilder.neo4jJsToStore(pgStructure, "RDFReification")[0];
    graphReducer(store, contextAsQuads);
    return store;
}

function main() {
    // Arg parsing done badly
    if (process.argv.length < 3) {
        console.log(`Usage: ${process.argv[0]} ${process.argv[1]} filename (RDFStar)? (ContextFile)?`);
        return;
    }

    const filename = process.argv[2];

    let args = process.argv.splice(3);
    let mode = "RDFReification";
    if (args.length > 0 && args[0] === "RDFStar") {
        mode = args[0];
        args = args.splice(1);
    }

    // Read the PG structure
    const propertyGraphStructure = fileReader.fromNeo4j(filename);
    // Convert to an expanded RDF graph
    const [store, prefixes] = RDFGraphBuilder.neo4jJsToStore(propertyGraphStructure, mode);
    // Reduce the number of triples
    if (args.length === 1) {
        graphReducer(store, filenameToArrayOfQuads(arg[0]));
    } else if (args.length >= 1) {
        console.error("Too much arguments");
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
    outputTheStore: outputTheStore
};
