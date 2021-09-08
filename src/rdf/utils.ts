import { DataFactory } from 'n3';
import namespace from '@rdfjs/namespace';
import { Term, Quad, BaseQuad } from 'rdf-js';

const xsd = namespace("http://www.w3.org/2001/XMLSchema#", { factory: DataFactory });


/**
 * Converts an RDF/JS literal to its value. If its type represents a number,
 * it returns a number. Else it returns a literal.
 * @param literal The literal to parse
 * @returns The value contained in the literal. Returns undefined if the term is
 * not a literal.
 */
export function rdfLiteralToValue(literal: Term): string | number | undefined {
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
 * @param term The term to convert to the boolean
 * @returns The value of the boolean, or undefined if not a valid boolean
 */
export function xsdBoolToBool(term: Term): boolean | undefined {
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
 * @param quads The list of quads to convert
 * @param indent Number of spaces that prefixes each line
 */
export function badToString(quads: Quad[], indent: number = 0): string {
  let s = "";

  function pushTerm(term: Term) {
    if (term.termType === "Quad") {
      s += "<< ";
      push(term);
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

  function push(quad: BaseQuad) {
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

  let prefix = "";
  for (let i = 0; i != indent; ++i) prefix += " ";

  for (let quad of quads) {
    if (s !== "") s += "\n";
    s += prefix;

    push(quad);
  }

  return s;
}

/**
 * Return true if `term` is in `listOfTerms`
 * @param term The term to search
 * @param listOfTerms The list of terms
 * @returns True if the term is in the list of tems
 */
export function termIsIn(term: Term, listOfTerms: Term[]) {
  return listOfTerms.find(t => t.equals(term)) !== undefined;
}

/**
 * Tries to build an approximation of the isomorphism.
 * @param {Quad[]} quads1 
 * @param {Quad[]} quads2 
 * @returns A list of two list of numbers. For each list, the ith member is the
 * position of the ith quad in the other list of quads.
 * 
 * For example [1, undefined], [undefined, 0, undefined] means that the 0th
 * quad of quads1 is the 1st quad of quads2, and the others quads are not
 * in the other list of quads.
 */
export function approximateIsomorphism(quads1: Quad[], quads2: Quad[]) {
  function makeBaseR(quads: Quad[]): (number | undefined)[] {
    return quads.map(_ => undefined);
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
