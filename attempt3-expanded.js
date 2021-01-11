'use strict';

// This file enables to convert an APOC exported Property Graph in Json format
// into a Turtle-star RDF-star file.
//
// RDF-star is used in SA mode (annotated quads are not affirmed).

const N3        = require('n3');
const namespace = require('@rdfjs/namespace');

if (process.argv.length < 3) {
    console.log(`Usage: ${process.argv[0]} ${process.argv[1]} filename`);
    exit(0);
}

const filename = process.argv[2];

let propertyGraphStructure = require("./file-read.js").fromNeo4j(filename);

// ============================================================================
// ?????????????????????

const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);
const rdfs = namespace("http://www.w3.org/2000/01/rdf-schema#", N3.DataFactory)
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#", N3.DataFactory);

class RDFGraphBuilder {
    constructor(indiv, vocab/*, options*/) {
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

        //this.options = options;
    }

    _addQuad(s, p, o, g) {
        this.quads.push(N3.DataFactory.quad(s, p, o, g));
    }

    toStore() {
        const store = new N3.Store();
        for (let quad of this.quads) {
            store.addQuad(quad);
        }
        return store;
    }

    _labelize(nodeName, literal) {
        this._addQuad(nodeName, rdfs.label, N3.DataFactory.literal(literal));
        return nodeName;
    }

    _makeNodeForPropertyValue(literal, propValueMaker) {
        //if (this.options.nodeForProperty !== false) {
            let propertyValueNode = propValueMaker[++this.propValueCounter];
            this._labelize(propertyValueNode, literal);
            return propertyValueNode
        //} else {
        //    return N3.DataFactory.literal(literal);
        //}
    }

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

    _addLabel(node, label, labelMaker) {
        let labelNode = labelMaker[label];
        this._addQuad(node, rdf.type, labelNode);
        this._labelize(labelNode, label);
    }

    addNode(edgeId, labels, properties) {
        let node = this.namespaces.nodeId[edgeId];

        this._addQuad(node, rdf.type, pgo.Node);

        for (let label of labels) {
            this._addLabel(node, label, this.namespaces.nodeLabel);
        }

        this._addProperties(node, properties, labels, this.namespaces.nodeProperty, this.namespaces.literals);
    }

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
}


// ============================================================================

function js_to_store(ar) {
    let builder = new RDFGraphBuilder(
        "http://www.example.org/indiv/", "http://www.example.org/vocab/" //,
        //{ "nodeForProperty": false }
    );

    ar.filter (object => object.type === 'node')
        .forEach(object => builder.addNode(object.id, object.labels || [], object.properties || []));

    ar.filter(object => object.type == 'relationship')
        .forEach(object => builder.addRelationship(
                object.id, object.start.id, object.end.id, object.label,
                object.properties || []
            )
        );
    
    return [builder.toStore(), builder.getPrefixes()];
}

const [store, prefixes] = js_to_store(propertyGraphStructure);

const writer = new N3.Writer({ prefixes: prefixes });
store.forEach(quad => writer.addQuad(quad.subject, quad.predicate, quad.object, quad.graph));
writer.end((_error, result) => console.log(result));

console.error(store.size + " triples");
