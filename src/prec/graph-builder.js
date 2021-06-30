'use strict';

//! This module provides an RDF graph builder that enables the user to build an
//! expanded RDF graph from a Property Graph description.

// Libraries
const N3        = require('n3');
const DStar     = require('../dataset/index.js');
const namespace = require('@rdfjs/namespace');

// Namespaces
const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);
const rdfs = namespace("http://www.w3.org/2000/01/rdf-schema#"      , N3.DataFactory);
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#"                  , N3.DataFactory);
const prec = namespace("http://bruy.at/prec#"                       , N3.DataFactory);

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
class RDFGraphBuilder {
    /**
     * Builds a builder (Who would have believed?)
     * @param {*} vocab Namespace for IRIs that should be mapped to existing
     * ontology IRIs.
     */
    constructor(vocab) {
        this.quads = [];

        this.namespaces = {
            nodeLabel   : namespace(vocab + "node/label/"),
            nodeProperty: namespace(vocab + "node/property/"),
            edgeLabel   : namespace(vocab + "edge/label/"),
            edgeProperty: namespace(vocab + "edge/property/")
        };
        
        this.counters = {
            properties: 0,
            lists: 0
        };
    }

    /** Builds and adds the quad described by S P O G */
    _addQuad(s, p, o, g) {
        this.quads.push(N3.DataFactory.quad(s, p, o, g));
    }

    /** Builds a store using the quads stored in this builder */
    toStore() {
        let dataset = new DStar();
        
        for (const quad of this.quads) {
            dataset.add(quad);
        }

        return dataset;
    }

    /** Adds the quad(nodeName, rdfs.label, literal) */
    _labelize(nodeName, literal) {
        this._addQuad(nodeName, rdfs.label, N3.DataFactory.literal(literal));
        return nodeName;
    }

    /** Builds some new node for the literal. The end of the IRI is kind of opaque. */
    _makeNodeForPropertyValue(literal) {
        const propertyValueNode = N3.DataFactory.blankNode("propertyValue" + (++this.counters.properties));
        this._addQuad(propertyValueNode, rdf.value, N3.DataFactory.literal(literal));
        this._addQuad(propertyValueNode, rdf.type, prec.PropertyValue);
        return propertyValueNode;
    }

    /** Builds some new node for a list of literal. The end of the IRI is kind of opaque. */
    _makeNodeForPropertyValues(literals) {
        const asRdfLiterals = literals.map(lit => N3.DataFactory.literal(lit));
        const head = this._addList(asRdfLiterals);

        const propertyValueNode = N3.DataFactory.blankNode("propertyValue" + (++this.counters.properties));
        this._addQuad(propertyValueNode, rdf.value, head);
        this._addQuad(propertyValueNode, rdf.type, prec.PropertyValue);
        return propertyValueNode;
    }

    /**
     * Add the properties of the node. Properties are suffixed with the list
     * of labels.
     * 
     * Array of properties are mapped to an RDF list.
     */
    _addProperties(node, properties, labels, propMaker) {
        let tag = "/";
        for (let label of [...labels].sort()) {
            if (tag !== "/") tag += "-";
            tag += label;
        }

        for (let property in properties) {
            // Predicate
            let propertyNode = propMaker[property + tag];
            this._labelize(propertyNode, property);
            this._addQuad(propertyNode, rdf.type, prec.PropertyLabel);
            this._addQuad(propertyNode, rdf.type, prec.CreatedPropertyLabel);
            this._addQuad(prec.CreatedPropertyLabel, rdfs.subClassOf, prec.CreatedVocabulary);

            // Object
            if (!Array.isArray(properties[property])) {
                let nodeValue = this._makeNodeForPropertyValue(properties[property]);
                this._addQuad(node, propertyNode, nodeValue);
            } else {
                let listHead = this._makeNodeForPropertyValues(properties[property]);
                this._addQuad(node, propertyNode, listHead);
            }
        }
    }

    _addMetaProperties(node, properties, labels, propMaker) {
        let tag = "/";
        for (let label of [...labels].sort()) {
            if (tag !== "/") tag += "-";
            tag += label;
        }

        for (let propertyObject of properties) {
            let propertyName = propertyObject.key;
            let propertyValue = propertyObject.value;

            // Predicate
            let propertyNode = propMaker[propertyName + tag];
            this._labelize(propertyNode, propertyName);
            this._addQuad(propertyNode, rdf.type, prec.PropertyLabel);
            this._addQuad(propertyNode, rdf.type, prec.CreatedPropertyLabel);
            this._addQuad(prec.CreatedPropertyLabel, rdfs.subClassOf, prec.CreatedVocabulary);

            // Object
            let self = this;
            function buildPropertyValue(propertyValue) {
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
                let metaNode = N3.DataFactory.blankNode();
                this._addQuad(o, prec.hasMetaProperties, metaNode);
                
                for (let metaKey in propertyObject.meta) {
                    let metaValue = propertyObject.meta[metaKey];

                    let propertyNode = propMaker[metaKey + tag];
                    this._labelize(propertyNode, metaKey);
                    this._addQuad(propertyNode, rdf.type, prec.PropertyLabel);
                    this._addQuad(propertyNode, rdf.type, prec.CreatedPropertyLabel);
                    this._addQuad(prec.CreatedPropertyLabel, rdfs.subClassOf, prec.CreatedVocabulary);

                    let target = buildPropertyValue(metaValue);

                    this._addQuad(metaNode, propertyNode, target);
                }
            }
        }
    }

    /** Adds to the builder the nodes in the form of a proper RDF list. */
    _addList(list) {
        let head = rdf.nil;

        const prefix = "list" + (++this.counters.lists) + "_";

        for (let i = list.length - 1 ; i >= 0 ; --i) {
            let node = N3.DataFactory.blankNode(prefix + (i + 1));
            //this._addQuad(node, rdf.type, rdf.List);
            this._addQuad(node, rdf.first, list[i]);
            this._addQuad(node, rdf.rest, head);

            head = node;
        }

        return head;
    }

    /**
     * Adds to the builder the given node.
     * @param {*} nodeId The node Id in the Property Graph. Have to be unique.
     * @param {*} labels The unordered list of labels of the node in the
     * Property Graph.
     * @param {*} properties The unordered list of properties of the node in
     * the Property Graph.
     */
    addNode(nodeId, labels, properties) {
        let node = N3.DataFactory.blankNode("node" + nodeId);

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
     * @param {*} relId The edge id in the Property Graph. Have to be unique.
     * @param {*} start The starting node id of the edge.
     * @param {*} end The ending node id of the edge.
     * @param {*} label The edge label
     * @param {*} properties The list of properties on the edge.
     */
    addEdge(relId, start, end, label, properties) {
        let edge = N3.DataFactory.blankNode("edge" + relId);
        this._addQuad(edge, rdf.type, pgo.Edge);
        this._addQuad(edge, rdf.subject, N3.DataFactory.blankNode("node" + start));
        this._addQuad(edge, rdf.object, N3.DataFactory.blankNode("node" + end));

        let labelNode = this.namespaces.edgeLabel[label];
        this._addQuad(edge, rdf.predicate, labelNode);
        
        this._addQuad(labelNode, rdf.type, prec.CreatedEdgeLabel);
        this._addQuad(prec.CreatedEdgeLabel, rdfs.subClassOf, prec.CreatedVocabulary);

        this._labelize(labelNode, label);

        this._addProperties(edge, properties, [label], this.namespaces.edgeProperty);
    }

    /** Returns a dictionary with every prefixes used by this object. */
    getPrefixes() {
        const res = {
            rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
            rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
            pgo: 'http://ii.uwb.edu.pl/pgo#',
            prec: 'http://bruy.at/prec#'
        };

        for (let namespace_ in this.namespaces) {
            res[namespace_] = this.namespaces[namespace_][""].value;
        }

        return res;
    }

    /**
     * Converts a list of nodes and edges from a Neo4J property graph into an
     * RDF/JS dataset that contains the PREC-0 RDF Graph.
     * 
     * @param {*} neo4jJavascriptArray The list of Json objects exported from
     * Neo4J APOC plugin.
     */
    static neo4jJsToStore(neo4jJavascriptArray) {
        let builder = new RDFGraphBuilder("http://www.example.org/vocab/");
    
        neo4jJavascriptArray.filter (object => object.type === 'node')
            .forEach(object => builder.addNode(object.id, object.labels || [], object.properties || []));
    
        neo4jJavascriptArray.filter(object => object.type == 'relationship')
            .forEach(object => builder.addEdge(
                    object.id, object.start.id, object.end.id, object.label,
                    object.properties || {}
                )
            );
        
        return [builder.toStore(), builder.getPrefixes()];
    }

    static neo4JCypherToStore(neo4JCypherResult) {
        let nodes = {};
        let edges = {};
        
        // match (m)-[n]->(o) return (m, n, o)
        for (let oneResult of neo4JCypherResult) {  // One (m, n, o)
            for (let oneOneResultKey in oneResult) {
                let oneOneResult = oneResult[oneOneResultKey];

                if (oneOneResult.labels !== undefined) {
                    if (nodes[oneOneResult.identity] !== undefined) {
                        continue;
                    }

                    nodes[oneOneResult.identity] = oneOneResult;
                } else if (oneOneResult.start !== undefined) {
                    edges[oneOneResult.identity] = oneOneResult;
                } else {
                    console.error("Unknown type of result");
                    console.error(oneOneResult);
                    return null;
                }
            }
        }

        return RDFGraphBuilder.neo4JProtocoleToStore(nodes, edges);
    }

    static neo4JProtocoleToStore(nodes, edges) {
        let builder = new RDFGraphBuilder("http://www.example.org/vocab/");

        for (let nodeId in nodes) {
            let node = nodes[nodeId];

            builder.addNode(
                node.identity,
                node.labels || {},
                node.properties || {}
            );
        }

        for (let edgeId in edges) {
            let edge = edges[edgeId];

            builder.addEdge(
                edge.identity,
                edge.start, edge.end,
                edge.type,
                edge.properties || {}
            )
        }
        
        return [builder.toStore(), builder.getPrefixes()];
    }

    static fromTinkerPop(nodes, edges) {
        let builder = new RDFGraphBuilder("http://www.example.org/vocab/");

        builder._addProperties = builder._addMetaProperties;

        for (let nodeId in nodes) {
            let node = nodes[nodeId];

            builder.addNode(
                node.identity,
                node.labels || {},
                node.properties || {}
            );
        }

        for (let edgeId in edges) {
            let edge = edges[edgeId];

            builder.addEdge(
                edge.identity,
                edge.start, edge.end,
                edge.type,
                edge.properties || {}
            )
        }

        return [builder.toStore(), builder.getPrefixes()];
    }
}

module.exports = RDFGraphBuilder;
