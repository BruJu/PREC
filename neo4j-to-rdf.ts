
// Connects to a Neo4J database to convert its content to an RDF graph

import neo4j, { Driver } from 'neo4j-driver';

import { neo4JProtocoleToStore } from "./src/prec/graph-builder";
import graphReducer from "./src/prec/graph-reducer";

import { ArgumentParser } from 'argparse';
import { filenameToArrayOfQuads, outputTheStore } from './src/rdf/parsing';

import { extractFromNeo4jProtocole } from './src/prec-0/from-cypher';
import * as N3 from 'n3';
import { Quad } from '@rdfjs/types';

export async function cypherToRDF(connection: Driver, context?: Quad[]) {
  return extractFromNeo4jProtocole(connection)
  .then(output => {
    const [dataset, _] = neo4JProtocoleToStore(output.nodes, output.edges);

    if (context !== undefined) {
      graphReducer(dataset, context);
    }

    return dataset;
  });
}

async function main() {
  const parser = new ArgumentParser({
    description: 'Property Graph -> RDF Experimental Parser: From a Neo4J interface'
  });

  parser.add_argument("username", { help: "Username" });
  parser.add_argument("password", { help: "password" });

  parser.add_argument("uri", {
    help: "IRI to connect to",
    default: "bolt://localhost:7687/neo4j",
    nargs: "?"
  });

  parser.add_argument("-c", "--context", {
    help: "Context file in turtle format",
    default: "", nargs: "?"
  });

  let args = parser.parse_args();
  console.log(args);

  const auth = neo4j.auth.basic(args.username, args.password);
  const driver = neo4j.driver(args.uri, auth);

  extractFromNeo4jProtocole(driver)
  .then(result => {
    let [store, prefixes] = neo4JProtocoleToStore(result.nodes, result.edges);

    if (args.context !== "") {
      graphReducer(store, filenameToArrayOfQuads(args.context));
    }
  
    outputTheStore(new N3.Store([...store]), prefixes);
  })
  .finally(async () => await driver.close());
}

if (require.main === module) {
  main();
}
