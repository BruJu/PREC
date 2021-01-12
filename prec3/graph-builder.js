'use strict';

//! This module provides an RDF graph builder that enables the user to build an
//! expanded RDF graph from a Property Graph description.

// Libraries
const N3            = require('n3');
const namespace     = require('@rdfjs/namespace');

// Namespaces
const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);
const rdfs = namespace("http://www.w3.org/2000/01/rdf-schema#", N3.DataFactory)
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#", N3.DataFactory);

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
     * @param {*} indiv Namespace for IRIs that doesn't have any proper semantic
     * @param {*} vocab Namespace for IRIs that should be mapped to existing
     * ontology IRIs.
     */
    constructor(indiv, vocab) {
        this.quads = [];
        this.propValueCounter = 0;

        this.namespaces = {};
        this.namespaces.nodeId       = namespace(indiv + "node/id/");
        this.namespaces.nodeLabel    = namespace(vocab + "node/label/");
        this.namespaces.nodeProperty = namespace(vocab + "node/property/");
        
        this.namespaces.relationId       = namespace(indiv + "relation/");
        this.namespaces.relationLabel    = namespace(vocab + "relation/label/");
        this.namespaces.relationProperty = namespace(vocab + "relation/property/");
        
        this.namespaces.literals     = namespace(indiv + "literal/");

        this.numberOfBlankNodes = 0;
    }

    /** Builds and adds the quad described by S P O G */
    _addQuad(s, p, o, g) {
        this.quads.push(N3.DataFactory.quad(s, p, o, g));
    }

    /** Builds a store using the quads stored in this builder */
    toStore() {
        const store = new N3.Store();
        for (let quad of this.quads) {
            store.addQuad(quad);
        }
        return store;
    }

    /** Adds the quad(nodeName, rdfs.label, literal) */
    _labelize(nodeName, literal) {
        this._addQuad(nodeName, rdfs.label, N3.DataFactory.literal(literal));
        return nodeName;
    }

    /** Builds some new node for the literal. The end of the IRI is kind of opaque. */
    _makeNodeForPropertyValue(literal, propValueMaker) {
        let propertyValueNode = propValueMaker[++this.propValueCounter];
        this._labelize(propertyValueNode, literal);
        return propertyValueNode
    }

    /**
     * Add the properties of the node. Properties are suffixed with the list
     * of labels.
     * 
     * Array of properties are mapped to an RDF list.
     */
    _addProperties(node, properties, labels, propMaker, propValueMaker) {
        let tag = "/";
        for (let label of [...labels].sort()) {
            if (tag !== "/") tag += "-";
            tag += label;
        }

        for (let property in properties) {
            // Predicate
            let propertyNode = propMaker[property + tag];
            this._labelize(propertyNode, property);
            this._addQuad(propertyNode, rdf.type, pgo.Property);

            // Object
            if (!Array.isArray(properties[property])) {
                this._addQuad(node, propertyNode, this._makeNodeForPropertyValue(properties[property], propValueMaker));
            } else {
                let listOfNodes = properties[property].map(p => this._makeNodeForPropertyValue(p, propValueMaker));
                let listHead = this._addList(listOfNodes);
                this._addQuad(node, propertyNode, listHead);
            }
        }
    }

    /** Adds the the builder the nodes in the form of a proper RDF list. */
    _addList(list) {
        let head = rdf.nil;

        for (let i = list.length - 1 ; i >= 0 ; --i) {
            let node = N3.DataFactory.blankNode("" + (++this.numberOfBlankNodes));
            this._addQuad(node, rdf.type, rdf.List);
            this._addQuad(node, rdf.first, list[i]);
            this._addQuad(node, rdf.rest, head);

            head = node;
        }

        return head;
    }

    /** Assigns the the node the type of the label. The label can be new. */
    _addLabel(node, label, labelMaker) {
        let labelNode = labelMaker[label];
        this._addQuad(node, rdf.type, labelNode);
        this._labelize(labelNode, label);
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
        let node = this.namespaces.nodeId[nodeId];

        this._addQuad(node, rdf.type, pgo.Node);

        for (let label of labels) {
            this._addLabel(node, label, this.namespaces.nodeLabel);
        }

        this._addProperties(node, properties, labels, this.namespaces.nodeProperty, this.namespaces.literals);
    }

    /**
     * Adds to the builder the given relationship. Relationships are expected
     * to be directed and have one and only one label.
     * 
     * Relationships are materialized using RDF reification.
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
    addRelationship(relId, start, end, label, properties) {
        let relation = this.namespaces.relationId[relId];
        this._addQuad(relation, rdf.type, pgo.Edge);
        this._addQuad(relation, rdf.subject, this.namespaces.nodeId[start]);
        this._addQuad(relation, rdf.object, this.namespaces.nodeId[end]);

        let labelNode = this.namespaces.relationLabel[label];
        this._addQuad(relation, rdf.predicate, labelNode);
        this._labelize(labelNode, label);

        this._addProperties(relation, properties, [label], this.namespaces.relationProperty, this.namespaces.literals);
    }

    /** Returns a dictionary with every prefixes used by this object. */
    getPrefixes() {
        const res = {
            rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
            rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
            pgo: 'http://ii.uwb.edu.pl/pgo#'
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
        let builder = new RDFGraphBuilder(
            "http://www.example.org/indiv/", "http://www.example.org/vocab/"
        );
    
        neo4jJavascriptArray.filter (object => object.type === 'node')
            .forEach(object => builder.addNode(object.id, object.labels || [], object.properties || []));
    
            neo4jJavascriptArray.filter(object => object.type == 'relationship')
            .forEach(object => builder.addRelationship(
                    object.id, object.start.id, object.end.id, object.label,
                    object.properties || []
                )
            );
        
        return [builder.toStore(), builder.getPrefixes()];
    }
}

module.exports = RDFGraphBuilder;
