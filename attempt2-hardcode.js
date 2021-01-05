'use strict';

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

const rdf = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);

function makeNodeIdentifier(nodeId) {
    return N3.DataFactory.namedNode("http://node/" + nodeId);
}

function makeRelationshipNodeIdentifier(relationshipId) {
    return N3.DataFactory.namedNode("http://relationshipnode/" + relationshipId);
}

function makeRelationshipIdentifier(predicateLabel) {
    return N3.DataFactory.namedNode("http://relationship/" + predicateLabel)
}

function makeAnnotationIdentifier(annotationAttribute) {
    return N3.DataFactory.namedNode("http://attribute/" + annotationAttribute)
}

function makeLabelIdentifier(labelName) {
    return N3.DataFactory.namedNode("http://types/" + labelName);
}

function makeNodeAttributeIdentifier(fieldName) {
    return N3.DataFactory.namedNode("http://attribute/" + fieldName)
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
                        N3.DataFactory.quad(
                            subject,
                            rdf.type,
                            makeLabelIdentifier(label)
                        )
                    );
                }
            }

            if (object.properties) {
                for (let property in object.properties) {
                    resultingQuads.push(
                        N3.DataFactory.quad(
                            subject,
                            makeNodeAttributeIdentifier(property),
                            N3.DataFactory.literal(object.properties[property])         // ???
                        )
                    );
                }
            }

            return resultingQuads;
        });

    // Reified edges
    const reifiedRelationships = findReifiedRelationships(ar);

    const reifiedEdges = ar.filter(object => object.type == 'relationship')
        .filter(object => reifiedRelationships.has(object.label))
        .map(object => {
            const resultingQuads = [];

            const edgeId = makeRelationshipNodeIdentifier(object.id);

            let rdfSubject   = makeNodeIdentifier(object.start.id);
            let rdfPredicate = makeRelationshipIdentifier(object.label);
            let rdfObject    = makeNodeIdentifier(object.end.id);

            resultingQuads.push(N3.DataFactory.quad(edgeId, rdf.subject  , rdfSubject  ));
            resultingQuads.push(N3.DataFactory.quad(edgeId, rdf.predicate, rdfPredicate));
            resultingQuads.push(N3.DataFactory.quad(edgeId, rdf.object   , rdfObject   ));

            object.associatedTerm = edgeId;

            return resultingQuads;
        });


    // Unreified edges
    const edges = ar.filter(object => object.type === 'relationship')
        .filter(object => !reifiedRelationships.has(object.label))
        .map(object => {
            const resultingQuads = [];

            let rdfSubject   = object.start.id;
            let rdfPredicate = object.label;
            let rdfObject    = object.end.id;

            let predicateQuad = N3.DataFactory.quad(
                makeNodeIdentifier(rdfSubject),
                makeRelationshipIdentifier(rdfPredicate),
                makeNodeIdentifier(rdfObject)
            );

            // Heuristic: if there is no attribute, it must be true
            // We also must keep it as we would else end up with information
            // loss
            if (!object.properties || object.properties.length == 0) {
                resultingQuads.push(predicateQuad);
            }
            
            object.associatedTerm = predicateQuad;
    
            return resultingQuads;
        });
    
    // Relationships properties
    const relationshipProperties = ar.filter(object => object.type === 'relationship')
        .map(object => {
            let resultingQuads = [];
            // Attributes
            if (object.properties) {
                for (let property in object.properties) {
                    resultingQuads.push(
                        N3.DataFactory.quad(
                            // TODO: `associatedTerm` is horrible design as the parameter of the function is not const.
                            // Change it
                            object.associatedTerm,  
                            makeAnnotationIdentifier(property),
                            N3.DataFactory.literal(object.properties[property]) // ???
                        )
                    );
                }
            }

            return resultingQuads;
        });

    return [nodes, reifiedEdges, edges, relationshipProperties];
}


let categoriesOfQuads = jsarray_to_nodesedges(propertyGraphStructure);

//const dataset = ds();

const store = new N3.Store();

for (let quadssPerCategory of categoriesOfQuads) {
    for (let quadsPerPGObject of quadssPerCategory) {
        for (let quad of quadsPerPGObject) {
            store.addQuad(quad);
        }
    }
}

const prefixes = { rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#' };
const writer = new N3.Writer({ prefixes: prefixes });
store.forEach(quad => writer.addQuad(quad));
writer.end((_error, result) => console.log(result));
