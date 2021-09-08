"use strict";

// RDF -> Property Graph Experimental Converter
// Or more like PREC-0-1

// This file extensively uses the concept of "(simple) path following".
// Following a path is a cute way of saying that we know the subject, and:
// - We know the predicate, we want to know the unique object that coresponds
// to (subject, predicate, ?object).
// - We don't know the predicate, we want to retrieve every path that starts
// with subject ie every triple that has subject as the subject.

////////////////////////////////////////////////////////////////////////////////
// ==== Imports

import { ArgumentParser } from 'argparse';
import fs from 'fs';
import { outputTheStore } from './src/rdf/parsing';

// -- RDF
import { DataFactory, Parser, Store as N3Store } from "n3";
import * as WasmTree from "@bruju/wasm-tree";
import namespace from '@rdfjs/namespace';

const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", { factory: DataFactory });
const rdfs = namespace("http://www.w3.org/2000/01/rdf-schema#"      , { factory: DataFactory });
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#"                  , { factory: DataFactory });
const prec = namespace("http://bruy.at/prec#"                       , { factory: DataFactory });

const QUAD = DataFactory.quad;

// -- Property Graph API
import neo4j from 'neo4j-driver';

import gremlin from "gremlin";
import { BlankNode, DatasetCore, NamedNode, Quad_Subject } from '@rdfjs/types';
import { areDisjointTypes, followThrough, getNodesOfType, getPathsFrom, hasExpectedPaths, hasNamedGraph, isRdfStar, RDFPath, RDFPathPartial } from './src/rdf/path-travelling';
import { extractAndDeletePropertyValue, ExtractedPropertyValue, getRealLabel, readPropertyName } from './src/prec-0/Prec0DatasetUtil';
const traversal = gremlin.process.AnonymousTraversalSource.traversal;
const DriverRemoteConnection = gremlin.driver.DriverRemoteConnection;


////////////////////////////////////////////////////////////////////////////////
// ==== Helper functions and extension of dataset

/** Read the turtle (not star) file in filepath and builds a WT Dataset from it */
function readDataset(filepath: string): WasmTree.Dataset {
  const parser = new Parser();
  let quads = parser.parse(fs.readFileSync(filepath, "utf8"));

  return new WasmTree.Dataset(quads);
}

/**
 * For a given edge in the RDF graph that was an export from PREC, return the
 * subject node, the object node and the label.
 * 
 * The rdf:subject, rdf:predicate and rdf:object must be unique.
 *
 * The type of the subject and the object are checked to be as type pgo:Node.
 * For the predicate, both the node and its label are retrieved.
 * 
 * Returns null on error.
 * @returns [subject node, object node, [ predicate node, predicate label ]]
 */
function extractEdgeSPO(dataset: DatasetCore, rdfEdge: NamedNode | BlankNode)
: [Quad_Subject, Quad_Subject, [Quad_Subject, string | null]] {
  function extractConnectedNodeToEdge(dataset: DatasetCore, rdfEdge: Quad_Subject, predicate: NamedNode) {
    let result = followThrough(dataset, rdfEdge, predicate);
    if (!result) throw "Edge has no " + predicate.value + " " + rdfEdge.value;
    if (!dataset.has(QUAD(result as Quad_Subject, rdf.type, pgo.Node))) {
      throw "Edge connected to something that is not a node";
    }
    return result as Quad_Subject;
  }

  function extractLabel(dataset: DatasetCore, rdfEdge: Quad_Subject, predicate: NamedNode)
  : [Quad_Subject, string | null] {
    let result = followThrough(dataset, rdfEdge, predicate);
    if (!result) throw "Edge has no " + predicate.value;
    return [
      result as Quad_Subject,
      getRealLabel(dataset, result as Quad_Subject, prec.CreatedEdgeLabel)
    ];
  }

  return [
    extractConnectedNodeToEdge(dataset, rdfEdge, rdf.subject),
    extractConnectedNodeToEdge(dataset, rdfEdge, rdf.object),
    extractLabel(dataset, rdfEdge, rdf.predicate)
  ];
}

/**
 * Remove all subject that have the given paths and match the given predicate.
 */
function removeSubjectIfMatchPaths(
  dataset: DatasetCore,
  requiredPaths: RDFPathPartial[],
  optionalPaths: RDFPathPartial[] = [],
  extraPredicate: (dataset: DatasetCore, subject: Quad_Subject) => boolean = () => true
) {
  if (requiredPaths.length == 0) {
    throw "Empty required path is not yet implemented";
  }

  function removePaths(dataset: DatasetCore, subject: Quad_Subject, paths: RDFPath[]) {
    paths.map(path => DataFactory.quad(subject, path[0], path[1]))
      .forEach(q => dataset.delete(q));
  }

  // Find subjects that match the first pattern
  let match = dataset.match(null, requiredPaths[0][0], requiredPaths[0][1], DataFactory.defaultGraph());

  let old01 = requiredPaths[0][1];

  for (let quad of match) {
    const subject = quad.subject;
    if (old01 == null) requiredPaths[0][1] = quad.object;

    let foundMappings: RDFPath[] = [];

    if (
      hasExpectedPaths(dataset, subject, requiredPaths, optionalPaths, foundMappings)
      && extraPredicate(dataset, subject)
    ) {
      removePaths(dataset, subject, foundMappings);
    }
  }

  requiredPaths[0][1] = old01;
}


////////////////////////////////////////////////////////////////////////////////
// ==== Pseudo PG builder

type PseudoPGNode = {
  id: string;
  identifier?: string;
  labels?: string[];
  properties?: {[key: string]: ExtractedPropertyValue};
  _gremlin?: any
};

type PseudoPGEdge = {
  source: PseudoPGNode;
  destination: PseudoPGNode;
  label?: string;
  properties?: {[key: string]: ExtractedPropertyValue};
};

/**
 * Builder for a property graph structure.
 */
export class PseudoPGBuilder {
  nodes: PseudoPGNode[] = [];
  edges: PseudoPGEdge[] = [];
  iriToNodes: {[iri: string]: PseudoPGNode} = {};

  /**
   * Returns a dictionnary with the nodes and the edges in the form of
   * { nodes: [node...], edges: [edge...] }
   */
  toPropertyGraph() {
    return { nodes: this.nodes, edges: this.edges };
  }

  /**
   * Ensures a node corresponding to the given identifier exists and returns
   * it. The identifier format is a string.
   */
  addNode(identifier: string) {
    if (this.iriToNodes[identifier] === undefined) {
      this.iriToNodes[identifier] = {
        id: identifier
      };

      this.nodes.push(this.iriToNodes[identifier]);
    }

    return this.iriToNodes[identifier];
  }

  /**
   * Creates a new edge that starts at the node identified by sourceIdentifier
   * and at the node identifier by destinationIdentifier.
   * 
   * If the edge was already present, the behaviour is undefined.
   */
  addEdge(sourceIdentifier: string, destinationIdentifier: string) {
    const edge: PseudoPGEdge = {
      source: this.addNode(sourceIdentifier),
      destination: this.addNode(destinationIdentifier)
    };
    this.edges.push(edge);
    return edge;
  }

  /**
   * Converts the RDF graph described by sourceDataset into a a Property Graph
   * structure. The given RDF graph is expected to have been generated by
   * a former call to PREC, ie to have its format ; but other RDF graphs
   * that have the same structure are also accepted.
   * 
   * This function is unable to translate a graph that has been transformed
   * by a context.
   * 
   * This function will return either a dictionnary with a
   * { "PropertyGraph": toPropertyGraph(), "Remaining Quads": remaningQuads }
   * if there was no error in the structure of the consumed quads
   * or
   * { "error": a message }
   * if there was a problem with the structure.
   */
  static from(sourceDataset: WasmTree.Dataset)
  : { error: string }
  | { "PropertyGraph": { nodes: PseudoPGNode[], edges: PseudoPGEdge[] }, "Remaining Quads": WasmTree.Dataset }
  {
    let dataset = sourceDataset.match();

    try {
      if (hasNamedGraph(dataset)) throw "Found named graphs but PREC only generates in default graph";
      if (isRdfStar(dataset)) throw "Found embedded quad but PREC only generates RDF non star";

      if (!areDisjointTypes(dataset, [pgo.Node, pgo.Edge, prec.PropertyKey, prec.PropertyKeyValue])) {
        throw "pgo:Node, pgo:Edge, prec:PropertyKey and prec:PropertyKeyValue should be disjoint types.";
      }

      let builder = new PseudoPGBuilder();

      // Edges should be:
      // - this rdf:subject s, s is a pgo.Node
      // - this rdf:predicate y, y is an (edge) label
      // - this rdf:object o, o is a pgo.Node
      // Edges may have some other things that are properties
      for (let rdfEdge of getNodesOfType(dataset, pgo.Edge)) {
        // rdf:subject/predicate/object
        let [source, destination, label] = extractEdgeSPO(dataset, rdfEdge as NamedNode | BlankNode);
        let pgEdge = builder.addEdge(source.value, destination.value)
        pgEdge.label = label[1]!;

        // Remove from the RDF graph to be able to check if we consumed
        // the whole graph.
        dataset.delete(DataFactory.quad(rdfEdge, rdf.subject  , source     ));
        dataset.delete(DataFactory.quad(rdfEdge, rdf.predicate, label[0]   ));
        dataset.delete(DataFactory.quad(rdfEdge, rdf.object   , destination));

        // Some other things that are properties
        pgEdge.properties = extractProperties(dataset, rdfEdge, "Edge");

        dataset.delete(QUAD(rdfEdge, rdf.type, pgo.Edge));
      }

      // Nodes
      // - A node is something of type pgo.Node. It may have properties
      for (let rdfNode of getNodesOfType(dataset, pgo.Node)) {
        // The node itself
        let pgNode = builder.addNode(rdfNode.value);
        dataset.delete(DataFactory.quad(rdfNode, rdf.type, pgo.Node));

        // Labels and properties
        pgNode.labels = extractLabels(dataset, rdfNode);
        pgNode.properties = extractProperties(dataset, rdfNode, "Node");
      }

      // Delete from the RDF graph the triples that are "prec related".

      function noMoreInContext(dataset: DatasetCore, subject: Quad_Subject) {
        return dataset.match(null, subject, null).size == 0 &&
        dataset.match(null, null, subject).size == 0;
      }
        
      removeSubjectIfMatchPaths(dataset, [
        [rdf.type, prec.CreatedEdgeLabel],
        [rdfs.label, null]
      ], [], noMoreInContext);

      removeSubjectIfMatchPaths(dataset, [
        [rdf.type, prec.CreatedNodeLabel],
        [rdfs.label, null]
      ], [], noMoreInContext);

      removeSubjectIfMatchPaths(dataset, [
        [rdf.type, prec.PropertyKey],
        [rdfs.label, null]
      ], [
        [rdf.type, prec.CreatedPropertyKey]
      ], noMoreInContext);

      // Remove axioms and meta data
      dataset.delete(QUAD(prec.CreatedNodeLabel, rdfs.subClassOf, prec.CreatedVocabulary));
      dataset.delete(QUAD(prec.CreatedEdgeLabel, rdfs.subClassOf, prec.CreatedVocabulary));
      dataset.delete(QUAD(prec.CreatedPropertyKey, rdfs.subClassOf, prec.CreatedVocabulary));

      // End
      if (dataset.size === 0) {
        dataset.free();
      }

      return {
        "PropertyGraph": builder.toPropertyGraph(),
        "Remaining Quads": dataset
      };
    } catch (e) {
      if (dataset.free !== undefined) dataset.free();
      return { "error": e as string };
    }
  }

  
}

// A property is:
// - _e prop propBN - propBN rdf:value a_literal
// - prop rdf:type prec:PropertyKey
// - propBN rdf:type propBN
// - propBN is only used here
// => We currently don't support meta properties
function extractProperties(dataset: DatasetCore, rdfNode: Quad_Subject, type: 'Node' | 'Edge') {
  let ignoreList: NamedNode[];
  if (type == "Node") {
    ignoreList = [rdf.type];
  } else if (type == "Edge") {
    ignoreList = [rdf.subject, rdf.predicate, rdf.object, rdf.type];
  } else {
    throw Error("PseudoPGBuilder::extractProperties - Unknown type " + type);
  }

  const pathsFrom = getPathsFrom(dataset, rdfNode, ignoreList);

  let properties: {[name: string]: ExtractedPropertyValue} = {};

  for (const path of pathsFrom) {
    const propertyKey = readPropertyName(dataset, path.predicate);
    if (propertyKey === null) throw "Invalid RDF Graph - readPropertyName";

    dataset.delete(path);

    const propertyValue = extractAndDeletePropertyValue(dataset, path.object as Quad_Subject);
    if (propertyValue === null || propertyValue === undefined)
        throw "Invalid RDF Graph - Invalid Property Value - " + path.object.value;

    if (properties[propertyKey] !== undefined) {
      // Note : we could relax this so several times the same
      // predicate name means it was a list.
      // But this wouldn't catch the case of empty and one
      // element lists.
      throw "Invalid RDF graph: several times the same property " + propertyKey;
    }

    properties[propertyKey] = propertyValue;
  }

  return properties;
}

function extractLabels(dataset: DatasetCore, node: Quad_Subject) {
  let otherTypes = dataset.match(node, rdf.type);

  let result = [...otherTypes].map(quad => quad.object);
  for (let r of result) {
    dataset.delete(DataFactory.quad(node, rdf.type, r));
  }

  return result.map(term => getRealLabel(dataset, term as Quad_Subject, prec.CreatedNodeLabel)!);
}

/**
 * 
 * This function assigns a new member to the identifier property of nodes
 */
function makeCypherQuery(propertyGraphStructure: { nodes: PseudoPGNode[], edges: PseudoPGEdge[] }) {
  class QueryBuilder {
    instructions: string[] = [];

    getQuery() {
      if (this.instructions.length == 0) return "";
      return "CREATE " + this.instructions.join(",\n       ") + ";";
    }

    addInstruction(instruction: string) { this.instructions.push(instruction); }
  }

  function translateProperties(properties: {[key: string]: ExtractedPropertyValue} | undefined) {
    if (properties === undefined) return "";
    if (properties.length == 0) return "";

    // We rely on the fact that:
    // Cypher doesn't support different types on properties in a iist
    // Only string and numbers can appear in a list of properties

    return "{"
      + Object.entries(properties)
      .map(([pName, pValue]) => `${pName}: ${JSON.stringify(pValue)}`)
      .join(", ")
      + "}";
  }

  let builder = new QueryBuilder();

  let nodeCount = 1;
  for (let node of propertyGraphStructure.nodes) {
    node.identifier = "node" + nodeCount;
    ++nodeCount;

    const labels = node.labels!.map(label => ":" + label).join(" ");
    const properties = translateProperties(node.properties);
    builder.addInstruction(`(${node.identifier} ${labels} ${properties})`)
  }

  for (let edge of propertyGraphStructure.edges) {
    const properties = translateProperties(edge.properties);
    const edgeString = `:${edge.label} ${properties}`;
    builder.addInstruction(
      `(${edge.source.identifier})-[${edgeString}]->(${edge.destination.identifier})`
    );
  }

  return builder.getQuery();
}

async function makeNeo4Jrequest(username: string, password: string, uri: string, query: string) {
  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  const session = driver.session();

  try {
    await session.run(query);
  } catch (error) {
    console.error("-- Make Neo4J Request");
    console.error(error);
  } finally {
    await session.close();
  }

  await driver.close();
}

/**
 * Insert the content of the property graph in the given Gremlin end point.
 * @param uri The URI of the Gremlin end point
 * @param propertyGraphStructure The content of the property graph, in the
 * meta property-less model
 */
async function insertIntoGremlin(uri: string, propertyGraphStructure: { nodes: PseudoPGNode[], edges: PseudoPGEdge[] }) {
  let connection = new DriverRemoteConnection(uri);
  const g = traversal().withRemote(connection);

  let numberOfNodes = 0;
  let numberOfEdges = 0;

  // Properties are not inserted using specific Cardinalities as they seem to
  // only be "insertion strategies".
  for (const node of propertyGraphStructure.nodes) {
    let vertex;
    if (node.labels!.length === 0) {
      vertex = g.addV();
    } else {
      vertex = g.addV(node.labels!.join("::"));
    }

    for (let propertyKey in node.properties) {
        vertex = vertex.property(propertyKey, node.properties[propertyKey]);
    }

    node._gremlin = await vertex.next();
    ++numberOfNodes;
  }

  for (const edge of propertyGraphStructure.edges) {
    let gremlinEdge = g.V(edge.source._gremlin.value.id).addE(edge.label);
    gremlinEdge = gremlinEdge.to(edge.destination._gremlin.value);

    for (let propertyKey in edge.properties) {
      gremlinEdge = gremlinEdge.property(propertyKey, edge.properties[propertyKey]);
    }

    await gremlinEdge.iterate();
    ++numberOfEdges;
  }

  await connection.close();
  console.error(`${numberOfNodes} node${numberOfNodes===1?'':'s'} `
    + `and ${numberOfEdges} edge${numberOfEdges===1?'':'s'} `
    + `have been added to the Gremlin endpoint ${uri}`);
}

async function main() {
  const parser = new ArgumentParser({
    description: 'PREC-1 (Property Graph <- RDF Experimental Converter)'
  });

  parser.add_argument("RDFPath", {
    help: "Path to the RDF graph to convert back"
  });

  parser.add_argument( "-f", "--OutputFormat", {
    help: "Output format",
    default: "Cypher",
    choices: ["Cypher", "Neo4J", "PGStructure", "Gremlin"],
    nargs: "?"
  });

  parser.add_argument( "--Neo4JLogs", {
    help: "Neo4J credentials in the format username:password. Only used if output is Neo4J",
    default: "", nargs: "?"
  });

  parser.add_argument("--Neo4JURI", {
    help: "Neo4J database URI. Only used if output if Neo4J.",
    default: "neo4j://localhost/neo4j", nargs: "?"
  });
    
  parser.add_argument("--GremlinURI", {
    help: "Gremlin end point URI. Only used id output is Gremlin",
    default: "ws://localhost:8182/gremlin", nargs: "?"
  });

  const args = parser.parse_args();
  const dataset = readDataset(args.RDFPath);
    
  let result = PseudoPGBuilder.from(dataset)
    
  if ('error' in result) {
    console.error("Error: " + result.error);
  } else if (result["Remaining Quads"].size !== 0) {
    console.error(dataset.size + " remaining quads");
    outputTheStore(new N3Store([...dataset]));
  } else {
    if (args.OutputFormat === "Cypher") {
      console.log(makeCypherQuery(result.PropertyGraph));
    } else if (args.OutputFormat === "PGStructure") {
      console.log(JSON.stringify(result.PropertyGraph, null, 2));
    } else if (args.OutputFormat === "Neo4J") {
      const credentials = args.Neo4JLogs.split(":");
      const query = makeCypherQuery(result.PropertyGraph);

      await makeNeo4Jrequest(
        credentials[0],
        credentials[1],
        args.Neo4JURI,
        query
      );

      result["Remaining Quads"].free();
    } else if (args.OutputFormat === 'Gremlin') {
      const uri = args.GremlinURI;
      await insertIntoGremlin(uri, result.PropertyGraph);
    } else {
      console.error("Unknown output format " + args.OutputFormat);
    }
  }
}

if (require.main === module) {
  main();
}

