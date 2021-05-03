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

/**
 * Return true if `term` is in `listOfTerms`
 * @param {*} term 
 * @param {Array} listOfTerms 
 * @returns True if the term is in the list of tems
 */
function termIsIn(term, listOfTerms) {
    return listOfTerms.find(t => t.equals(term));
}

/**
 * 
 * @param {Array} quads1 
 * @param {Array} quads2 
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

/**
 * A map that uses object.value as a key and the equal function to check if
 * two keys are actually equals.
 */
class TermDict {
    /** Build an empty `TermDict` */
    constructor() {
        this.map = {};
    }

    /** Return the value stored for key */
    get(key) {
        let list = this.map[key.value];
        if (list === undefined) return undefined;

        for (let term of list) {
            if (term[0].equals(key)) {
                return term[1];
            }
        }

        return undefined;
    }

    /** Set the given value for the given key */
    set(key, value) {
        let list = this.map[key.value];
        if (list === undefined) {
            list = [];
            this.map[key.value] = list;
        }

        for (let term of list) {
            if (term[0].equals(key)) {
                term[1] = value;
                return;
            }
        }

        list.push([key, value]);
    }
}

module.exports = {
    rdfLiteralToValue,
    badToString,
    termIsIn,
    approximateIsomorphism,
    TermDict
};
