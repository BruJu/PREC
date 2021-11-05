import * as RDF from "@rdfjs/types";
import { DataFactory } from "n3";
import DStar, { MatchResult } from "../dataset";
import * as RDFString from 'rdf-string';
import * as QuadStar from '../rdf/quad-star';

const $quad         = DataFactory.quad;
const $literal      = DataFactory.literal;
const $variable     = DataFactory.variable;
const $defaultGraph = DataFactory.defaultGraph();

import namespace from '@rdfjs/namespace';
import { followThrough, followAll } from "../rdf/path-travelling";
import { eventuallyRebuildQuad } from "../rdf/quad-star";
import TermMap from "@rdfjs/term-map";
import TermSet from "@rdfjs/term-set";

const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", { factory: DataFactory });
const rdfs = namespace("http://www.w3.org/2000/01/rdf-schema#"      , { factory: DataFactory });
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#"                  , { factory: DataFactory });
const prec = namespace("http://bruy.at/prec#"                       , { factory: DataFactory });
const pvar = namespace("http://bruy.at/prec-trans#"                 , { factory: DataFactory });
const ex   = namespace("http://www.example.org/"                    , { factory: DataFactory });

const xsdString = DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#string");
// const pvarPrefix = "http://bruy.at/prec-trans#";

type RDFPosition = 'subject' | 'predicate' | 'object' | 'graph';
const RDFPositions: RDFPosition[] = ['subject', 'predicate', 'object', 'graph'];

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

/**
 * Return true if the two graphs are strictly equals.
 * @param lhs A graph
 * @param rhs Another graph
 * @returns True if the two graphs have exactly the same quads
 */
function areStrictlyEqualGraphs(lhs: RDF.DatasetCore, rhs: RDF.DatasetCore) {
  if (lhs.size !== rhs.size) return false;

  for (const quad of lhs) {
    if (!rhs.has(quad)) {
      return false;
    }
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

  isUniqueEdgeType() {
    if (this.type !== 'edge') return false;
    return undefined === this.template.find(templateTriple => 
      QuadStar.containsTerm(templateTriple, pvar.self)
      && QuadStar.containsTerm(templateTriple, pvar.edge)
    );
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
  
  buildBackPREC0(self: RDF.Term, bindings: MatchResult): { used: RDF.Quad[], prec0: RDF.Quad[] } {
    let toAdd: RDF.Quad[] = [
      $quad(self as RDF.Quad_Subject, rdf.type, this.type === 'node' ? pgo.Node : pgo.Edge)
    ];

    if (this.type === 'edge') {
      toAdd.push(
        $quad(self as RDF.Quad_Subject, rdf.subject, bindings['pvar_source']      as RDF.Quad_Object),
        $quad(self as RDF.Quad_Subject, rdf.object , bindings['pvar_destination'] as RDF.Quad_Object)
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

      let v = bindings["property_" + propertyName];
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

    const used = bindings["@quads"];
  
    return { used, prec0: toAdd };
  }

  couldHaveProduced(
    subgraph: DStar,
    initial: { self?: RDF.BlankNode, source?: RDF.BlankNode, destination?: RDF.BlankNode }
  ): MatchResult | false {
    const matchPattern = buildMatchPatternFromTemplate(
      this.template,
      initial.self || $variable("pvar_self"),
      initial.source || $variable("pvar_source"),
      initial.destination || $variable("pvar_destination")
    );

    const matchResults = subgraph.matchAndBind(matchPattern)
      .filter(mr => isConsistentEvaluation(mr, subgraph));

    if (matchResults.length === 0) {
      return false;
    } else if (matchResults.length === 1) {
      const result = matchResults[0];
      if ('pvar_self' in result) {
        throw Error("couldHaveProduced used on a template with pvar:self, "
        + RDFString.termToString(this.identity)
        + ", but without specifying the value of pvar:self");
      }
      if (initial.source) result['pvar_source'] = initial.source;
      if (initial.destination) result['pvar_destination'] = initial.destination;

      return matchResults[0];
    } else {
      throw Error("More than one possible evaluation");
    }
  }
}

function buildMatchPatternFromTemplate(
  template: RDF.Quad[],
  self: RDF.Term, source: RDF.Term, destination: RDF.Term
) {
  return template.map(templateQuad =>
    eventuallyRebuildQuad(
      templateQuad,
      term => {
        if (term.equals(pvar.node) || term.equals(pvar.edge) || term.equals(pvar.self)) return self;
        else if (term.equals(pvar.source)) return source;
        else if (term.equals(pvar.destination)) return destination;
        else if (term.termType === 'Literal' && term.datatype.equals(prec._valueOf))
          return $variable("property_" + term.value);
        else return term;
      }
    )
  );
}

function isConsistentEvaluation(matchResult: MatchResult, graph: DStar) {
  for (const [key, value] of Object.entries(matchResult)) {
    if (key === '@quads') {
      if (!Array.isArray(value)) return false; // should never happen

      if (!areStrictlyEqualGraphs(graph, new DStar(value))) return false;
    } else {
      if (Array.isArray(value)) return false; // should never happen

      if (key.startsWith("pvar_")) {
        if (value.termType !== 'BlankNode') return false;
      } else if (key.startsWith("property_")) {
        if (value.termType !== 'Literal') return false;
      }
    }
  }

  return true;
}

function findListOfBlankNodesIn(quad: RDF.Quad) {
  function extractBlankNodes(quad: RDF.Quad) {
    const result: RDF.BlankNode[] = [];
  
    for (const pos of RDFPositions) {
      if (quad[pos].termType === 'Quad') result.push(...extractBlankNodes(quad[pos] as RDF.Quad));
      else if (quad[pos].termType === 'BlankNode') result.push(quad[pos] as RDF.BlankNode);
    }
  
    return result;
  }

  function uniquefyBlankNodeList(list: RDF.BlankNode[]): RDF.BlankNode[] {
    let res = list
    .map(bn => ({ node: bn, str: RDFString.termToString(bn) }))
    .sort((e1, e2) => e1.str.localeCompare(e2.str) )
    .map(e => e.node);
  
    let i = 1;
    while (i < res.length) {
      if (res[i - 1].equals(res[i])) {
        res.splice(i, 1);
      } else {
        ++i;
      }
    }
  
    return res;
  }

  return uniquefyBlankNodeList(extractBlankNodes(quad));
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

  static cutGraphByBlankNodes(dataset: DStar): {
    blankNodes: TermMap<RDF.BlankNode, DStar>,
    suspiciousGangs: Map<string, SuspiciousGang>
  } {
    const bnToSubGraph = new TermMap<RDF.BlankNode, DStar>();
    const suspiciousGangs = new Map<string, SuspiciousGang>();
    for (const quad of dataset) {
      const extractedBNs = findListOfBlankNodesIn(quad);

      for (const blankNode of extractedBNs) {
        if (bnToSubGraph.get(blankNode) === undefined) {
          bnToSubGraph.set(blankNode, new DStar());
        }

        bnToSubGraph.get(blankNode)!.add(quad);
      }

      if (extractedBNs.length === 2) {
        const id = extractedBNs.map(t => RDFString.termToString(t)).join(" ");
        const alreadyHere = suspiciousGangs.get(id);
        if (alreadyHere !== undefined) {
          alreadyHere.quads.add(quad);
        } else {
          suspiciousGangs.set(id, {
            identifier: extractedBNs as [RDF.BlankNode, RDF.BlankNode],
            quads: new DStar([quad])
          });
        }
      }
    }

    return {
      blankNodes: bnToSubGraph,
      suspiciousGangs: suspiciousGangs
    };
  }

  getAnonymousEdgeTemplateTriples(): RDF.Quad[] {
    return this.prscRules
    .filter(rule => rule.type === 'edge')
    .flatMap(rule => rule.template.filter(templateTriple => 
      QuadStar.containsTerm(templateTriple, pvar.source)
      && QuadStar.containsTerm(templateTriple, pvar.destination)
      && !QuadStar.containsTerm(templateTriple, pvar.self)
      && !QuadStar.containsTerm(templateTriple, pvar.edge)
      ));
  }

  static filterOutNonNodesDataTriple(
    allDataTriples: DStar,
    templateTriplesBanList: RDF.Quad[]
  ): { nodeGraph: DStar, banned: DStar } {
    function onlyOneDistinctBN(dataTriple: RDF.Quad) {
      return findListOfBlankNodesIn(dataTriple).length === 1;
    }

    function banned(data: RDF.Quad) {
      return templateTriplesBanList.find(
        template => templateCanProduceData(template, data)
      );
    }

    const onlyThis = [...allDataTriples].filter(triple => onlyOneDistinctBN(triple));

    return onlyThis.reduce((acc, quad) => {
      const target = banned(quad) ? acc.banned : acc.nodeGraph;
      target.add(quad);

      return acc;
    }, { nodeGraph: new DStar(), banned: new DStar() });
  }

  findTypesOfBlankNodes(dataset: DStar): IdentifiedPGElement[] {
    const identified: IdentifiedPGElement[] = [];

    const { blankNodes, suspiciousGangs } = PRSCSchema.cutGraphByBlankNodes(dataset);

    const anonymousEdgeTemplateTriples = this.getAnonymousEdgeTemplateTriples();

    const edgeBNs = new TermSet<RDF.BlankNode>();

    for (const [blankNode, subgraphIfEdge] of blankNodes.entries()) {
      const {
        nodeGraph: subgraphIfNode, banned
      } = PRSCSchema.filterOutNonNodesDataTriple(subgraphIfEdge, anonymousEdgeTemplateTriples);

      if (banned.size !== 0) {
        suspiciousGangs.set(RDFString.termToString(blankNode), {
          identifier: [blankNode, blankNode], quads: banned
        });
      }

      const candidates = this.prscRules.map(
        rule => {
          const subgraph = rule.type === 'edge' ? subgraphIfEdge : subgraphIfNode;
          const variables = rule.couldHaveProduced(subgraph, { "self": blankNode });
          return variables !== false ? { rule, variables } : null;
        }
      ).filter(result => result !== null) as { rule: PRSCRule, variables: MatchResult}[];

      if (candidates.length !== 1) {
        throw Error(
          `The blank node ${RDFString.termToString(blankNode)} has`
          + ` ${candidates.length} type candidates. It should have 1.`
        );
      }

      identified.push({
        identifier: blankNode,
        rule: candidates[0].rule,
        quads: candidates[0].rule.type === 'edge' ? subgraphIfEdge : subgraphIfNode,
        bindings: candidates[0].variables
      });

      if (candidates[0].rule.type === 'edge') edgeBNs.add(blankNode);
    }

    for (const suspiciousGang of suspiciousGangs.values()) {
      if (edgeBNs.has(suspiciousGang.identifier[0])) continue;
      if (edgeBNs.has(suspiciousGang.identifier[1])) continue;

      // Every quad in suspiciousGang.quads has two blank nodes that are not
      // bound to PG edges. The only case where PRSC can produce such triples
      // is in an edge rule where ?self is ommited.

      const si = suspiciousGang.identifier;
      const permutations = si[0].equals(si[1]) ? [si] : [si, [...si].reverse()];

      const candidates = this.prscRules
      .filter(rule => rule.isUniqueEdgeType())
      .map(rule => 
        permutations.map(order => ({
          rule: rule,
          mr: rule.couldHaveProduced(suspiciousGang.quads, {
            "source": order[0], "destination": order[1]
          })
        }))
        .filter(x => x.mr !== false)
      )
      .filter(foundBindings => foundBindings.length !== 0);

      if (candidates.length !== 1) {
        const gangName = "(" + RDFString.termToString(suspiciousGang.identifier[0])
          + ", " + RDFString.termToString(suspiciousGang.identifier[1]) + ")";

        throw Error(
          `The pair of blank nodes ${gangName} has `
          + ` ${candidates.length} type candidates. It should have 1.`
        );
      }

      for (const candidate of candidates[0]) {
        identified.push({
          identifier: suspiciousGang.identifier,
          rule: candidate.rule,
          quads: suspiciousGang.quads,
          bindings: candidate.mr as MatchResult
        });
      }
    }

    return identified;
  }
}

type SuspiciousGang = {
  identifier: [RDF.BlankNode, RDF.BlankNode],
  quads: DStar
};

type IdentifiedPGElement = {
  identifier: RDF.BlankNode | [RDF.BlankNode, RDF.BlankNode];
  rule: PRSCRule;
  quads: DStar,
  bindings: MatchResult
};

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
  const schema = new PRSCSchema(contextQuads);

  const identifiedPGElements: IdentifiedPGElement[] = schema.findTypesOfBlankNodes(dataset);

  const prec0Graph = new DStar();
  const usedQuads = new DStar();

  for (const { identifier, rule, bindings } of identifiedPGElements) {
    const selfBN = Array.isArray(identifier) ? DataFactory.blankNode() : identifier;

    const { used, prec0 } = rule.buildBackPREC0(selfBN, bindings);
    prec0Graph.addAll(prec0);
    usedQuads.addAll(used);
  }

  return {
    dataset: prec0Graph,
    complete: usedQuads.size === dataset.size
  };
}

function templateCanProduceData(template: RDF.Quad, data: RDF.Quad) {
  const variableValues = new TermMap<RDF.Term, RDF.Term>();
  function addVariableValue(variable: RDF.Term, value: RDF.Term) {
    const previously = variableValues.get(variable);
    if (previously === undefined) {
      variableValues.set(variable, value);
      return true;
    } else {
      return previously.equals(value);
    }
  }

  function inner(template: RDF.Term, data: RDF.Term): boolean {
    if (template.termType === 'DefaultGraph') {
      return template.equals(data);
    }

    if (template.termType === 'Literal') {
      if (data.termType !== 'Literal') return false;

      if (template.datatype === prec._valueOf) {
        return addVariableValue(template, data);
      } else {
        return template.equals(data);
      }
    }

    if (template.termType === 'NamedNode') {
      if (template.equals(pvar.self)
        || template.equals(pvar.node)
        || template.equals(pvar.edge)) {
        return addVariableValue(pvar.self, data);
      } else if (template.equals(pvar.source)) {
        return addVariableValue(pvar.source, data);
      } else if (template.equals(pvar.destination)) {
        return addVariableValue(pvar.destination, data);
      } else {
        return template.equals(data);
      }
    }

    if (template.termType === 'Quad') {
      if (data.termType !== 'Quad') return false;

      return inner(template.subject, data.subject)
        && inner(template.predicate, data.predicate)
        && inner(template.object, data.object)
        && inner(template.graph, data.graph);
    }

    return false;
  }

  return inner(template, data);
}
