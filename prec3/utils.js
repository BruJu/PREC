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
 * (Badly) convert a list of quads into a string
 * @param {*} quads 
 */
function badToString(quads, indent) {
    let s = "";

    function pushTerm(term) {
        if (term.termType === "Quad") {
            s += "<< ";
            push(term, s);
            s += " >>";
        } else if (term.termType == "Literal") {
            s += "\"" + term.value + "\"";
        } else if (term.termType == "NamedNode") {
            s += "<" + term.value + ">";
        } else if (term.termType == "Variable") {
            s += "?" + term.value;
        } else if (term.termType == 'BlankNode') {
            s += "_:" + term.value
        } else {
            s += "UnknownTermType" + term.termType;
        }
    }

    function push(quad) {
        if (Array.isArray(quad)) {
            pushTerm(quad[0]);
            s += " ";
            pushTerm(quad[1]);
            s += " ";
            pushTerm(quad[2]);
        } else {
            pushTerm(quad.subject);
            s += " ";
            pushTerm(quad.predicate);
            s += " ";
            pushTerm(quad.object);
        }
    }

    if (indent === undefined) indent = 0;

    for (let quad of quads) {
        if (s !== "") s += "\n";

        for (let i = 0 ; i != indent ; ++i) s += " ";

        push(quad, s);
    }

    return s;
}


module.exports = {
    rdfLiteralToValue,
    eventuallyRebuildQuad,
    badToString
};

