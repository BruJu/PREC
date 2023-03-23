import * as RDF from "@rdfjs/types";
import TermMap from "@rdfjs/term-map";
import TermSet from '@rdfjs/term-set';
import { DataFactory } from "n3";
import * as RDFString from 'rdf-string';

import DStar from "../dataset";
import {
  rdf, rdfs, pgo, prec, pvar,
  $quad, $literal, $variable, $defaultGraph,
  precValueOf
} from '../PRECNamespace';

import { followThrough } from "../rdf/path-travelling";
import { eventuallyRebuildQuad } from "../rdf/quad-star";
import { buildRule, findSignatureOfRules, PRSCRule } from "./PrscRule";
import { rdfToPREC0 } from "./prsc-reversion";
export { PRSCRule };

const pvarPrefix = "http://bruy.at/prec-trans#";

////////////////////////////////////////////////////////////////////////////////
// General purpose utilty functions

/**
 * Returns true if lhs and rhs contains the same strings.
 * 
 * Assumes that both array contains no duplicate.
 */
export function haveSameStrings(lhs: string[], rhs: string[]): boolean {
  if (lhs.length !== rhs.length) return false;
  return lhs.every(label => rhs.includes(label));
}


////////////////////////////////////////////////////////////////////////////////
// Schema detection

export class PRSCContext {
  prscRules: PRSCRule[] = [];

  static build(contextQuads: RDF.Quad[]): { context: PRSCContext } | { violations: PRSCContextViolation[] } {
    const rules: PRSCRule[] = [];
    const violations: PRSCContextViolation[] = [];
    const dataset = new DStar(contextQuads);
    const alreadySeenTypes = new TermSet();

    for (const type of [prec.PRSCNodeRule, prec.PRSCEdgeRule]) {
      for (const ruleQuad of dataset.match(null, rdf.type, type, $defaultGraph)) {
        // Do not process duplicates
        if (alreadySeenTypes.has(ruleQuad.subject)) continue;
        alreadySeenTypes.add(ruleQuad.subject);

        // Read and add the rule
        const thisRule = buildRule(dataset, ruleQuad.subject);
        if ('violations' in thisRule) {
          violations.push(...thisRule.violations);
        } else {
          rules.push(thisRule.rule);
        }
      }
    }

    if (violations.length !== 0) {
      return { violations };
    }
    
    return { context: new PRSCContext(rules) };
  }

  private constructor(rules: PRSCRule[]) {
    this.prscRules = rules;
  }

  apply(dataset: DStar): DStar {
    let result = new DStar();

    for (const pgElement of dataset.match(null, rdf.type, pgo.Node, $defaultGraph)) {
      this.produceQuads(dataset, pgElement.subject, 'node', result);
    }

    for (const pgElement of dataset.match(null, rdf.type, pgo.Edge, $defaultGraph)) {
      this.produceQuads(dataset, pgElement.subject, 'edge', result);
    }

    return result;
  }

  private produceQuads(dataset: DStar, element: RDF.Quad_Subject, t: 'node' | 'edge', result: DStar) {
    const toLabel = t === 'node' ? rdf.type : rdf.predicate;

    let pgElement = {
      labels: dataset.matchAndBind([
        $quad(element, toLabel, $variable('labelIRI')),
        $quad($variable('labelIRI'), rdfs.label, $variable('label'))
      ]).map(binding => (binding.label as RDF.Term).value),
      properties: dataset.matchAndBind([
        $quad(element, $variable('propertyKey'), $variable('blankNode')),
        $quad($variable('propertyKey'), rdfs.label, $variable('propertyNameLabel')),
        $quad($variable('blankNode'), rdf.value, $variable('value'))
      ]).reduce((accumulator, bindings) => {
        const key = (bindings.propertyNameLabel as RDF.Term).value;
        const value = bindings.value as RDF.Quad_Object;

        if (accumulator[key] !== undefined) {
          throw Error("Multiple value for property " + key);
        }

        accumulator[key] = value;

        return accumulator;
      }, {} as {[propName: string]: RDF.Quad_Object})
    };

    const rule = this.prscRules.find(rule => {
      if (rule.kind !== t) return false;
      if (!haveSameStrings(rule.labels, pgElement.labels)) return false;
      if (!haveSameStrings(rule.properties, Object.keys(pgElement.properties))) return false;
      return true;
    })

    if (rule === undefined) {
      throw Error(`No rule matches the PG ${t} mapped to ${RDFString.termToString(element)}`);
    }

    buildRdfTriplesFromRule(
      result, 
      rule.template, element, pgElement.properties,
      t === 'edge' ? followThrough(dataset, element, rdf.subject)! as RDF.Quad_Subject : undefined,
      t === 'edge' ? followThrough(dataset, element, rdf.object )! as RDF.Quad_Subject : undefined
    );
  }

  getAllSignatures(): SignatureTripleOf[] {
    return findSignatureOfRules(this.prscRules);
  }
}

/** A pair with a rule and (one of) its signature triple. */
export type SignatureTripleOf = {
  rule: PRSCRule;
  kind: 'node' | 'edge' | 'edge-unique';
  signature: RDF.Quad;
};

export type PRSCContextViolation = { identity: RDF.Quad_Subject } & (
  { type: 'rule_bad_type_qtt', message: string }
  | { type: 'rule_given_bad_type', foundType: RDF.Quad_Object }
  | { type: 'template_has_invalid_prop_name', propName: string }
);

export function violationsToString(violations: PRSCContextViolation[], delimiter: string = " ; "): string {
  return violations.map(violation => violationToString(violation)).join(delimiter);
}

export function violationToString(violation: PRSCContextViolation): string {
  if (violation.type === 'rule_bad_type_qtt') {
    return `${RDFString.termToString(violation.identity)} does not have exactly one type`;
  } else if (violation.type === 'rule_given_bad_type') {
    return `${RDFString.termToString(violation.identity)} has the type ${RDFString.termToString(violation.foundType)} `
      + 'which is different from the expected types prec:PRSCNodeRule and prec:PRSCEdgeRule.'
  } else if (violation.type === 'template_has_invalid_prop_name') {
    return RDFString.termToString(violation.identity)
      + " uses the property name " + violation.propName
      + " in its template but it is not a property in the described type."
  } else {
    return 'Unknown violation';
  }
}

export function unwrapContext(r: { context: PRSCContext } | { violations: PRSCContextViolation[] }): PRSCContext {
  if ('violations' in r) {
    throw Error("The given schema is invalid: " + violationsToString(r.violations));
  }

  return r.context;
}

////////////////////////////////////////////////////////////////////////////////
// ==== Structural description graph -> Idiomatic Graph

export default function precCwithPRSC(dataset: DStar, contextQuads: RDF.Quad[]): DStar {
  const context = unwrapContext(PRSCContext.build(contextQuads));
  return context.apply(dataset);
}

/**
 * Produce the triples related to the PG element `pgElement` in the output
 * graph by instantiating the template graph with the values contained in the
 * PREC-0 format PG.
 * 
 * @param output The graph that will be filled
 * @param templateGraph The template graph
 * @param pgElement The blank node that represents the PG element to transform
 * @param properties A mapping from property key to the literal with the
 * property value
 * @param source If the element is an edge, the blank node that represents the
 * source
 * @param destination If the element is an edge, the blank node that represents
 * the destination.
 */
function buildRdfTriplesFromRule(
  output: DStar,
  templateGraph: RDF.Quad[],
  pgElement: RDF.Quad_Subject,
  properties: {[key: string]: RDF.Quad_Object},
  source?: RDF.Quad_Subject,
  destination?: RDF.Quad_Subject
) {
  const blankNodeInstantiations = new TermMap<RDF.BlankNode, RDF.BlankNode>();

  templateGraph.forEach(templateQuad => {
    output.add(eventuallyRebuildQuad(templateQuad, term => {
      if (term.equals(pvar.node) || term.equals(pvar.edge) || term.equals(pvar.self)) {
        return pgElement;
      } else if (term.equals(pvar.source)) {
        if (source === undefined) throw Error("Using pvar:source but no source value was provided");
        return source;
      } else if (term.equals(pvar.destination)) {
        if (destination === undefined) throw Error("Using pvar:destination but no destination value was provided");
        return destination!;
      } else if (term.termType === 'Literal' && term.datatype.equals(precValueOf)) {
        return properties[term.value];
      } else if (term.termType === 'BlankNode') {
        if (blankNodeInstantiations.has(term)) {
          return blankNodeInstantiations.get(term)!;
        } else {
          const result = DataFactory.blankNode();
          blankNodeInstantiations.set(term, result);
          return result;
        }
      } else {
        return term;
      }
    }));
  });
}


////////////////////////////////////////////////////////////////////////////////
// ==== Structural description graph <- Idiomatic Graph

export function revertPrecC(dataset: DStar, contextQuads: RDF.Quad[]): DStar {
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
