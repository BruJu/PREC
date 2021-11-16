import * as RDF from "@rdfjs/types";
import { DataFactory } from "n3";
import DStar from "../dataset";
import * as RDFString from 'rdf-string';
import * as QuadStar from '../rdf/quad-star';

const $quad         = DataFactory.quad;
const $literal      = DataFactory.literal;
const $variable     = DataFactory.variable;
const $defaultGraph = DataFactory.defaultGraph();

import namespace from '@rdfjs/namespace';
import { followThrough, followAll } from "../rdf/path-travelling";
import { eventuallyRebuildQuad } from "../rdf/quad-star";
const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", { factory: DataFactory });
const rdfs = namespace("http://www.w3.org/2000/01/rdf-schema#"      , { factory: DataFactory });
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#"                  , { factory: DataFactory });
const prec = namespace("http://bruy.at/prec#"                       , { factory: DataFactory });
const pvar = namespace("http://bruy.at/prec-trans#"                 , { factory: DataFactory });
const ex   = namespace("http://www.example.org/"                    , { factory: DataFactory });

const xsdString = DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#string");
const pvarPrefix = "http://bruy.at/prec-trans#";


////////////////////////////////////////////////////////////////////////////////
//

type IdentificationTriple = {
  rule: PRSCRule;
  triple: RDF.Quad;
};

////////////////////////////////////////////////////////////////////////////////
// General purpose utilty functions

/**
 * Returns true if lhs and rhs contains the same strings.
 * 
 * Assumes that both array contains no duplicate.
 */
function haveSameStrings(lhs: string[], rhs: string[]): boolean {
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

class PRSCRule {
  readonly identity: RDF.Quad_Subject;
  readonly type: 'edge' | 'node';
  readonly labels: string[];
  readonly properties: string[];
  readonly template: RDF.Quad[];

  constructor(context: DStar, identity: RDF.Quad_Subject) {
    this.identity = identity;

    const type = followThrough(context, identity, rdf.type);
    if (type === null) throw Error(`${RDFString.termToString(identity)} is an invalid PRSC rule: must have one type`);
    else if (type.equals(prec.prsc_node)) this.type = 'node';
    else if (type.equals(prec.prsc_edge)) this.type = 'edge';
    else throw Error(`${RDFString.termToString(identity)} is an invalid PRSC rule: has a bad type`);

    if (this.type === 'node') {
      this.labels = followAllXSDStrings(context, identity, prec.nodeLabel);
    } else {
      this.labels = followAllXSDStrings(context, identity, prec.edgeLabel);
    }

    this.properties = followAllXSDStrings(context, identity, prec.propertyName);

    this.template = PRSCRule.#readTemplate(context, identity);

    // TODO : check if the template is well formed WRT the properties
  }

  static #readTemplate(context: DStar, identity: RDF.Quad_Subject): RDF.Quad[] {
    return (followAll(context, identity, prec.composedOf) as RDF.Quad[])
      .map(quad => eventuallyRebuildQuad(quad, PRSCRule.#removeBlankNodes(context)));
  }
  
  static #removeBlankNodes(context: DStar): (quad: RDF.Term) => RDF.Term {
    return (term: RDF.Term) => {
      if (term.termType === 'BlankNode') {
        const valueOf = followThrough(context, term, prec.prsc_valueOf);
        if (valueOf === null) throw Error("invalid template (blank node is bad)");
        return DataFactory.literal(valueOf.value, prec._valueOf);
      } else {
        return term;
      }
    };
  }

  prec0Production(
    output: DStar,
    pgElement: RDF.Quad_Subject,
    properties: {[key: string]: RDF.Quad_Object},
    source?: RDF.Quad_Subject,
    destination?: RDF.Quad_Subject
  ) {
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
        } else {
          return term;
        }
      }));
    });
  }
  
  findIdentificationTriple(rules: PRSCRule[]): RDF.Quad {
    const unifiedTriples = this.template.map(q => tripleWithUnifiedTerms(q));
    const unifiedOthers = rules.filter(r => r !== this)
      .map(r => r.template.map(q => tripleWithUnifiedTerms(q)));
  
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
          else if (term.equals(pvar.source)) return nodesOfEdge![0];
          else if (term.equals(pvar.destination)) return nodesOfEdge![1];
          else if (term.termType === 'Literal' && term.datatype.equals(prec._valueOf))
            return $variable("property_" + term.value);
          else return term;
        }
      ));
    });

    const matchResult = dataGraph.matchAndBind(matchPattern);
    if (matchResult.length !== 1) throw Error("More than one result");
  
    const matchResult1 = matchResult[0];

    if (nodesOfEdge !== null) {
      matchResult1['edge_source']      ||= nodesOfEdge![0];
      matchResult1['edge_destination'] ||= nodesOfEdge![1];
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

class PRSCSchema {
  prscRules: PRSCRule[] = [];

  constructor(contextQuads: RDF.Quad[]) {
    const dataset = new DStar(contextQuads);

    for (const nodeForm of dataset.match(null, rdf.type, prec.prsc_node, $defaultGraph)) {
      this.prscRules.push(new PRSCRule(dataset, nodeForm.subject));
    }

    for (const edgeForm of dataset.match(null, rdf.type, prec.prsc_edge, $defaultGraph)) {
      this.prscRules.push(new PRSCRule(dataset, edgeForm.subject));
    }
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

  findIdentificationTriples(): IdentificationTriple[] {
    return this.prscRules
      .map(rule => ({
        rule: rule,
        triple: rule.findIdentificationTriple(this.prscRules)
      }));
  }
}

////////////////////////////////////////////////////////////////////////////////
// ==== Structural description graph -> Idiomatic Graph


export function isPrscContext(contextQuads: RDF.Quad[]) {
  const searched = $quad(prec.this_is, rdf.type, prec.prscContext);
  return contextQuads.find(q => q.equals(searched)) !== undefined;
}

export default function precCwithPRSC(dataset: DStar, contextQuads: RDF.Quad[]) {
  return new PRSCSchema(contextQuads).applyContext(dataset);
}


////////////////////////////////////////////////////////////////////////////////
// ==== Structural description graph <- Idiomatic Graph



export function revertPrecC(dataset: DStar, contextQuads: RDF.Quad[]): { dataset: DStar, complete: boolean } {
  dataset = dataset.match();

  const schema = new PRSCSchema(contextQuads);
  const identificationTriples = schema.findIdentificationTriples();

  const usedQuads = new DStar();
  const listOfUsedRules: { term: RDF.Term, terms: [RDF.Term, RDF.Term] | null, rule: PRSCRule }[] = [];
  for (const dataQuad of dataset) {    
    const f = identificationTriples.find(
      t => isPossibleSourceFor(t.triple, dataQuad)
    );

    if (f === undefined) continue;

    listOfUsedRules.push(findElement(dataQuad, f));
    usedQuads.add(dataQuad);
  }

  const prec0Graph = new DStar();
  for (const { term, terms, rule } of listOfUsedRules) {
    const { used, prec0 } = rule.revertFromPrec0(dataset, term, terms);
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
 function tripleWithUnifiedTerms(quad: RDF.Quad) {
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

export function isPossibleSourceFor(pattern: RDF.Quad, data: RDF.Quad): boolean {
  function isPossibleSourceTermFor(pattern: RDF.Term, data: RDF.Term): boolean {
    if (
      pattern.equals(pvar.self)
      || pattern.equals(pvar.node)
      || pattern.equals(pvar.edge)
      || pattern.equals(pvar.source)
      || pattern.equals(pvar.destination)
    ) {
      return data.termType === 'BlankNode';
    }

    if (pattern.termType === 'Literal' && pattern.datatype.equals(prec._valueOf)) {
      return data.termType === 'Literal';
    }

    if (data.termType === 'BlankNode') return false;

    if (pattern.termType !== data.termType) {
      return false;
    } else if (pattern.termType === 'Quad' && data.termType === 'Quad') {
      return isPossibleSourceTermFor(pattern.subject, data.subject) && 
        isPossibleSourceTermFor(pattern.predicate, data.predicate) &&
        isPossibleSourceTermFor(pattern.object, data.object) &&
        isPossibleSourceTermFor(pattern.graph, data.graph);
    } else {
      return pattern.equals(data);
    }
  }

  return isPossibleSourceTermFor(pattern, data);
}


function findElement(dataQuad: RDF.Quad, f: { rule: PRSCRule, triple: RDF.Quad })
: { term: RDF.Term, terms: [RDF.Term, RDF.Term] | null, rule: PRSCRule } {
  let self: RDF.Term | null = null;
  let source: RDF.Term | null = null;
  let destination: RDF.Term | null = null;

  function recurseIn(data: RDF.Term, template: RDF.Term) {
    if (template.equals(pvar.node) || template.equals(pvar.edge) || template.equals(pvar.self)) {
      self = data;
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

  recurseIn(dataQuad, f.triple);

  if (f.rule.type === 'node') {
    if (self === null) throw Error("Did not found pvar:node in template");
    return { term: self, terms: null, rule: f.rule };
  } else if (f.rule.type === 'edge') {
    if (self === null) {
      if (source === null || destination === null) {
        throw Error("Did not found pvar:node nor pvar:source + pvar:destination in template");
      }

      self = DataFactory.blankNode();
    }

    let src = source || $variable("edge_source");
    let dst = destination || $variable("edge_destination");

    return { term: self, terms: [src, dst], rule: f.rule };
  } else {
    throw Error("Impossible path by design");
  }
}
