import * as RDF from "@rdfjs/types";
import DStar, { Bindings, MatchResult } from "../dataset";
import { followAll, followThrough } from "../rdf/path-travelling";

import { DataFactory } from "n3";
import namespace from '@rdfjs/namespace';
import { eventuallyRebuildQuad } from "../rdf/quad-star";
const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", { factory: DataFactory });
const prec = namespace("http://bruy.at/prec#"                       , { factory: DataFactory });
const pvar = namespace("http://bruy.at/prec-trans#"                 , { factory: DataFactory });
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
        return DataFactory.literal("XX", prec._valueOf);
      } else {
        return term;
      }
    } else if (term.termType === 'BlankNode') {
      return DataFactory.literal('nodeOrIRI', prec._placeholder);
    } else if (term.termType === 'NamedNode') {
      if (term.value.startsWith(pvarPrefix)) {
        const pvarSelf = isEdge ? pvar.edge : pvar.node;
        if (term.equals(pvarSelf)) {
          return DataFactory.literal('self', prec._placeholder);
        }

        return DataFactory.literal('nodeOrIRI', prec._placeholder);
      } else {
        return term;
      }
    } else {
      return term;
    }
  })
}

function dataTripleAsUnified(quad: RDF.Quad): RDF.Quad {
  return quad;
  // TODO
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
    const identifiedDataQuad = dataTripleAsUnified(dataQuad);
    
    const f = identificationTriples.find(
      t => identifiedDataQuad.equals(tripleWithUnifiedTerms(t.triple, t.rule.type === 'edge'))
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
  throw Error("NYI");
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

