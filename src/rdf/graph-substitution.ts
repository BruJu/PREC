import * as N3 from 'n3';
import * as RDF from '@rdfjs/types';

//! This file contains a (slow) graph substitution implementation. It is used for
//! PREC unit tests


/**
 * Returns true if pattern is substituable to actualQuads.
 * 
 * A pattern graph is substituable to another one if a mapping from the blank
 * nodes of the pattern graph to the terms of the other graph exists, in which
 * every blank node is mapped to a different term.
 */
export function isSubstituableGraph(actualQuads: RDF.Quad[], pattern: RDF.Quad[]) {
  // Ensure that the blank nodes used in the two lists of quads are different
  let [rebuiltActualQuads, endNumber] = rebuildBlankNodes(actualQuads, 0);
  let [rebuiltPattern    , trueEnd  ] = rebuildBlankNodes(pattern    , endNumber);

  // Policy for blank node exploration
  const blankNodeExplorer = new BlankNodeExplorer(rebuiltPattern, [endNumber, trueEnd]);
  
  // Check if the two list of nodes are "isomorphic".
  return _isSubstituableGraph(rebuiltActualQuads, rebuiltPattern, blankNodeExplorer);
}


/**
 * Remap every blank node in the list of quads to blank nodes from nextBlankNodeId
 * to nextBlankNodeId + the number of blank nodes
 * 
 * Returns [the list of remapped quads, the next number of blank node that would have been
 * attributed].
 * @param listOfQuads The list of quads
 * @param nextBlankNodeId The first number of blank node, default is 1
 */
export function rebuildBlankNodes(listOfQuads: RDF.Quad[], nextBlankNodeId: number = 1): [RDF.Quad[], number] {
  // Make the list of blank nodes in list of quads
  let newBlankNodes: {[newName: string]: string} = {};
  let oldBlankNodes: {[oldName: string]: string} = {};

  for (let quad of listOfQuads) {
    const listOfBlankNodes = findBlankNodes(quad);

    for (const blankNodeName of listOfBlankNodes) {
      if (oldBlankNodes[blankNodeName] === undefined) {
        oldBlankNodes[blankNodeName] = nextBlankNodeId.toString();
        newBlankNodes[nextBlankNodeId] = blankNodeName;
        nextBlankNodeId++;
      }
    }
  }

  // Do not rename blank nodes to blank nodes names that already appears
  for (let attributedNumber in newBlankNodes) {
    if (oldBlankNodes[attributedNumber] !== undefined) {
      // We have :
      // oldBlankNode             newBlankNode
      // [a] = 0                  [0] = a
      // [0] = 1                  [1] = 0
      //
      // where 0 is attributedNumber
      // a is oldBlankNodes[attributedNumber]

      // Swap oldBlankNodes
      const oldTarget = oldBlankNodes[attributedNumber];

      let a = newBlankNodes[attributedNumber];
      // oldBlankNodes[a] === attributedNumber)

      oldBlankNodes[a] = oldBlankNodes[attributedNumber];
      oldBlankNodes[attributedNumber] = attributedNumber;

      // Swap newBlankNodes
      newBlankNodes[oldTarget] = a;
      newBlankNodes[attributedNumber] = attributedNumber;
    }
  }

  // Make the substitution
  return [
    listOfQuads.map(quad => _renameBlankNodesOfQuad(quad, oldBlankNodes)),
    nextBlankNodeId
  ];
}

/** Computes the list of blank nodes that composes the quad */
export function findBlankNodes(quad: RDF.Term): Set<string> {
  let m = new Set<string>();

  function read(term: RDF.Term) {
    if (term.termType === "Quad") {
      read(term.subject);
      read(term.predicate);
      read(term.object);
      read(term.graph);
    } else if (term.termType === "BlankNode") {
      m.add(term.value);
    }
  }

  read(quad)

  return m;
}



////////////////////////////////////////////////////////////////////////////////

/**
 * Checks if the given term-star is or contains a blank node.
 * @param term The term-star to explore
 * @returns True if the term is or contains a blank node
 */
function hasBlankNode(term: RDF.Term): boolean {
  if (term.termType === "BlankNode") return true;
  if (term.termType !== "Quad") return false;

  return hasBlankNode(term.subject)
    || hasBlankNode(term.predicate)
    || hasBlankNode(term.object)
    || hasBlankNode(term.graph);
}

/**
 * Returns the given node if it doesn't contain a blank node, null if it
 * contains any
 * @param term The term
 * @returns The term if it doesn't contain any blank node, null if it does.
 */
function bNodeLess<T extends RDF.Term>(term: T): T | null {
  return hasBlankNode(term) ? null : term;
}

/**
 * A class that prepares the list fo blank nodes from a list of quads, to be
 * able to find substitutions of these blank nodes for other terms to match a
 * store.
 */
class BlankNodeExplorer {

  /** Next node to explore */ i = 0;
  blankNodesDetails: Details;
  blankNodes: RDF.BlankNode[];


  /**
   * Construct a blank node explorer: an objet that knows the list of blank
   * node that will need to be substitued.
   * 
   * The list of blank nodes and informations about where the blank node
   * appears are stored in this class.
   * 
   * @param patternQuads The list of quads that contains the blank node
   * @param range An array of two integers, the first is the number of the
   * lowest numbered blank node. The second is the number of the highest
   * numbered blank node + 1. Only blank nodes in this range will be
   * substitued.
   */
  constructor(patternQuads: RDF.Quad[], range: [number, number]) {
    let scores: {[name: string]: number} = {}; // Blank node name -> number of non nested occurrences
    let values: RDF.BlankNode[] = [];          // The list of blank nodes

    const patternStore = new N3.Store(patternQuads);

    // For each blank node to substitute, we count the number of times it
    // appears. Then we will able to sort them from the blank node that
    // appears the most often to the less often.
    // The counting is heuristic as it doesn't account for nested blank
    // nodes.
    for (let i_ = range[0] ; i_ != range[1] ; ++i_) {
      let i = i_.toString();
      const blankNode = N3.DataFactory.blankNode(i);

      values.push(blankNode);

      scores[i] = patternStore.getQuads(blankNode, null, null, null).length +
                  patternStore.getQuads(null, blankNode, null, null).length + 
                  patternStore.getQuads(null, null, blankNode, null).length +
                  patternStore.getQuads(null, null, null, blankNode).length;
    }

    // The list of blank nodes in store, 
    this.blankNodes = values.sort((a, b) => scores[b.value] - scores[a.value]);

    // Blank nodes details is a mapping from
    // blank node -> [ s, p, o, g, filter, finder ]
    // See makeDetails for more details
    this.blankNodesDetails = makeDetails(patternStore);
  }

  /**
   * Returns true if the store is empty of blank node or if there are no more
   * blank node to explore
   * 
   * TODO: Both should be equivalent by construction?
   */
  hasNonBlankQuad(store: N3.Store) {
    if (this.i == this.blankNodes.length) return true;

    return !store.getQuads(null, null, null, null).every(quad => hasBlankNode(quad));
  }

  nextListOfSubstitution(target: N3.Store): [RDF.BlankNode, RDF.Term[]] {
    const blankNode = this.blankNodes[this.i];
    const [subject, predicate, object, graph, filter, finder] = this.blankNodesDetails[blankNode.value];
  
    return [
      blankNode,
    // 2/ Find all corresponding quads in target
      target
      .getQuads(subject, predicate, object, graph)
      .filter(filter)
    // 3/ Make the list
      .map(quad => finder(quad))
    ];
  }

  /**
   * Given a predicate that checks if a proposed subsititution is valid or
   * not, explores every possible subsitution until one is valid.
   * 
   * The main purpose of this function is to ensure the blank node exploration
   * index (this.i) is properly moved
   * 
   * @param actualStore The current state of the destination store
   * @param substituableChecker A predicate that returns true if the
   * proposed substitution is valid
   */
  forEachPossibleSubstitution(
    actualStore: N3.Store,
    substituableChecker: (source: RDF.BlankNode, target: RDF.Term) => boolean
  ) {
    // Find a list of candidates
    const [blankNode, listOfSubstitutions] = this.nextListOfSubstitution(actualStore);
    
    // If another call to nextListOfSubstitution is made in the loop, we
    // want it to explore the next blank node.
    ++this.i;

    // See if there exists a valid subsitution for this blank node
    for (const substitution of listOfSubstitutions) {
      if (substituableChecker(blankNode, substitution)) {
        // Yes: we forward true
        --this.i;       // ensure the object remains in a valid state
        return true;
      }
    }

    // No more candidate
    --this.i;
    return false;
  }
}


type Details = {[blankNodeName: string]: Detail};

type Detail = [
  RDF.Quad_Subject | null,
  RDF.Quad_Predicate | null,
  RDF.Quad_Object | null,
  RDF.Quad_Graph | null,
  (quad: RDF.Quad) => boolean,
  (quad: RDF.Quad) => RDF.Term
];


/**
 * For each blank nodes, gives a path to retrieve a quad with a similar
 * shape from the store.
 * Example: if the blank node is in the quad "ex:s ex:p _:bn", we want to
 * to know that similar quads are the ones with a "ex:s ex:p ???" pattern.
 *
 * The path is splitted in 6 parts : s, p, o, g, filter, finder
 * - s, p, o, g : Parameters to give to the getQuads method to filter the
 * quads.
 * - filter: a predicate function on quad, that filters the wrong nested
 * quads.
 * - finder: a function that if given the right quad, retrieves the blank
 * node. In other word, in run throught the path of nested quads.
 * 
 * @param {*} store 
 * @returns 
 */
function makeDetails(store: N3.Store): Details {
  let details: Details = {};

  for (const quad of store.getQuads(null, null, null, null)) {
    makeDetail_exploreNewQuad(details, quad, "subject");
    makeDetail_exploreNewQuad(details, quad, "predicate");
    makeDetail_exploreNewQuad(details, quad, "object");
    makeDetail_exploreNewQuad(details, quad, "graph");
  }

  return details;
}

function makeDetail_exploreNewQuad(
  details: Details, quad: RDF.Quad,
  where: 'subject' | 'predicate' | 'object' | 'graph'
) {
  if (quad[where].termType === "Quad") {
    mergeIntoDetails(
        details,
        quad[where],
        where === "subject"   ? null : bNodeLess(quad.subject)  ,
        where === "predicate" ? null : bNodeLess(quad.predicate),
        where === "object"    ? null : bNodeLess(quad.object)   ,
        where === "graph"     ? null : bNodeLess(quad.graph)    ,
        q => q[where],
        []
    );
} else if (quad[where].termType === "BlankNode") {
    details[quad[where].value] = [
      where === "subject"   ? null : bNodeLess(quad.subject)  ,
      where === "predicate" ? null : bNodeLess(quad.predicate),
      where === "object"    ? null : bNodeLess(quad.object)   ,
      where === "graph"     ? null : bNodeLess(quad.graph)    ,
      _ => true,
      q => q[where]
    ];
  }
}

function mergeIntoDetails(
  details: Details,
  term: RDF.Term,
  s: RDF.Quad_Subject | null,
  p: RDF.Quad_Predicate | null,
  o: RDF.Quad_Object | null,
  g: RDF.Quad_Graph | null,
  zzz: (quad: RDF.Quad) => RDF.Term,
  conditions: ((quad: RDF.Quad) => boolean)[]
) {
  if (term.termType === "BlankNode") {
    if (details[term.value] === undefined) {
      details[term.value] = [
        s, p, o, g,
        quad => conditions.every(c => c(quad)),
        quad => zzz(quad)
      ];
    }
  } else if (term.termType === "Quad") {
    for (const tt of ["subject", "predicate", "object", "graph"] as const) {
      const copy = [...conditions];

      for (const tt_ of ["subject", "predicate", "object", "graph"] as const) {
        if (tt != tt_) {
          const bl = bNodeLess(term[tt_]);
          // @ts-ignore
          copy.push(quad => bl === null || zzz(quad)[tt_].equals(bl));
        }
      }

      mergeIntoDetails(
        details,
        term[tt],
        s, p, o, g,
        // @ts-ignore
        quad => zzz(quad)[tt],
        copy
      );
    }
  }
}

/** Replace the components of the quad equals to source with destination */
function deepSubstituteOneQuad(quad: RDF.BaseQuad, source: RDF.Term, destination: RDF.Term): RDF.Quad {
  function r(term: RDF.Term): RDF.Term {
    if (source.equals(term)) {
      return destination;
    } else if (term.termType === "Quad") {
      return deepSubstituteOneQuad(term, source, destination);
    } else {
      return term;
    }
  }

  return remapQuad(quad, r);
}

/**
 * Build a new list of quads for which the quads in listOfQuads have the member
 * equals to source replaced with destination
 */
function deepSubstitute(listOfQuads: RDF.Quad[], source: RDF.Term, destination: RDF.Term): RDF.Quad[] {
  return listOfQuads.map(quad => deepSubstituteOneQuad(quad, source, destination));
}

function _isSubstituableGraph(actualQuads: RDF.Quad[], pattern: RDF.Quad[], blankNodeExplorer: BlankNodeExplorer): boolean {
  // 1) Transform the list of quads into N3 stores
  const actualStore = new N3.Store(actualQuads);
  const patternStore = new N3.Store(pattern);

  // 2) If different sizes, they are not substituable
  if (actualStore.size != patternStore.size) return false;

  // 3) Remove quads that appear in both graphs
  for (const quad of actualStore.getQuads(null, null, null, null)) {
    const p = patternStore.getQuads(quad.subject, quad.predicate, quad.object, quad.graph);

    if (p.length == 1) {
      // The quad is in the pattern store
      actualStore.removeQuad(quad);
      patternStore.removeQuad(quad);
    }
  }

  // 4) If both graph are empty, they are obviously substituable (they are strictly equal)
  if (actualStore.size == 0 && patternStore.size == 0) return true;
  
  // 5) If there is no blank node in the pattern store, we won't be able to do an substitution = fail
  if (blankNodeExplorer.hasNonBlankQuad(patternStore)) return false;

  // 6) Substitute a blank node of pattern to a term of actualQuads
  return blankNodeExplorer.forEachPossibleSubstitution(actualStore, 
    // We are given a blank node and a candidate substitution, we have to
    // check if it is valid
    (blankNode, substitution) => _isSubstituableGraph(
      actualStore.getQuads(null, null, null, null),
      deepSubstitute(patternStore.getQuads(null, null, null, null), blankNode, substitution),
      blankNodeExplorer
    )
  );
}

/**
 * Given a quad and a mapping between old blank node names and new blank node
 * names, map every blank node in the quad to the blank node assigned in the
 * mapping.
 * 
 * In other world, this function renames the blank node of a quad
 * 
 * Precondition: Every blank node name must appear in mapping
 * 
 * @param quad The quad
 * @param mapping The correspondance of old blank node names to new ones
 * @returns A quad for which every blank node is remapped to a new blank node
 * according to mapping
 */
function _renameBlankNodesOfQuad(quad: RDF.Quad, mapping: {[oldName: string]: string}): RDF.Quad {
  function renameBlankNodesOfTerm(term: RDF.Term): RDF.Term {
    if (term.termType === "Quad") {
      return remapQuad(term, renameBlankNodesOfTerm);
    } else if (term.termType === "BlankNode") {
      return N3.DataFactory.blankNode(mapping[term.value]);
    } else {
      return term;
    }
  }

  return renameBlankNodesOfTerm(quad) as RDF.Quad;
}

function remapQuad(quad: RDF.BaseQuad, mapper: (term: RDF.Term) => RDF.Term): RDF.Quad {
  return N3.DataFactory.quad(
    mapper(quad.subject) as RDF.Quad_Subject,
    mapper(quad.predicate) as RDF.Quad_Predicate,
    mapper(quad.object) as RDF.Quad_Object,
    mapper(quad.graph) as RDF.Quad_Graph
  );
}
