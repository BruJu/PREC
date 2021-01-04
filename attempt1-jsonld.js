'use strict';

// Attempt 1: convert the JSON using JSONLD

// I don't like it because it requires a lot of work to produce a JSON-LD
// compatible file and currently there is not incentive in using JSON-LD.


// Nodes
// - JSON LD doesn't seems to bring much so far.
// - But in the data, we have ambiguous names (for name): can JSON LD solve
// this problem? (which would be the major appeal of using json ld)
// - Or do we have to modify the names of the properties before expanding
// with a context ?

// Edges:
// - We are confronted to the problem of SA vs PG mode.
// (https://lists.w3.org/Archives/Public/public-rdf-star/2019Sep/0051.html)
// - If PG is chosen, then the transformation is very straightforward.
// - If SA is chosen, then its more complicated (when the edge is actually
// created in RDF?)



const fileRead = require("./file-read.js");
const jsonld = require('jsonld');

function jsarray_to_nodesedges(ar) {
    // Nodes
    const nodes = ar
        .filter(object => object.type === 'node')
        .map(object => {
            let transformed = {
                "@id": "http://edge/" + object.id
            };

            if (object.labels.length > 0) {
                if (object.labels.length == 1) {
                    transformed['@type'] = "http://type//" + object.labels[0];
                } else {
                    transformed['@type'] = "http://type//" + object.labels;
                }
            }

            if (object.properties) {
                for (const key in object.properties) {
                    transformed["http://property/" + key] = object.properties[key];
                }
            }

            return transformed;
        });

    // Edges
    // TODO: JSON-LD*?????
    // TODO: finish the edges transformation

    const edges = {};

    ar.filter(object => object.type === 'relationship')
        .map(object => {
            let transformed = {};
    
            transformed.from = object.start.id;
            transformed.to   = object.end.id;
    
    
            return [object.id, transformed];
        })
        .forEach(([id, object]) => edges[id] = object);

    // Unknown

    const unknown_types = new Set(ar
        .map(object => object.type)
        .filter(type => type !== 'node')
    );

    return [nodes, edges, unknown_types];
}

let js_array = fileRead.fromNeo4j("data/julian.json");

let [nodes, edges, unknown_types] = jsarray_to_nodesedges(js_array);


async function toRDF(nodes) {
    console.log(await jsonld.toRDF(nodes, {'algorithm': 'URDNA2015', 'format': 'application/n-quads'}));
}

toRDF(nodes);

//console.log(JSON.stringify(nodes));
console.log(unknown_types);
