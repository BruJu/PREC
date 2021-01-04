'use strict';

const graphy = require('@graphy/core.data.factory')
const ds = require('@graphy/memory.dataset.fast')

let propertyGraphStructure = require("./file-read.js").fromNeo4j("data/julian.json");

// ============================================================================
// ?????????????????????

const rdfType = graphy.namedNode("http://rdf/type"); // TODO

function makeNodeIdentifier(nodeId) {
    return graphy.namedNode("http://node/" + nodeId);
}

function makeRelationshipIdentifier(predicateLabel) {
    return graphy.namedNode("http://relationship/" + predicateLabel)
}

function makeAnnotationIdentifier(annotationAttribute) {
    return graphy.namedNode("http://attribute/" + annotationAttribute)
}

function makeLabelIdentifier(labelName) {
    return graphy.namedNode("http://types/" + labelName);
}

function makeNodeAttributeIdentifier(fieldName) {
    return graphy.namedNode("http://attribute/" + fieldName)
}

// ============================================================================

function jsarray_to_nodesedges(ar) {
    // Nodes
    const nodes = ar
        .filter(object => object.type === 'node')
        .map(object => {
            const resultingQuads = [];

            const subject = makeNodeIdentifier(object.id);

            if (object.labels) {
                for (let label of object.labels) {
                    resultingQuads.push(
                        graphy.quad(
                            subject,
                            rdfType,
                            makeLabelIdentifier(label)
                        )
                    );
                }
            }

            if (object.properties) {
                for (let property in object.properties) {
                    resultingQuads.push(
                        graphy.quad(
                            subject,
                            makeNodeAttributeIdentifier(property),
                            graphy.literal(object.properties[property])         // ???
                        )
                    );
                }
            }

            return resultingQuads;
        });

    // Edges
    const edges = ar.filter(object => object.type === 'relationship')
        .map(object => {
            const resultingQuads = [];

            let rdfSubject   = object.start.id;
            let rdfPredicate = object.label;
            let rdfObject    = object.end.id;

            let predicateQuad = graphy.quad(
                makeNodeIdentifier(rdfSubject),
                makeRelationshipIdentifier(rdfPredicate),
                makeNodeIdentifier(rdfObject)
            );

            // Heuristic: if there is no attribute, it must be true
            // We also must keep it as it would else end up with information
            // loss
            if (!object.properties || object.properties.length == 0) {
                resultingQuads.push(predicateQuad);
            }

            // Attributes
            console.log(object);
            if (object.properties) {
                for (let property in object.properties) {
                    resultingQuads.push(
                        graphy.quad(
                            predicateQuad,
                            makeAnnotationIdentifier(property),
                            graphy.literal(object.properties[property]) // ???
                        )
                    );
                }
            }
            
    
            return resultingQuads;
        })

    return [nodes, edges];
}


let [nodes, edges] = jsarray_to_nodesedges(propertyGraphStructure);

const dataset = ds();

// What if the same edge is stored several times in edges?

for (let quadCollection of [nodes, edges]) {
    for (let jsonEntry of quadCollection) {
        for (let triple of jsonEntry) {
            dataset.add(triple);
        }
    }
}

for (let quad of dataset) {
    console.log(quad);
}
