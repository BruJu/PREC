'use strict';

//! This module provides an RDF graph builder that enables the user to build an
//! expanded RDF graph from a Property Graph description.

// Libraries
const N3        = require('n3');
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
 * - A relationship is materialized using RDF reification
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
            nodeLabel        : namespace(vocab + "node/label/"),
            nodeProperty     : namespace(vocab + "node/property/"),
            relationLabel    : namespace(vocab + "relation/label/"),
            relationProperty : namespace(vocab + "relation/property/")
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
    toStore() { return new N3.Store(this.quads); }

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
            this._addQuad(propertyNode, rdf.type, prec.Property);
            this._addQuad(propertyNode, rdf.type, prec.CreatedProperty);
            this._addQuad(prec.CreatedProperty, rdfs.subClassOf, prec.CreatedVocabulary);

            // Object
            if (!Array.isArray(properties[property])) {
                let nodeValue = this._makeNodeForPropertyValue(properties[property]);
                this._addQuad(node, propertyNode, nodeValue);
            } else {
                let listOfNodes = properties[property].map(p => this._makeNodeForPropertyValue(p));
                let listHead = this._addList(listOfNodes);
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
            this._addQuad(propertyNode, rdf.type, prec.Property);
            this._addQuad(propertyNode, rdf.type, prec.CreatedProperty);
            this._addQuad(prec.CreatedProperty, rdfs.subClassOf, prec.CreatedVocabulary);

            // Object
            let self = this;
            function buildPropertyValue(propertyValue) {
                if (!Array.isArray(propertyValue)) {
                    let nodeValue = self._makeNodeForPropertyValue(propertyValue);
                    self._addQuad(node, propertyNode, nodeValue);
                    return nodeValue;
                } else {
                    let listOfNodes = propertyValue.map(p => self._makeNodeForPropertyValue(p));
                    let listHead = self._addList(listOfNodes);
                    self._addQuad(node, propertyNode, listHead);
                    return listHead;
                }
            }

            let o = buildPropertyValue(propertyValue);


            // META
            if (propertyObject.meta !== undefined) {
                for (let metaKey in propertyObject.meta) {
                    let metaValue = propertyObject.meta[metaKey];

                    let propertyNode = propMaker[metaKey + tag];
                    this._labelize(propertyNode, metaKey);
                    this._addQuad(propertyNode, rdf.type, prec.Property);
                    this._addQuad(propertyNode, rdf.type, prec.CreatedProperty);
                    this._addQuad(prec.CreatedProperty, rdfs.subClassOf, prec.CreatedVocabulary);

                    let target = buildPropertyValue(metaValue);

                    this._addQuad(o, propertyNode, target);
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
     * Adds to the builder the given relationship. Relationships are expected
     * to be directed and have one and only one label.
     * 
     * Relationships are materialized using standard RDF reification.
     * 
     * The reltionship triple is not asserted.
     * 
     * - "But RDF-star exists and have been designed for PG": Yes but a triple
     * is still unique in an RDF-star graph, so it ca not materialize multiples
     * edges between the same nodes that have the same label. This class
     * provides a mapping that always works and is always the same so it can't
     * use RDF-star.
     * 
     * @param {*} relId The relationship id in the Property Graph. Have to be
     * unique.
     * @param {*} start The starting node id of the relationship.
     * @param {*} end The ending node id of the relationship.
     * @param {*} label The relationship label
     * @param {*} properties The list of properties on the relationship.
     */
    addRelationshipRDFReification(relId, start, end, label, properties) {
        let relation = N3.DataFactory.blankNode("edge" + relId);
        this._addQuad(relation, rdf.type, pgo.Edge);
        this._addQuad(relation, rdf.subject, N3.DataFactory.blankNode("node" + start));
        this._addQuad(relation, rdf.object, N3.DataFactory.blankNode("node" + end));

        let labelNode = this.namespaces.relationLabel[label];
        this._addQuad(relation, rdf.predicate, labelNode);
        
        this._addQuad(labelNode, rdf.type, prec.CreatedRelationshipLabel);
        this._addQuad(prec.CreatedRelationshipLabel, rdfs.subClassOf, prec.CreatedVocabulary);

        this._labelize(labelNode, label);

        this._addProperties(relation, properties, [label], this.namespaces.relationProperty);
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
     * Converts a list of nodes and relationships from a Neo4J property graph
     * into an expanded RDF store.
     * 
     * @param {*} neo4jJavascriptArray The list of Json objects exported from
     * Neo4J APOC plugin.
     */
    static neo4jJsToStore(neo4jJavascriptArray) {
        let builder = new RDFGraphBuilder("http://www.example.org/vocab/");
        builder.addRelationship = builder.addRelationshipRDFReification;
    
        neo4jJavascriptArray.filter (object => object.type === 'node')
            .forEach(object => builder.addNode(object.id, object.labels || [], object.properties || []));
    
        neo4jJavascriptArray.filter(object => object.type == 'relationship')
            .forEach(object => builder.addRelationship(
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

            builder.addRelationshipRDFReification(
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

            builder.addRelationshipRDFReification(
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
