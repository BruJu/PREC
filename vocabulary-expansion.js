'use strict';

const fs = require('fs');
const N3 = require('n3');
const namespace = require('@rdfjs/namespace');

const rdf = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);
const rdfType = rdf.type;

const prec = namespace("http://bruy.at/prec#", N3.DataFactory);
const precAttributeIRI = prec.attributeIRI;
const precRelationshipIRI = prec.relationshipIRI;
const precAlwaysAsserted = prec.alwaysAsserted;

function readQuad(quad) {
    if (quad.predicate.equals(precAttributeIRI)) {
        // assert(subject is named node)
        // assert(object is raw string literal)
        return [
            "attributeIRI",
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
        console.error("Unexpected quad: " + quad);
        return undefined;
    }
}

function readVocabulary(filename) {
    const vocab = {
        "attributeIRI": [],
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
