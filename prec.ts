// This file enables to convert an APOC exported Property Graph in Json format
// into a Turtle-star RDF-star file.
//
// RDF-star is used in SA mode (annotated quads are not affirmed).

// Import some libraries
import { neo4jJsToStore, neo4JCypherToStore } from "./src/prec/graph-builder";
import graphReducer from "./src/prec/graph-reducer";

import { ArgumentParser } from 'argparse';
import { filenameToArrayOfQuads, outputTheStore } from './src/rdf/parsing';
import fs from 'fs';
import { Quad } from "@rdfjs/types";
import DStar from "./src/dataset";
import * as N3 from 'n3';

/// Transforms an array of strings, each strings being a JSON representation,
/// into an array of JS objects
function stringsToJsObjects(file_content: string): any[] {
  let collection = [];

  for (const line of file_content.split(/\r?\n/)) {
    if (line.trim() == "") {
      continue;
    }

    collection.push(JSON.parse(line));
  }

  return collection;
}

export function precOnNeo4J(filename: string, contextQuads: Quad[]) {
  const content = fs.readFileSync(filename, 'utf-8');
  const propertyGraphStructure = stringsToJsObjects(content);
  const store = neo4jJsToStore(propertyGraphStructure)[0];
  graphReducer(store, contextQuads);
  return store;
}

export function precOnNeo4JString(json: string, contextQuads: Quad[]) {
  const pgStructure = stringsToJsObjects(json);
  const store = neo4jJsToStore(pgStructure)[0];
  graphReducer(store, contextQuads);
  return store;
}

function main() {
  const parser = new ArgumentParser({
    description: 'Property Graph -> RDF Experimental Converter'
  });

  parser.add_argument("PGContentPath", {
    help: "Property Graph content source file"
  });

  parser.add_argument("Context", {
    help: "Path to a turtle file with the context",
    default: "",
    nargs: "?"
  });

  parser.add_argument("-f", "--PGContentFormat", {
    help: "Method used to generation the PG Content file",
    default: "Neo4JAPOC",
    choices: ["Neo4JAPOC", "Neo4JCypher"],
    nargs: "?",
  });

  let realArgs = parser.parse_args();

  // Convert the Property Graph content to RDF
  const fileContent = fs.readFileSync(realArgs.PGContentPath, 'utf-8');
  const pgContentFormat: string = realArgs.PGContentFormat;

  let getter: () => [DStar, {[prefixes: string]: string}];

  if (pgContentFormat === "Neo4JAPOC") {
    const propertyGraphStructure = stringsToJsObjects(fileContent);
    getter = () => neo4jJsToStore(propertyGraphStructure);
  } else if (pgContentFormat === "Neo4JCypher") {
    let content = JSON.parse(fileContent);
    getter = () => neo4JCypherToStore(content);
  } else {
    console.error("Unknown format: " + pgContentFormat);
    return;
  }

  const [store, prefixes] = getter();

  // Reduce the number of triples
  if (realArgs.Context !== "") {
    graphReducer(store, filenameToArrayOfQuads(realArgs.Context));
  }

  // Done gg
  outputTheStore(new N3.Store([...store]), prefixes);
}

if (require.main === module) {
  main();
}
