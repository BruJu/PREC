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
import { APOCDocument, CypherEntry } from "./src/prec-0/PGDefinitions";

export { cypherToRDF } from './neo4j-to-rdf';
export { gremlinToRDF } from './gremlin-to-rdf';

/**
 * Transforms a string, supposed to be a list of APOCDocuments, content of a
 * file produced by a call to `apoc.export.json.all` in Neo4j.
 * @param fileContent The content of the file
 * @returns The list of APOC documents
 */
export function stringToApocDocuments(fileContent: string): APOCDocument[] {
  let collection = [];

  for (const line of fileContent.split(/\r?\n/)) {
    if (line.trim() == "") {
      continue;
    }

    collection.push(JSON.parse(line));
  }

  return collection as APOCDocument[];
}

/**
 * Transforms a list of APOCDocument which corresponds to the content of a Neo4j
 * Property Graph to an RDF graph.
 * @param documents The list of APOCDocuments contained in the Neo4j graph
 * @param contextQuads The list of quads in the PREC context
 * @returns The RDF graph
 */
export function apocToRDF(documents: APOCDocument[], contextQuads: Quad[] = []): DStar {
  const store = neo4jJsToStore(documents)[0];
  graphReducer(store, contextQuads);
  return store;
}

// TODO: Specify that cypherJsonToRDF also supports other formats, as long as
// the output is only constitued of nodes and edges

/**
 * Transform the result in JSON format of a `(src)-(edge)->(dest)` cypher query
 * into an RDF graph.
 * @param cypherResult The result of the query
 * @param contextQuads The list of quads in the PREC context
 * @returns The RDF graph
 */
export function cypherJsontoRDF(cypherResult: CypherEntry[], contextQuads: Quad[] = []): DStar {
  const store = neo4JCypherToStore(cypherResult)[0];
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
    const propertyGraphStructure = stringToApocDocuments(fileContent);
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
