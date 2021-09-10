
import { program } from 'commander';

import neo4j from 'neo4j-driver';

import fs from 'fs';

import * as N3 from 'n3';
import * as WasmTree from '@bruju/wasm-tree';

import namespace from '@rdfjs/namespace';
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#", { factory: N3.DataFactory });
const prec = namespace("http://bruy.at/prec#"     , { factory: N3.DataFactory });

import { Quad, Quad_Graph, Quad_Object, Quad_Predicate, Quad_Subject, Term } from '@rdfjs/types';

import { isomorphic } from "rdf-isomorphic";

import {
  neo4JProtocoleToStore,
  neo4jJsToStore,
  neo4JCypherToStore,
  fromTinkerPop
} from "./prec/graph-builder";

import { extractFromNeo4jProtocole } from './prec-0/from-cypher';
import { getNodesOfType } from './rdf/path-travelling';
import PseudoPGBuilder, { insertIntoGremlin, makeCypherQuery, PseudoPGEdge, PseudoPGNode } from './prec-0-1/proto-pg';
import DStar from './dataset';
import graphReducer from './prec/graph-reducer';
import { filenameToArrayOfQuads, outputTheStore } from './rdf/parsing';

import { APOCDocument, CypherEntry } from "./prec-0/PGDefinitions";
import fromGremlin from './prec-0/from-gremlin';

import gremlin from 'gremlin';
import { Driver } from 'neo4j-driver';
import DriverRemoteConnection = gremlin.driver.DriverRemoteConnection;


export async function main() {
  // ==== CYPHER API

  program
    .command('cypher2rdf')
    .description("Converts the Neo4j graph connected to the Cypher API to an RDF graph")
    .argument('<username>', 'The username (neo4j by default)')
    .argument('<password>', 'The password')
    .argument('[uri]', 'The URI to the Neo4j instance', 'bolt://localhost:7687/neo4j')
    .option('-c, --context <context-path>', 'The path to the context')
    .action((username: string, password: string, uri: string, options: any) => {
      const auth = neo4j.auth.basic(username, password);
      const driver = neo4j.driver(uri, auth);    

      extractFromNeo4jProtocole(driver)
      .then(result => {
        let [dataset, prefixes] = neo4JProtocoleToStore(result.nodes, result.edges);
        applyContextIfAnyAndPrint(dataset, prefixes, options.context);
      })
      .finally(async () => await driver.close());
    });

  // ==== GREMLIN API

  program.command("gremlin2rdf")
    .description("Converts the Property Graph connected to the given Gremlin address to an RDF graph")
    .argument('[gremlin-iri]', 'Path to the Gremlin end point', 'ws://localhost:8182/gremlin')
    .option('-c, --context <context-path>', 'The path to the context')
    .action(async (gremlinIRI: string, options: any) => {
      // TODO: having a function named fromGremlin and another one named
      // fromTinkerPop with a different task means they are badly named
      let connection = new DriverRemoteConnection(gremlinIRI);
      const gremlinAnswer = await fromGremlin(connection);
      const closingGremlin = connection.close();
      let [dataset, prefixes] = fromTinkerPop(gremlinAnswer.nodes, gremlinAnswer.edges);
      applyContextIfAnyAndPrint(dataset, prefixes, options.context);
      await closingGremlin;
    });


  // ==== NEO4J ALTERNATES APIs

  program.command('apoc2rdf')
    .description("Converts a Neo4j graph exported by the APOC extension into an RDF graph")
    .argument('<path-to-apoc-file>', "Path to the JSON file generated by APOC")
    .option('-c, --context <context-path>', 'The path to the context')
    .action((apocPath: string, options: any) => {
      const fileContent = fs.readFileSync(apocPath, 'utf-8');
      const propertyGraphStructure = stringToApocDocuments(fileContent);
      const [dataset, prefixes] = neo4jJsToStore(propertyGraphStructure);
      applyContextIfAnyAndPrint(dataset, prefixes, options.context);
    });

  program.command('cypherJson2rdf')
    .description("Converts the result of a Cypher query stored in JSON into an RDF graph. The query result must only contain nodes and edges.")
    .argument('<path-to-cypher-result>', "Path to the JSON file with the answer of the Cypher query")
    .option('-c, --context <context-path>', 'The path to the context')
    .action((cypherResultPath: string, options: any) => {
      const fileContent = fs.readFileSync(cypherResultPath, 'utf-8');
      const content = JSON.parse(fileContent);
      const [dataset, prefixes] = neo4JCypherToStore(content);
      applyContextIfAnyAndPrint(dataset, prefixes, options.context);
    });

  // PREC-0-1

  const prec0m1 = program.command('preczero2rdf')
    .description('Converts an RDF graph generated without any context to a Property Graph.');

  prec0m1.command('print-structure')
    .argument('<path-to-rdf-graph>', "Path to the RDF graph that describes the property graph.")
    .action((pathToRdf: string) => {
      const pseudoPG = revertRdfGraphToPseudoPg(pathToRdf);
      if (pseudoPG !== false) {
        console.log(JSON.stringify(pseudoPG, null, 2));
      }
    });

  prec0m1.command('print-cypher')
    .argument('<path-to-rdf-graph>', "Path to the RDF graph that describes the property graph.")
    .action((pathToRdf: string) => {
      const pseudoPG = revertRdfGraphToPseudoPg(pathToRdf);
      if (pseudoPG !== false) {
        console.log(makeCypherQuery(pseudoPG));
      }
    });

  prec0m1.command('cypher')
    .argument('<path-to-rdf-graph>', "Path to the RDF graph that describes the property graph.")
    .argument('<username>', "The Cypher username, usually neo4j")
    .argument('<password>', "The Cypher password")
    .argument('[URI]', "The URI to the connection", 'neo4j://localhost/neo4j')
    .action((pathToRdf: string, username: string, password: string, uri: string) => {
      const pseudoPG = revertRdfGraphToPseudoPg(pathToRdf);
      if (pseudoPG !== false) {
        const query = makeCypherQuery(pseudoPG);
        const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
        const session = driver.session();
  
        session.run(query)
        .finally(async () => {
          await session.close();
          await driver.close();
        });
      }
    });

  prec0m1.command('gremlin')
    .argument('<path-to-rdf-graph>', "Path to the RDF graph that describes the property graph.")
    .argument('[uri]', "The URI to the Gremlin API", "ws://localhost:8182/gremlin")
    .action(async (pathToRdf: string, uri: string) => {
      const pseudoPG = revertRdfGraphToPseudoPg(pathToRdf);
      if (pseudoPG !== false) {
        const connection = new DriverRemoteConnection(uri);
        const r = await insertIntoGremlin(connection, pseudoPG);
        await connection.close();
        
        console.error(`${r.numberOfNodes} node${r.numberOfNodes===1?'':'s'} `
        + `and ${r.numberOfEdges} edge${r.numberOfEdges===1?'':'s'} `
        + `have been added to the Gremlin endpoint ${uri}`);  
      }
    });

  // ==== Extra tools

  program.command('applyContext')
    .description("Applies a context to an RDF graph previously generated without any context")
    .argument('<path-to-rdf-graph>', "Path to the RDF graph")
    .option('-c, --context <context-path>', 'The path to the context, mandatory')
    .action((pathToRdfGraph: string, options: any) => {
      const dataset = new DStar(filenameToArrayOfQuads(pathToRdfGraph));
      applyContextIfAnyAndPrint(dataset, {}, options.context);
    });

  program.command('checkIsomorphism')
    .description("Checks if two graphs generated by PREC are isomorphics if the nodes and edges IRI are replaced with blank nodes.")
    .argument('<graph1>', "Path to first graph")
    .argument('<graph2>', "Path to second graph")
    .action((path1: string, path2: string) => {
      
      function remapQuad(quad: Quad, destination: Term, source: Term): Quad {
        function _remapTerm(term: Term): Term {
          if (term.equals(source)) {
            return destination;
          } else if (term.termType === "Quad") {
            return N3.DataFactory.quad(
              _remapTerm(term.subject) as Quad_Subject,
              _remapTerm(term.predicate) as Quad_Predicate,
              _remapTerm(term.object) as Quad_Object,
              _remapTerm(term.graph) as Quad_Graph
            );
          } else {
            return term;
          }
        }

        return _remapTerm(quad) as Quad;
      }

      function loadRDFGraph(path: string): Quad[] {
        const trig = fs.readFileSync(path, 'utf-8');
        const parser = new N3.Parser();
        return parser.parse(trig);
      }

      function load(pathToGraph: string) {
        let quads = loadRDFGraph(pathToGraph);
  
        // Find every nodes and edges
        let toReplace = function(quads) {
          const dataset = new N3.Store(quads);
          let nodes = getNodesOfType(dataset, pgo.Node, N3.DataFactory.defaultGraph());
          let edges = getNodesOfType(dataset, pgo.Edge, N3.DataFactory.defaultGraph());
          let propertyValue = getNodesOfType(dataset, prec.PropertyKeyValue, N3.DataFactory.defaultGraph());
          return [...nodes, ...edges, ...propertyValue];
        }(quads);
  
        for (let term of toReplace) {
          if (term.termType === "NamedNode" && term.value.startsWith("http://www.example.org/indiv/")) {
            const newBlankNode = N3.DataFactory.blankNode();
            quads = quads.map(quad => remapQuad(quad, newBlankNode, term));
          }
        }
  
        return quads;
      }
  
      // Load
      const graph1 = load(path1);
      const graph2 = load(path2);
  
      // Test isomorphism
      const isomorphics = isomorphic(graph1, [...graph2]);
      console.log(isomorphics ? "The graphs are isomorphics" : "The graphs are not isomorphics");
    });

  // ==== Go

  program.parse(process.argv);
}

function applyContextIfAnyAndPrint(
  dataset: DStar,
  prefixes: {[prefix: string]: string},
  contextPath: string | undefined
) {
  if (contextPath !== undefined) {
    graphReducer(dataset, filenameToArrayOfQuads(contextPath));
  }

  outputDStar(dataset, prefixes);
}

function outputDStar(dataset: DStar, prefixes: {[prefix: string]: string}) {
  outputTheStore(new N3.Store([...dataset]), prefixes);
}



//////////

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

//////////

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


/////////

/**
 * Produce an RDF graph from the content of the property graph behind the given
 * Cypher connection.
 * @param connection The connection to the Cypher API
 * @param context The list of quads that define the context
 * @returns The produced RDF graph
 */
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

////////////////////////////////////////////////////////////////////////////////

function revertRdfGraphToPseudoPg(rdfPath: string) {
  const parser = new N3.Parser();
  let quads = parser.parse(fs.readFileSync(rdfPath, "utf8"));
  const dataset = new WasmTree.Dataset(quads);
  const result = PseudoPGBuilder.from(dataset);
  if ('error' in result) {
    console.error(result.error);
    return false;
  } else if (result["Remaining Quads"].size !== 0) {
    console.error(dataset.size + " remaining quads");
    outputTheStore(new N3.Store([...dataset]));
    return false;
  } else {
    return result.PropertyGraph;
  }
}

export function prec0ToCypherQuery(quads: Quad[]): string {
  const r = prec0ToCommon(quads);
  return makeCypherQuery(r);
}

export function prec0ToCypher(quads: Quad[], connection: Driver) {
  const r = prec0ToCommon(quads);
  const query = makeCypherQuery(r);
  const session = connection.session();
  return session.run(query)
  .finally(async () => {
    await session.close();
  });
}

export function prec0ToGremlin(quads: Quad[], connection: DriverRemoteConnection) {
  const pseudoPG = prec0ToCommon(quads);
  return insertIntoGremlin(connection, pseudoPG);
}

function prec0ToCommon(quads: Quad[]): {
  nodes: PseudoPGNode[];
  edges: PseudoPGEdge[];
} {
  const wt = new WasmTree.Dataset(quads);
  const result = PseudoPGBuilder.from(wt);
  wt.free();
  if ('error' in result) {
    throw Error(result.error);
  } else if (result["Remaining Quads"].size !== 0) {
    result["Remaining Quads"].free();
    throw Error("All quads were not consumed");
  } else {
    result["Remaining Quads"].free();
    return result.PropertyGraph;
  }
}