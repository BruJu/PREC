import { DataFactory } from 'n3';
import DStar from "../dataset";

import * as QuadStar from '../rdf/quad-star';
import TermSet from '@rdfjs/term-set';
import * as RDF from "@rdfjs/types";
import Context from "./Context";

import { rdf, pgo, prec, $defaultGraph } from '../PRECNamespace';

/**
 * Given a PREC-0 PG and a list of triples that descrives a PREC-C context, transform
 * the dataset that stores the PREC-0 PG into an idiomatic RDF graph
 * @param dataset The PREC-0 property graph that will be transformed into an idiomatic
 * RDF graph
 * @param contextQuads The triples in the context
 */
export default function precC(dataset: DStar, contextQuads: RDF.Quad[]) {
  const context = new Context(contextQuads);

  // -- Blank nodes transformation
  for (let typeOfNode in context.blankNodeMapping) {
    blankNodeMapping(
      dataset,
      DataFactory.namedNode(typeOfNode),
      context.blankNodeMapping[typeOfNode]
    );
  }

  // -- Map generated IRI to existing IRIs + apply the templates
  const newDataset = ruleBasedProduction(dataset, context);
  dataset.deleteMatches();
  dataset.addAll(newDataset.getQuads());

  // -- Remove provenance information if they are not required by the user
  if (context.keepProvenance === false) removePGO(dataset);
}


/**
 * Build a new dataset by translating the PREC-0 triples in the source `dataset`
 * according to the rules described in the passed `context`.
 * @param dataset The source dataset
 * @param context The context
 * @returns The new dataset 
 */
function ruleBasedProduction(dataset: DStar, context: Context): DStar {
  context.produceMarks(dataset);
  
  const newDataset = new DStar();

  const preservedLabels = new TermSet<RDF.Term>();
  
  for (const nepManager of context.nepManagers) {
    const ruleType = nepManager.ruleset;

    for (const mark of dataset.getQuads(null, ruleType.mark, null, $defaultGraph)) {
      const ts = ruleType.applyMark(newDataset, mark, dataset, context);
      ts.forEach(t => preservedLabels.add(t));
    }
  }

  preservedLabels.forEach(label => newDataset.addAll(dataset.getQuads(label)));
  
  // As it is impossible to write a rule that catches a node without any label
  // and property, we add back the nodes here
  newDataset.addAll(dataset.getQuads(null, rdf.type, pgo.Node, $defaultGraph));

  return newDataset;
}


// ==== Blank Node Mapping

/**
 * Transform the blank nodes of the given type to named nodes, by appending to
 * the given prefix the current name of the blank node.
 * @param dataset The dataset that contains the quads
 * @param typeOfMappedNodes The type of the IRIs to map
 * @param prefixIRI The prefix used
 */
function blankNodeMapping(dataset: DStar, typeOfMappedNodes: RDF.Term, prefixIRI: string) {
  let remapping: {[blankNodeName: string]: RDF.NamedNode} = {};

  dataset.getQuads(null, rdf.type, typeOfMappedNodes, $defaultGraph)
    .filter(quad => quad.subject.termType === "BlankNode")
    .map(quad => quad.subject.value)
    .forEach(blankNodeValue => remapping[blankNodeValue] = DataFactory.namedNode(prefixIRI + blankNodeValue))
  
  let newContent = dataset.getQuads().map(quad => _quadBNMap(remapping, quad));
  
  dataset.removeQuads(dataset.getQuads());
  dataset.addAll(newContent);
}

/**
 * Provided a mapping blank node value => named node, maps the quad to another
 * quad, in which every blank node in the mapping is mapped to the named node
 */
function _quadBNMap(map: {[blankNodeName: string]: RDF.NamedNode}, quad: RDF.Quad): RDF.Quad {
  return QuadStar.eventuallyRebuildQuad(quad, term => {
    if (term.termType === "BlankNode") {
      let mappedTo = map[term.value];
      if (mappedTo === undefined) return term;
      return mappedTo;
    } else {
      return term;
    }
  });
}

/**
 * Deletes all occurrence of pgo:Edge pgo:Node, prec:PropertyKey and prec:PropertyKeyValue.
 * 
 * While the PGO ontology is usefull to describe the PG structure, and to
 * specify the provenance of the data, some user may want to discard these
 * provenance information.
 * @param dataset The dataset 
 */
function removePGO(dataset: DStar) {
  dataset.deleteMatches(null, rdf.type, pgo.Edge             , $defaultGraph);
  dataset.deleteMatches(null, rdf.type, pgo.Node             , $defaultGraph);
  dataset.deleteMatches(null, rdf.type, prec.PropertyKey     , $defaultGraph);
  dataset.deleteMatches(null, rdf.type, prec.PropertyKeyValue, $defaultGraph);
}
