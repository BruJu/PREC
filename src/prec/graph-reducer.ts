import { DataFactory } from 'n3';
import DStar from '../dataset/index';

import Context, { allPRECCExclusiveTerms } from "../prec-c/Context";
import * as QuadStar from '../rdf/quad-star';
import TermSet from '@rdfjs/term-set';
import * as RDF from "@rdfjs/types";

import { rdf, pgo, prec, $defaultGraph, pvar } from '../PRECNamespace';

import prsc from '../prsc/PrscContext';
import { termToString } from 'rdf-string';

// =============================================================================

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
  const context = new Context(contextQuads);

  // -- Blank nodes transformation
  for (let typeOfNode in context.blankNodeMapping) {
    blankNodeMapping(
      dataset,
      DataFactory.namedNode(typeOfNode),
      context.blankNodeMapping[typeOfNode]
    );
  }

  // -- Map generated IRI to existing IRIs + apply the templates
  const newDataset = ruleBasedProduction(dataset, context);
  dataset.deleteMatches();
  dataset.addAll(newDataset.getQuads());

  // -- Remove provenance information if they are not required by the user
  if (context.keepProvenance === false) removePGO(dataset);
}

/**
 * Build a new dataset by translating the PREC-0 triples in the source `dataset`
 * according to the rules described in the passed `context`.
 * @param dataset The source dataset
 * @param context The context
 * @returns The new dataset 
 */
function ruleBasedProduction(dataset: DStar, context: Context): DStar {
  context.produceMarks(dataset);
  
  const newDataset = new DStar();

  const preservedLabels = new TermSet<RDF.Term>();
  
  for (const entityManager of context.entityManagers) {
    const ruleType = entityManager.ruleset;

    for (const mark of dataset.getQuads(null, ruleType.mark, null, $defaultGraph)) {
      const ts = ruleType.applyMark(newDataset, mark, dataset, context);
      ts.forEach(t => preservedLabels.add(t));
    }
  }

  preservedLabels.forEach(label => newDataset.addAll(dataset.getQuads(label)));
  
  // As it is impossible to write a rule that catches a node without any label
  // and property, we add back the nodes here
  newDataset.addAll(dataset.getQuads(null, rdf.type, pgo.Node, $defaultGraph));

  return newDataset;
}

// =============================================================================
// =============================================================================

// ==== Blank Node Mapping

/**
 * Transform the blank nodes of the given type to named nodes, by appending to
 * the given prefix the current name of the blank node.
 * @param dataset The dataset that contains the quads
 * @param typeOfMappedNodes The type of the IRIs to map
 * @param prefixIRI The prefix used
 */
function blankNodeMapping(dataset: DStar, typeOfMappedNodes: RDF.Term, prefixIRI: string) {
  let remapping: {[blankNodeName: string]: RDF.NamedNode} = {};

  dataset.getQuads(null, rdf.type, typeOfMappedNodes, $defaultGraph)
    .filter(quad => quad.subject.termType === "BlankNode")
    .map(quad => quad.subject.value)
    .forEach(blankNodeValue => remapping[blankNodeValue] = DataFactory.namedNode(prefixIRI + blankNodeValue))
  
  let newContent = dataset.getQuads().map(quad => _quadBNMap(remapping, quad));
  
  dataset.removeQuads(dataset.getQuads());
  dataset.addAll(newContent);
}

/**
 * Provided a mapping blank node value => named node, maps the quad to another
 * quad, in which every blank node in the mapping is mapped to the named node
 */
function _quadBNMap(map: {[blankNodeName: string]: RDF.NamedNode}, quad: RDF.Quad): RDF.Quad {
  return QuadStar.eventuallyRebuildQuad(quad, term => {
    if (term.termType === "BlankNode") {
      let mappedTo = map[term.value];
      if (mappedTo === undefined) return term;
      return mappedTo;
    } else {
      return term;
    }
  });
}


// ==== AG

/**
 * Deletes every occurrence of pgo:Edge pgo:Node, prec:PropertyKey and prec:PropertyKeyValue.
 * 
 * While the PGO ontology is usefull to describe the PG structure, and to
 * specify the provenance of the data, some user may want to discard these
 * provenance information.
 * @param dataset The dataset 
 */
function removePGO(dataset: DStar) {
    dataset.deleteMatches(null, rdf.type, pgo.Edge             , $defaultGraph);
    dataset.deleteMatches(null, rdf.type, pgo.Node             , $defaultGraph);
    dataset.deleteMatches(null, rdf.type, prec.PropertyKey     , $defaultGraph);
    dataset.deleteMatches(null, rdf.type, prec.PropertyKeyValue, $defaultGraph);
}
