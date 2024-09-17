import * as RDF from "@rdfjs/types";

import DStar from "../dataset";
import {
  prec,
  $literal,
  precValueOf
} from '../PRECNamespace';

import { eventuallyRebuildQuad } from "../rdf/quad-star";
import { PRSCRule } from "./PrscRule";
import { rdfToPREC0 } from "./prsc-reversion";
import { PRSCContext, unwrapContext } from "./PrscContext";
export { PRSCRule };

const pvarPrefix = "http://bruy.at/prec-trans#";


////////////////////////////////////////////////////////////////////////////////
// ==== Structural description graph -> Idiomatic Graph

/**
 * Given a PREC-0 PG and a list of triples that descrives a PRSC context, produce
 * an idiomatic RDF graph
 * @param pg The PREC-0 property graph 
 * @param contextQuads The triples in the context
 * @returns An idiomatic RDF graph produced by applying the context to the PG
 */
export default function applyPRSC(pg: DStar, contextQuads: RDF.Quad[]): DStar {
  const context = unwrapContext(PRSCContext.build(contextQuads));
  return context.apply(pg);
}


////////////////////////////////////////////////////////////////////////////////
// ==== Structural description graph <- Idiomatic Graph

/**
 * From an RDF graph and a list of RDF triples that composes a PRSC context,
 * produce a PG in the format of a PREC-0 graph.
 * 
 * Only reasonnably works if the `contextQuads` describes a PRSC well-behaved
 * context and if `dataset` was produced from the usage of `applyPRSC`.
 * @param dataset The RDF graph to revert to a PREC-0 PG
 * @param contextQuads The RDF triples inside the PRSC context
 * @returns A PREC-0 PG
 */
export function revertPRSC(dataset: DStar, contextQuads: RDF.Quad[]): DStar {
  const context = unwrapContext(PRSCContext.build(contextQuads));
  return rdfToPREC0(dataset, context);
}


/**
 * Characterize the triple
 * 
 * IRI -> IRI
 * Blank Node and pvar -> B (the literal "BlankNode")
 * Literals and Literals datatyped precValueOf -> L (the literal "Literal")
 */
export function characterizeTriple(quad: RDF.Quad) {
  return eventuallyRebuildQuad(quad, term => {
    if (term.termType === 'Literal') {
      return $literal("Literal", precValueOf);
    } else if (term.termType === 'BlankNode') {
      return $literal('BlankNode', prec._placeholder);
    } else if (term.termType === 'NamedNode' && term.value.startsWith(pvarPrefix)) {
      return $literal('BlankNode', prec._placeholder);
    } else {
      return term;
    }
  });
}

////////////////////////////////////////////////////////////////////////////////

/**
 * Give the list of blank nodes inside the given quad
 */
export function extractBnsIn(quad: RDF.Quad): RDF.BlankNode[] {
  let result: RDF.BlankNode[] = [];

  const explore = (term: RDF.Term) => {
    if (term.termType === 'Quad') {
      explore(term.subject);
      explore(term.predicate);
      explore(term.object);
      explore(term.graph);
    } else if (term.termType === 'BlankNode') {
      result.push(term);
    }
  }

  explore(quad);

  return result;
}
