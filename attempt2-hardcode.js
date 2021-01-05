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

let addedVocabulary = null;

if (process.argv.length >= 4) {
    addedVocabulary = require("./vocabulary-expansion.js")(process.argv[3]);
}

let propertyGraphStructure = require("./file-read.js").fromNeo4j(filename);

// ============================================================================
// ?????????????????????

const rdf = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);
const ex  = namespace("http://www.example.org/prec/")

function matchingRule(rule, extra) {
    if (rule.when != "always") {
        console.error("Rules is not when: always - " + rule);
    }

    return true;
}

class PGtoRDFMapper {
    constructor(vocabulary) {
        this.vocabulary = vocabulary;
        this.knownNodes = {};
        this.knownRelations = {};
        this.knownAttributes = {};
    }

    getNodeFromId(nodeId) {
        if (this.knownNodes[nodeId] === undefined) {
            this.knownNodes[nodeId] = ex["node#" + nodeId];
        }

        return this.knownNodes[nodeId];
    }

    getAttributeFromName(attributeName/* TODO:, listOfLabelsOfNode */) {
        if (this.knownAttributes[attributeName] === undefined) {
            const ruleToApply = this._findRulesFor("attributeIRI", attributeName)
                .filter(rule => matchingRule(rule, null));
            
            if (ruleToApply.length != 0) {
                if (ruleToApply.length > 1) {
                    console.error("More than 1 rule match attribute#" + attributeName);
                }
                
                this.knownAttributes[attributeName] = ruleToApply[0].replacement;
            } else {
                this.knownAttributes[attributeName] = ex["attribute#" + attributeName];
            }
        }

        return this.knownAttributes[attributeName];
    }

    getLabel(labelName) {
        return ex["type#" + labelName];
    }

    _findRulesFor(kind, target) {
        if (addedVocabulary[kind] === undefined) return [];
        return addedVocabulary[kind].filter(props => props.target == target);
    }

    getRelationship(relationshipLabel /*TODO:, sourceLabels, destinationLabels */) {
        if (this.knownRelations[relationshipLabel] === undefined) {
            const ruleToApply = this._findRulesFor("relationshipIRI", relationshipLabel)
                .filter(rule => matchingRule(rule, null));
            
            if (ruleToApply.length != 0) {
                if (ruleToApply.length > 1) {
                    console.error("More than 1 rule match " + relationshipLabel);
                }
                this.knownRelations[relationshipLabel] = ruleToApply[0].replacement;
            } else {
                this.knownRelations[relationshipLabel] = ex["relation#" + relationshipLabel];
            }
        }

        return this.knownRelations[relationshipLabel];
    }

    isAlwaysAsserted(propertyName) {
        if (this.vocabulary["alwaysAsserted"] === undefined) return false;
        return this.vocabulary["alwaysAsserted"].indexOf(propertyName.value) != -1;
    }
}

// ============================================================================

function findReifiedRelationships(ar) {
    // Find relationships without their attributes
    const spoRelationships = ar.filter(object => object.type === 'relationship')
                               .map(object => [object.start.id, object.label, object.end.id]);

    const propertyAnalysis = {}

    for (const [s, p, o] of spoRelationships) {
        if (propertyAnalysis[p] === undefined) {
            propertyAnalysis[p] = {};
        }

        if (propertyAnalysis[p][[s, o]] === undefined) {
            propertyAnalysis[p][[s, o]] = 1;
        } else {
            ++propertyAnalysis[p][[s, o]];
        }
    }

    // A relationship is reified if there are several edges between two nodes
    const reifiedList = new Set();

    for (const p in propertyAnalysis) {
        const soProps = propertyAnalysis[p];

        for (const so in soProps) {
            if (soProps[so] >= 2) {
                reifiedList.add(p);
                break;
            }
        }
    }

    return reifiedList;
}

function jsarray_to_nodesedges(ar, addedVocabulary_) {
    const mapping = new PGtoRDFMapper(addedVocabulary_);

    // Nodes
    const nodes = ar
        .filter(object => object.type === 'node')
        .map(object => {
            const resultingQuads = [];

            const subject = mapping.getNodeFromId(object.id);

            if (object.labels) {
                for (let label of object.labels) {
                    resultingQuads.push(
                        N3.DataFactory.quad(
                            subject, rdf.type, mapping.getLabel(label)
                        )
                    );
                }
            }

            if (object.properties) {
                for (let property in object.properties) {
                    resultingQuads.push(
                        N3.DataFactory.quad(
                            subject,
                            mapping.getAttributeFromName(property),
                            N3.DataFactory.literal(object.properties[property])         // ???
                        )
                    );
                }
            }

            return resultingQuads;
        });

    // Edges without properties
    const reifiedRelationships = findReifiedRelationships(ar);

    const reifiedEdges = ar.filter(object => object.type == 'relationship')
        .map(object => {
            const resultingQuads = [];

            const rdfSubject   = mapping.getNodeFromId(object.start.id);
            const rdfPredicate = mapping.getRelationship(object.label);
            const rdfObject    = mapping.getNodeFromId(object.end.id);

            if (reifiedRelationships.has(object.label)) {
                // RDF standard reification is required so the relationship is materialized
                // as a new node in the RDF graphy
                const edgeId = makeRelationshipNodeIdentifier(object.id);
                object.associatedTerm = edgeId;

                resultingQuads.push(N3.DataFactory.quad(edgeId, rdf.subject  , rdfSubject  ));
                resultingQuads.push(N3.DataFactory.quad(edgeId, rdf.predicate, rdfPredicate));
                resultingQuads.push(N3.DataFactory.quad(edgeId, rdf.object   , rdfObject   ));
            } else {
                // Only one relation of this kind between every node : it is kept as an
                // edge in RDF
                let predicateQuad = N3.DataFactory.quad(rdfSubject, rdfPredicate, rdfObject);
                object.associatedTerm = predicateQuad;
                
                // Heuristic: if there is no attribute, it must be true
                // We also must keep it as we would else end up with information
                // loss
                if (!object.properties || object.properties.length == 0
                    || mapping.isAlwaysAsserted(rdfPredicate)) {
                    resultingQuads.push(predicateQuad);
                }
            }
    
            return resultingQuads;
        });
    
    // Relationships properties
    const relationshipProperties = ar.filter(object => object.type === 'relationship')
        .map(object => {
            let resultingQuads = [];
            // Attributes
            if (object.properties) {
                for (let property in object.properties) {
                    // If there are multiple values, with need to create a triple per value
                    let props;

                    if (Array.isArray(object.properties[property])) {
                        props = object.properties[property];
                    } else {
                        props = [object.properties[property]];
                    }

                    for (let propValue of props) {
                        resultingQuads.push(
                            N3.DataFactory.quad(
                                // TODO: `associatedTerm` is horrible design as the parameter of the function is not const.
                                // Change it
                                object.associatedTerm,  
                                mapping.getAttributeFromName(property),
                                N3.DataFactory.literal(propValue) // ???
                            )
                        );
                    }
                }
            }

            return resultingQuads;
        });

    return {
        quadsss: [nodes, reifiedEdges, relationshipProperties]
    };
}

const result = jsarray_to_nodesedges(propertyGraphStructure, addedVocabulary);

const store = new N3.Store();

for (let quadssPerCategory of result.quadsss) {
    for (let quadsPerPGObject of quadssPerCategory) {
        for (let quad of quadsPerPGObject) {
            store.addQuad(quad);
        }
    }
}

const prefixes = {
    rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    label: 'http://www.example.org/prec/type#',
    node: 'http://www.example.org/prec/node#',
    attribute: 'http://www.example.org/prec/attribute#',
    relation: 'http://www.example.org/prec/relation#',
    schema: 'https://schema.org/'
};
const writer = new N3.Writer({ prefixes: prefixes });
store.forEach(quad => writer.addQuad(quad.subject, quad.predicate, quad.object, quad.graph));
writer.end((_error, result) => console.log(result));
