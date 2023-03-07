import * as RDF from "@rdfjs/types";
import { prec, pvar } from '../PRECNamespace';


/** A small TermMap backed by an array */
export class SmallTermMap {
  private pairs: { key: RDF.Term, value: RDF.Term }[] = [];

  tryAdd(key: RDF.Term, value: RDF.Term): boolean {
    const it = this.pairs.find(pair => pair.key.equals(key));
    if (it === undefined) {
      this.pairs.push({ key, value });
      return true;
    } else {
      return it.value.equals(value);
    }
  }

  get(key: RDF.Term): RDF.Term | undefined {
    const it = this.pairs.find(pair => pair.key.equals(key));
    return it !== undefined ? it.value : undefined;
  }
}

/**
 * Compute an affectation of the placeholders in the template triple by using
 * the terms in the data triple.
 * @param template The template triple
 * @param data The data triple
 * @returns An affectation of the placeholders (pvar and literal of datatype
 * prec:valueOf) in the template triple with the terms in the data triple, or
 * null if not possible.
 */
export function computeAffectation(template: RDF.Term, data: RDF.Term): SmallTermMap | null {
  const variableValues = new SmallTermMap();
  const r = computeAffectationInPlace(variableValues, template, data);
  return r ? variableValues : null;
}

function computeAffectationInPlace(variablesState: SmallTermMap, template: RDF.Term, data: RDF.Term): boolean {
  if (template.termType === 'DefaultGraph') {
    // Data must be the default graph
    return template.equals(data);
  }

  if (template.termType === 'Literal') {
    // TODO: data could also possibly be an rdf:list of literals
    if (data.termType !== 'Literal') return false;

    if (template.datatype.equals(prec._valueOf)) {
      // precValueOf -> Literal (already checked) + consistent
      return variablesState.tryAdd(template, data);
    } else {
      return template.equals(data);
    }
  }

  if (template.termType === 'NamedNode') {
    // pvar:self/node/edge/source/destination -> Blank Node + consistent
    if (template.equals(pvar.self)
      || template.equals(pvar.node)
      || template.equals(pvar.edge)) {
      if (data.termType !== 'BlankNode') return false;
      return variablesState.tryAdd(pvar.self, data);
    } else if (template.equals(pvar.source)) {
      if (data.termType !== 'BlankNode') return false;
      return variablesState.tryAdd(pvar.source, data);
    } else if (template.equals(pvar.destination)) {
      if (data.termType !== 'BlankNode') return false;
      return variablesState.tryAdd(pvar.destination, data);
    } else {
      // Same IRI
      return template.equals(data);
    }
  }

  if (template.termType === 'Quad') {
    if (data.termType !== 'Quad') return false;

    // Consistent nested triples
    return computeAffectationInPlace(variablesState, template.subject, data.subject)
      && computeAffectationInPlace(variablesState, template.predicate, data.predicate)
      && computeAffectationInPlace(variablesState, template.object, data.object)
      && computeAffectationInPlace(variablesState, template.graph, data.graph);
  }

  // Template's termType is blankNode or variable -> both are invalid
  return false;
}
