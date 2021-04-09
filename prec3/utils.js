const N3 = require('n3');
const namespace = require('@rdfjs/namespace');
const xsd = namespace("http://www.w3.org/2001/XMLSchema#", N3.DataFactory);

/**
 * Converts a RDF.JS literal to its value. If its type represents a number,
 * it returns a number. Else it returns a literal.
 */
function rdfLiteralToValue(literal) {
    if (literal.termType !== "Literal") return undefined;

    if (literal.datatype.equals(xsd.integer)) {
        return parseInt(literal.value);
    } else if (literal.datatype.equals(xsd.double)) {
        return parseFloat(literal.value);
    } else {
        return literal.value;
    }
}


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
let level = 0;
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
            --level;
            return N3.DataFactory.quad(
                conversion[0], conversion[1], conversion[2], conversion[3]
            );
        }
    }
    
    return quad;
}


module.exports = {
    rdfLiteralToValue,
    eventuallyRebuildQuad
};

