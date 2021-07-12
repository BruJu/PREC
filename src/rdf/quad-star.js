"use strict";

const N3 = require('n3');

/**
 * @typedef { import("rdf-js").Term } Term
 * @typedef { import("rdf-js").Quad } Quad
 */

/**
 * Returns a quad equals to
 * ```
 *  Quad(
 *    unaryFunction(quad.subject),
 *    unaryFunction(quad.predicate),
 *    unaryFunction(quad.object),
 *    unaryFunction(quad.graph)
 *  )
 * ```
 * 
 * Compared to a naive approach, in some cases this quad returns the passed quad
 * if it would be equal.
 * 
 * @param {Quad} quad Quad to rebuild. Must be of type quad
 * @param {function(Quad): Quad} unaryFunction Function to call to convert an
 * inner term
 */
function eventuallyRebuildQuad(quad, unaryFunction) {
    let elements = [quad.subject, quad.predicate, quad.object, quad.graph];

    let conversion = elements.map(
        e => {
            if (e.termType === 'Quad') return eventuallyRebuildQuad(e, unaryFunction);
            else                       return unaryFunction(e);
        }
    );

    for (let i = 0 ; i != 4 ; ++i) {
        if (elements[i] !== conversion[i]) {
            return N3.DataFactory.quad(
                conversion[0], conversion[1], conversion[2], conversion[3]
            );
        }
    }
    
    return quad;
}

/**
 * Modify the term by replacing its content.
 * 
 * @param {Term} term The term to modify
 * @param {[Term, Term][]} mapping A list of [termReplacement, termToReplace]
 * @returns {Term} the term where the term to replace have been replaced with
 * their counterpart
 */
function remapPatternWithVariables(term, mapping) {
    function remapTerm(t) {
        let dest = mapping.find(e => e[1].equals(t));

        if (dest !== undefined) {
            return dest[0];
        } else if (t.termType !== 'Quad') {
            return t;
        } else {
            return N3.DataFactory.quad(
                remapTerm(t.subject),
                remapTerm(t.predicate),
                remapTerm(t.object),
                remapTerm(t.graph)
            );
        }
    }

    return remapTerm(term);
}

/**
 * Returns true if the term is or contains the searched term.
 * @param {Term} term A RDF/JS term
 * @param {Term} searched The searched RDF/JS terms
 * @returns True if term is or contains `searched`
 */
function containsTerm(term, searched) {
    if (term.equals(searched)) return true;
    if (term.termType !== 'Quad') return false;
    return containsTerm(term.subject  , searched)
        || containsTerm(term.predicate, searched)
        || containsTerm(term.object   , searched)
        || containsTerm(term.graph    , searched);
}

/**
 * Checks if realQuad and patternQuad are equals. `null` and `undefined` are
 * considered wildcards: any term matches it in the pattern quad.
 * 
 * `realQuad` must not contain any wildcard
 * 
 * @param {Quad} realQuad A quad with no wildcards
 * @param {Quad} patternQuad A quad that may contain wildcards
 * @returns {boolean} True if the readQuad matches the patternQuad
 */
function matches(realQuad, patternQuad) {
    for (const position of ['subject', 'predicate', 'object', 'graph']) {
        const rightTerm = patternQuad[position];
        if (rightTerm === null || rightTerm === undefined) {
            continue;
        }

        const leftTerm = realQuad[position];

        if (rightTerm.termType === 'Quad') {
            if (leftTerm.termType !== 'Quad') {
                return false;
            }

            if (!matches(leftTerm, rightTerm)) {
                return false;
            }
        } else {
            if (!leftTerm.equals(rightTerm)) {
                return false;
            }
        }
    }

    return true;
}


module.exports = {
    eventuallyRebuildQuad,
    remapPatternWithVariables,
    containsTerm,
    matches
};
