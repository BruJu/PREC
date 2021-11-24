import { DatasetCore, Quad, Quad_Graph, Quad_Object, Quad_Predicate, Quad_Subject, Term } from "@rdfjs/types";
import { DataFactory } from "n3";
import TermSet from "@rdfjs/term-set";
import * as PrecUtils from './utils';

import namespace from '@rdfjs/namespace';
const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", { factory: DataFactory });

export type RDFPath = [Quad_Predicate, Quad_Object];
export type RDFPathPartial = [Quad_Predicate, Quad_Object | null];

const $quad = DataFactory.quad;

/*
 * Mathods that relies on the RDF/JS DatasetCore interfce
 * 
 * These methods are related to path travelling and basic checking of the
 * content of the dataset.
 */

/** Returns true if one of the quad is not in the default graph */
export function hasNamedGraph(dataset: DatasetCore) {
  for (const quad of dataset) {
    if (!DataFactory.defaultGraph().equals(quad.graph)) {
      return true;
    }
  }

  return false;
}

/** Returns true if one of the quad has a embedded quad */
export function isRdfStar(dataset: DatasetCore) {
  for (const quad of dataset) {
    if (quad.subject.termType === 'Quad') return true;
    if (quad.object.termType === 'Quad') return true;
  }

  return false;
}

/**
 * Returns true if the given types are disjoints, ie if all nodes that have
 * one of them as a type doesn't have the others as type.
 */
export function areDisjointTypes(dataset: DatasetCore, types: Quad_Object[]) {
  const typedObjects = new TermSet<Term>();

  for (const type of types) {
    const thisType = dataset.match(null, rdf.type, type);

    for (const quad of thisType) {
      if (typedObjects.has(quad.subject)) return false;
      typedObjects.add(quad.subject);
    }
  }

  return true;
}

/**
 * Return the list of terms that are of type type in the given dataset 
 * @param type The type of the wanted nodes
 * @returns The list of nodes that have the given type
 */
export function getNodesOfType(dataset: DatasetCore, type: Quad_Object, graph?: Quad_Graph) {
  return [...dataset.match(null, rdf.type, type, graph)]
    .map(quad => quad.subject);
}

/**
 * Return the list of quads that has the given subject and the predicate is
 * not in ignoreList
 * @param subject The term that is in position subject
 * @param ignoreList List of predicates that should not be as predicate
 * @returns The list of quads that has the given subject and for which the
 * predicate is not in ignoreList
 */
export function getPathsFrom(dataset: DatasetCore, subject: Quad_Subject, ignoreList?: Quad_Predicate[]) {
  return [...dataset.match(subject)]
    .filter(quad => !PrecUtils.termIsIn(quad.predicate, ignoreList || []));
}

/**
 * Find the triple (subject, predicate, ?object), and return the value of
 * ?object. If there is not exactly one match, this function returns null
 * instead.
 * 
 * The considered graph is the default graph
 * @param subject The subject
 * @param predicate The predicate
 * @returns The corresponding object if it exists and is unique
 */
export function followThrough(dataset: DatasetCore, subject: Quad_Subject, predicate: Quad_Predicate) {
  let match = dataset.match(subject, predicate, null, DataFactory.defaultGraph());
  if (match.size !== 1) return null;

  return [...match][0].object;
}

/**
 * Find the triple (subject, predicate, ?object) and return the value of object.
 * 
 * If there are no match, returns null. If there are more than one match, throws
 * an error.
 * @param dataset The dataset
 * @param subject The subject
 * @param predicate The predicate
 * @returns null if no value has been found, the value if one.
 */
export function followOrNull(
  dataset: DatasetCore,
  subject: Quad_Subject, predicate: Quad_Predicate
): Quad_Object | null {
  const triples = dataset.match(subject, predicate, null, DataFactory.defaultGraph());
  if (triples.size === 0) return null;
  else if (triples.size === 1) return [...triples][0].object;
  else throw Error("More than one path");
}

/**
 * Returns every object from triples of the form (subject, predicate, ?object).
 * @param dataset The dataset
 * @param subject The subject
 * @param predicate The predicate
 * @returns The list of objects
 */
export function followAll(
  dataset: DatasetCore,
  subject: Quad_Subject, predicate: Quad_Predicate
): Quad_Object[] {
  return [
    ...dataset.match(subject, predicate, null, DataFactory.defaultGraph())
  ].map(quad => quad.object);
}


/**
 * Check every paths from the subject node are the expected one, ie every
 * requiredPath exists and there are no unlisted paths.
 * 
 * Paths can use null as an object as an unique wildcard.
 * 
 * @param subject The subject of every studied quad
 * @param requiredPaths The list of required path, ie for each path in
 * requiredPaths, a quad in the form
 * (subject, path[0], path[1], defaultGraph)
 * must be in the dataset. If path[1] is null, the function will bind it
 * to the first ?object it find in a triple (subject, path[0], ?object) of
 * the graph
 * @param optionalPaths The list of optional paths. See requiredPaths
 * for format. The only difference is that not finding optional paths won't
 * result in a false
 * @param outFoundPaths If an array is provided as this parameter, the
 * actually found paths will be written here
 * @returns True if every requiredPaths is found and there exists no path
 * that is not either in requiredPaths or optionalPaths.
 */
export function hasExpectedPaths(
  dataset: DatasetCore,
  subject: Quad_Subject,
  requiredPaths: RDFPathPartial[],
  optionalPaths: RDFPathPartial[],
  outFoundPaths?: RDFPath[]
) {
  if (outFoundPaths !== undefined) outFoundPaths.length = 0;

  // Get actual paths
  const match = dataset.match(subject, null, null, DataFactory.defaultGraph());
  if (match.size < requiredPaths.length) return null;

  // Copy the expected path to modify them
  let reqPaths = [...requiredPaths];
  let optPaths = [...optionalPaths];

  // Helper function to check and remove from the list of accepted paths
  function findInListOfPaths(quad: Quad, paths: RDFPathPartial[]) {
    let iPath = paths.findIndex(path =>
      quad.predicate.equals(path[0])
      && (path[1] === null || quad.object.equals(path[1]))
      && quad.graph.equals(DataFactory.defaultGraph())
    );

    if (iPath === -1) return false;

    if (outFoundPaths !== undefined) outFoundPaths.push([quad.predicate, quad.object]);
    paths.splice(iPath, 1);
    return true;
  }
  
  // Compare the actual paths with the expected ones
  for (const quad of match) {
    if (!findInListOfPaths(quad, reqPaths) && !findInListOfPaths(quad, optPaths)) {
      return false;
    }
  }

  return reqPaths.length === 0;
}

/**
 * If subject, predicate is an unique path (named the followed path), and
 * if the paths of predicates are all either the followed path or included
 * in requiredPaths or optionals paths, returns the object of the followed
 * path.
 * 
 * The considered graph is the default graph.
 * 
 * followThrough(subject, predicate) if the quads were valid.
 * 
 * @param subject The subject
 * @param predicate The predicate to follow
 * @param requiredPaths The list of required paths
 * @param optionalPaths The list of paths that are allowed to be found
 * @returns The object of the (subject, predicate, null) match, or null 
 * either if not unique or if not all the requiredPaths where found or some
 * extra unspecified paths were found.
 */
export function checkAndFollow(
  dataset: DatasetCore,
  subject: Quad_Subject,
  predicate: Quad_Predicate,
  requiredPaths: RDFPath[],
  optionalPaths: RDFPath[]
) {
  const followUp = followThrough(dataset, subject, predicate);
  if (followUp === null) return null;

  const realRequiredPaths: RDFPath[] = [[predicate, followUp], ...requiredPaths];

  if (hasExpectedPaths(dataset, subject, realRequiredPaths, optionalPaths)) {
    return followUp;
  } else {
    return null;
  }
};


////////////////////////////////////////////////////////////////////////////////

/**
 * Remove from the dataset the list that starts from currentNode, and return an
 * array with every node of this list.
 * 
 * Throws an error if the list is not a valid RDF list or one of its node is
 * connected to another part of the graph.
 */
export function extractAndDeleteRdfList(dataset: DatasetCore, currentNode: Quad_Subject): Quad_Object[] {
  let result = [];

  while (!rdf.nil.equals(currentNode)) {
    if (dataset.match(null, null, currentNode).size != 0) throw "Invalid list (1)";
    if (dataset.match(null, currentNode, null).size != 0) throw "Invalid list (2)";
    
    const asSubject = dataset.match(currentNode, null, null).size;
    const isList = dataset.has($quad(currentNode, rdf.type, rdf.List));

    const ok = (asSubject === 2 && !isList) || (asSubject === 3 && isList);
    if (!ok)throw "Invalid list (3)";

    let value = followThrough(dataset, currentNode, rdf.first);
    if (value === null) throw "Invalid list - No first element";

    // TODO: check if value is not used anywhere else

    result.push(value);

    let next = followThrough(dataset, currentNode, rdf.rest);
    if (next == null) throw "Invalid list - No rest";

    dataset.delete($quad(currentNode, rdf.type , rdf.List));
    dataset.delete($quad(currentNode, rdf.first, value   ));
    dataset.delete($quad(currentNode, rdf.rest , next    ));

    currentNode = next as Quad_Subject;
  }

  return result;
}

