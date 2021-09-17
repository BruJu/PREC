import * as RDF from "@rdfjs/types";
import DStar, { Bindings, MatchResult } from "../dataset";
import { followAll, followThrough } from "../rdf/path-travelling";

import { DataFactory } from "n3";
import namespace from '@rdfjs/namespace';
import { eventuallyRebuildQuad } from "../rdf/quad-star";
const ex   = namespace("http://example.org/"                        , { factory: DataFactory });
const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", { factory: DataFactory });
const rdfs = namespace("http://www.w3.org/2000/01/rdf-schema#"      , { factory: DataFactory });
const prec = namespace("http://bruy.at/prec#"                       , { factory: DataFactory });
const pvar = namespace("http://bruy.at/prec-trans#"                 , { factory: DataFactory });
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#"                  , { factory: DataFactory });
const $literal = DataFactory.literal;
const $quad = DataFactory.quad;
const $variable = DataFactory.variable;
const $dg = DataFactory.defaultGraph();
const pvarPrefix = "http://bruy.at/prec-trans#";


class PRSCRule {
  identity: RDF.Quad_Subject;
  type: 'edge' | 'node';
  labels: string[];
  properties: string[];
  template: RDF.Quad[];

  constructor(context: DStar, identity: RDF.Quad_Subject) {
    this.identity = identity;
    const type = followThrough(context, identity, rdf.type);
    if (type === null) throw Error("Invalid PRSC rule (not 1 type)");
    if (type.equals(prec.prsc_node)) this.type = 'node';
    else if (type.equals(prec.prsc_edge)) this.type = 'edge';
    else throw Error("Invalid PRSC rule (bad type");

    if (this.type === 'node') {
      this.labels = followAll(context, identity, prec.nodeLabel).map(q => q.value);
    } else if (this.type === 'edge') {
      this.labels = followAll(context, identity, prec.edgeLabel).map(q => q.value);
    } else throw Error("impossible");

    this.properties = followAll(context, identity, prec.propertyName).map(q => q.value);

    this.template = PRSCRule.#readTemplate(context, identity);
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
}

/**
 * Returns the triple in unified term format in `rule` that is not found in
 * `rules`
 */
function findUniqueTriple(rule: PRSCRule, rules: PRSCRule[]) {
  const unifiedTriples = rule.template.map(q => tripleWithUnifiedTerms(q, rule.type === 'edge'));
  const unifiedOthers = rules.filter(r => r !== rule)
    .map(r => r.template.map(q => tripleWithUnifiedTerms(q, r.type === 'edge')))

  for (let i = 0; i != unifiedTriples.length; ++i) {
    const triple = unifiedTriples[i];
    if (unifiedOthers.every(other => other.find(t => t.equals(triple)) === undefined)) {
      return rule.template[i];
    }
  }

  throw Error("No unique triple found in " + rule.identity.value);
}

/**
 * Return the unified form of the triple.
 * 
 * The unified form is the triple with pvar nodes and ^^prec:_valueOf merged
 */
function tripleWithUnifiedTerms(quad: RDF.Quad, isEdge: boolean) {
  return eventuallyRebuildQuad(quad, term => {
    if (term.termType === 'Literal') {
      if (term.datatype.equals(prec._valueOf)) {
        return $literal("XX", prec._valueOf);
      } else {
        return term;
      }
    } else if (term.termType === 'BlankNode') {
      return $literal('nodeOrIRI', prec._placeholder);
    } else if (term.termType === 'NamedNode') {
      if (term.value.startsWith(pvarPrefix)) {
        const pvarSelf = isEdge ? pvar.edge : pvar.node;
        if (term.equals(pvarSelf)) {
          return $literal('self', prec._placeholder);
        }

        return $literal('nodeOrIRI', prec._placeholder);
      } else {
        return term;
      }
    } else {
      return term;
    }
  })
}

function isPossibleSourceFor(pattern: RDF.Quad, data: RDF.Quad): boolean {
  function isPossibleSourceTermFor(pattern: RDF.Term, data: RDF.Term): boolean {
    if (pattern.termType === 'Literal' && pattern.datatype.equals(prec._placeholder)) {
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

export default function precCRevert(dataset: DStar, contextQuads: RDF.Quad[]) {
  dataset = dataset.match();

  const contextDstar = new DStar(contextQuads);
  const rules = [
    ...contextDstar.match(null, rdf.type, prec.prsc_node, $dg),
    ...contextDstar.match(null, rdf.type, prec.prsc_edge, $dg)
  ].map(q => new PRSCRule(contextDstar, q.subject));

  const identificationTriples = rules.map(
    rule => ({ rule: rule, triple: findUniqueTriple(rule, rules) })
  );

  const usedQuads = new DStar();
  const listOfUsedRules: { term: RDF.Term, rule: PRSCRule }[] = [];
  for (const dataQuad of dataset) {    
    const f = identificationTriples.find(
      t => isPossibleSourceFor(
        tripleWithUnifiedTerms(t.triple, t.rule.type === 'edge'),
        dataQuad
      )
    );

    if (f === undefined) continue;

    const element = findElement(dataQuad, f);
    listOfUsedRules.push({ term: element, rule: f.rule });
    usedQuads.add(dataQuad);
  }

  const prec0Graph = new DStar();
  for (const { term, rule } of listOfUsedRules) {
    const { used, prec0 } = buildPrec0Element(dataset, term, rule);
    prec0Graph.addAll(prec0);
    usedQuads.addAll(used);
  }

  if (usedQuads.size !== dataset.size) {
    console.error("Not all quads were consumed");
  }

  return prec0Graph;
}

function findElement(dataQuad: RDF.Quad, f: { rule: PRSCRule, triple: RDF.Quad }): RDF.Term {
  const lookingFor = f.rule.type === 'edge' ? pvar.edge : pvar.node;

  const position = ((): 'subject' | 'predicate' | 'object' => {
    if (f.triple.subject.equals(lookingFor)) return 'subject';
    if (f.triple.predicate.equals(lookingFor)) return 'predicate';
    if (f.triple.object.equals(lookingFor)) return 'object';
    throw Error("Did not found " + lookingFor.value + " in template");
  })();

  return dataQuad[position];
}

function thePatternBecomesAMatch(self: RDF.Term, rule: PRSCRule)
: { matchPattern: RDF.Quad[], quadBuilder: (binding: MatchResult) => RDF.Quad[] } {
  
  let matchPattern: RDF.Quad[] = [];

  rule.template.forEach(templateQuad => {
    matchPattern.push(eventuallyRebuildQuad(
      templateQuad,
      term => {
        if (term.equals(pvar.node)) {
          if (rule.type === 'edge') throw Error("Invalid template - pvar:node in edge template");
          return self;
        } else if (term.equals(pvar.edge)) {
          if (rule.type === 'node') throw Error("Invalid template - pvar:edge in node template");
          return self;
        } else if (term.equals(pvar.source)) {
          if (rule.type === 'node') throw Error("Invalid template - pvar:source in node template");
          return $variable("edge_source");
        } else if (term.equals(pvar.destination)) {
          if (rule.type === 'node') throw Error("Invalid template - pvar:destination in node template");
          return $variable("edge_destination");
        } else if (term.termType === 'Literal' && term.datatype.equals(prec._valueOf)) {
          return $variable("property_" + term.value)
        }

        return term;
      }
    ));
  });

  let quadBuilder = (binding: MatchResult) => {
    let quads: RDF.Quad[] = [
      $quad(self as RDF.Quad_Subject, rdf.type, rule.type === 'node' ? pgo.Node : pgo.Edge)
    ];

    if (rule.type === 'edge') {
      quads.push(
        $quad(self as RDF.Quad_Subject, rdf.subject, binding['edge_source']      as RDF.Quad_Object),
        $quad(self as RDF.Quad_Subject, rdf.object , binding['edge_destination'] as RDF.Quad_Object)
      );
    }

    rule.labels.forEach(label => {
      let labelBlankNode = DataFactory.blankNode();
      quads.push(
        $quad(self as RDF.Quad_Subject, rule.type === 'node' ? rdf.type : rdf.predicate, labelBlankNode),
        $quad(labelBlankNode, rdfs.label, $literal(label))
      );
    });

    let labelsM = rule.labels.map(x => x).sort().join("/");

    rule.properties.forEach(propertyName => {
      let pn = ex[labelsM + "/" + propertyName];
      let bn = DataFactory.blankNode();

      let v = binding["property_" + propertyName];
      if (v === undefined) throw Error("Invalid code logic in thePatternBecomesAMatch");

      quads.push(
        $quad(self as RDF.Quad_Subject, pn, bn),
        $quad(pn, rdfs.label, $literal(propertyName)),
        $quad(bn, rdf.value, v as RDF.Quad_Object)
      );
    });

    return quads;
  };

  return {
    matchPattern,
    quadBuilder
  }
}

function buildPrec0Element(dataset: DStar, element: RDF.Term, rule: PRSCRule)
: { used: RDF.Quad[], prec0: RDF.Quad[] } {

  const {
    matchPattern,
    quadBuilder
  } = thePatternBecomesAMatch(element, rule);

  const matchResult = dataset.matchAndBind(matchPattern);
  if (matchResult.length !== 1) throw Error("More than one result");

  const matchResult1 = matchResult[0];
  const toAdd = quadBuilder(matchResult1);
  const used = matchResult1["@quads"];

  return { used, prec0: toAdd };
}

