'use strict';

const fs = require('fs');
const N3 = require('n3');
const namespace = require('@rdfjs/namespace');
const { exit } = require('process');

const rdf = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);
const rdfType = rdf.type;

const prec = namespace("http://bruy.at/prec#", N3.DataFactory);
const precpropertyIRI = prec.propertyIRI;
const precRelationshipIRI = prec.relationshipIRI;
const precAlwaysAsserted = prec.alwaysAsserted;

function readQuad(quad) {
    if (quad.predicate.equals(precpropertyIRI)) {
        // assert(subject is named node)
        // assert(object is raw string literal)
        return [
            "propertyIRI",
            {
                "target": quad.object.value,
                "replacement": quad.subject,
                "when": "always"
            }
        ];
    } else if (quad.predicate.equals(precRelationshipIRI)) {
        return [
            "relationshipIRI",
            {
                "target": quad.object.value,
                "replacement": quad.subject,
                "when": "always"
            }
        ];
    } else if (quad.predicate.equals(rdfType) && quad.object.equals(precAlwaysAsserted)) {
        return [
            "alwaysAsserted",
            quad.subject.value,
        ];
    } else {
        if (quad.subject.termType == "Quad") {
            let innerQuad = readQuad(quad.subject);

            if (innerQuad === undefined) return undefined;

            if (quad.predicate.equals(prec.applyOnNodesLabeled)
                && quad.object.termType == "Literal") {
                
                if (innerQuad[1].when != "always") {
                    console.error("Double annotations are not yet supported");
                    exit(0);
                    return undefined;
                }

                innerQuad[1].when = { "On": "Nodes", "Labelled": quad.object.value };
                return innerQuad;
            }

        }
        console.error("Unexpected quad: ");
        console.error(quad)
        exit(0);
        return undefined;
    }
}

function readVocabulary(filename) {
    const vocab = {
        "propertyIRI": [],
        "relationshipIRI": [],
        "alwaysAsserted": []
    };

    const parser = new N3.Parser();
    const fileContent = fs.readFileSync(filename, 'utf-8');
    const quads = parser.parse(fileContent);

    for (let quad of quads) {
        const rule = readQuad(quad);
        if (rule !== undefined) {
            vocab[rule[0]].push(rule[1]);
        }
    }

    return vocab;
}

module.exports = readVocabulary;
