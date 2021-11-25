import * as RDF from "@rdfjs/types";
import namespace from '@rdfjs/namespace';
import TermSet from '@rdfjs/term-set';
import TermMap from "@rdfjs/term-map";
import { DataFactory } from "n3";
import * as RDFString from 'rdf-string';
import * as QuadStar from '../rdf/quad-star';


import DStar from "../dataset";
import {
  rdf, rdfs, pgo, prec, pvar,
  $quad, $literal, $variable, $defaultGraph
} from '../PRECNamespace';

const TTS = RDFString.termToString;

import { followThrough, followAll } from "../rdf/path-travelling";
import { eventuallyRebuildQuad } from "../rdf/quad-star";
import { unifyTemplateWithData } from "./possible-template-to-data-check";
import findPGTypeOfAllBlankNodesIn, { SignatureTripleOf } from "./reversion-type-identification";

const ex   = namespace("http://www.example.org/"                    , { factory: DataFactory });

const xsdString = DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#string");
const pvarPrefix = "http://bruy.at/prec-trans#";


////////////////////////////////////////////////////////////////////////////////
//




////////////////////////////////////////////////////////////////////////////////
// General purpose utilty functions

/**
 * Returns true if lhs and rhs contains the same strings.
 * 
 * Assumes that both array contains no duplicate.
 */
export function haveSameStrings(lhs: string[], rhs: string[]): boolean {
  if (lhs.length !== rhs.length) return false;

  for (const label of lhs) {
    if (!rhs.includes(label)) return false;
  }

  return true;
}


////////////////////////////////////////////////////////////////////////////////
// Schema detection

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

export class PRSCRule {
  readonly identity: RDF.Quad_Subject;
  readonly type: 'edge' | 'node';
  readonly labels: string[];
  readonly properties: string[];
  readonly template: RDF.Quad[];

  static build(context: DStar, identity: RDF.Quad_Subject): { rule: PRSCRule } | { violations: PRSCSchemaViolation[] } {
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
    const template = PRSCRule.#readTemplate(context, identity);

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

    return { rule: new PRSCRule(identity, nodeOrEdge!, labels, properties, template) };
  }

  private constructor(
    identity: RDF.Quad_Subject,
    type: 'node' | 'edge',
    labels: string[],
    properties: string[],
    template: RDF.Quad[]
  ) {
    this.identity = identity;
    this.type = type;
    this.labels = labels;
    this.properties = properties;
    this.template = template;
  }

  static #readTemplate(context: DStar, identity: RDF.Quad_Subject): RDF.Quad[] {
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
  
  prec0Production(
    output: DStar,
    pgElement: RDF.Quad_Subject,
    properties: {[key: string]: RDF.Quad_Object},
    source?: RDF.Quad_Subject,
    destination?: RDF.Quad_Subject
  ) {
    const blankNodeInstantiations = new TermMap<RDF.BlankNode, RDF.BlankNode>();

    this.template.forEach(templateQuad => {
      output.add(eventuallyRebuildQuad(templateQuad, term => {
        if (term.equals(pvar.node) || term.equals(pvar.edge) || term.equals(pvar.self)) {
          return pgElement;
        } else if (term.equals(pvar.source)) {
          return source!;
        } else if (term.equals(pvar.destination)) {
          return destination!;
        } else if (term.termType === 'Literal' && term.datatype.equals(prec._valueOf)) {
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
  
  findSignature(rules: PRSCRule[]): RDF.Quad {
    // TODO: a smarter choice of the signature for the case:
    // pvar:source :connected_to pvar:destination
    // pvar:destination :connected_to pvar:source
    // pvar:source :hello pvar:destination        -> We want this one
    const unifiedTriples = this.template.map(q => characterizeTemplateTriple(q));
    const unifiedOthers = rules.filter(r => r !== this)
      .map(r => r.template.map(q => characterizeTemplateTriple(q)));
  
    let result: number | null = null;

    for (let i = 0; i != unifiedTriples.length; ++i) {
      const triple = unifiedTriples[i];
      if (unifiedOthers.every(other => other.find(t => t.equals(triple)) === undefined)) {
        const value = getValuationOfTriple(this.template[i], this.type);

        if (value === ValuationResult.Ok) return this.template[i];
        else if (value === ValuationResult.Partial && result === null) result = i;
      }
    }
  
    if (result === null) {
      throw Error(`No unique triple found in ${RDFString.termToString(this.identity)}`);
    } else {
      return this.template[result];
    }
  }

  revertFromPrec0(dataGraph: DStar, self: RDF.Term, nodesOfEdge: [RDF.Term, RDF.Term] | null): { used: RDF.Quad[], prec0: RDF.Quad[] } {
    let matchPattern: RDF.Quad[] = [];

    this.template.forEach(templateQuad => {
      matchPattern.push(eventuallyRebuildQuad(
        templateQuad,
        term => {
          if (term.equals(pvar.node) || term.equals(pvar.edge) || term.equals(pvar.self)) return self;
          else if (term.equals(pvar.source)) return nodesOfEdge ? nodesOfEdge[0] : $variable("edge_source");
          else if (term.equals(pvar.destination)) return nodesOfEdge ? nodesOfEdge[1] : $variable("edge_destination");
          else if (term.termType === 'Literal' && term.datatype.equals(prec._valueOf))
            return $variable("property_" + term.value);
          else return term;
        }
      ));
    });

    const matchResult = dataGraph.matchAndBind(matchPattern);
    if (matchResult.length !== 1) {
//      console.error(matchPattern.map(t => RDFString.termToString(t)).join("\n"));
      throw Error("Not exactly one result: " + matchResult.length);
    }
  
    const matchResult1 = matchResult[0];

    if (nodesOfEdge !== null) {
      matchResult1['edge_source']      ||= nodesOfEdge[0];
      matchResult1['edge_destination'] ||= nodesOfEdge[1];
    }
    
    let toAdd: RDF.Quad[] = [
      $quad(self as RDF.Quad_Subject, rdf.type, this.type === 'node' ? pgo.Node : pgo.Edge)
    ];

    if (this.type === 'edge') {
      toAdd.push(
        $quad(self as RDF.Quad_Subject, rdf.subject, matchResult1['edge_source']      as RDF.Quad_Object),
        $quad(self as RDF.Quad_Subject, rdf.object , matchResult1['edge_destination'] as RDF.Quad_Object)
      );
    }

    this.labels.forEach(label => {
      let labelBlankNode = ex["vocab/" + this.type + "/label/" + label];
      let labelType = this.type === 'node' ? prec.CreatedNodeLabel : prec.CreatedEdgeLabel;
      toAdd.push(
        $quad(self as RDF.Quad_Subject, this.type === 'node' ? rdf.type : rdf.predicate, labelBlankNode),
        $quad(labelBlankNode, rdfs.label, $literal(label)),
        $quad(labelBlankNode, rdf.type, labelType),
        $quad(labelType, rdfs.subClassOf, prec.CreatedVocabulary)
      );
    });

    let labelsM = this.labels.map(x => x).sort().join("-");

    this.properties.forEach(propertyName => {
      let pn = ex["vocab/" + this.type + "/property/" + propertyName + "/" + labelsM];
      let bn = DataFactory.blankNode();

      let v = matchResult1["property_" + propertyName];
      if (v === undefined) throw Error("Invalid code logic in thePatternBecomesAMatch");

      toAdd.push(
        $quad(self as RDF.Quad_Subject, pn, bn),
        $quad(pn, rdfs.label, $literal(propertyName)),
        $quad(bn, rdf.value, v as RDF.Quad_Object),
        $quad(bn, rdf.type, prec.PropertyKeyValue),
        $quad(pn, rdf.type, prec.PropertyKey),
        $quad(pn, rdf.type, prec.CreatedPropertyKey),
        $quad(prec.CreatedPropertyKey, rdfs.subClassOf, prec.CreatedVocabulary)
      );
    });

    const used = matchResult1["@quads"];
  
    return { used, prec0: toAdd };
  }
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

enum ValuationResult { Ok, Partial, No };

function getValuationOfTriple(quad: RDF.Quad, type: 'node' | 'edge'): ValuationResult {
  if (type === 'node') {
    if (QuadStar.containsTerm(quad, pvar.node) || QuadStar.containsTerm(quad, pvar.self)) {
      return ValuationResult.Ok;
    } else {
      return ValuationResult.No;
    }
  } else {
    if (QuadStar.containsTerm(quad, pvar.edge) || QuadStar.containsTerm(quad, pvar.self)) {
      return ValuationResult.Ok;
    } else if (QuadStar.containsTerm(quad, pvar.source)
    && QuadStar.containsTerm(quad, pvar.destination)) {
      return ValuationResult.Partial;
    } else {
      return ValuationResult.No;
    }
  }
}

export class PRSCSchema {
  prscRules: PRSCRule[] = [];

  static build(contextQuads: RDF.Quad[]): { schema: PRSCSchema } | { violations: PRSCSchemaViolation[] } {
    const rules: PRSCRule[] = [];
    const violations: PRSCSchemaViolation[] = [];
    const dataset = new DStar(contextQuads);
    const alreadySeenTypes = new TermSet();

    for (const type of [prec.prsc_node, prec.prsc_edge]) {
      for (const ruleQuad of dataset.match(null, rdf.type, type, $defaultGraph)) {
        // 
        if (alreadySeenTypes.has(ruleQuad.subject)) continue;
        alreadySeenTypes.add(ruleQuad.subject);

        // Read and add the rule
        const thisRule = PRSCRule.build(dataset, ruleQuad.subject);
        if ('violations' in thisRule) {
          violations.push(...thisRule.violations);
        } else {
          rules.push(thisRule.rule);
        }
      }
    }

    if (violations.length !== 0) {
      return { violations };
    } else {
      return { schema: new PRSCSchema(rules) };
    }
  }

  private constructor(rules: PRSCRule[]) {
    this.prscRules = rules;
  }

  applyContext(dataset: DStar): DStar {
    let result = new DStar();

    for (const pgElement of dataset.match(null, rdf.type, pgo.Node, $defaultGraph)) {
      this.#produceQuads(dataset, pgElement.subject, 'node', result);
    }

    for (const pgElement of dataset.match(null, rdf.type, pgo.Edge, $defaultGraph)) {
      this.#produceQuads(dataset, pgElement.subject, 'edge', result);
    }

    return result;
  }

  #produceQuads(dataset: DStar, element: RDF.Quad_Subject, t: 'node' | 'edge', result: DStar) {
    const toLabel = t === 'node' ? rdf.type : rdf.predicate;

    let pgElement = {
      labels: dataset.matchAndBind([
        $quad(element, toLabel, $variable('labelIRI')),
        $quad($variable('labelIRI'), rdfs.label, $variable('label'))
      ]).map(binding => (binding.label as RDF.Term).value),
      properties: dataset.matchAndBind([
        $quad(element, $variable('propertyName'), $variable('blankNode')),
        $quad($variable('propertyName'), rdfs.label, $variable('propertyNameLabel')),
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
      if (rule.type !== t) return false;
      if (!haveSameStrings(rule.labels, pgElement.labels)) return false;
      if (!haveSameStrings(rule.properties, Object.keys(pgElement.properties))) return false;
      return true;
    })

    if (rule === undefined) {
      throw Error(`No rule matches the PG ${t} mapped to ${RDFString.termToString(element)}`);
    }

    rule.prec0Production(
      result, element, pgElement.properties,
      t === 'edge' ? followThrough(dataset, element, rdf.subject)! as RDF.Quad_Subject : undefined,
      t === 'edge' ? followThrough(dataset, element, rdf.object )! as RDF.Quad_Subject : undefined
    );
  }

  getAllSignatures(): SignatureTripleOf[] {
    return this.prscRules
      .map(rule => ({
        rule: rule,
        signature: rule.findSignature(this.prscRules)
      }));
  }
}

export type PRSCSchemaViolation = { identity: RDF.Quad_Subject } & (
  { type: 'rule_bad_type_qtt', message: string }
  | { type: 'rule_given_bad_type', foundType: RDF.Quad_Object }
  | { type: 'template_has_invalid_prop_name', propName: string }
);

export function violationsToString(violations: PRSCSchemaViolation[], delimiter: string = " ; "): string {
  return violations.map(violation => violationToString(violation)).join(delimiter);
}

export function violationToString(violation: PRSCSchemaViolation): string {
  if (violation.type === 'rule_bad_type_qtt') {
    return `${RDFString.termToString(violation.identity)} does not have exactly one type`;
  } else if (violation.type === 'rule_given_bad_type') {
    return `${RDFString.termToString(violation.identity)} has the type ${RDFString.termToString(violation.foundType)} `
      + 'which is different from the expected types prec:prsc_node and prec:prsc_edge.'
  } else if (violation.type === 'template_has_invalid_prop_name') {
    return RDFString.termToString(violation.identity)
      + " uses the property name " + violation.propName
      + " in its template but it is not a property in the described type."
  } else {
    return 'Unknown violation';
  }
}

export function assertSchema(r: { schema: PRSCSchema } | { violations: PRSCSchemaViolation[] }): PRSCSchema {
  if ('violations' in r) {
    throw Error("The given schema is invalid: " + violationsToString(r.violations));
  }

  return r.schema;
}

////////////////////////////////////////////////////////////////////////////////
// ==== Structural description graph -> Idiomatic Graph


export function isPrscContext(contextQuads: RDF.Quad[]) {
  const searched = $quad(prec.this_is, rdf.type, prec.prscContext);
  return contextQuads.find(q => q.equals(searched)) !== undefined;
}

export default function precCwithPRSC(dataset: DStar, contextQuads: RDF.Quad[]): DStar {
  const schema = assertSchema(PRSCSchema.build(contextQuads));
  return schema.applyContext(dataset);
}


////////////////////////////////////////////////////////////////////////////////
// ==== Structural description graph <- Idiomatic Graph

export function revertPrecC(dataset: DStar, contextQuads: RDF.Quad[]): { dataset: DStar, complete: boolean } {
  dataset = dataset.match();

  const schema = assertSchema(PRSCSchema.build(contextQuads));
  const signatures = schema.getAllSignatures();

  const usedQuads = new DStar();

  const blankNodesToType = findPGTypeOfAllBlankNodesIn(
    dataset, signatures, usedQuads
  );

  const prec0Graph = new DStar();
  for (const [self, { linkedNodes, rule }] of blankNodesToType.entries()) {
    const { used, prec0 } = rule.revertFromPrec0(dataset, self, linkedNodes);
    prec0Graph.addAll(prec0);
    usedQuads.addAll(used);
  }

  return {
    dataset: prec0Graph,
    complete: usedQuads.size === dataset.size
  };
}


/**
 * Return the unified form of the triple.
 * 
 * The unified form is the triple with pvar nodes and ^^prec:_valueOf merged
 */
export function characterizeTemplateTriple(quad: RDF.Quad) {
  return eventuallyRebuildQuad(quad, term => {
    if (term.termType === 'Literal') {
      return $literal("Literal", prec._valueOf);
    } else if (term.termType === 'BlankNode') {
      throw Error("A template quad should not contain any blank node");
    } else if (term.termType === 'NamedNode' && term.value.startsWith(pvarPrefix)) {
      return $literal('BlankNode', prec._placeholder);
    } else {
      return term;
    }
  });
}

export function canTemplateProduceData(pattern: RDF.Quad, data: RDF.Quad): boolean {
  return unifyTemplateWithData(pattern, data) !== null;
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
