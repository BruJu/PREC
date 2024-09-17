import * as RDF from "@rdfjs/types";
import { SplitDefConditions } from "./context-loader";
import DStar from '../dataset/index';
import Context from "./Context";

/**
 * The list of terms that are related to rules of a type.
 */
export type RuleDomain = {
  /** The type of the rules */
  readonly RuleType             : RDF.NamedNode;
  /** The default template for the data affected by this rule */
  readonly DefaultTemplate      : RDF.Term;
  /** The predicate to address the label of the element */
  readonly MainLabel            : RDF.NamedNode;
  /** The possible conditions */
  readonly PossibleConditions   : RDF.Term[];
  /**
   * The list of domain nodes
   */
  readonly TemplateBases        : (RDF.NamedNode | RDF.BlankNode)[]
  /** The term used for short rules (`:name prec:IRIOFProperty "Name".`) */
  readonly ShortcutIRI          : RDF.NamedNode;
  /** The substitution predicate for the label */
  readonly SubstitutionPredicate: RDF.NamedNode;
  
  /** Property holder substitution term (where are the properties going?) */
  readonly SelfIdentityIs: RDF.Term | null;

  /** Heuristic rules to detect the self identity / holder of properties */
  readonly SelfIdentityHeuristic: RDF.NamedNode[][] | null;
}

export type Template = {
  quads: RDF.Quad[];
  selfIs: RDF.Term[];
}

export interface Priorisable {
  get priority(): [number | undefined, string]
}

export interface FilterProviderConstructor {
  new (conditions: SplitDefConditions, hash: string, ruleNode: RDF.Quad_Subject): FilterProvider;
}

export interface FilterProvider extends Priorisable {
  getFilters(): { source: RDF.Quad[], conditions: RDF.Quad[][], destination: RDF.Quad[]}[];
}

export interface RuleType {
  get domain(): RuleDomain;
  get mark(): RDF.NamedNode;

  makeOneRuleFilter(conditions: SplitDefConditions, hash: string, ruleNode: RDF.Quad_Subject): FilterProvider;

  addInitialMarks(dataset: DStar): void;

  applyMark(
    destination: DStar,
    mark: RDF.Quad,
    input: DStar,
    context: Context
  ): RDF.Term[];
}
