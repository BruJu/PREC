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

function outputTheStore(store, prefixes) {
    const writer = new N3.Writer({ prefixes: prefixes });
    store.forEach(quad => writer.addQuad(quad.subject, quad.predicate, quad.object, quad.graph));
    writer.end((_error, result) => console.log(result));
    
    console.error(store.size + " triples");
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
    graphReducer(store, args);
    // Done gg
    outputTheStore(store, prefixes);
}

main();
