import TermMap from '@rdfjs/term-map';
import TermSet from "@rdfjs/term-set";
import * as RDF from "@rdfjs/types";
import {
  characterizeTemplateTriple,
  haveSameStrings, PRSCRule, PRSCSchema
} from '../prec-c/PrscContext';
import { precValueOf, pvarDestination, pvarEdge, pvarNode, pvarSelf, pvarSource } from "../prec/PRECNamespace";
import * as QuadStar from '../rdf/quad-star';


/** A violation for a Well Behaved Context */
export type WellBehavedViolation = {
  rule: PRSCRule,
  reason: string
};

/**
 * Checks if pvar:self is in every triple of the template
 * @param rule The rule
 * @returns True if pvar:self is in every triple of the template
 */
export function elementIdentification(rule: PRSCRule): boolean {
  const other = rule.type === 'node' ? pvarNode : pvarEdge;
  return undefined === rule.template.find(templateTriple =>
    !(QuadStar.containsTerm(templateTriple, pvarSelf)
    || QuadStar.containsTerm(templateTriple, other))
  );
}

/**
 * Return the list of rules that do not have a signature template i.e. those
 * that we think can not produce triples that only them can produce.
 * @param rules List of rules 
 * @returns The list of rules that do not have a signature template
 */
export function signatureTriple(rules: PRSCRule[]): PRSCRule[] {
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

  // 2) Find which rules are in the map
  const withSignature = new TermSet<RDF.Term>();

  for (const ruleOrNull of found.values()) {
    if (ruleOrNull !== null) {
      withSignature.add(ruleOrNull.identity);
    }
  }

  // 3) Build list of missings and return it
  return rules.filter(rule => !withSignature.has(rule.identity));
}

enum SpecialArg { Source, Destination }

/**
 * Checks if no value can be lost during the PG to RDF conversion
 * @param rule The rule
 * @returns True if no value can be lost during the PG to RDF conversion
 */
export function noValueLoss(rule: PRSCRule): boolean {
  let m = new TermMap<RDF.Quad, null | { quad: RDF.Quad, values: (string | SpecialArg)[] }>();

  for (const templateTriple of rule.template) {
    const args = extractArgs(templateTriple);

    if (args.length !== 0) {
      const characterized = characterizeTemplateTriple(templateTriple);
      const mappedTo = m.get(characterized);
      if (mappedTo === undefined) {
        m.set(characterized, { quad: templateTriple, values: args });
      } else if (mappedTo !== null) {
        m.set(characterized, null);
      }
    }
  }

  let foundSrc = false;
  let foundDest = false;
  let foundPropertyValues = new Set<string>();

  for (const uniqueProperties of m.values()) {
    if (uniqueProperties === null) continue;

    const { values } = uniqueProperties;
    for (const value of values) {
      if (value === SpecialArg.Source) foundSrc = true;
      else if (value === SpecialArg.Destination) foundDest = true;
      else foundPropertyValues.add(value);
    }
  }

  if (foundSrc !== foundDest) return false;
  if (foundSrc !== (rule.type === 'edge')) return false;
  if (!haveSameStrings([...foundPropertyValues], rule.properties)) return false;
  return true;
}


/** Extract the list of placeholders in the template triple */
function extractArgs(templateTriple: RDF.Quad): (string | SpecialArg)[] {
  let result: (string | SpecialArg)[] = [];

  function visit(term: RDF.Term) {
    if (term.termType === 'Quad') {
      visit(term.subject);
      visit(term.predicate);
      visit(term.object);
      visit(term.graph);
    } else if (term.termType === 'NamedNode') {
      if (term.equals(pvarSource)) result.push(SpecialArg.Source);
      if (term.equals(pvarDestination)) result.push(SpecialArg.Destination);
    } else if (term.termType === 'Literal') {
      if (term.datatype.equals(precValueOf)) {
        result.push(term.value);
      }
    }
  }

  visit(templateTriple);

  return result;
}

/** Adds a violation in the list of violation */
function addViolation(map: WellBehavedViolation[], rule: PRSCRule, message: string) {
  const it = map.find(violation => violation.rule === rule);
  if (it === undefined) {
    map.push({ rule: rule, reason: message });
  } else {
    it.reason += " / " + message;
  }
}

/**
 * Check if the context is well behaved, i.e. if we have proved in a WIP paper
 * that it is reversible
 * @param context The context
 * @returns True if the context is well behaved, else the list of detected
 * violations
 */
export default function wellBehavedCheck(context: PRSCSchema): true | WellBehavedViolation[] {
  let violations: WellBehavedViolation[] = [];
  
  for (const rule of context.prscRules) {
    if (!elementIdentification(rule)) {
      addViolation(violations, rule, "pvar:self is not in every triple");
    }

    if (!noValueLoss(rule)) {
      addViolation(violations, rule, "Some data from the Property Graph is lost");
    }
  }

  const rulesWithoutSignature = signatureTriple(context.prscRules);
  rulesWithoutSignature.forEach(ruleWithoutSignature =>
    addViolation(violations, ruleWithoutSignature, "No signature")
  );

  return violations.length === 0 ? true : violations;
}
