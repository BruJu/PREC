import { Term, Quad } from "rdf-js";

/**
 * The list of terms that are related to rules of a type.
 */
export type RuleDomain = {
  /** The type of the rules */
  readonly RuleType          : Term;
  /** The default template for the data affected by this rule */
  readonly DefaultTemplate   : Term;
  /** The predicate to address the label of the element */
  readonly MainLabel         : Term;
  /** The possible conditions */
  readonly PossibleConditions: Term[];
  /**
   * The list of domain nodes, paired with the list of conditions they are
   * incompatible with
   */
  readonly TemplateBases     : [Term, Term[]][]
  /** The term used for short rules (`:name prec:IRIOFProperty "Name".`) */
  readonly ShortcutIRI       : Term;
  /** The substitution term for the label */
  readonly SubstitutionTerm  : Term;
  
  /** Property holder substitution term (where are the properties going?) */
  readonly PropertyHolderSubstitutionTerm: Term | null;

  // TODO: Use real substitutions instead of this
}

export type Template = {
  quads: Quad[];
  entityIs: Term[];
}
