import { BlankNode, Literal, Quad, Quad_Graph, Quad_Object, Quad_Predicate, Quad_Subject } from "@rdfjs/types";
import { APOCDocument, CypherEdge, CypherEntry, CypherNode, IdentityTo, TinkerPopEdge, TinkerPopNode, TinkerPopProperties } from "../prec-0/PGDefinitions";

//! This module provides an RDF graph builder that enables the user to build an
//! expanded RDF graph from a Property Graph description.

// Libraries
import { DataFactory } from 'n3';
import DStar from '../dataset/index';
import namespace, { NamespaceBuilder } from '@rdfjs/namespace';

// Namespaces
import { rdf, rdfs, pgo, prec } from '../PRECNamespace';


/**
 * Converts a list of nodes and edges from a Neo4J property graph into an
 * RDF/JS dataset that contains the PREC-0 RDF Graph.
 * 
 * @param {*} neo4jJavascriptArray The list of Json objects exported from
 * Neo4J APOC plugin.
 */
export function neo4jJsToStore(
  neo4jJavascriptArray: APOCDocument[]
): [DStar, {[prefix: string]: string}] {
  let builder = new BuilderForCypherProperties("http://www.example.org/vocab/");

  for (const object of neo4jJavascriptArray) {
    if (object.type === 'node') {
      builder.addNode(object.id, object.labels || [], object.properties);
    } else /* (object.type === 'relationship') */ {
      builder.addEdge(
        object.id, object.start.id, object.end.id, object.label,
        object.properties
      )
    }
  }

  return [builder.toStore(), builder.getPrefixes()];
}

export function neo4JCypherToStore(
  neo4JCypherResult: CypherEntry[]
): [DStar, {[prefix: string]: string}] {
  let nodes: IdentityTo<CypherNode> = {};
  let edges: IdentityTo<CypherEdge> = {};
  
  // match (m)-[n]->(o) return (m, n, o)
  for (let oneResult of neo4JCypherResult) {  // One (m, n, o)
    Object.values(oneResult)
    .forEach(value => {
      if ('labels' in value) { // Node
        if (nodes[value.identity] === undefined) {
          nodes[value.identity] = value;
        }
      } else if ('start' in value) { // Edge
        edges[value.identity] = value;
      } else {
        throw Error('Unknown type of result ' + value);
      }
    });
  }

  return neo4JProtocoleToStore(nodes, edges);
}

export function neo4JProtocoleToStore(
  nodes: IdentityTo<CypherNode>,
  edges: IdentityTo<CypherEdge>
): [DStar, {[prefix: string]: string}] {
  let builder = new BuilderForCypherProperties("http://www.example.org/vocab/");
  builder.populate(nodes, edges);
  return [builder.toStore(), builder.getPrefixes()];
}

export function fromTinkerPop(
  nodes: IdentityTo<TinkerPopNode>,
  edges: IdentityTo<TinkerPopEdge>
): [DStar, {[prefix: string]: string}] {
  let builder = new BuilderForTPProperties("http://www.example.org/vocab/");
  builder.populate(nodes, edges);
  return [builder.toStore(), builder.getPrefixes()];
}

export type AbstractNode<Ps> = {
  identity: number;
  labels: string[];
  properties: Ps;
}

export type AbstractEdge<Ps> = {
  identity: number;
  start: number;
  end: number;
  type: string;
  properties: Ps;
}


/**
 * An RDF Graph Builder utility class that provides methods to add the
 * structure of a Property Graph and output an Expanded Representation of the
 * Property Graph in the form of an RDF store.
 *
 * An Expanded Representation is basically:
 * - A PG node is an RDF node
 * - An RDF node is created for each property value and a label name. These
 * nodes have a rdfs:label property to retrieve the value or the label.
 * - An edge is materialized by using RDF reification
 * - New IRIs are forged
 *
 * The produced RDF graph is not expected to be used by an end user: it should
 * be transformed to bring more semantic.
 */
abstract class RDFGraphBuilder<Ps> {
  quads: Quad[] = [];
  counters = {
    properties: 0,
    lists: 0
  };
  namespaces: {
    nodeLabel: NamespaceBuilder,
    nodeProperty: NamespaceBuilder,
    edgeLabel: NamespaceBuilder,
    edgeProperty: NamespaceBuilder
  };

  /**
   * Builds a builder (Who would have believed?)
   * @param vocab Namespace for IRIs that should be mapped to existing
   * ontology IRIs.
   */
  constructor(vocab: string) {
    this.namespaces = {
      nodeLabel   : namespace(vocab + "node/label/"),
      nodeProperty: namespace(vocab + "node/property/"),
      edgeLabel   : namespace(vocab + "edge/label/"),
      edgeProperty: namespace(vocab + "edge/property/")
    };
  }

  /** Builds and adds the quad described by S P O G */
  _addQuad(s: Quad_Subject, p: Quad_Predicate, o: Quad_Object, g?: Quad_Graph) {
    this.quads.push(DataFactory.quad(s, p, o, g));
  }

  /** Builds a store using the quads stored in this builder */
  toStore() { return new DStar(this.quads); }

  /** Adds the quad(nodeName, rdfs.label, literal) */
  _labelize(nodeName: Quad_Subject, literal: string | number) {
    this._addQuad(nodeName, rdfs.label, DataFactory.literal(literal));
    return nodeName;
  }

  /** Builds some new node for the literal. The end of the IRI is kind of opaque. */
  _makeNodeForPropertyValue(literal: number | string): BlankNode {
    const propertyValueNode = DataFactory.blankNode("propertyValue" + (++this.counters.properties));
    this._addQuad(propertyValueNode, rdf.value, DataFactory.literal(literal));
    this._addQuad(propertyValueNode, rdf.type, prec.PropertyKeyValue);
    return propertyValueNode;
  }

  /** Builds some new node for a list of literal. The end of the IRI is kind of opaque. */
  _makeNodeForPropertyValues(literals: (string | number)[]) {
    const asRdfLiterals = literals.map(lit => DataFactory.literal(lit));
    const head = this._addList(asRdfLiterals);

    const propertyValueNode = DataFactory.blankNode("propertyValue" + (++this.counters.properties));
    this._addQuad(propertyValueNode, rdf.value, head);
    this._addQuad(propertyValueNode, rdf.type, prec.PropertyKeyValue);
    return propertyValueNode;
  }

  abstract _addProperties(
    node: Quad_Subject,
    properties: Ps | undefined,
    labels: string[],
    propMaker: NamespaceBuilder
  ): void;


  /** Adds to the builder the nodes in the form of a proper RDF list. */
  _addList(list: Literal[]) {
    let head: Quad_Subject = rdf.nil;

    const prefix = "list" + (++this.counters.lists) + "_";

    for (let i = list.length - 1 ; i >= 0 ; --i) {
      let node = DataFactory.blankNode(prefix + (i + 1));
      //this._addQuad(node, rdf.type, rdf.List);
      this._addQuad(node, rdf.first, list[i]);
      this._addQuad(node, rdf.rest, head);

      head = node;
    }

    return head;
  }

  /**
   * Adds to the builder the given node.
   * @param nodeId The node Id in the Property Graph. Have to be unique.
   * @param labels The unordered list of labels of the node in the
   * Property Graph.
   * @param properties The unordered list of properties of the node in
   * the Property Graph.
   */
  addNode(nodeId: number, labels: string[], properties: Ps | undefined) {
    let node = DataFactory.blankNode("node" + nodeId);

    this._addQuad(node, rdf.type, pgo.Node);

    for (let label of labels) {           
      let labelNode = this.namespaces.nodeLabel[label];
      this._addQuad(node, rdf.type, labelNode);
      this._labelize(labelNode, label);
      this._addQuad(labelNode, rdf.type, prec.CreatedNodeLabel);
      this._addQuad(prec.CreatedNodeLabel, rdfs.subClassOf, prec.CreatedVocabulary);
    }

    this._addProperties(node, properties, labels, this.namespaces.nodeProperty);
  }

  /**
   * Adds to the builder the given edge. Edges are expected to be directed and
   * have one and only one label.
   * 
   * Edges are materialized using standard RDF reification.
   * 
   * The reltionship triple is not asserted.
   * 
   * - "But RDF-star exists and have been designed for PG": Yes but a triple
   * is still unique in an RDF-star graph, so it ca not materialize multiples
   * edges between the same nodes that have the same label. This class
   * provides a mapping that always works and is always the same so it can't
   * use RDF-star.
   * 
   * @param relId The edge id in the Property Graph. Have to be unique.
   * @param start The starting node id of the edge.
   * @param end The ending node id of the edge.
   * @param label The edge label
   * @param properties The list of properties on the edge.
   */
  addEdge(relId: number, start: number, end: number, label: string, properties: Ps | undefined) {
    let edge = DataFactory.blankNode("edge" + relId);
    this._addQuad(edge, rdf.type, pgo.Edge);
    this._addQuad(edge, rdf.subject, DataFactory.blankNode("node" + start));
    this._addQuad(edge, rdf.object, DataFactory.blankNode("node" + end));

    let labelNode = this.namespaces.edgeLabel[label];
    this._addQuad(edge, rdf.predicate, labelNode);
    
    this._addQuad(labelNode, rdf.type, prec.CreatedEdgeLabel);
    this._addQuad(prec.CreatedEdgeLabel, rdfs.subClassOf, prec.CreatedVocabulary);

    this._labelize(labelNode, label);

    this._addProperties(edge, properties, [label], this.namespaces.edgeProperty);
  }

  /** Returns a dictionary with every prefixes used by this object. */
  getPrefixes() {
    const res: {[prefix: string]: string} = {
      rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
      rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
      pgo: 'http://ii.uwb.edu.pl/pgo#',
      prec: 'http://bruy.at/prec#'
    };

    Object.entries(this.namespaces)
    .forEach(([prefix, builder]) => res[prefix] = builder[""].value);

    return res;
  }

  populate(nodes: IdentityTo<AbstractNode<Ps>>, edges: IdentityTo<AbstractEdge<Ps>>) {
    for (let nodeId in nodes) {
      let node = nodes[nodeId];

      this.addNode(
        node.identity,
        node.labels || [],
        node.properties || undefined
      );
    }

    for (let edgeId in edges) {
      let edge = edges[edgeId];

      this.addEdge(
        edge.identity,
        edge.start, edge.end,
        edge.type,
        edge.properties || undefined
      )
    }
  }
}



type CypherProperties = {[key: string]: number | string | (number | string)[]} | undefined;

class BuilderForCypherProperties extends RDFGraphBuilder<CypherProperties> {
  /**
   * Add the properties of the node. Properties are suffixed with the list
   * of labels.
   * 
   * Array of properties are mapped to an RDF list.
   */
  _addProperties(
    node: Quad_Subject,
    properties: CypherProperties | undefined,
    labels: string[],
    propMaker: NamespaceBuilder
  ) {
    if (properties === undefined) return;

    let tag = "/";
    for (let label of [...labels].sort()) {
        if (tag !== "/") tag += "-";
        tag += label;
    }

    Object.entries(properties)
    .forEach(([property, value]) => {
      // Predicate
      let propertyNode = propMaker[property + tag];
      this._labelize(propertyNode, property);
      this._addQuad(propertyNode, rdf.type, prec.PropertyKey);
      this._addQuad(propertyNode, rdf.type, prec.CreatedPropertyKey);
      this._addQuad(prec.CreatedPropertyKey, rdfs.subClassOf, prec.CreatedVocabulary);

      // Object
      if (!Array.isArray(value)) {
        let nodeValue = this._makeNodeForPropertyValue(value);
        this._addQuad(node, propertyNode, nodeValue);
      } else {
        let listHead = this._makeNodeForPropertyValues(value);
        this._addQuad(node, propertyNode, listHead);
      }
    });
  }
}


class BuilderForTPProperties extends RDFGraphBuilder<TinkerPopProperties> {
  _addProperties(
    node: Quad_Subject,
    properties: TinkerPopProperties | undefined,
    labels: string[],
    propMaker: NamespaceBuilder
  ): void {
    if (properties === undefined) return;

    let tag = "/";
    for (let label of [...labels].sort()) {
        if (tag !== "/") tag += "-";
        tag += label;
    }

    for (let propertyObject of properties) {
      let propertyKey = propertyObject.key;
      let propertyValue = propertyObject.value;

      // Predicate
      let propertyNode = propMaker[propertyKey + tag];
      this._labelize(propertyNode, propertyKey);
      this._addQuad(propertyNode, rdf.type, prec.PropertyKey);
      this._addQuad(propertyNode, rdf.type, prec.CreatedPropertyKey);
      this._addQuad(prec.CreatedPropertyKey, rdfs.subClassOf, prec.CreatedVocabulary);

      // Object
      let self = this;
      function buildPropertyValue(propertyValue: number | string | (string | number)[]) {
        if (!Array.isArray(propertyValue)) {
          let nodeValue = self._makeNodeForPropertyValue(propertyValue);
          self._addQuad(node, propertyNode, nodeValue);
          return nodeValue;
        } else {
          let listHead = self._makeNodeForPropertyValues(propertyValue);
          self._addQuad(node, propertyNode, listHead);
          return listHead;
        }
      }

      let o = buildPropertyValue(propertyValue);

      // META
      if (propertyObject.meta !== undefined) {
        let metaNode = DataFactory.blankNode();
        this._addQuad(o, prec.hasMetaProperties, metaNode);
        
        for (let metaKey in propertyObject.meta) {
          let metaValue = propertyObject.meta[metaKey];

          let propertyNode = propMaker[metaKey + tag];
          this._labelize(propertyNode, metaKey);
          this._addQuad(propertyNode, rdf.type, prec.PropertyKey);
          this._addQuad(propertyNode, rdf.type, prec.CreatedPropertyKey);
          this._addQuad(prec.CreatedPropertyKey, rdfs.subClassOf, prec.CreatedVocabulary);

          let target = buildPropertyValue(metaValue);

          this._addQuad(metaNode, propertyNode, target);
        }
      }
    }
  }
}
