import * as RDF from "@rdfjs/types";
import TermMap from "@rdfjs/term-map";
import TermSet from "@rdfjs/term-set";
import DStar from "../dataset";
import { canTemplateProduceData, extractBnsIn, PRSCRule } from "./PrscContext";
import { pvar, $blankNode, $quad } from '../PRECNamespace';
import * as QuadStar from '../rdf/quad-star';


/** A pair with a rule and (one of) its signature triple. */
export type SignatureTripleOf = {
  rule: PRSCRule;
  signature: RDF.Quad;
};

export type CandidateInstantiation = SignatureTripleOf & { data: RDF.Quad };

export type UsedRule = { rule: PRSCRule, linkedNodes: null | [RDF.Term, RDF.Term] };

export default function findPGTypeOfAllBlankNodesIn(
  dataset: DStar, signatures: SignatureTripleOf[], usedQuads: DStar
) {
  // For each blank node, find which signature have produced a triple with it.
  const blankNodesToSignature = findSignaturesThatMatchesTheBlankNodes(dataset, signatures, usedQuads);
  
  // For each blank node, find the type from the list of signatures
  const blankNodesToType = findBlankNodeTypes(blankNodesToSignature);

  // A PG monoedge does not have a blank node in the produced RDF graph: use
  // some black magic to retrieve them
  addMonoedges(blankNodesToType, blankNodesToSignature);

  return blankNodesToType;
}

/**
 * For each blank node in the dataset, find every signature template triple that
 * produced a triple with this blank node.
 * 
 * @param dataset The RDF graph to revert
 * @param signatures The list of (signature triple)
 * @param usedQuads A dataset to store the quads that are actually used in dataset
 * @returns A mapping of every blank nodes of the graph to the list of
 * signatures that produced a triple with this blank node
 */
function findSignaturesThatMatchesTheBlankNodes(
  dataset: DStar, signatures: SignatureTripleOf[], usedQuads: DStar
): TermMap<RDF.BlankNode, CandidateInstantiation[]> {
  const blankNodesToSignature = new TermMap<RDF.BlankNode, CandidateInstantiation[]>();

  for (const dataQuad of dataset) {
    const bns = extractBnsIn(dataQuad);
    for (const bn of bns) {
      if (!blankNodesToSignature.has(bn)) {
        blankNodesToSignature.set(bn, []);
      }
    }

    const f = signatures.find(t => canTemplateProduceData(t.signature, dataQuad));
    if (f === undefined) continue;

    const x: CandidateInstantiation = Object.assign({ data: dataQuad, blankNodes: bns }, f);
    bns.forEach(bn => blankNodesToSignature.get(bn)!.push(x));
    usedQuads.add(dataQuad);
  }

  return blankNodesToSignature;
}

/**
 * From the mapping of each blank node to the a list of signature triple
 * candidates, produces a mapping from each blank node to the signature triple
 * that produced it.
 */
function findBlankNodeTypes(
  candidates: TermMap<RDF.BlankNode, CandidateInstantiation[]>)
: TermMap<RDF.BlankNode, UsedRule> {
  let blankNodesToType = new TermMap<RDF.BlankNode, UsedRule>();

  // Find the nodes
  for (const [bn, myCandidates] of candidates) {
    const isNode = findOneAndOnlyOne(blankNodesToType, bn, myCandidates, 'node');
    if (isNode) continue;
    
    const isEdge = findOneAndOnlyOne(blankNodesToType, bn, myCandidates, 'edge');
    if (isEdge) continue;
    
    // This is theorically impossible.
    throw Error("Some blank node could not be identified.");
  }

  return blankNodesToType;
}

/**
 * Checks if the given blank node only has one candidate of the given kind.
 * 
 * Returns true if myCandidates has only one rule of kind `kind`.
 * If true, blankNodesToType is filled at the key `me` with this candidate.
 */
function findOneAndOnlyOne(
  blankNodesToType: TermMap<RDF.BlankNode, UsedRule>,
  me: RDF.BlankNode, myCandidates: SignatureTripleOf[], kind: 'node' | 'edge'
): boolean {
  const asKind = myCandidates.filter(candidate => candidate.rule.kind === kind);

  if (asKind.length > 1) {
    // More than one candidate of this kind: check if every candidate comes from
    // the exact same rule
    const rulesIdentifiers = new TermSet(); 
    asKind.map(c => c.rule.identity).forEach(identifierForRule => rulesIdentifiers.add(identifierForRule));

    if (rulesIdentifiers.size > 1) {
      throw Error("Should never happen: rulesIdentifiers.length = " + rulesIdentifiers.size + " != 1");
    }

    // Yes all the same rule
    asKind.splice(1);
  }

  if (asKind.length !== 1) return false;

  blankNodesToType.set(me, { rule: asKind[0].rule, linkedNodes: null });
  return true;
}

function addMonoedges(
  alreadyFound: TermMap<RDF.BlankNode, UsedRule>,
  candidates: TermMap<RDF.BlankNode, CandidateInstantiation[]>
) {
  // 1) Find all candidate instantiation involving nodes
  const edgeCandidates: CandidateInstantiation[] = [];

  for (const [bn, myCandidates] of candidates) {
    // If we know that an edge is involved, it can not be a monoedge
    if (alreadyFound.get(bn)!.rule.kind === 'edge') continue;
    
    for (const candidate of myCandidates) {
      // Node rules are not monoedges rules
      if (candidate.rule.kind === 'node') continue;

      // Possible
      if (!edgeCandidates.includes(candidate)) {
        edgeCandidates.push(candidate);
      }
    }
  }

  // 2) To be a monoedge rule, every triples in the template should not have
  // pvar:self and should have both pvar:source + pvar:destination
  const monoedgeCandidates = edgeCandidates.filter(edgeCandidate => {
    const pvarSelfIsMissing = undefined === edgeCandidate.rule.template.find(
      t => QuadStar.containsTerm(t, pvar.self)
    );
    if (!pvarSelfIsMissing) return false;

    const allHaveSourceAndDestination = undefined === edgeCandidate.rule.template.find(
      t => !(QuadStar.containsTerm(t, pvar.source) && QuadStar.containsTerm(t, pvar.destination))
    );
    return allHaveSourceAndDestination;
  });

  // cis contains a list of tuples with:
  // - a data triple
  // - the signature triple of a monoedge that created it (or a Kappa identical one)
  // - the monoedge rule
  
  // 3) If the signature has been chosen carefully, we can extract from the
  // data and the template the source and the destination.
  // We put it in a TermSet to ensure that we do not create several edges
  // for a given (monoedge type, source, destination).
  const ruleIdentityToRule = new TermMap<RDF.Term, PRSCRule>();
  const monoedgesInThePG = new TermSet<RDF.Quad>();
  for (const monoedgeCandidate of monoedgeCandidates) {
    const { source, destination } = findSrcAndDestInMonoedge(monoedgeCandidate.data, monoedgeCandidate.signature);
    // We encode the fact that there is a PG edge between source and destination
    // as a regular RDF triple that uses the rule identity, = a node that
    // identifies this type of PG edge, in predicate position.
    const directTriple = $quad(
      source,
      monoedgeCandidate.rule.identity as RDF.Quad_Predicate,
      destination
    );

    monoedgesInThePG.add(directTriple);
    ruleIdentityToRule.set(monoedgeCandidate.rule.identity, monoedgeCandidate.rule);
  }

  // 4) Add all monoedges in the PG to the list of PG element to build back.
  for (const directTriple of monoedgesInThePG) {
    const correspondingRule = ruleIdentityToRule.get(directTriple.predicate)!;
    alreadyFound.set(
      $blankNode(), { rule: correspondingRule, linkedNodes: [directTriple.subject, directTriple.object] }
    );
  }
}


/**
 * Extract from the dataQuad the value of pvar:source and pvar:destination,
 * assuming that it was produced by the given template.
 * @param dataQuad The data quad
 * @param template The template that produced it
 * @returns The value of pvar:source and pvar:destination
 */
function findSrcAndDestInMonoedge(dataQuad: RDF.Quad, template: RDF.Quad)
: { source: RDF.BlankNode, destination: RDF.BlankNode } {
  let source: RDF.Term | null = null;
  let destination: RDF.Term | null = null;

  function recurseIn(data: RDF.Term, template: RDF.Term) {
    if (template.equals(pvar.node) || template.equals(pvar.edge) || template.equals(pvar.self)) {
      throw Error("This template is not a monoedge template");
    } else if (template.equals(pvar.source)) {
      source = data;
    } else if (template.equals(pvar.destination)) {
      destination = data;
    } else if (template.termType === 'Quad' && data.termType === 'Quad') {
      recurseIn(data.subject, template.subject);
      recurseIn(data.predicate, template.predicate);
      recurseIn(data.object, template.object);
    }
  }

  recurseIn(dataQuad, template);

  if (source === null || destination === null) {
    throw Error("The template triple did not contain pvar:source or pvar:destination");
  }

  return { source, destination };
}
