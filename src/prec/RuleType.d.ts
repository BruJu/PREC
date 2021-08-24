import { Term, Quad, NamedNode, BlankNode } from "rdf-js";

/**
 * The list of terms that are related to rules of a type.
 */
export type RuleDomain = {
  /** The type of the rules */
  readonly RuleType          : NamedNode;
  /** The default template for the data affected by this rule */
  readonly DefaultTemplate   : Term;
  /** The predicate to address the label of the element */
  readonly MainLabel         : NamedNode;
  /** The possible conditions */
  readonly PossibleConditions: Term[];
  /**
   * The list of domain nodes, paired with the list of conditions they are
   * incompatible with
   */
  readonly TemplateBases     : [NamedNode | BlankNode, Term[]][]
  /** The term used for short rules (`:name prec:IRIOFProperty "Name".`) */
  readonly ShortcutIRI       : NamedNode;
  /** The substitution term for the label */
  readonly SubstitutionTerm  : NamedNode;
  
  /** Property holder substitution term (where are the properties going?) */
  readonly PropertyHolderSubstitutionTerm: Term | null;

  // TODO: Use real substitutions instead of this

  readonly EntityIsHeuristic: NamedNode[][] | null;
}

export type Template = {
  quads: Quad[];
  entityIs: Quad[] | null;
}

interface Priorisable {
  get priority(): [number | undefined, string]
}

interface FilterProviderConstructor {
  new (conditions: SplitDefConditions, hash: string, ruleNode: Quad_Subject): FilterProvider;
}

interface FilterProvider extends Priorisable {
  getFilter(): { source: Quad[], conditions: Quad[][], destination: Quad[]};
}
