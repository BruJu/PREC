'use strict';

import { ArgumentParser } from 'argparse';
import gremlin from 'gremlin';
import { fromTinkerPop } from "./src/prec/graph-builder";
import graphReducer from "./src/prec/graph-reducer";
import { filenameToArrayOfQuads, outputTheStore } from './src/rdf/parsing';
import fromGremlin from './src/prec-0/from-gremlin';
import * as N3 from 'n3';
import DriverRemoteConnection = gremlin.driver.DriverRemoteConnection;
import { Quad } from '@rdfjs/types';

/**
 * Converts the data contained in the Property Graph queried by the Gremlin API
 * to an RDF graph that describes the structure.
 * @param connection The connection to the Gremlin API
 * @returns An RDF graph which describes the content of the PG
 */
export async function gremlinToPREC0Graph(connection: DriverRemoteConnection) {
  return fromGremlin(connection)
  .then(result => fromTinkerPop(result.nodes, result.edges)[0]);
}

/**
 * Converts the data contained in the Property Graph queried by the Gremlin API
 * to an RDF graph, with the format described by the context.
 * @param connection The connection to the Gremlin API
 * @param context The quads that are contained in the context
 * @returns An RDF graph with the content of the PG in the format described by
 * the context
 */
export async function gremlinToRDF(connection: DriverRemoteConnection, context: Quad[] = []) {
  return gremlinToPREC0Graph(connection).then(prec0Graph => {
    graphReducer(prec0Graph, context);
    return prec0Graph;
  });
}

async function gremlinURIToJson(uri: string) {
  let connection = new DriverRemoteConnection(uri);
  const result = await fromGremlin(connection);
  await connection.close();
  return result;
}

async function main() {
  const parser = new ArgumentParser({
    description: 'Property Graph -> RDF Experimental Parser: From a Gremlin interface'
  });

  parser.add_argument("uri", {
    help: "IRI to connect to",
    default: "ws://localhost:8182/gremlin",
    nargs: "?"
  });
    
  parser.add_argument("-c", "--context", {
    help: "Context file in turtle format",
    default: "", nargs: "?"
  });

  let args = parser.parse_args();

  let result = await gremlinURIToJson(args.uri);
  if (result === null) return;

  let [store, prefixes] = fromTinkerPop(result.nodes, result.edges);

  if (args.context !== "") {
    graphReducer(store, filenameToArrayOfQuads(args.context));
  }

  outputTheStore(new N3.Store([...store]), prefixes);
}

if (require.main === module) {
  main();
}
