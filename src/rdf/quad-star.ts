import { Quad, Term } from '@rdfjs/types';
import { DataFactory } from 'n3';

type QuadPosition = 'subject' | 'predicate' | 'object' | 'graph';

/**
 * Returns a quad equals to
 * ```
 *  Quad(
 *    unaryFunction(quad.subject),
 *    unaryFunction(quad.predicate),
 *    unaryFunction(quad.object),
 *    unaryFunction(quad.graph)
 *  )
 * ```
 * 
 * Compared to a naive approach, in some cases this quad returns the passed quad
 * if it would be equal.
 * 
 * @param quad Quad to rebuild. Must be of type quad
 * @param unaryFunction Function to call to convert an inner term
 */
export function eventuallyRebuildQuad(quad: Quad, unaryFunction: (quad: Term) => Term): Quad {
  let elements = [quad.subject, quad.predicate, quad.object, quad.graph];

  let conversion = elements.map(
    e => e.termType === 'Quad' ? eventuallyRebuildQuad(e, unaryFunction) : unaryFunction(e)
  );

  for (let i = 0 ; i != 4 ; ++i) {
    if (elements[i] !== conversion[i]) {
      // @ts-ignore 
      return DataFactory.quad(conversion[0], conversion[1], conversion[2], conversion[3]);
    }
  }
  
  return quad;
}

/**
 * Modify the term by replacing its content.
 * 
 * @param term The term to modify
 * @param mapping A list of [termReplacement, termToReplace]
 * @returns the term where the term to replace have been replaced with
 * their counterpart
 */
export function remapPatternWithVariables(term: Term, mapping: [Term, Term][]): Term {
  function remapTerm(t: Term): Term {
    let dest = mapping.find(e => e[1].equals(t));

    if (dest !== undefined) {
      return dest[0];
    } else if (t.termType !== 'Quad') {
      return t;
    } else {
      return DataFactory.quad(
        // @ts-ignore 
        remapTerm(t.subject),
        remapTerm(t.predicate),
        remapTerm(t.object),
        remapTerm(t.graph)
      );
    }
  }

  return remapTerm(term);
}

/**
 * Returns true if the term is or contains the searched term.
 * @param term A RDF/JS term
 * @param searched The searched RDF/JS term
 * @returns True if term is or contains `searched`
 */
export function containsTerm(term: Term, searched: Term): boolean {
  if (term.equals(searched)) return true;
  if (term.termType !== 'Quad') return false;
  return containsTerm(term.subject  , searched)
    || containsTerm(term.predicate, searched)
    || containsTerm(term.object   , searched)
    || containsTerm(term.graph    , searched);
}

/**
 * Returns true if the term is or contains one of the searched term.
 * @param term A RDF/JS term
 * @param searched The searched RDF/JS terms
 * @returns True if term is or contains one of the `searched` terms
 */
export function containsOneOfTerm(term: Term, ...searched: Term[]): boolean {
  return searched.some(oneSearchedTerm => containsTerm(term, oneSearchedTerm));
}

/**
 * Returns true if the term all of the searched term.
 * @param term A RDF/JS term
 * @param searched The searched RDF/JS terms
 * @returns True if term contains all of the `searched` terms
 */
export function containsAllTerms(term: Term, ...searched: Term[]): boolean {
  return searched.every(oneSearchedTerm => containsTerm(term, oneSearchedTerm));
}

/**
 * Checks if realQuad and patternQuad are equals. `null` and `undefined` are
 * considered wildcards: any term matches it in the pattern quad.
 * 
 * `realQuad` must not contain any wildcard
 * 
 * @param realQuad A quad with no wildcards
 * @param patternQuad A quad that may contain wildcards
 * @returns True if the readQuad matches the patternQuad
 */
export function matches(realQuad: Quad, patternQuad: Quad): boolean {
  function ok(position: QuadPosition): boolean {
    const rightTerm = patternQuad[position];
    if (rightTerm === null || rightTerm === undefined) {
      return true;
    }

    const leftTerm = realQuad[position];

    if (rightTerm.termType === 'Quad') {
      return leftTerm.termType === 'Quad' && matches(leftTerm, rightTerm);
    } else {
      return leftTerm.equals(rightTerm);
    }
  }

  return ok('subject') && ok('predicate') && ok('object') && ok('graph');
}
