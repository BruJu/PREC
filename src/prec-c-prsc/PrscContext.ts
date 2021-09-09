import { DatasetCore, Quad, Quad_Object, Quad_Predicate, Quad_Subject, Term, NamedNode } from "@rdfjs/types";
import { DataFactory } from "n3";
import DStar from "../dataset";

const $quad         = DataFactory.quad;
const $literal      = DataFactory.literal;
const $variable     = DataFactory.variable;
const $defaultGraph = DataFactory.defaultGraph();

import namespace from '@rdfjs/namespace';
import { followThrough } from "../rdf/path-travelling";
const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", { factory: DataFactory });
const rdfs = namespace("http://www.w3.org/2000/01/rdf-schema#"      , { factory: DataFactory });
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#"                  , { factory: DataFactory });
const prec = namespace("http://bruy.at/prec#"                       , { factory: DataFactory });
const pvar = namespace("http://bruy.at/prec-trans#"                 , { factory: DataFactory });

////////////////////////////////////////////////////////////////////////////////
// Path following

function followOrNull(dataset: DatasetCore): Quad_Object | null {
  const triples = [...dataset];
  if (triples.length === 0) return null;
  else if (triples.length === 1) return triples[0].object;
  else throw Error("More than one path");
}

function followAll(dataset: DatasetCore, subject: Quad_Subject, predicate: Quad_Predicate): Quad_Object[] {
  return [...dataset.match(subject, predicate, null, $defaultGraph)].map(quad => quad.object);
}


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

// TODO: finish this function (non mandatory values should really be non mandatory)
function haveSameProperties(
  actual: string[],
  expected: { name: string, mandatory: boolean }[]
): boolean {
  if (actual.length !== expected.length) return false;

  for (const property of actual) {
    if (expected.find(p => p.name === property) === undefined) return false;
  }

  return true;
}


////////////////////////////////////////////////////////////////////////////////
// Schema detection

abstract class SchemaDetector {
  contextGraph: DStar;
  myName: Quad_Subject;
  composition: Quad[];

  constructor(dataset: DStar, myName: Quad_Subject) {
    this.contextGraph = dataset;
    this.myName = myName;
    this.composition = [...dataset.match(myName, prec.composedOf, null, $defaultGraph)].map(term => term.object) as Quad[];
  }
  
  /** The IRI of the schema */
  get iri(): Quad_Subject { return this.myName; }

  /** Returns true if the given element complies with this schema */
  abstract match(dataset: DStar, element: Quad_Subject): boolean;

  /** Produce the new representation of the thing, we suppose than match == true */
  produce(destination: DStar, source: DStar, element: Quad_Subject): void {
    for (const quadToAdd of this.composition) {
      destination.add(this.instanciate(source, element, quadToAdd));
    }
  }

  abstract instanciate(source: DStar, element: Quad_Subject, quadToAdd: Quad): Quad;
}

function extractPropertyNameLabels(dataset: DStar, pgNodeOrEdge: Quad_Subject) {
  return dataset.matchAndBind([
    $quad(pgNodeOrEdge, $variable('propertyName'), $variable('blankNode')),
    $quad($variable('propertyName'), rdfs.label, $variable('propertyNameLabel'))
  ]).map(binding => binding.propertyNameLabel as Term).map(propertyNameLabel => propertyNameLabel.value);
}

class NodeSchemaDetector extends SchemaDetector {
  labels: string[];
  properties: { name: string, mandatory: boolean }[];
  
  constructor(dataset: DStar, myName: Quad_Subject) {
    super(dataset, myName);
    this.labels = followAll(dataset, myName, prec.nodeLabel).map(labelLiteral => labelLiteral.value);
    this.properties = followAll(dataset, myName, prec.propertyName).map(object => ({ name: object.value, mandatory: true }));
  }

  match(dataset: DStar, node: Quad_Subject): boolean {
    const labels = dataset.matchAndBind([
      $quad(node, rdf.type, $variable('type')),
      $quad($variable('type'), rdfs.label, $variable('label'))
    ]).map(binding => binding.label as Term).map(term => term.value);
    if (!haveSameStrings(labels, this.labels)) return false;
    
    const properties = extractPropertyNameLabels(dataset, node);
    if (!haveSameProperties(properties, this.properties)) return false;

    return true;
  }

  instanciate(source: DStar, element: Quad_Subject, quadToAdd: Quad): Quad {
    const transform = (term: Term): Term => {
      if (term.termType === 'Quad') {
        return $quad(
          transform(term.subject) as Quad_Subject,
          transform(term.predicate) as Quad_Predicate,
          transform(term.object) as Quad_Object,
        );
      }

      if (term.equals(pvar.node)) return element;
      if (term.termType === 'BlankNode') {
        return instanciateBlankNode(this.contextGraph, source, term, element);
      }
      
      return term;
    }

    return transform(quadToAdd) as Quad;
  }
}


class EdgeSchemaDetector extends SchemaDetector {
  labels: string[];
  properties: { name: string, mandatory: boolean }[];

  startForm: Quad_Subject | null;
  endForm: Quad_Subject | null;

  constructor(dataset: DStar, myName: Quad_Subject) {
    super(dataset, myName);

    this.labels = followAll(dataset, myName, prec.edgeLabel).map(labelLiteral => labelLiteral.value);
    this.properties = followAll(dataset, myName, prec.propertyName).map(object => ({ name: object.value, mandatory: true }));

    this.startForm = followOrNull(dataset.match(myName, prec.prscSource, null, $defaultGraph)) as (Quad_Subject | null);
    this.endForm = followOrNull(dataset.match(myName, prec.prscDestination, null, $defaultGraph)) as (Quad_Subject | null);
  }

  match(dataset: DStar, element: Quad_Subject): boolean {
    if (!EdgeSchemaDetector.nodeCompliesWith(dataset, element, rdf.subject, this.startForm)
    || !EdgeSchemaDetector.nodeCompliesWith(dataset, element, rdf.object, this.endForm)) {
      return false;
    }
    
    const labels = dataset.matchAndBind([
      $quad(element, rdf.predicate, $variable('labelIRI')),
      $quad($variable('labelIRI'), rdfs.label, $variable('label'))
    ]).map(binding => (binding.label as Term).value);
    if (!haveSameStrings(labels, this.labels)) return false;

    const properties = extractPropertyNameLabels(dataset, element);
    if (!haveSameProperties(properties, this.properties)) return false;

    return true;
  }

  static nodeCompliesWith(dataset: DStar, element: Quad_Subject, predicate: NamedNode, targetSchema: Quad_Subject | null) {
    if (targetSchema === null) return true;

    const theNode = followThrough(dataset, element, predicate);
    if (theNode === null) return false;

    const theSchema = followThrough(dataset, theNode as Quad_Subject, prec._prsc_schema);
    if (theSchema === null) return false;

    return targetSchema.equals(theSchema);
  }

  instanciate(source: DStar, element: Quad_Subject, quadToAdd: Quad): Quad {
    const transform = (term: Term): Term => {
      if (term.termType === 'Quad') {
        return $quad(
          transform(term.subject) as Quad_Subject,
          transform(term.predicate) as Quad_Predicate,
          transform(term.object) as Quad_Object,
        );
      }

      if (term.equals(pvar.edge)) return element;
      if (term.equals(pvar.source))      return followThrough(source, element, rdf.subject)!;
      if (term.equals(pvar.destination)) return followThrough(source, element, rdf.object )!;
      if (term.termType === 'BlankNode') {
        return instanciateBlankNode(this.contextGraph, source, term, element);
      }
      return term;
    };

    return transform(quadToAdd) as Quad;
  }
}

function instanciateBlankNode(contextGraph: DStar, dataGraph: DStar, term: Term, element: Quad_Subject) {
  const triples = contextGraph.match(term);
  if (triples.size !== 1) throw Error('Blank node is not unique ; ' + triples.size);
  const triple = [...triples][0];
  if (triple.predicate.equals(prec.prsc_valueOf)) {
    if (triple.object.termType !== 'Literal')
      throw Error('Object is not a literal');

    const propertyName = triple.object.value;
    const bindings = dataGraph.matchAndBind([
      $quad(element, $variable('propertyKey'), $variable('propertyBN')),
      $quad($variable('propertyKey'), rdfs.label, $literal(propertyName)),
      $quad($variable('propertyBN'), rdf.value, $variable('propertyValue'))
    ]).map(bindings => bindings.propertyValue as Term);
    
    if (bindings.length !== 1) throw Error('Not 1 value');
    return bindings[0];
  } else {
    throw Error('Found bad blank node');
  }
}

class PrscContext {
  nodeSchema: SchemaDetector[] = [];
  edgeSchema: SchemaDetector[] = [];

  constructor(quads: Quad[]) {
    const dataset = new DStar(quads);

    for (const nodeForm of dataset.match(null, rdf.type, prec.prsc_node, $defaultGraph)) {
      this.nodeSchema.push(new NodeSchemaDetector(dataset, nodeForm.subject));
    }

    for (const edgeForm of dataset.match(null, rdf.type, prec.prsc_edge, $defaultGraph)) {
      this.edgeSchema.push(new EdgeSchemaDetector(dataset, edgeForm.subject));
    }
  }

  markSchemaOfNodes(dataset: DStar, output: DStar) {
    for (const node of dataset.match(null, rdf.type, pgo.Node, $defaultGraph)) {
      const schema = this.findNodeSchema(dataset, node.subject);
      if (schema === null) {
        console.error("No schema for " + node.value);
        return false;
      }
      dataset.add($quad(node.subject, prec._prsc_schema, schema.iri));
      schema.produce(output, dataset, node.subject);
    }

    return true;
  }

  findNodeSchema(dataset: DStar, node: Quad_Subject) {
    const schema = this.nodeSchema.find(schema => schema.match(dataset, node));
    if (schema === undefined) return null;
    return schema;
  }

  markSchemaOfEdges(dataset: DStar, output: DStar) {
    for (const edge of dataset.match(null, rdf.type, pgo.Edge, $defaultGraph)) {
      const schema = this.findEdgeSchema(dataset, edge.subject);
      if (schema === null) {
        console.error("No schema for edge " + edge.subject.value);
        return false;
      }
      dataset.add($quad(edge.subject, prec._prsc_schema, schema.iri));
      schema.produce(output, dataset, edge.subject);
    }

    return true;
  }

  findEdgeSchema(dataset: DStar, edge: Quad_Subject) {
    const schema = this.edgeSchema.find(schema => schema.match(dataset, edge));
    if (schema === undefined) return null;
    return schema;
  }

  producePrecCGraph(dataset: DStar) {
    const result = new DStar();
    if (!this.markSchemaOfNodes(dataset, result)) return null;
    if (!this.markSchemaOfEdges(dataset, result)) return null;
    return result;
  }
}

export function isPrscContext(contextQuads: Quad[]) {
  const searched = $quad(prec.this_is, rdf.type, prec.prscContext);
  return contextQuads.find(q => q.equals(searched)) !== undefined;
}

export default function precCwithPRSC(dataset: DStar, contextQuads: Quad[]) {
  const context = new PrscContext(contextQuads);
  return context.producePrecCGraph(dataset);
}
