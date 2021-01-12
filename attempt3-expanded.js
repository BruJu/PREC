'use strict';

// This file enables to convert an APOC exported Property Graph in Json format
// into a Turtle-star RDF-star file.
//
// RDF-star is used in SA mode (annotated quads are not affirmed).

const N3        = require('n3');
const namespace = require('@rdfjs/namespace');
const graphyFactory = require('@graphy/core.data.factory');

if (process.argv.length < 3) {
    console.log(`Usage: ${process.argv[0]} ${process.argv[1]} filename`);
    exit(0);
}

const filename = process.argv[2];

let propertyGraphStructure = require("./file-read.js").fromNeo4j(filename);

// ============================================================================
// ?????????????????????


function concise(term) { return graphyFactory.term(term).concise(); }

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
        let propertyValueNode = propValueMaker[++this.propValueCounter];
        this._labelize(propertyValueNode, literal);
        return propertyValueNode
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

// namespaces!
const TripleSed = {
    "forMatch": function(term, binded) {
        if (term.termType == "Quad") {
            let s = TripleSed.forMatch(term.subject, binded);
            let p = TripleSed.forMatch(term.predicate, binded);
            let o = TripleSed.forMatch(term.object, binded);
            let g = term.graph;

            return N3.DataFactory.quad(s, p, o, g);
        }

        if (term.termType !== "Variable") return term;
        return binded[term.value];
    },
    "addBind": function(newBinds, searched, result) {
        if (searched.termType === "Variable") {
            newBinds[searched.value] = result;
        }
    },
    "filterBinds": function(result, bindedName, predicate) {
        return result.filter(dict => predicate(dict[bindedName]));
    },
    "replace": function(store, bindss, newPattern) {
        let r = [];

        for (let binds of bindss) {
            store.removeQuads(binds["@quads"]);

            r.push({ "binds": binds, "quads": [] });

            for (const newPattern1 of newPattern) {
                const newQuad = N3.DataFactory.quad(
                    TripleSed.forMatch(newPattern1[0], binds),
                    TripleSed.forMatch(newPattern1[1], binds),
                    TripleSed.forMatch(newPattern1[2], binds),
                );

                r[r.length - 1].quads.push(newQuad);
                store.addQuad(newQuad);
            }
        }

        return r;
    },
    "toRdfStar": function(store, replacementResults, nodeGetter, quadGetter) {
        for (const replacementResult of replacementResults) {
            const oldNode = nodeGetter(replacementResult);
            const newQuad = quadGetter(replacementResult);

            const oldAnnotations = TripleSed.matchAndBind(store,
                [[oldNode, N3.DataFactory.variable("RDFSTAR__p"), N3.DataFactory.variable("RDFSTAR__o")]]
            );

            TripleSed.replace(store, oldAnnotations,
                [[newQuad, N3.DataFactory.variable("RDFSTAR__p"), N3.DataFactory.variable("RDFSTAR__o")]]
            );
        }
    },
    "deleteMatches": function(store, s, p, o) {
        let x = "_";
        function m(term) {
            if (term == null || term == undefined) {
                x = x + "_";
                return N3.DataFactory.variable(x);
            } else {
                return term;
            }
        }

        let request = TripleSed.matchAndBind(store, [[m(s), m(p), m(o)]]);
        TripleSed.replace(store, request, []);
    },
    "matchAndBind_": function(store, patterns, iPattern, results) {
        if (iPattern == patterns.length) {
            return results;
        }

        const pattern = patterns[iPattern];

        const newResults = [];

        for (const oldResult of results) {
            const quads = store.getQuads(
                TripleSed.forMatch(pattern[0], oldResult),
                TripleSed.forMatch(pattern[1], oldResult),
                TripleSed.forMatch(pattern[2], oldResult)
            );

            for (let quad of quads) {
                const r = { "@quads": [...oldResult["@quads"], quad] };

                for (let x in oldResult) {
                    if (x === "@quads") continue;
                    r[x] = oldResult[x];
                }

                TripleSed.addBind(r, pattern[0], quad.subject);
                TripleSed.addBind(r, pattern[1], quad.predicate);
                TripleSed.addBind(r, pattern[2], quad.object);

                newResults.push(r);
            }
        }

        return TripleSed.matchAndBind_(store, patterns, iPattern + 1, newResults);
    },
    "matchAndBind": function(store, pattern) {
        return TripleSed.matchAndBind_(store, pattern, 0, [ { "@quads": [] } ]);
    }
};



function findTripleAbleRelations(requestResult) {
    // 1.
    const predicates = {};

    for (let bindings of requestResult) {
        console.log(predicates);
        const key = concise(bindings.p);

        if (predicates[key] === undefined) {
            predicates[key] = new N3.Store();
        } else if (predicates[key] === "HadDuplicates") {
            continue;
        }

        if (predicates[key].countQuads(bindings.s, bindings.p, bindings.o) >= 1) {
            predicates[key] = "HadDuplicates";
        } else {
            predicates[key].addQuad(bindings.s, bindings.p, bindings.o);
        }
    }

    // 2.
    const result = new Set();

    for (const key in predicates) {
        if (predicates[key] !== "HadDuplicates") {
            result.add(key);
        }
    }

    return result;
}

function transformationRelationship(store, star) {
    const variable = N3.DataFactory.variable;

    let request = TripleSed.matchAndBind(store,
        [
            [variable("rel"), rdf.subject  , variable("s")],
            [variable("rel"), rdf.predicate, variable("p")],
            [variable("rel"), rdf.object   , variable("o")],
            [variable("rel"), rdf.type     , pgo.Edge]
        ]
    );

    const tripleAbleRelations = findTripleAbleRelations(request);

    request = request.filter(dict => tripleAbleRelations.has(concise(dict.p)));

    if (!star) {
        request = request.filter(dict => store.countQuads(dict["rel"], null, null) === 4);
    }

    let r = TripleSed.replace(store, request,
        [
            [variable("s"), variable("p"), variable("o")],
            [N3.DataFactory.quad(variable("s"), variable("p"), variable("o")), rdf.type, pgo.Edge],
        ]
    );

    if (star) {
        TripleSed.toRdfStar(store, r, r1 => r1.binds.rel, r1 => r1.quads[0]);
    }
}


function transformationAttributes(store, star) {
    const variable = N3.DataFactory.variable;

    let request = TripleSed.matchAndBind(store,
        [
            [variable("property")     , rdf.type            , pgo.Property],
            [variable("node")         , variable("property"), variable("propertyValue")],
            [variable("propertyValue"), rdfs.label          , variable("value")]
        ]
    );

    request = TripleSed.filterBinds(request, "value", node => node.termType === "Literal");

    if (!star) {
        request = request.filter(dict => store.countQuads(dict["propertyValue"], null, null) === 1);
    }

    let r = TripleSed.replace(store, request,
        [
            [variable("property")     , rdf.type            , pgo.Property],
            [variable("node")         , variable("property"), variable("value")],
        ]
    );

    if (star) {
        TripleSed.toRdfStar(store, r, r1 => r1.binds.propertyValue, r1 => r1.quads[1]);
    }
}

function removePGO(store) {
    TripleSed.deleteMatches(store, null, null, pgo.Edge);
    TripleSed.deleteMatches(store, null, null, pgo.Node);
    TripleSed.deleteMatches(store, null, null, pgo.Property);
}

const availableTransformations = {
    "RRA"    : store => transformationAttributes(store, false),
    "RRAstar": store => transformationAttributes(store, true),
    "RRR"    : store => transformationRelationship(store, false),
    "RRRstar": store => transformationRelationship(store, true),
    "NoLabel": store => TripleSed.deleteMatches(store, null, rdfs.label, null),
    "NoPGO"  : store => removePGO(store)
};


// ============================================================================

function js_to_store(ar) {
    let builder = new RDFGraphBuilder(
        "http://www.example.org/indiv/", "http://www.example.org/vocab/"
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


let transformations = [];
for (let i = 3 ; i < process.argv.length ; ++i) {
    transformations.push(process.argv[i]);
}

for (let transformation of transformations) {
    const transformer = availableTransformations[transformation];
    transformer(store);
}


const writer = new N3.Writer({ prefixes: prefixes });
store.forEach(quad => writer.addQuad(quad.subject, quad.predicate, quad.object, quad.graph));
writer.end((_error, result) => console.log(result));

console.error(store.size + " triples");
