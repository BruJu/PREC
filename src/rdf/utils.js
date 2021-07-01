const N3 = require('n3');
const namespace = require('@rdfjs/namespace');
const xsd = namespace("http://www.w3.org/2001/XMLSchema#", N3.DataFactory);


/**
 * @typedef { import("rdf-js").Term } Term
 * @typedef { import("rdf-js").Quad } Quad
 */

/**
 * Converts an RDF/JS literal to its value. If its type represents a number,
 * it returns a number. Else it returns a literal.
 * @param {Term} literal The literal to parse
 * @returns {number|string|undefined} The value contained in the literal.
 * Returns undefined if the term is not a literal.
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
 * Converts the term into its boolean value. Return undefined if it's not a
 * valid boolean
 * @param {Term} term The term to convert to the boolean
 * @returns {boolean|undefined} The value of the boolean, or undefined if not
 * a valid boolean
 */
function xsdBoolToBool(term) {
    if (term.termType !== "Literal" || !xsd.boolean.equals(term.datatype)) {
        return undefined;
    }

    if (term.value === "true") {
        return true;
    } else if (term.value === "false") {
        return false;
    } else {
        return undefined;
    }
}

/**
 * (Badly) convert a list of quads into a string
 * @param {Quad[]} quads 
 * @param {number} indent
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

/**
 * Return true if `term` is in `listOfTerms`
 * @param {Term} term 
 * @param {Array} listOfTerms 
 * @returns True if the term is in the list of tems
 */
function termIsIn(term, listOfTerms) {
    return listOfTerms.find(t => t.equals(term));
}

/**
 * 
 * @param {Quad[]} quads1 
 * @param {Quad[]} quads2 
 * @returns 
 */
function approximateIsomorphism(quads1, quads2) {
    function makeBaseR(quads) {
        let r = [];
        quads.forEach(q => r.push(undefined));
        return r;
    }

    let r1 = makeBaseR(quads1);
    let r2 = makeBaseR(quads2);

    // First step: equal quads
    for (let i1 = 0 ; i1 != quads1.length ; ++i1) {
        let i2 = quads2.findIndex(q2 => quads1[i1].equals(q2));

        if (i2 !== -1) {
            r1[i1] = i2;
            r2[i2] = i1;
        }
    }

    // Second step: "Well formed" blank node equality
    // TODO: find a way to have some blank node isomorphism

    return [r1, r2];
}

module.exports = {
    rdfLiteralToValue,
    xsdBoolToBool,
    badToString,
    termIsIn,
    approximateIsomorphism
};
