import TermMap from '@rdfjs/term-map';
import TermSet from "@rdfjs/term-set";
import * as RDF from "@rdfjs/types";
import * as RDFString from 'rdf-string';
import {
  characterizeTemplateTriple,
  haveSameStrings, PRSCSchema
} from './PrscContext';
import { PRSCRule, isSrcDestCompatible } from './PrscRule';
import { precValueOf, pvarDestination, pvarEdge, pvarNode, pvarSelf, pvarSource } from "../PRECNamespace";
import * as QuadStar from '../rdf/quad-star';
import { findBlankNodes } from '../../build/src/rdf/graph-substitution';


/** A violation for a Well Behaved Context */
export type WellBehavedViolation = {
  rule: PRSCRule,
  reason: string
};

/**
 * Answer for `elementIdentification`
 */
export enum ElementIdentificationAnswer { FullyIdentifiable, MonoEdge, No }

/**
 * Checks if pvar:self is in all triples of the template
 * @param rule The rule
 * @returns True if pvar:self is in all triples of the template
 */
export function elementIdentification(rule: PRSCRule): ElementIdentificationAnswer {
  const other = rule.kind === 'node' ? pvarNode : pvarEdge;

  // The template must contain no blank node: as pvar:self will be mapped to blank node,
  // if a blank node is produced by another source, we can not identify every
  // blank node as a PG element trivially.
  const hasABlankNode = undefined !== rule.template.find(templateTriple => findBlankNodes(templateTriple).size !== 0);
  if (hasABlankNode) {
    return ElementIdentificationAnswer.No;
  }

  const isFull = undefined === rule.template.find(templateTriple =>
    !(QuadStar.containsTerm(templateTriple, pvarSelf)
    || QuadStar.containsTerm(templateTriple, other))
  );

  if (isFull) return ElementIdentificationAnswer.FullyIdentifiable;

  if (rule.kind === 'edge') {
    const areAllPartial = undefined === rule.template.find(templateTriple =>
      !(QuadStar.containsTerm(templateTriple, pvarSource)
      && QuadStar.containsTerm(templateTriple, pvarDestination))
    );
    if (areAllPartial) return ElementIdentificationAnswer.MonoEdge;
  }

  return ElementIdentificationAnswer.No;
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

  // Monoedges: All triples must be "signature" + at least one must not have a
  // triple with inverted pvar:source and pvar:destination
  rules.filter(rule => isMonoedgeTemplate(rule.template))
  .forEach(rule => {
    const kappaTemplateGraph = rule.template.map(t => characterizeTemplateTriple(t));

    const notSignature = kappaTemplateGraph.find(triple => found.get(triple) !== rule);

    if (notSignature !== undefined) {
      kappaTemplateGraph.forEach(t => found.set(t, null));
    }

    let signatureWithIdentifiableSrcAndDest: number | null = null;

    for (let i = 0; i !== kappaTemplateGraph.length; ++i) {
      let good = true;

      for (let j = 0; j !== kappaTemplateGraph.length; ++j) {
        if (i === j) continue;
        if (!kappaTemplateGraph[i].equals(kappaTemplateGraph[j])) continue;

        if (!isSrcDestCompatible(rule.template[i], rule.template[j])) {
          good = false;
          break;
        }
      }

      if (good) {
        signatureWithIdentifiableSrcAndDest = i;
        break;
      }
    }

    if (signatureWithIdentifiableSrcAndDest === null) {
      kappaTemplateGraph.forEach(t => found.set(t, null));
    }
  });

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

function isMonoedgeTemplate(template: RDF.Quad[]) {
  return template.find(triple => QuadStar.containsTerm(triple, pvarSelf)) === undefined
    && (
      template.find(triple =>
        !(QuadStar.containsTerm(triple, pvarSource)
        && QuadStar.containsTerm(triple, pvarDestination))
      ) === undefined
    );
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
  if (foundSrc !== (rule.kind === 'edge')) return false;
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

type MonoEdgeViolation = {
  monoedge: PRSCRule;
  clashingRules: PRSCRule[];
};

function findMonoedgeViolations(monoedges: PRSCRule[], all: PRSCRule[]): MonoEdgeViolation[] {
  const detecter = new MonoEdgeViolationDetector();

  monoedges.forEach(monoedge => detecter.addSignature(monoedge));

  all.filter(rule => !monoedges.includes(rule))
    .forEach(rule => detecter.addOtherRule(rule));

  return detecter.getViolations();
}

class MonoEdgeViolationDetector {
  #signatureOfMonoedge = new TermMap<RDF.Quad, PRSCRule[]>();
  #detectedViolations = new TermMap<RDF.Term, MonoEdgeViolation>();

  /** Adds the fact that the given monoedge rule is violated by the clasher */
  #addViolation(monoedgeRule: PRSCRule, clasher: PRSCRule) {
    let violationList = this.#detectedViolations.get(monoedgeRule.identity);
    if (violationList === undefined) {
      violationList = { monoedge: monoedgeRule, clashingRules: [] };
      this.#detectedViolations.set(monoedgeRule.identity, violationList);
    }

    if (!violationList.clashingRules.includes(clasher)) {
      violationList.clashingRules.push(clasher);
    }
  }

  /** Consider that every template triple of monoedge must be signature */
  addSignature(monoEdge: PRSCRule) {
    const alreadyClashesWith = new TermSet<RDF.Term>();

    monoEdge.template.forEach(templateTriple => {
      const kappa = characterizeTemplateTriple(templateTriple);

      const sign = this.#signatureOfMonoedge.get(kappa);
      if (sign === undefined) {
        this.#signatureOfMonoedge.set(kappa, [monoEdge]);
      } else if (!sign.includes(monoEdge)) {
        sign.forEach(sign1 => {
          if (!alreadyClashesWith.has(sign1.identity)) {
            alreadyClashesWith.add(sign1.identity);
            this.#addViolation(monoEdge, sign1);
            this.#addViolation(sign1, monoEdge);
          }
        });
        sign.push(monoEdge);
      }
    });
  }

  addOtherRule(rule: PRSCRule) {
    const alreadyClashesWith = new TermSet<RDF.Term>();

    rule.template.forEach(templateTriple => {
      const kappa = characterizeTemplateTriple(templateTriple);
      const signatureOf = this.#signatureOfMonoedge.get(kappa);
      if (signatureOf === undefined) return;

      signatureOf.forEach(monoedge => {
        if (!alreadyClashesWith.has(monoedge.identity)) {
          alreadyClashesWith.add(monoedge.identity);
          this.#addViolation(monoedge, rule);
        }
      });
    })
  }

  getViolations(): MonoEdgeViolation[] {
    return [...this.#detectedViolations.values()];
  }
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

  let monoedgeRules: PRSCRule[] = [];
  
  for (const rule of context.prscRules) {
    const identifiable = elementIdentification(rule);

    if (identifiable === ElementIdentificationAnswer.No) {
      addViolation(violations, rule, "pvar:self is not in all triples");
    } else if (identifiable === ElementIdentificationAnswer.MonoEdge) {
      monoedgeRules.push(rule);
    }

    if (!noValueLoss(rule)) {
      addViolation(violations, rule, "Some data from the Property Graph is lost");
    }
  }

  const rulesWithoutSignature = signatureTriple(context.prscRules);
  rulesWithoutSignature.forEach(ruleWithoutSignature =>
    addViolation(violations, ruleWithoutSignature, "No signature")
  );

  if (monoedgeRules.length !== 0) {
    const newViolations = findMonoedgeViolations(monoedgeRules, context.prscRules);
    for (const newViolation of newViolations) {
      addViolation(
        violations, newViolation.monoedge,
        'is a monoedge but its triples clashes with'
        + newViolation.clashingRules.map(rule => RDFString.termToString(rule.identity)).join(" and ")
      );
    }
  }

  return violations.length === 0 ? true : violations;
}
