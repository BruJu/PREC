"use strict";

const N3 = require('n3');

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
 * @param {*} quad Quad to rebuild. Must be of type quad
 * @param {*} unaryFunction Function to call to convert an inner term
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
 * 
 * @param {*} term 
 * @param {*} mapping A list of [termReplacement, termToReplace]
 * @returns 
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
 * 
 * @param {*} term A RDF/JS term
 * @param {*} searched A list of RDF/JS terms
 * @returns True if term is or contains a term in `searched`
 */
function containsTerm(term, searched) {
    if (term.equals(searched)) return true;
    if (term.termType !== 'Quad') return false;
    return containsTerm(term.subject  , searched)
        || containsTerm(term.predicate, searched)
        || containsTerm(term.object   , searched)
        || containsTerm(term.graph    , searched);
}


module.exports = {
    eventuallyRebuildQuad,
    remapPatternWithVariables,
    containsTerm
};
