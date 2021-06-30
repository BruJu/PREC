const N3 = require('n3');
const QuadStar = require('../prec/quad-star.js');

/**
 * @typedef { import("rdf-js").Term } Term
 * @typedef { import("rdf-js").Quad } Quad
 */

/** Return true if the quad contains a nested quad */
function isRdfStarQuad(quad) {
    return quad.subject.termType === 'Quad'
        || quad.predicate.termType === 'Quad'
        || quad.object.termType === 'Quad'
        || quad.graph.termType === 'Quad';
}

/** Return true if `something` is null or undefined */
function isLikeNone(something) {
    return something === null || something === undefined;
}

/**
 * Return the term at the position described by path in the quad
 * 
 * path is an array of 'subject' | 'predicate' | 'object' | 'graph'
 */
function getTermAtPosition(quad, path) {
    let term = quad;
    for (let p of path) term = term[p];
    return term;
}


/**
 * An RDF.JS implementation that stores separately the standard RDF quads and
 * the RDF-star quads.
 * 
 * This implementation also provides methods to replace the quads that matches
 * a certain pattern with quads that match another pattern
 * (see `findFilterReplace`).
 */
class Dataset {
    /**
     * Convert the variables in the given quad to their values found in the
     * `bindings` object.
     * 
     * - Variables found in `quad` are replaced in the returned quad by the
     * value at bindings[variable_name] if present.
     * - If `quad` is an `Array`, a new array is built, by calling recursively
     * this function on every member.
     * 
     * @param {*} bindings A mapping of variable names to their value
     * @param {*} quad The quad to convert, or an `Array` of `quad` (see the
     * description of the method).
     */
    static bindVariables(bindings, quad) {
        if (Array.isArray(quad)) {
            return quad.map(q => Dataset.bindVariables(bindings, q));
        }

        return QuadStar.eventuallyRebuildQuad(quad, term => {
            if (term.termType !== 'Variable')
                return term;

            const variableValue = bindings[term.value];
            return variableValue !== undefined ? variableValue : term;
        });
    }

    // =========================================================================

    /** Build a dataset. If quads are provided, they are added to the dataset. */
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

    /** Parses the given trig star string and add the quads in it */
    addFromTurtleStar(turtleStarContent) {
        let parser = new N3.Parser();
        let quads = parser.parse(turtleStarContent);
        this.addAll(quads);
    }

    // =========================================================================
    // === Dataset Core / Partial Dataset

    /** Return the number of quads in the dataset */
    get size() {
        return this.store.size + this.starQuads.length;
    }

    /** Add the quad to the dataset */
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

    /** Removes the quad from the dataset */
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

    /** Return true if the quad is in the datset */
    has(quad) {
        if (isRdfStarQuad(quad)) {
            return this.starQuads.find(here => here.equals(quad)) !== undefined;
        } else {
            return this.store.countQuads(quad.subject, quad.predicate, quad.object, quad.graph) === 1;
        }
    }

    /**
     * Return a dataset with the quads of this dataset that matches the given
     * filter
     */
    match(subject, predicate, object, graph) {
        return new Dataset(this.getQuads(subject, predicate, object, graph));
    }

    /** Iterates over all the quads of this dataset */
    *[Symbol.iterator]() {
        for (let quad of this.store.getQuads()) {
            yield quad;
        }

        for (let quad of this.starQuads) {
            yield quad;
        }
    }

    /** Calls the function of each of dataset */
    forEach(callback) {
        for (const quad of this) {
            callback(quad);
        }
    }

    /** Add all the quads of the given iterable to this dataset */
    addAll(quads) {
        for (const quad of quads) {
            this.add(quad);
        }
    }
    
    /** Delete all quads that matches the given pattern */
    deleteMatches(subject, predicate, object, graph) {
        let quads = this.getQuads(subject, predicate, object, graph);
        this.removeQuads(quads);
        return this;
    }

    // =========================================================================

    /**
     * Look for every occurrence of term, returning them if they all match an
     * auhtorized pattern.  
     * @param {Term} term The term
     * @param {Quad[]} authorizedPatterns The authorized patterns for quad
     * @returns {Quad[]} The list of every occurences of term in the dataset
     * if all of them matches one of the given pattern. null if at least one
     * does not match any of the patterns
     */
    allUsageOfAre(term, authorizedPatterns) {
        let matches = [];

        function isAuthorized(quad) {
            const x = authorizedPatterns.find(
                pattern => QuadStar.matches(quad, pattern)
            );

            return x !== undefined;
        }

        for (let quads of [
            this.match(term, null, null, null),
            this.match(null, term, null, null),
            this.match(null, null, term, null),
            this.match(null, null, null, term)
        ]) {
            for (let quad of quads) {
                if (isAuthorized(quad)) {
                    matches.push(quad);
                } else {
                    return null;
                }
            }
        }

        for (let quad of this.starQuads) {
            if (QuadStar.containsTerm(term)) {
                if (isAuthorized(quad)) {
                    matches.push(quad);
                } else {
                    return null;
                }
            }
        }

        return matches;
    }

    // =========================================================================
    // ==== Mimic a part of the N3.Store interface

    /** Return an array with all the quads that matches the given filter */
    getQuads(subject, predicate, object, graph) {
        let inStore = this.store.getQuads(subject, predicate, object, graph);

        let inArray = this.starQuads.filter(quad => {
            return (isLikeNone(subject)   || quad.subject  .equals(subject))
                && (isLikeNone(predicate) || quad.predicate.equals(predicate))
                && (isLikeNone(object)    || quad.object   .equals(object))
                && (isLikeNone(graph)     || quad.graph    .equals(graph));
        });

        return [...inStore, ...inArray];
    }

    /** Return an array with every quad that contains a nested triple */
    getRDFStarQuads() {
        return [...this.starQuads];
    }
    
    /** Removes */
    removeQuads(quads) {
        for (const quad of quads) {
            this.delete(quad);
        }
    }

    // =========================================================================
    // === Match and replace with bindings

    /**
     * Look for every possible instanciation of the varaibles in the pattern.
     * 
     * For example, if the dataset contains the following quads:
     * ```
     * :a :b :c .
     * :a :b "d" .
     * :e :f :g .
     * ```
     * 
     * And pattern is the following quad : `?s :b ?o `
     * 
     * The returned value will be:
     * ```
     * [
     *   { 's': NamedNode(:a); 'o': NamedNode(:c), '@quad': Quad(:a :b :c ) },
     *   { 's': NamedNode(:a); 'o': Literal("d") , '@quad': Quad(:a :b "d") }
     * ]
     * ```
     * 
     * @param {*} pattern A quad that contains variables
     */
    matchPattern(pattern) {
        let extractVariableEvaluationsPaths = [];
        let extractVariableEvaluations = function(quad) {
            let d = {};

            d["@quad"] = quad;

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

    /**
     * Replace the quads that match a certain pattern with quads that matches
     * a new pattern.
     * 
     * The source pattern, `source`, is a list of quads that can contain
     * variables. All (source) instantiation of the variables will be looked
     * for.
     * 
     * Then, the condition patterns will be checked. A condntion pattern is a
     * list of quads, that can contain variables. For each source instantation,
     * at least one instantiation of the condition patterns must exist. The
     * variables used in a condition patterns that are also used in the source
     * pattern are bounded, but every condition pattern is independant (if a
     * condition pattern uses the non bound variable ?s and another also uses
     * ?s, the values can be different)
     * 
     * Finally, with the known source variables instantiation, and for every
     * source instantiation that matches the condition, the quads matched during
     * the source instantiation processed will be removed and replaced with the
     * destination pattern, in which the variables have been instantatiated.
     * 
     * *Example*:
     * 
     * If we have this dataset :
     * ```
     * ex:subject ex:predicate ex:oldobject .
     * ex:subject   rdf:type _:bn1 . _:bn1 rdfs:label "Subject"   .
     * ex:predicate rdf:type _:bn2 . _:bn2 rdfs:label "Predicate" .
     * ```
     * 
     * The call to
     * ```
     * findFilterPattern(
     *   [ ?s ?p ex:oldobject ],
     *   [
     *     [ ?s rdf:type ?bn . ?bn rdfs:label "Subject" ]
     *     [ ?p rdf:type ?bn . ?bn rdfs:label "Predicate" ]
     *   ],
     *   [ ?p ?s ex:object ]
     * )
     * ```
     * 
     * Will :
     * - Bind `?s` to `ex:subject` and `?p` to `ex:predicate`
     * - Successfully check the conditions:
     *    - The first condition matches the bound variable `?s` to `ex:subject`,
     * and find the successfull match `?bn = _:bn1`
     *    - The second condition matches the bound variables `?p` to
     * `ex:predicate`, and find the succesfull match `?bn = _:bn2` (it ignores
     * the fact that in the other condition, `?bn` had a different value)
     * - Instanciate the destination pattern, to delete from the dataset
     * `ex:s ex:p ex:oldobject` and add `ex:p ex:s ex:object` to the dataset.
     * 
     * @param {*} source The source pattern, an array of quads
     * @param {*} conditions The conditions pattern, an array of array of quads
     * @param {*} destination The destination pattern, an array of quads
     * @returns The result of `matchAndBind` on `source`
     */
    findFilterReplace(source, conditions, destination) {
        // Find
        let binds = this.matchAndBind(source);

        // Filter
        binds = binds.filter(bind => {
                const mappedConditions = Dataset.bindVariables(bind, conditions);
                return !mappedConditions.find(condition => this.matchAndBind(condition).length === 0)
            });
        
        // Replace
        this._replaceFromBindings(binds, destination);

        return binds;
    }

    /**
     * Search the given pattern in the dataset and returns the list of bindable
     * values for each variable.
     * 
     * The pattern is a list of quads. The terms used in the quads can be either
     * proper RDF terms or variables.
     * 
     * Returns a list of dictionaries in the form:
     * {
     *  "@quad": list of involved quads,
     *  variableName: the binded quad for each variable
     * }
     * 
     * @param {*} pattern The pattern, a list of quads that may contain
     * variables.
     */
    matchAndBind(patterns) {
        return this._matchAndBind(patterns, 0, [ { "@quads": [] }]);
    }

    /**
     * Recursive implementation of matchAndBind, that process
     * `patterns[iPattern:]`
     */
    _matchAndBind(patterns, iPattern, results) {
        if (iPattern == patterns.length) {
            return results;
        }

        const pattern = patterns[iPattern];

        const newBindings = [];

        for (const knownResult of results) {
            const bindedPattern = Dataset.bindVariables(knownResult, pattern);
            const bindings = this.matchPattern(bindedPattern);

            for (let binding of bindings) {
                const r = { "@quads": [...knownResult['@quads'], binding['@quad']] };

                for (let x in knownResult) {
                    if (x === '@quads') continue;
                    r[x] = knownResult[x];
                }

                for (let x in binding) {
                    if (x === '@quad') continue;
                    r[x] = binding[x];
                }

                newBindings.push(r);
            }
        }

        return this._matchAndBind(patterns, iPattern + 1, newBindings);
    }
    
    /**
     * Replace all quads found using a pattern with `matchAndBind` from the
     * dataset by a new pattern.
     * The new pattern is a list of pattern quads, that can use either fixed
     * terms or variables that were present in the request pattern.
     * 
     * @param {*} bindings The result of `matchAndBind`
     * @param {*} destinationPatterns The new pattern that is used to replaces
     * the matched quads.
     */
    _replaceFromBindings(bindings, destinationPatterns) {
        bindings.forEach(binding => this.replaceOneBinding(binding, destinationPatterns));
    }
    
    /**
     * Replace one match result with the new pattern
     * 
     * @param {*} bindings A member of the list returned by `matchAndBind`
     * @param {*} destinationPatterns The new pattern to replace the quads with
     * @returns 
     */
    replaceOneBinding(bindings, destinationPatterns) {
        bindings['@quads'].forEach(quad => this.delete(quad));
        
        for (const destinationPattern of destinationPatterns) {
            this.add(Dataset.bindVariables(bindings, destinationPattern));
        }
    }

    /**
     * 
     * 
     * The matched patterns must be independant (the quads that contribute
     * to a binding must be not contribute to any other biding)
     * 
     * It is evil because it break referentially opaque semantic and can throw.
     * 
     * @param {*} initialBindings 
     * @param {*} sourcePattern 
     * @param {*} destinationPattern 
     */
    evilFindAndReplace(initialBindings, sourcePattern, destinationPattern) {
        // The nice part
        sourcePattern      = Dataset.bindVariables(initialBindings, sourcePattern     );
        destinationPattern = Dataset.bindVariables(initialBindings, destinationPattern);

        let newBindings = this.matchAndBind(sourcePattern);
        this._replaceFromBindings(newBindings, destinationPattern);

        let deletionList = [];
        let additionList = [];

        // The evil part
        for (const binding of newBindings) {
            for (let i = 0 ; i != binding['@quads'].length ; ++i) {
                const quad = binding['@quads'][i];
                let matches = this.starQuads.filter(q => QuadStar.containsTerm(q, quad))

                if (matches.length === 0) continue;

                let associated = IntrusiveFindAndReplace.findAssociatedQuad(sourcePattern[i], destinationPattern);
                if (associated === undefined) {
                    throw Error(
                        `Requires the associated quad for ${JSON.stringify(sourcePattern[i])}
                        but it does not exist in ${JSON.stringify(destinationPattern)}`
                    );
                }

                deletionList.push(...matches);
                additionList.push(...matches.map(match => IntrusiveFindAndReplace.rewriteQuad(match, quad, associated.subject, binding)));
            }
        }

        this.removeQuads(deletionList);
        this.addAll(additionList);
    }
};

/* Helper function for an intrusive find and replace */
const IntrusiveFindAndReplace = {
    /**
     * Find the associated quad to source in possibleDestinations.
     * 
     * An associated term is a term that shares the same predicate, object
     * and graph.
     * @param {*} source An RDF/JS term
     * @param {any[]} possibleDestinations An array of RDF/JS term
     * @returns The associated term if it exists, or undefined
     */
    findAssociatedQuad: function(source, possibleDestinations) {
        return possibleDestinations.find(
            quad => source.predicate.equals(quad.predicate)
                && source.object.equals(quad.object)
                && source.graph.equals(quad.graph)
        );
    },

    rewriteQuad: function(match, quad, associatedSubject, binding) {
        if (associatedSubject.termType === 'Variable' && binding[associatedSubject.value] !== undefined) {
            associatedSubject = binding[associatedSubject.value];
        }

        function remapTerm(term) {
            if (term.equals(quad)) {
                return N3.DataFactory.quad(
                    associatedSubject,
                    term.predicate,
                    term.object,
                    term.graph,
                );
            } else if (term.termType === 'Quad') {
                return N3.DataFactory.quad(
                    remapTerm(term.subject),
                    remapTerm(term.predicate),
                    remapTerm(term.object),
                    remapTerm(term.graph),
                );
            } else {
                return term;
            }
        }

        return remapTerm(match);
    }
};

module.exports = Dataset;
