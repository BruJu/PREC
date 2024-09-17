import DStar from '../dataset/index';

import { allPRECCExclusiveTerms } from "../prec-c/Context";
import TermSet from '@rdfjs/term-set';
import * as RDF from "@rdfjs/types";

import { rdf, prec, pvar } from '../PRECNamespace';

import prsc from '../prsc';
import { termToString } from 'rdf-string';
import precC from '../prec-c';

// =============================================================================

/** List of context types */
export enum ContextType { PRECC, PRSC, Empty, Invalid };

/**
 * Transform the dataset by applying the given context.
 * @param dataset The DStar dataset that contains the quad
 * @param contextQuads The list of quads that are part of the context
 */
export default function applyContext(dataset: DStar, contextQuads: RDF.Quad[]) {
  performObsoleteTermsCheck(contextQuads);

  const contextType = getContextType(contextQuads);

  if (contextType === ContextType.PRECC) {
    applyPRECC(dataset, contextQuads);
  } else if (contextType === ContextType.PRSC) {
    applyPRSC(dataset, contextQuads, true);
  } else if (contextType === ContextType.Empty) {
    // noop
  } else {
    throw Error("The given context mixes PREC-C and PRSC directives");
  }
}

/**
 * Throws if one of the quads contains an obsolete term
 * @param contextQuads List of quads
 */
function performObsoleteTermsCheck(contextQuads: RDF.Quad[]) {
  const forbiddenTerms = hasForbiddenTerms(contextQuads)
  if (forbiddenTerms) {
    const asString = forbiddenTerms.map(term => termToString(term)).join(", ");
    throw Error("The context contains the following forbidden terms: " + asString);
  }
}

/**
 * Check if the quads contains one of the forbidden (obsolete) terms.
 * @param quads The quads to check
 */
function hasForbiddenTerms(quads: RDF.Quad[]): RDF.Term[] | null {
  const forbiddenTerms = new TermSet([
    // Relationship terminology -> use the word edge instead
    prec.RelationshipRule,
    prec.RelationshipTemplate,
    prec.Relationships,
    prec.RelationshipProperties,
    prec.IRIOfRelationshipLabel,
    prec.relationshipIRI,
    pvar.relationshipIRI,
    pvar.relationship,
    // Old type names in PRSC
    prec.prsc_node /* use prec:PRSCNodeRule */,
    prec.prsc_edge /* use prec:PRSCEdgeRule */,
    prec.nodeLabel, prec.edgeLabel, /* use prec:label */
    prec._valueOf, prec.prsc_valueOf, /* use "propertyKey"^^prec:valueOf */
    prec.SubstitutionTerm /* prec:SubstitutionPredicate */,
  ]);

  const seenTerms = new TermSet();

  function findForbiddenTermsInTerm(term: RDF.Term) {
    if (term.termType === 'Quad') {
      findForbiddenTermsInTerm(term.subject);
      findForbiddenTermsInTerm(term.predicate);
      findForbiddenTermsInTerm(term.object);
      findForbiddenTermsInTerm(term.graph);
    } else if (term.termType === 'NamedNode') {
      if (forbiddenTerms.has(term)) {
        seenTerms.add(term);
      }
    } else if (term.termType === 'Literal') {
      findForbiddenTermsInTerm(term.datatype);
    }
  }

  quads.forEach(findForbiddenTermsInTerm);

  if (seenTerms.size > 0) return [...seenTerms.keys()];
  return null;
}

/**
 * Return the type of the context described by the triples: PREC-C, PRSC,
 * empty or invalid.
 * @param contextQuads The context
 * @returns The type of the context
 */
export function getContextType(contextQuads: RDF.Quad[]): ContextType {
  if (contextQuads.length === 0) return ContextType.Empty;

  const prscTypes = new TermSet([prec.PRSCNodeRule, prec.PRSCEdgeRule]); 
  const preccTerms = allPRECCExclusiveTerms();

  preccTerms.predicates.add(prec.mapBlankNodesToPrefix);
  preccTerms.predicates.add(prec.flagState);

  let isPRECC = false;
  let isPRSC = false;

  for (const quad of contextQuads) {
    if (preccTerms.subjects.has(quad.subject)) {
      isPRECC = true;
    }
    
    if (preccTerms.predicates.has(quad.predicate)) {
      isPRECC = true;
    }

    if (quad.predicate.equals(rdf.type)) {
      if (preccTerms.types.has(quad.object)) {
        isPRECC = true;
      }

      if (quad.object.termType === 'NamedNode' && prscTypes.has(quad.object)) {
        isPRSC = true;
      }
    }
  }

  if (isPRECC && isPRSC) return ContextType.Invalid;
  if (isPRECC) return ContextType.PRECC;
  if (isPRSC) return ContextType.PRSC;
  return ContextType.Empty;
}


/**
 * Transform the PREC-0 graph into an idiomatic RDF graph using PRSC
 * @param dataset The PREC-0 graph
 * @param contextQuads The PRSC context
 */
export function applyPRSC(dataset: DStar, contextQuads: RDF.Quad[], obsoleteAreChecked = false) {
  if (!obsoleteAreChecked) performObsoleteTermsCheck(contextQuads)

  const dstar = prsc(dataset, contextQuads);
  dataset.deleteMatches();
  if (dstar !== null) dataset.addAll([...dstar]);
}

/**
 * Transform the PREC-0 graph into an idiomatic RDF-graph using PREC-C
 * @param dataset The PREC-0 graph
 * @param contextQuads The PREC-C context
 */
export function applyPRECC(dataset: DStar, contextQuads: RDF.Quad[]) {
  precC(dataset, contextQuads);
}
