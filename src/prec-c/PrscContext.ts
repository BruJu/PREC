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
import TermDict from "../TermDict";
import { termIsIn } from "../rdf/utils";
const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", { factory: DataFactory });
const rdfs = namespace("http://www.w3.org/2000/01/rdf-schema#"      , { factory: DataFactory });
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#"                  , { factory: DataFactory });
const prec = namespace("http://bruy.at/prec#"                       , { factory: DataFactory });
const pvar = namespace("http://bruy.at/prec-trans#"                 , { factory: DataFactory });
const ex   = namespace("http://www.example.org/"                    , { factory: DataFactory });

const xsdString = DataFactory.namedNode("http://www.w3.org/2001/XMLSchema#string");
const pvarPrefix = "http://bruy.at/prec-trans#";

type RDFPosition = 'subject' | 'predicate' | 'object' | 'graph';
const RDFPositions: RDFPosition[] = ['subject', 'predicate', 'object', 'graph'];

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

  revertFromPrecC(dataGraph: DStar, self: RDF.Term, nodesOfEdge: [RDF.Term, RDF.Term] | null): { used: RDF.Quad[], prec0: RDF.Quad[] } {
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
    if (matchResult.length !== 1) {
      throw Error("More than one result for " + RDFString.termToString(self) + " - pattern is " + matchPattern.map(x => RDFString.termToString(x)).join(" "));
    }
  
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

  couldHaveProduced(graph: DStar): boolean {
    // TODO: check consistency ie the same variable does not
    // have multiple different instanciation in the data graph)
    let dataQuads = [...graph];
    if (this.type === 'node') {
      dataQuads = dataQuads.filter(quad => findListOfBlankNodesIn(quad).length === 1);
    }

    console.log("---- " + RDFString.termToString(this.identity));
    for (const quad of dataQuads) {
      console.log(RDFString.termToString(quad));
    }

    const usage = dataQuads.map(_ => 0);

    function templateQuadCanProduce(templateQuad: RDF.Quad, dataQuad: RDF.Quad): boolean {
      const templateTermCanProduce = (template: RDF.Term, data: RDF.Term): boolean => {
//        console.log(" ? ", RDFString.termToString(template), "|>", RDFString.termToString(data));
        
        if (termIsIn(template, [pvar.self, pvar.node, pvar.edge, pvar.source, pvar.destination])) {
          return data.termType === 'BlankNode';
        } else if (template.termType === 'NamedNode') {
          return template.equals(data);
        }

        if (template.termType === 'Literal') {
          if (template.datatype.equals(prec._valueOf)) return data.termType === 'Literal';
          else return template.equals(data);
        }

        if (template.termType === 'Quad' && data.termType === 'Quad') {
          return templateTermCanProduce(template.subject, data.subject)
            && templateTermCanProduce(template.predicate, data.predicate)
            && templateTermCanProduce(template.object, data.object)
            && templateTermCanProduce(template.graph, data.graph);
        }

        if (template.termType === 'DefaultGraph') {
          return template.equals(data);
        }

        return false;
      };

      return templateTermCanProduce(templateQuad, dataQuad);
    }

    const nextTemplateQuad = (templateQuadId: number): boolean => {
      if (templateQuadId === this.template.length) return !usage.includes(0);

      for (let i = 0; i != dataQuads.length; ++i) {
        if (templateQuadCanProduce(this.template[templateQuadId], dataQuads[i])) {
          ++usage[i];
          if (nextTemplateQuad(templateQuadId + 1)) {
            return true;
          }
          --usage[i];
        }
      }

      return false;
    };

    const r = nextTemplateQuad(0);
    console.log(r);
    return r;
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

  findIdentificationTriples(): IdentificationTriple[] {
    return this.prscRules
      .map(rule => ({
        rule: rule,
        triple: rule.findIdentificationTriple(this.prscRules)
      }));
  }

  static cutGraphByBlankNodes(dataset: DStar): {
    blankNodes: TermDict<RDF.BlankNode, DStar>,
    suspiciousGangs: Map<string, SuspiciousGang>
  } {
    const bnToSubGraph = new TermDict<RDF.BlankNode, DStar>();
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

  findTypesOfBlankNodes(dataset: DStar): IdentifiedPGElement[] {
    const identified: IdentifiedPGElement[] = [];

    const { blankNodes, suspiciousGangs } = PRSCSchema.cutGraphByBlankNodes(dataset);

    const edgeBNs = new TermDict<RDF.BlankNode, true>();
    blankNodes.forEach((blankNode, subGraph) => {
      const candidates = this.prscRules.filter(rule => rule.couldHaveProduced(subGraph));

      if (candidates.length !== 1) {
        throw Error(
          `The blank node ${RDFString.termToString(blankNode)} has`
          + ` ${candidates.length} type candidates. It should have 1.`);
      }

      identified.push({
        identifier: blankNode,
        rule: candidates[0],
        quads: subGraph
      });

      if (candidates[0].type === 'edge') edgeBNs.set(blankNode, true);
    });

    for (const suspiciousGang of suspiciousGangs.values()) {
      if (edgeBNs.get(suspiciousGang.identifier[0]) !== undefined) continue;
      if (edgeBNs.get(suspiciousGang.identifier[1]) !== undefined) continue;

      // Every quad in suspiciousGang.quads has two blank nodes that are not
      // bound to PG edges. The only case where PRSC can produce such triples
      // is in an edge rule where ?self is ommited.

      // !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
      // !!!!!!!! Oui c'est bien, sauf que qu'en fait on peut avoir deux évaluations
      // possibles ici :
      //
      //         :knows
      //        <----
      //    (n1)     (n2)
      //        ---->
      //         :knows
       

      const candidates = this.prscRules.filter(
        rule => rule.type === 'edge' && rule.couldHaveProduced(suspiciousGang.quads)
      );

      if (candidates.length !== 1) {
        const gangName = "(" + RDFString.termToString(suspiciousGang.identifier[0])
          + ", " + RDFString.termToString(suspiciousGang.identifier[0]) + ")";

        throw Error(
          `The pair of blank nodes ${gangName} has `
          + ` ${candidates.length} type candidates. It should have 1.`);
      }

      identified.push({
        identifier: suspiciousGang.identifier,
        rule: candidates[0],
        quads: suspiciousGang.quads
      });
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
  quads: DStar
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
  dataset = dataset.match();

  const schema = new PRSCSchema(contextQuads);
  const identifiedPGElements: IdentifiedPGElement[] = schema.findTypesOfBlankNodes(dataset);

  const prec0Graph = new DStar();
  const usedQuads = new DStar();

  for (const identified of identifiedPGElements) {
    const selfBN = Array.isArray(identified.identifier) ? DataFactory.blankNode() : identified.identifier;
    const srcAndDest = Array.isArray(identified.identifier) ? identified.identifier : null;

    const { used, prec0 } = identified.rule.revertFromPrecC(identified.quads, selfBN, srcAndDest);
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

/*
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

*/