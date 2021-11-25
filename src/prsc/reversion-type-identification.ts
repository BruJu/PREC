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
  
  // For each blank node, find the signature that is the only one who could have
  // produced the blank node.
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
  let tm = new TermMap<RDF.BlankNode, UsedRule>();

  // Find the nodes
  for (const [bn, myCandidates] of candidates) {
    const isNode = findOneAndOnlyOne(tm, bn, myCandidates, 'node');
    if (isNode) continue;
    
    const isEdge = findOneAndOnlyOne(tm, bn, myCandidates, 'edge');
    if (isEdge) continue;
    
    // This is theorically impossible.
    throw Error("Some blank node could not be identified.");
  }

  return tm;
}

/**
 * Checks if the given blank node only has one candidate of the given type.
 * 
 * Returns true if myCandidates has only one rule of type `type`.
 * If true, tm is filled at the key `me` with this candidate.
 */
function findOneAndOnlyOne(
  tm: TermMap<RDF.BlankNode, UsedRule>,
  me: RDF.BlankNode, myCandidates: SignatureTripleOf[], type: 'node' | 'edge'
): boolean {
  const asType = myCandidates.filter(candidate => candidate.rule.type === type);

  if (asType.length > 1) {
    const identityNodes = new TermSet(); 
    asType.map(c => c.rule.identity).forEach(identityNode => identityNodes.add(identityNode));

    if (identityNodes.size > 1) throw Error("Should never happen: identityNode = " + identityNodes.size + " != 1");

    // All the same rule
    asType.splice(1);
  }

  if (asType.length !== 1) return false;

  tm.set(me, { rule: asType[0].rule, linkedNodes: null });
  return true;
}

function addMonoedges(
  alreadyFound: TermMap<RDF.BlankNode, UsedRule>,
  candidates: TermMap<RDF.BlankNode, CandidateInstantiation[]>
) {
  // 1) Find all candidate instantiation involving nodes
  let cis: CandidateInstantiation[] = [];

  for (const [bn, myCandidates] of candidates) {
    // If we know that an edge is involved, it can not be a monoedge
    if (alreadyFound.get(bn)!.rule.type === 'edge') continue;
    
    for (const candidate of myCandidates) {
      // Node rules are not monoedges rules
      if (candidate.rule.type === 'node') continue;

      // Possible
      if (!cis.includes(candidate)) cis.push(candidate);
    }
  }

  // 2) To be a monoedge rule, every triples in the template should not have
  // pvar:self and should have both pvar:source + pvar:destination
  cis = cis.filter(cis => {
    let a = cis.rule.template.find(t => QuadStar.containsTerm(t, pvar.self)) === undefined;
    if (!a) return false;

    let b = cis.rule.template.find(t => QuadStar.containsTerm(t, pvar.source) && QuadStar.containsTerm(t, pvar.destination)) !== undefined;
    return b;
  });

  // cis contains a list of tuples with:
  // - a data triple
  // - the signature triple of a monoedge that created it (or a Kappa identical one)
  // - the monoedge rule
  
  // 3) If the signature has been chosen carefully, we can extract from the
  // data and the template the source and the destination.
  // We put it in a TermMap to ensure that we do not create several edges
  // for a given (monoedge rule, source, destination).
  let qs = new TermMap<RDF.Quad, PRSCRule>();
  for (const ci of cis) {
    const xs = findSrcAndDestInMonoedge(ci.data, ci.signature);
    const key = $quad(
      xs.source,
      ci.rule.identity as RDF.Quad_Predicate,
      xs.destination
    );

    qs.set(key, ci.rule);
  }

  // 4) qs contains as key tuples with
  // (source, monoedge type identifer, destination). We forge a blank node for
  // a new monoedge of the given type with the given source and destination.
  for (const [triple, rule] of qs) {
    alreadyFound.set(
      $blankNode(), { rule: rule, linkedNodes: [triple.subject, triple.object] }
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
