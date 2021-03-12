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


module.exports = {
    rdfLiteralToValue
};

