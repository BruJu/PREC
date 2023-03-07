import TermMap from '@rdfjs/term-map';
import TermSet from "@rdfjs/term-set";
import * as RDF from "@rdfjs/types";
import * as RDFString from 'rdf-string';
import { characterizeTemplateTriple, haveSameStrings, PRSCContext } from './PrscContext';
import { PRSCRule, findSignatureOfRules } from './PrscRule';
import { precValueOf, pvarDestination, pvarEdge, pvarNode, pvarSelf, pvarSource } from "../PRECNamespace";
import * as QuadStar from '../rdf/quad-star';
import { findBlankNodes } from '@bruju/rdf-test-util/dist/src/graph-substitution';


/** A violation for a Well Behaved Context */
export type WellBehavedViolation = { rule: PRSCRule, reason: string };

/**
 * Answer for `elementIdentification`
 */
export enum ElementIdentificationAnswer { FullyIdentifiable, EdgeUnique, No }

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
  const hasABlankNode = rule.template.some(templateTriple => findBlankNodes(templateTriple).size !== 0);
  if (hasABlankNode) {
    return ElementIdentificationAnswer.No;
  }

  const isFull = rule.template.every(templateTriple =>
    QuadStar.containsOneOfTerm(templateTriple, pvarSelf, other)
  );

  if (isFull) return ElementIdentificationAnswer.FullyIdentifiable;

  if (rule.kind === 'edge') {
    const areAllPartial = rule.template.every(templateTriple =>
      QuadStar.containsAllTerms(templateTriple, pvarSource, pvarDestination)
    );
    if (areAllPartial) return ElementIdentificationAnswer.EdgeUnique;
  }

  return ElementIdentificationAnswer.No;
}

/**
 * Return the list of rules that do not have a signature template i.e. those
 * that we think can not produce triples that only them can produce.
 * @param rules List of rules 
 * @returns The list of rules that do not have a signature template
 */
export function filterRulesWithoutSignature(rules: PRSCRule[]): PRSCRule[] {
  // 1) Find which rules have a signature
  const signatures = findSignatureOfRules(rules);

  // 2) Find which rules are in the map
  const withSignature = new TermSet<RDF.Term>();

  for (const { rule } of signatures) {
    withSignature.add(rule.identity);
  }

  // 3) Build list of missings and return it
  return rules.filter(rule => !withSignature.has(rule.identity));
}

enum NodePlaceholder { Source, Destination }

/**
 * Checks if no value can be lost during the PG to RDF conversion
 * @param rule The rule
 * @returns True if no value can be lost during the PG to RDF conversion
 */
export function noValueLoss(rule: PRSCRule): boolean {
  const kappaToTriple = new TermMap<RDF.Quad, RDF.Quad | null>();

  for (const templateTriple of rule.template) {
    const kappaValue = characterizeTemplateTriple(templateTriple);

    if (kappaToTriple.has(kappaValue)) {
      kappaToTriple.set(kappaValue, null);
    } else {
      kappaToTriple.set(kappaValue, templateTriple);
    }
  }

  let foundValues = { src: false, dest: false, labels: new Set<string>() };

  for (const templateTriple of kappaToTriple.values()) {
    if (templateTriple === null) continue;

    const args = extractArgs(templateTriple);

    for (const arg of args) {
      if (arg === NodePlaceholder.Source) {
        foundValues.src = true;
      } else if (arg === NodePlaceholder.Destination) {
        foundValues.dest = true;
      } else {
        foundValues.labels.add(arg);
      }
    }
  }

  const isEdge = rule.kind === "edge";
  if (foundValues.src !== isEdge || foundValues.dest !== isEdge) return false;
  if (!haveSameStrings([...foundValues.labels], rule.properties)) return false;
  return true;
}


/** Extract the list of placeholders in the template triple */
function extractArgs(templateTriple: RDF.Quad): (string | NodePlaceholder)[] {
  let result: (string | NodePlaceholder)[] = [];

  function visit(term: RDF.Term) {
    if (term.termType === 'Quad') {
      visit(term.subject);
      visit(term.predicate);
      visit(term.object);
      visit(term.graph);
    } else if (term.termType === 'NamedNode') {
      if (term.equals(pvarSource)) result.push(NodePlaceholder.Source);
      if (term.equals(pvarDestination)) result.push(NodePlaceholder.Destination);
    } else if (term.termType === 'Literal') {
      if (term.datatype.equals(precValueOf)) {
        result.push(term.value);
      }
    }
  }

  visit(templateTriple);

  return result;
}

type EdgeUniqueViolation = {
  edgeUnique: PRSCRule;
  clashingRules: PRSCRule[];
};

function findEdgeUniqueViolations(edgeUniqueRules: PRSCRule[], all: PRSCRule[]): EdgeUniqueViolation[] {
  const detecter = new EdgeUniqueViolationDetector();

  for (const edgeUniqueRule of edgeUniqueRules) {
    detecter.addSignature(edgeUniqueRule);
  }

  for (const rule of all) {
    if (!edgeUniqueRules.includes(rule)) {
      detecter.addOtherRule(rule);
    }
  }

  return detecter.getViolations();
}

class EdgeUniqueViolationDetector {
  private signatureOfEdgeUniqueType = new TermMap<RDF.Quad, PRSCRule[]>();
  private detectedViolations = new TermMap<RDF.Term, EdgeUniqueViolation>();

  /** Adds the fact that the given edgeUnique rule is violated by the clasher */
  private addViolation(edgeUniqueRule: PRSCRule, clasher: PRSCRule) {
    let violationList = this.detectedViolations.get(edgeUniqueRule.identity);
    if (violationList === undefined) {
      violationList = { edgeUnique: edgeUniqueRule, clashingRules: [] };
      this.detectedViolations.set(edgeUniqueRule.identity, violationList);
    }

    if (!violationList.clashingRules.includes(clasher)) {
      violationList.clashingRules.push(clasher);
    }
  }

  /** Consider that every template triple of edgeUnique must be signature */
  addSignature(edgeUnique: PRSCRule) {
    const alreadyClashesWith = new TermSet<RDF.Term>();

    edgeUnique.template.forEach(templateTriple => {
      const kappa = characterizeTemplateTriple(templateTriple);

      const sign = this.signatureOfEdgeUniqueType.get(kappa);
      if (sign === undefined) {
        this.signatureOfEdgeUniqueType.set(kappa, [edgeUnique]);
      } else if (!sign.includes(edgeUnique)) {
        sign.forEach(sign1 => {
          if (!alreadyClashesWith.has(sign1.identity)) {
            alreadyClashesWith.add(sign1.identity);
            this.addViolation(edgeUnique, sign1);
            this.addViolation(sign1, edgeUnique);
          }
        });
        sign.push(edgeUnique);
      }
    });
  }

  addOtherRule(rule: PRSCRule) {
    const alreadyClashesWith = new TermSet<RDF.Term>();

    rule.template.forEach(templateTriple => {
      const kappa = characterizeTemplateTriple(templateTriple);
      const signatureOf = this.signatureOfEdgeUniqueType.get(kappa);
      if (signatureOf === undefined) return;

      signatureOf.forEach(rule => {
        if (!alreadyClashesWith.has(rule.identity)) {
          alreadyClashesWith.add(rule.identity);
          this.addViolation(rule, rule);
        }
      });
    })
  }

  getViolations(): EdgeUniqueViolation[] {
    return [...this.detectedViolations.values()];
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
export default function wellBehavedCheck(context: PRSCContext): true | WellBehavedViolation[] {
  let violations: WellBehavedViolation[] = [];

  let edgeUniqueRules: PRSCRule[] = [];
  
  for (const rule of context.prscRules) {
    const identifiable = elementIdentification(rule);

    if (identifiable === ElementIdentificationAnswer.No) {
      addViolation(violations, rule, "pvar:self is not in all triples");
    } else if (identifiable === ElementIdentificationAnswer.EdgeUnique) {
      edgeUniqueRules.push(rule);
    }

    if (!noValueLoss(rule)) {
      addViolation(violations, rule, "Some data from the Property Graph is lost");
    }
  }

  const rulesWithoutSignature = filterRulesWithoutSignature(context.prscRules);
  rulesWithoutSignature.forEach(ruleWithoutSignature =>
    addViolation(violations, ruleWithoutSignature, "No signature")
  );

  if (edgeUniqueRules.length !== 0) {
    const newViolations = findEdgeUniqueViolations(edgeUniqueRules, context.prscRules);
    for (const newViolation of newViolations) {
      addViolation(
        violations, newViolation.edgeUnique,
        'is a edge unique edge but its triples clashes with'
        + newViolation.clashingRules.map(rule => RDFString.termToString(rule.identity)).join(" and ")
      );
    }
  }

  return violations.length === 0 ? true : violations;
}
