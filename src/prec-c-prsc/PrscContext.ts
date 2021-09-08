import { Quad, Quad_Object, Quad_Predicate, Quad_Subject, Term } from "@rdfjs/types";
import { DataFactory } from "n3";
import DStar from "../dataset";

const $quad = DataFactory.quad;
const $variable = DataFactory.variable;
const $defaultGraph = DataFactory.defaultGraph();
const $literal = DataFactory.literal;

import namespace from '@rdfjs/namespace';
const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", { factory: DataFactory });
const rdfs = namespace("http://www.w3.org/2000/01/rdf-schema#"      , { factory: DataFactory });
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#"                  , { factory: DataFactory });
const prec = namespace("http://bruy.at/prec#"                       , { factory: DataFactory });
const pvar = namespace("http://bruy.at/prec-trans#"                 , { factory: DataFactory });


interface SchemaDetector {
  get iri(): Quad_Subject;
  match(dataset: DStar, element: Quad_Subject): boolean;
  produce(destination: DStar, source: DStar, element: Quad_Subject): void;
}

class NodeSchemaDetector implements SchemaDetector {
  contextGraph: DStar;
  myName: Quad_Subject;
  labels: string[];
  properties: { name: string, mandatory: boolean }[];
  composition: Quad[];

  constructor(dataset: DStar, myName: Quad_Subject) {
    this.contextGraph = dataset;
    this.myName = myName;
    this.labels = [...dataset.match(myName, prec.nodeLabel, null, $defaultGraph)].map(term => term.object.value);
    this.properties = [...dataset.match(myName, prec.propertyName, null, $defaultGraph)].map(term => ({ name: term.object.value, mandatory: true }));
    this.composition = [...dataset.match(myName, prec.composedOf, null, $defaultGraph)].map(term => term.object) as Quad[];
  }

  get iri(): Quad_Subject { return this.myName; }

  match(dataset: DStar, element: Quad_Subject): boolean {
    const { labels, properties } = NodeSchemaDetector.describePREC0Node(dataset, element);

    if (labels.length === this.labels.length) {
      for (const label of labels) {
        if (!this.labels.includes(label)) return false;
      }
    }

    if (properties.length === this.properties.length) {
      for (const property of properties) {
        if (this.properties.find(p => p.name === property) === undefined) return false;
      }
    }

    return true;
  }

  produce(destination: DStar, source: DStar, element: Quad_Subject): void {
    for (const quadToAdd of this.composition) {
      destination.add(this.instanciate(source, element, quadToAdd));
    }
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
        const triples = this.contextGraph.match(term);
        if (triples.size !== 1) throw Error('Blank node is not unique ; ' + triples.size);
        const triple = [...triples][0];
        if (triple.predicate.equals(prec.prsc_valueOf)) {
          if (triple.object.termType !== 'Literal')
            throw Error('Object is not a literal');

          const propertyName = triple.object.value;
          const bindings = source.matchAndBind([
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
      
      return term;
    }

    return transform(quadToAdd) as Quad;
  }

  static describePREC0Node(dataset: DStar, node: Quad_Subject) {
    const result: { labels: string[], properties: string[] } = { labels: [], properties: [] };

    result.labels = dataset.matchAndBind([
      $quad(node, rdf.type, $variable('type')),
      $quad($variable('type'), rdfs.label, $variable('label'))
    ]).map(binding => binding.label as Term).map(term => term.value);

    result.properties = dataset.matchAndBind([
      $quad(node, $variable('propertyName'), $variable('blankNode')),
      $quad($variable('propertyName'), rdfs.label, $variable('propertyNameLabel'))
    ]).map(binding => binding.propertyNameLabel as Term).map(propertyNameLabel => propertyNameLabel.value);

    return result;
  }
}

//class EdgeSchemaDetector {
//
//}

class PrscContext {
  nodeSchema: SchemaDetector[] = [];
  edgeSchema: SchemaDetector[] = [];

  constructor(quads: Quad[]) {
    const dataset = new DStar(quads);

    for (const nodeForm of dataset.match(null, rdf.type, prec.prsc_node, $defaultGraph)) {
      this.nodeSchema.push(new NodeSchemaDetector(dataset, nodeForm.subject));
    }

    //for (const edgeForm of dataset.match(null, rdf.type, prec.prsc_edge, $defaultGraph)) {
    //  this.edgeSchema.push(new EdgeSchemaDetector(dataset, nodeForm));
    //}
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
    dataset;
    output;
    return true;
    /*
    for (const edge of dataset.match(null, rdf.type, pgo.Node, $defaultGraph)) {
      const schema = this.findEdgeSchema(dataset, edge.subject);
      if (schema === null) return false;
      dataset.add($quad(edge.subject, prec._prsc_schema, schema.iri));
      schema.produce(output, dataset, edge.subject);
    }

    return true;
    */
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
