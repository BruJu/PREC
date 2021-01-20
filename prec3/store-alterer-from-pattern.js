"use strict";

//! I was too lazy to learn how to use another Triple Pattern Matching and
//! Replacement library, let alone find one that is not async await heavy,
//! so I built one...

const DataFactory = require('n3').DataFactory;
const variable = DataFactory.variable;

/**
 * Converts a term into :
 * - Its value if it is a bound variable
 * - `undefined` if it is an unbound variable
 * - The term itself if every other cases.
 * 
 * Quads that contains variables have their components converted.
 * 
 * @param {*} term The term to convert
 * @param {*} binded A mapping variable -> known value
 */
function forMatch(term, binded) {
    if (term.termType == "Quad") {
        let s = forMatch(term.subject, binded);
        let p = forMatch(term.predicate, binded);
        let o = forMatch(term.object, binded);
        let g = term.graph;

        return DataFactory.quad(s, p, o, g);
    }

    if (term.termType !== "Variable") return term;
    return binded[term.value];
}

/**
 * If `searched` is an RDF.Variable, binds the value of `searched`
 * to `result` in the `bindings` mapping.
 * @param {*} bindings The mapping of known bound values.
 * @param {*} searched The term from the pattern.
 * @param {*} result The term returned by the match operation.
 */
function addBind(bindings, searched, result) {
    if (searched.termType === "Variable") {
        bindings[searched.value] = result;
    }
}

function filterBinds(result, bindedName, predicate) {
    return result.filter(dict => predicate(dict[bindedName]));
}

/**
 * Replace all quads found using a pattern from the store by a new pattern.
 * The new pattern is a list of triple pattern, that can use either fixed terms
 * or variables that were present in the request pattern.
 * 
 * @param {*} store The store to modify
 * @param {*} foundBindings The result of `matchAndBind`
 * @param {*} newPattern The new pattern that is used to replaces the matched
 * quads.
 */
function replace(store, foundBindings, newPattern) {
    let r = [];

    for (let binds of foundBindings) {
        r.push(replaceOneBinding(store, binds, newPattern));
    }

    return r;
}

function replaceOneBinding(store, binds, newPattern) {
    store.removeQuads(binds["@quads"]);

    const r = { "binds": binds, "quads": [] };

    for (const newPattern1 of newPattern) {
        const newQuad = DataFactory.quad(
            forMatch(newPattern1[0], binds),
            forMatch(newPattern1[1], binds),
            forMatch(newPattern1[2], binds),
        );

        r.quads.push(newQuad);
        store.addQuad(newQuad);
    }

    return r;
}

function toRdfStar(store, replacementResults, nodeGetter, quadGetter) {
    for (const replacementResult of replacementResults) {
        const oldNode = nodeGetter(replacementResult);
        const newQuad = quadGetter(replacementResult);

        const oldAnnotations = matchAndBind(store,
            [[oldNode, DataFactory.variable("RDFSTAR__p"), DataFactory.variable("RDFSTAR__o")]]
        );

        replace(store, oldAnnotations,
            [[newQuad, DataFactory.variable("RDFSTAR__p"), DataFactory.variable("RDFSTAR__o")]]
        );
    }
}

function deleteMatches(store, s, p, o) {
    let x = "_";
    function m(term) {
        if (term == null || term == undefined) {
            x = x + "_";
            return DataFactory.variable(x);
        } else {
            return term;
        }
    }

    let request = matchAndBind(store, [[m(s), m(p), m(o)]]);
    replace(store, request, []);
}

function _matchAndBind(store, patterns, iPattern, results) {
    if (iPattern == patterns.length) {
        return results;
    }

    const pattern = patterns[iPattern];

    const newResults = [];

    for (const oldResult of results) {
        const quads = store.getQuads(
            forMatch(pattern[0], oldResult),
            forMatch(pattern[1], oldResult),
            forMatch(pattern[2], oldResult)
        );

        for (let quad of quads) {
            const r = { "@quads": [...oldResult["@quads"], quad] };

            for (let x in oldResult) {
                if (x === "@quads") continue;
                r[x] = oldResult[x];
            }

            addBind(r, pattern[0], quad.subject);
            addBind(r, pattern[1], quad.predicate);
            addBind(r, pattern[2], quad.object);

            newResults.push(r);
        }
    }

    return _matchAndBind(store, patterns, iPattern + 1, newResults);
}

/**
 * Search the given pattern in the store and returns the list of bindable
 * values for each variable.
 * 
 * The pattern is a list of sub patterns. A sub pattern is an array of three
 * RDF.JS terms. The terms can be either proper RDF terms or variables.
 * 
 * 
 * Returns a list of dictionaries in the form:
 * {
 *  "@quad": list of involved quads,
 *  variableName: the binded quad for each variable
 * }
 * 
 * @param {*} store The store
 * @param {*} pattern The pattern, a list of arrays of 3 terms.
 */
function matchAndBind(store, pattern) {
    return _matchAndBind(store, pattern, 0, [ { "@quads": [] } ]);
}

function directReplace(store, source, destination) {
    const s = matchAndBind(store, source);
    return replace(store, s, destination);
}

function substitute(store, source, destination) {
    const variable = DataFactory.variable;

    console.log(source);
    console.log(destination);
    
    directReplace(
        store,
        [[source, variable("p"), variable("o")]],
        [[destination, variable("p"), variable("o")]]
    );

    directReplace(
        store,
        [[variable("s"), source, variable("o")]],
        [[variable("s"), destination, variable("o")]]
    );

    directReplace(
        store,
        [[variable("s"), variable("p"), source]],
        [[variable("s"), variable("p"), destination]]
    );
}

function _modify_pattern(pattern, sourceNode, destinationNode) {
    return pattern.map(
        list_of_terms => list_of_terms.map(
            term => term.equals(sourceNode) ? destinationNode : term
        )
    );
}

/**
 * Extract the values from a recursive pattern (for example every value
 * from an RDF List)
 * 
 * Returns null if at some point, the structure was not valid (exactly one
 * match was not found for the pattern)
 * 
 * @param {*} store The store
 * @param {*} beginNode The first node of the list
 * @param {*} recursivePattern The pattern to find the next element and the
 * next node
 * @param {*} endNode The final node value
 */
function extractRecursive(store, beginNode, recursivePattern, endNode) {
    let listedNodes = [];

    let currentNode = beginNode;
    while (!currentNode.equals(endNode)) {
        // We need to map the recursive pattern to a pattern (by replacing v with current node)
        let pattern = _modify_pattern(recursivePattern, variable("(R) current"), currentNode)

        let r = matchAndBind(store, pattern);

        if (r.length != 1) {
            // do something
            console.error(r);
            return null;
        }

        r = r[0];

        listedNodes.push(r["value"]); // ?
        currentNode = r["(R) next"];
    }

    return listedNodes;
}

module.exports = {
    forMatch: forMatch,
    addBind: addBind,
    replace: replace,
    replaceOneBinding: replaceOneBinding,
    deleteMatches: deleteMatches,
    matchAndBind: matchAndBind,
    toRdfStar: toRdfStar,
    filterBinds: filterBinds,
    directReplace: directReplace,
    substitute: substitute,
    extractRecursive: extractRecursive
};
