import TermMap from '@rdfjs/term-map';
import TermSet from '@rdfjs/term-set';
import * as RDF from "@rdfjs/types";
import { DataFactory } from "n3";
import * as RDFString from 'rdf-string';

import DStar from "../dataset";
import { $defaultGraph, $quad, prec, pvar, rdf } from '../PRECNamespace';
import { followAll, followThrough } from "../rdf/path-travelling";
import * as QuadStar from '../rdf/quad-star';
import { characterizeTemplateTriple, extractBnsIn, PRSCSchemaViolation } from "./PrscContext";
import { SignatureTripleOf } from './reversion-type-identification';


const xsdString = DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#string");

/**
 * A PRSC rule, corresponding to a PG type and the template required by the
 * user to represent the PG elements of this type.
 */
export type PRSCRule = {
  /** An RDF term to uniquely identify this rule */
  readonly identity: RDF.Quad_Subject;
  /** The kind of the PG elements: either a node or an edge */
  readonly kind: 'edge' | 'node';
  /** The list of labels of the type */
  readonly labels: string[];
  /** The list of properties of the type */
  readonly properties: string[];
  /** The template graph used to represent such rules */
  readonly template: RDF.Quad[];
};

/**
 * Either produces an object that describes the rule identify with `identity`
 * in the given context graph or return a list of rule violations that makes
 * the rule incoherent.
 * @param context The context graph
 * @param identity The identifier for the rule
 * @returns Either an object with the rule details or a list of violations.
 */
export function buildRule(context: DStar, identity: RDF.Quad_Subject)
: { rule: PRSCRule } | { violations: PRSCSchemaViolation[] } {
  let violations: PRSCSchemaViolation[] = [];

  let nodeOrEdge: 'node' | 'edge' | undefined = undefined;

  const type = followThrough(context, identity, rdf.type);
  if (type === null) {
    violations.push({ type: 'rule_bad_type_qtt', identity: identity, message: "must have exactly one type" });
  } else if (type.equals(prec.prsc_node)) {
    nodeOrEdge = 'node';
  } else if (type.equals(prec.prsc_edge)) {
    nodeOrEdge = 'edge';
  } else {
    violations.push({ type: 'rule_given_bad_type', identity: identity, foundType: type });
  }

  const labels = followAllXSDStrings(context, identity, prec.label);
  if (nodeOrEdge === 'node') {
    labels.push(...followAllXSDStrings(context, identity, prec.nodeLabel));
  } else if (nodeOrEdge === 'edge') {
    labels.push(...followAllXSDStrings(context, identity, prec.edgeLabel));
  }

  const properties = followAllXSDStrings(context, identity, prec.propertyName);
  const template = readTemplate(context, identity);

  const listOfInvalidPropNames = getInvalidPropNames(template, properties);
  if (listOfInvalidPropNames !== null) {
    const errors: PRSCSchemaViolation[] = listOfInvalidPropNames.map(invalidPropName =>
      ({ type: 'template_has_invalid_prop_name', identity: identity, propName: invalidPropName })
    );
    violations.push(...errors);
  }

  if (nodeOrEdge === 'node') {
    const edgeTemplateTriple = template.find(triple =>
      QuadStar.containsTerm(triple, pvar.source)
      || QuadStar.containsTerm(triple, pvar.destination)
    );

    if (edgeTemplateTriple !== undefined) {
      violations.push({ type: 'template_has_invalid_prop_name', identity: identity, propName: "pvar:source or pvar:destination" });
    }
  }

  if (violations.length !== 0) {
    return { violations };
  }

  return {
    rule: {
      identity: identity,
      kind: nodeOrEdge!,
      labels: labels,
      properties: properties,
      template: template
    }
  };
}

/**
 * Extract the template graph attached to the rule `identity` in the context
 * graph.
 * 
 * A triple is in the template graph if:
 * - it is a quoted triple in the object position of (identity, prec:composedOf, -)
 * - it is in a graph whose name is in object position of (identity, prec:composedOf, -)
 * - There exists a path between a blank node used in a quoted triple of prec:composedOf
 * and a blank node used in the default graph in object position.
 * @param context The template graph
 * @param identity The rule identifier
 * @returns The list of triples that composes the template graph
 */
function readTemplate(context: DStar, identity: RDF.Quad_Subject): RDF.Quad[] {
  let alreadySeenQuads = new TermSet();

  const template: RDF.Quad[] = [];

  for (const object of followAll(context, identity, prec.composedOf)) {
    if (object.termType === 'Quad') {
      if (alreadySeenQuads.has(object)) continue;

      let searchBlankNodesIn = new TermSet<RDF.Quad>();
      searchBlankNodesIn.add(object);
      alreadySeenQuads.add(object);
      template.push(object);

      while (searchBlankNodesIn.size !== 0) {
        const searchBlankNodesInHere = [...searchBlankNodesIn.values()][0];
        searchBlankNodesIn.delete(searchBlankNodesInHere);

        const addedBns = extractBnsIn(searchBlankNodesInHere);
        const theNewBnsAreIn = context.findAllOccurrencesAsSubject(addedBns);

        for (const newQuad of theNewBnsAreIn) {
          if (!alreadySeenQuads.has(newQuad)) {
            alreadySeenQuads.add(newQuad);
            searchBlankNodesIn.add(newQuad);

            template.push(newQuad);
          }
        }
      }
    } else if (object.termType === 'BlankNode' || object.termType === 'NamedNode') {
      const graphContent = context.getQuads(null, null, null, object);
      if (graphContent.length === 0) {
        const TTS = RDFString.termToString;
        throw Error(`${TTS(identity)} prec:composedOf ${TTS(object)} has been found but the graph ${TTS(object)} is empty.`);
      }

      for (const quad of graphContent) {
        const quadInDefaultGraph = $quad(quad.subject, quad.predicate, quad.object, $defaultGraph);
        template.push(quadInDefaultGraph);
      }
    } else {
      throw Error(`Invalid object for prec:composedOf found in rule ${RDFString.termToString(identity)}`);
    }
  }

  return template;
}


///////////////////////////////////////////////////////////////////////////////
// ==== Signature triple

/**
 * Find the signature of every given rule.
 * 
 * The signatures are returned in the format (Signature Triple, the rule).
 * Users that want to ensure that all rules has a signature must check if
 * the result.length === rules.length.
 * @param rules The list of rules
 */
export function findSignatureOfRules(rules: PRSCRule[]): SignatureTripleOf[] {
  // 1) Build a map characterization -> rule
  const found = new TermMap<RDF.Quad, PRSCRule | null>();

  rules.forEach(rule => rule.template.forEach(templateTriple => {
    const characterized = characterizeTemplateTriple(templateTriple);

    const f = found.get(characterized);
    if (f === undefined) {
      found.set(characterized, rule);
    } else if (f === rule) {
      // ok: multiple signature templates within the same rule can produce the
      // same triples
    } else if (f !== null) {
      // not ok: This template triple is shared by several rules
      found.set(characterized, null);
    } else {
      // f === null, we know this template triple is not signature
    }
  }));

  // Monoedges: All triples must be "signature" + at least one must not have a
  // triple with inverted pvar:source and pvar:destination
  rules.filter(rule => isMonoedgeTemplate(rule.template))
  .forEach(rule => {
    const kappaTemplateGraph = rule.template.map(t => characterizeTemplateTriple(t));

    const notSignature = kappaTemplateGraph.find(triple => found.get(triple) !== rule);

    if (notSignature !== undefined) {
      kappaTemplateGraph.forEach(t => found.set(t, null));
      return;
    }

    let signatureWithIdentifiableSrcAndDest: number | null = null;

    for (let i = 0; i !== kappaTemplateGraph.length; ++i) {
      let good = true;

      for (let j = 0; j !== kappaTemplateGraph.length; ++j) {
        if (i === j) continue;
        if (!kappaTemplateGraph[i].equals(kappaTemplateGraph[j])) continue;

        if (!isSrcDestCompatible(rule.template[i], rule.template[j])) {
          good = false;
          found.set(kappaTemplateGraph[i], null);
          found.set(kappaTemplateGraph[j], null);
        }
      }

      if (good) {
        signatureWithIdentifiableSrcAndDest = i;
      }
    }

    // TODO: this if is useless?
    if (signatureWithIdentifiableSrcAndDest === null) {
      kappaTemplateGraph.forEach(t => found.set(t, null));
    }
  });

  // Build the result
  let result: SignatureTripleOf[] = [];

  for (const rule of rules) {
    const signature = rule.template.find(template => {
      const kappa = characterizeTemplateTriple(template);
      const signatureOf = found.get(kappa);
      return signatureOf === rule;
    });

    if (signature !== undefined) {
      result.push({ rule: rule, signature: signature });
    }
  }

  return result;
}


function isMonoedgeTemplate(template: RDF.Quad[]) {
  return template.find(triple => QuadStar.containsTerm(triple, pvar.self)) === undefined
    && (
      template.find(triple =>
        !(QuadStar.containsTerm(triple, pvar.source)
        && QuadStar.containsTerm(triple, pvar.destination))
      ) === undefined
    );
}

/**
 * Assuming that they have the same kappa, returns true if every pvar:source
 * and pvar:destination are at the same place in both templates.
 */
export function isSrcDestCompatible(template1: RDF.Term, template2: RDF.Term) {
  function visit(t1: RDF.Term, t2: RDF.Term): boolean {
    if (t1.termType !== t2.termType) return false;

    if (t1.termType === 'Quad' && t2.termType === 'Quad') {
      return visit(t1.subject, t2.subject)
        && visit(t1.predicate, t2.predicate)
        && visit(t1.object, t2.object)
        && visit(t1.graph, t2.graph);
    }

    if (t1.termType === 'NamedNode' && t2.termType === 'NamedNode') {
      if (t1.equals(pvar.source)) return t2.equals(pvar.source);
      if (t1.equals(pvar.destination)) return t2.equals(pvar.destination);
      if (t2.equals(pvar.source) || t2.equals(pvar.destination)) return false;
    }

    return true;
  }

  return visit(template1, template2);
}


///////////////////////////////////////////////////////////////////////////////

/**
 * Extract the value of all triples in the form
 * `(subject, predicate, "???"^^xsd:string)` from the given RDF graph. Throws
 * if there are in object position other things that xsd:string typed literals.
 * @param dataset The dataset
 * @param subject The subject
 * @param predicate The predicate
 * @returns The value of the literals on objet position
 */
function followAllXSDStrings(
  dataset: RDF.DatasetCore,
  subject: RDF.Quad_Subject,
  predicate: RDF.Quad_Predicate
): string[] {
  return followAll(dataset, subject, predicate).map(object => {
    if (object.termType !== 'Literal' || !object.datatype.equals(xsdString)) {
      throw Error(`${RDFString.termToString(subject)} ${RDFString.termToString(predicate)} objects must be xsd:stringliterals`);
    }

    return object.value;
  })
}


/**
 * Search in the template graph the list of terms of type prec:_valueOf and check
 * if they are all in allowedKeys.
 * @param templateGraph The template graph
 * @param allowedKeys The list of allowed property names
 * @returns null if the template graph only uses allowed keys. The list of keys
 * that are not allowed if such keys exists.
 */
 function getInvalidPropNames(templateGraph: RDF.Quad[], allowedKeys: string[]): string[] | null {
  let badKeys: string[] = [];

  function searchBadKeys(templateTerm: RDF.Term) {
    if (templateTerm.termType === 'Quad') {
      searchBadKeys(templateTerm.subject);
      searchBadKeys(templateTerm.predicate);
      searchBadKeys(templateTerm.object);
      searchBadKeys(templateTerm.graph);
    } else if (templateTerm.termType === 'Literal') {
      if (templateTerm.datatype.equals(prec._valueOf)) {
        const key = templateTerm.value;

        if (!allowedKeys.includes(key)) {
          if (!badKeys.includes(key)) {
            badKeys.push(key);
          }
        }
      }
    }
  }

  for (const templateTriple of templateGraph) {
    searchBadKeys(templateTriple);
  }

  if (badKeys.length === 0) return null;
  return badKeys;
}

