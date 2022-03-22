import { DataFactory } from 'n3';
import namespace from '@rdfjs/namespace';
import * as RDF from '@rdfjs/types';

const xsd = namespace("http://www.w3.org/2001/XMLSchema#", { factory: DataFactory });


/**
 * Converts an RDF/JS literal to its value. If its type represents a number,
 * it returns a number. Else it returns a literal.
 * @param literal The literal to parse
 * @returns The value contained in the literal. Returns undefined if the term is
 * not a literal.
 */
export function rdfLiteralToValue(literal: RDF.Term): string | number | undefined {
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
export function xsdBoolToBool(term: RDF.Term): boolean | undefined {
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
 * Return true if `term` is in `listOfTerms`
 * @param term The term to search
 * @param listOfTerms The list of terms
 * @returns True if the term is in the list of tems
 */
export function termIsIn(term: RDF.Term, listOfTerms: RDF.Term[]) {
  return listOfTerms.find(t => t.equals(term)) !== undefined;
}
