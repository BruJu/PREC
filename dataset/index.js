const N3 = require('n3');


function isRdfStarQuad(quad) {
    return quad.subject.termType === 'Quad'
        || quad.predicate.termType === 'Quad'
        || quad.object.termType === 'Quad'
        || quad.graph.termType === 'Quad';
}

function isLikeNone(something) {
    return something === null || something === undefined;
}

function getTermAtPosition(quad, path) {
    let term = quad;
    for (let p of path) term = term[p];
    return term;
}

class Dataset {
    constructor(quads) {
        // A store that contains the non rdf star quads
        this.store = new N3.Store();
        // A list of RDF-star quads
        this.starQuads = [];

        if (quads !== undefined) {
            for (const quad of quads) {
                this.add(quad);
            }
        }
    }

    addFromTurtleStar(turtleStarContent) {
        let parser = new N3.Parser();
        let quads = parser.parse(turtleStarContent);
        let self = this;
        quads.forEach(q => self.add(q));
    }

    // =========================================================================
    // === Dataset Core

    get size() {
        return this.store.size + this.starQuads.length;
    }

    add(quad) {
        if (isRdfStarQuad(quad)) {
            if (!this.has(quad)) {
                this.starQuads.push(quad);
            }
        } else {
            this.store.addQuad(quad);
        }

        return this;
    }

    delete(quad) {
        if (isRdfStarQuad(quad)) {
            let q = this.starQuads.findIndex(here => quad.equals(here));
            if (q !== -1) {
                this.starQuads.splice(q, 1);
            }
        } else {
            this.store.removeQuad(quad.subject, quad.predicate, quad.object, quad.graph);
        }

        return this;
    }

    has(quad) {
        if (isRdfStarQuad(quad)) {
            return this.starQuads.find(here => here.equals(quad)) !== undefined;
        } else {
            return this.store.countQuads(quad.subject, quad.predicate, quad.object, quad.graph) === 1;
        }
    }

    match(subject, predicate, object, graph) {
        let inStore = this.store.getQuads(subject, predicate, object, graph);

        let inArray = this.starQuads.filter(quad => {
            return (isLikeNone(subject)   || quad.subject  .equals(subject))
                && (isLikeNone(predicate) || quad.predicate.equals(predicate))
                && (isLikeNone(object)    || quad.object   .equals(object))
                && (isLikeNone(graph)     || quad.graph    .equals(graph));
        });

        return new Dataset([...inStore, ...inArray]);
    }

    *[Symbol.iterator]() {
        for (let quad of this.store.getQuads()) {
            yield quad;
        }

        for (let quad of this.starQuads) {
            yield quad;
        }
    }

    // =========================================================================
    // === Match and replace with bindings

    /**
     * 
     * @param {*} pattern A quad that contains variables
     */
    matchPattern(pattern) {
        let extractVariableEvaluationsPaths = [];
        let extractVariableEvaluations = function(quad) {
            let d = {};

            d["@Quads"] = [quad];

            for (let path of extractVariableEvaluationsPaths) {
                d[path.variable] = getTermAtPosition(quad, path.path);
            }

            return d;
        }

        let extraFilterExpected = [];
        let extraFilter = function(quad) {
            for (let expected of extraFilterExpected) {
                let term = getTermAtPosition(quad, expected.path);
                if (!term.equals(expected.term)) return false;
            }

            return true;
        }

        function decomposeNested(term, path) {
            if (term.termType === 'Variable') {
                extractVariableEvaluationsPaths.push({
                    variable: term.value,
                    path: path
                });
                return null;
            } else if (term.termType === 'Quad') {
                let s = decomposeNested(term.subject  , [...path, 'subject'  ]);
                let p = decomposeNested(term.predicate, [...path, 'predicate']);
                let o = decomposeNested(term.object   , [...path, 'object'   ]);
                let g = decomposeNested(term.graph    , [...path, 'graph'    ]);

                if (s === null || p === null || o === null || g === null) {
                    return null;
                }

                return term;
            } else {
                if (path.length !== 1)
                    extraFilterExpected.push({term, path});
                return term;
            }
        }

        let sSearch = decomposeNested(pattern.subject  , ['subject'  ]);
        let pSearch = decomposeNested(pattern.predicate, ['predicate']);
        let oSearch = decomposeNested(pattern.object   , ['object'   ]);
        let gSearch = decomposeNested(pattern.graph    , ['graph'    ]);

        let storeQuads = this.store.getQuads(sSearch, pSearch, oSearch, gSearch);

        let starQuads = this.starQuads.filter(quad => {
            if (sSearch !== null && !sSearch.equals(quad.subject  )) return false;
            if (pSearch !== null && !pSearch.equals(quad.predicate)) return false;
            if (oSearch !== null && !oSearch.equals(quad.object   )) return false;
            if (gSearch !== null && !gSearch.equals(quad.graph    )) return false;
            return true;
        });

        return [...storeQuads, ...starQuads]
            .filter(extraFilter)
            .map(extractVariableEvaluations);
    }

    matchArrayPattern(arrayPattern) {



    }
};




module.exports = Dataset;
