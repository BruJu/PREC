import DStar, { Bindings, bindVariables } from '../dataset/index';
import * as QuadStar from '../rdf/quad-star';
import { FilterProvider, RuleDomain, RuleType } from '../prec-c/RuleType';
import { SplitDefConditions } from '../prec-c/context-loader';
import * as RDF from '@rdfjs/types';
import Context from './Context';

import {
  rdf, rdfs, prec, pvar, pgo,
  $quad, $variable, $defaultGraph
} from '../PRECNamespace';
import { termToString } from 'rdf-string';

class PropertiesRuleClass implements RuleType {
  readonly domain: RuleDomain = {
    RuleType             : prec.PropertyRule,
    DefaultTemplate      : prec.Prec0Property,
    MainLabel            : prec.propertyKey,
    PossibleConditions   : [prec.label, prec.onKind],
    TemplateBases: [
      prec.NodeProperties,
      prec.EdgeProperties,
      prec.MetaProperties
    ],
    ShortcutIRI          : prec.IRIOfProperty,
    SubstitutionPredicate: prec.propertyIRI,
    
    SelfIdentityIs: prec.selfIs,
    SelfIdentityHeuristic: [
      [pvar.metaPropertyNode],
      [pvar.propertyNode],
      [pvar.self],
      [pvar.holder, pvar.propertyKey, pvar.propertyValue  ],
      [pvar.holder, pvar.propertyKey, pvar.individualValue],
    ]
  };

  readonly mark = prec.__appliedPropertyRule;

  makeOneRuleFilter(conditions: SplitDefConditions, hash: string, ruleNode: RDF.Quad_Subject) {
    return new PropertyRule(conditions, hash, ruleNode);
  }

  addInitialMarks(dataset: DStar): void {
    const q = dataset.getQuads(null, rdf.type, prec.PropertyKey, $defaultGraph)
    .map(quad => quad.subject)
    .flatMap(propertyType => dataset.getQuads(null, propertyType, null, $defaultGraph))
    .map(quad => quad.object)
    .map(propertyBlankNode => $quad(propertyBlankNode as RDF.Quad_Subject, this.mark, prec._NoPropertyRuleFound));

    dataset.addAll(q);
  }

  applyMark(destination: DStar, mark: RDF.Quad, input: DStar, context: Context): RDF.Term[] {
    return applyMark(destination, mark, input, context);
  }
}

const instance = new PropertiesRuleClass();
export default instance;

/** An individual property rule */
class PropertyRule implements FilterProvider {
  conditions: RDF.Quad[][] | null;
  conditionsAlternative: RDF.Quad[][] | null;
  ruleNode: RDF.Quad_Subject;
  priority: [number | undefined, string];

  /** Build a Property Rule manager from its definition */
  constructor(conditions: SplitDefConditions, hash: string, ruleNode: RDF.Quad_Subject) {
    this.conditions = [[$quad($variable('propertyKey'), rdf.type, prec.PropertyKey)]];
    this.ruleNode = ruleNode;

    // prec:propertyKey
    if (conditions.label !== undefined) {
      this.conditions.push([$quad($variable('propertyKey'), rdfs.label, conditions.label)]);
    }

    // prec:priority
    if (conditions.explicitPriority !== undefined) {
      this.priority = [conditions.explicitPriority, hash];
    } else {
      this.priority = [undefined, hash];
    }

    function throwError(predicate: RDF.Term, message: string): never {
      throw Error(`Error for the property rule ${ruleNode.value} : ${predicate.value} ${message}`);
    }

    this.conditionsAlternative = [...this.conditions];

    // prec:label
    let reservedFor = { node: false, edge: false };
    for (const [key, value] of conditions.other) {
      if (prec.label.equals(key)) {
        PropertyRule._processRestrictionOnEntity(value, this.conditions, rdf.type, throwError);
        PropertyRule._processRestrictionOnEntity(value, this.conditionsAlternative, rdf.predicate, throwError);
      } else if (prec.onKind.equals(key)) {
        if (value.equals(prec.Node)) {
          reservedFor.node = true;
        } else if (value.equals(prec.Edge)) {
          reservedFor.edge = true;
        } else {
          throwError(key, "Invalid target, found " + termToString(value) + " but expected either prec:Node or prec:Edge");
        }
      } else {
        throw Error(
          "Invalid state: found a condition of type " + key.value + " but it should already have been filtered out"
        );
      }
    }

    if (reservedFor.node && reservedFor.edge) {
      this.conditions.push([$quad($variable("holder"), rdf.type, pgo.Node)]);
      this.conditionsAlternative.push([$quad($variable("holder"), rdf.type, pgo.Edge)]);
    } else if (reservedFor.node) {
      this.conditions.push([$quad($variable("holder"), rdf.type, pgo.Node)]);
      this.conditionsAlternative = null;
    } else if (reservedFor.edge) {
      this.conditionsAlternative.push([$quad($variable("holder"), rdf.type, pgo.Edge)]);
      this.conditions = null;
    } else {
      this.conditionsAlternative = null;
    }
  }

  /** Adds the condition for a prec:label restriction */
  static _processRestrictionOnEntity(
    object: RDF.Term, conditions: RDF.Quad[][], labelType: RDF.Quad_Predicate,
    throwError: (labelType: RDF.Quad_Predicate, text: string) => never
  ) {
    if (object.termType === 'Literal') {
      conditions.push([
        $quad($variable("holder"), labelType , $variable("label")),
        $quad($variable("label") , rdfs.label, object           )
      ]);
    } else {
      throwError(labelType, "invalid object");
    }
  }

  /**
   * Return the arguments to pass to `StoreAlterer::findFilterReplace` to tag
   * the properties that match this manager with its rule node.
   */
  getFilters() {
    return [this.conditions, this.conditionsAlternative]
    .filter(c => c !== null)
    .map(conditions => ({
      source: [
        $quad($variable("property"), prec.__appliedPropertyRule, prec._NoPropertyRuleFound),
        $quad($variable("holder")  , $variable("propertyKey")   , $variable("property")     )
      ],
      conditions: conditions!,
      destination: [
        $quad($variable("property"), prec.__appliedPropertyRule, this.ruleNode        ),
        $quad($variable("holder")  , $variable("propertyKey")  , $variable("property"))
      ]
    }))
  }
}

// =============================================================================
// =============================================================================
//            ==== CONTEXT APPLICATION ==== CONTEXT APPLICATION ==== 

/**
 * Return the type of the holder in the dataset, supposing it is either a node,
 * an edge or a property, and these types are exclusive.
 * @param dataset The dataset
 * @param holder The holder
 * @returns The type of the holder
 */
function findTypeOfEntity(dataset: DStar, holder: RDF.Quad_Subject): RDF.NamedNode {
  if (dataset.has($quad(holder, rdf.type, pgo.Node))) {
    return prec.NodeProperties;
  }

  if (dataset.has($quad(holder, rdf.type, pgo.Edge))) {
    return prec.EdgeProperties;
  }

  // Probably a meta property
  return prec.MetaProperties;
}

function applyMark(destination: DStar, mark: RDF.Quad, input: DStar, context: Context) {
  const src = [
    $quad($variable("holder"), $variable("propertyKey"), mark.subject),
    $quad(mark.subject, rdf.value, $variable("propertyValue")),
    $quad(mark.subject, rdf.type , prec.PropertyKeyValue)
  ];

  const bindingss = input.matchAndBind(src);

  if (bindingss.length !== 1) {
    throw Error(
      'rules-for-properties.ts::applyMark logic error on ' + mark.subject.value
    );
  }

  const bindings = bindingss[0];
  bindings.property = mark.subject;

  const typeOfHolder = findTypeOfEntity(input, bindings.holder as RDF.Quad_Subject);
  const template = context.findPropertyTemplate(mark.object as RDF.Quad_Subject, typeOfHolder).quads;
  const { produced, usedProperties, listsToKeep } = instanciateProperty(input, mark.subject, template, context);

  destination.addAll(produced);

  for (const listToKeep of listsToKeep) {
    let list = listToKeep;
    while (!list.equals(rdf.nil)) {
      destination.addAll(input.getQuads(list));
      list = input.getQuads(list, rdf.rest)[0].object;
    }
  }
  
  return usedProperties;
}

type InstanciateResult = {
  produced: RDF.Quad[];
  usedProperties: RDF.Term[];
  listsToKeep: RDF.Term[];
}


/**
 * 
 * @param input The input dataset
 * @param propertyNode The property node
 * @param srcTemplate The destination pattern
 * @returns The produced quads
 */
function instanciateProperty(
  input: DStar, propertyNode: RDF.Quad_Subject, srcTemplate: RDF.Quad[],
  context: Context
): InstanciateResult {
  const src = [
    $quad($variable("holder"), $variable("propertyKey"), propertyNode),
    $quad(propertyNode, rdf.value, $variable("propertyValue")),
    $quad(propertyNode, rdf.type , prec.PropertyKeyValue)
  ];

  const bindings = input.matchAndBind(src)[0];
  bindings.label = input.getQuads(bindings.propertyKey as RDF.Quad_Subject, rdfs.label, null, $defaultGraph)[0].object;
  bindings.property = propertyNode;

  const holders = deepResolve(bindings.holder as RDF.Quad_Subject, input, context);

  // Build the patterns to map to
  const r = (srcTemplate.map(term => QuadStar.remapPatternWithVariables(term,
    [
      [$variable("holder")          , pvar.holder          ],
      [$variable("propertyKey")     , pvar.propertyKey     ],
      [$variable("label")           , pvar.label           ],
      [$variable("property")        , pvar.propertyNode    ],
      [$variable("property")        , pvar.self            ],
      [$variable("propertyValue")   , pvar.propertyValue   ],
      [$variable("individualValue") , pvar.individualValue ],
      [$variable("metaPropertyNode"), pvar.metaPropertyNode],
    ]
  )) as RDF.Quad[]);

  // Split the template into 4 parts
  const pattern = r.reduce(
    (previous, quad) => {
      let containerName;

      if (QuadStar.containsTerm(quad, $variable("metaPropertyNode"))) {
        containerName = "optional";
      } else {
        containerName = "mandatory";
      }

      if (QuadStar.containsTerm(quad, $variable("individualValue"))) {
        containerName += "Individual";
      }

      (previous as any)[containerName].push(quad);
      
      return previous;
    },
    {
      mandatory: [] as RDF.Quad[],
      optional: [] as RDF.Quad[],
      mandatoryIndividual: [] as RDF.Quad[],
      optionalIndividual: [] as RDF.Quad[]
    }
  );

  const individualValues = extractIndividualValues(
    input,
    bindings.propertyValue as RDF.Quad_Object,
    pattern.mandatoryIndividual.length === 0
    && pattern.optionalIndividual.length === 0
  );
    
  const metaProperties = (() => {
    const theQuads = input.getQuads(propertyNode, prec.hasMetaProperties, null, $defaultGraph);
    if (theQuads.length === 0) return null;
    return theQuads[0].object;
  })();

  let addedQuads = [];
  for (const holder of holders) {
    bindings.holder = holder;
    addedQuads.push(...bindVariables(bindings as Bindings, pattern.mandatory));

    let indiv = bindVariables(bindings as Bindings, pattern.mandatoryIndividual)
    addedQuads.push(...individualValues.flatMap(value => bindVariables({ "individualValue": value }, indiv)));


    if (metaProperties !== null) {
      let [opt1, optN] = bindMultipleVariableSets(
        [bindings as Bindings, { metaPropertyNode: metaProperties }],
        [
          pattern.optional,
          pattern.optionalIndividual
        ]
      );

      addedQuads.push(...opt1);
      addedQuads.push(...individualValues.flatMap(value => bindVariables({ "individualValue": value }, optN)));
    }
  }

  let result: InstanciateResult = {
    produced: addedQuads,
    usedProperties: [],
    listsToKeep: []
  }

  if (r.some(t => QuadStar.containsTerm(t, $variable('propertyValue')))
    && input.getQuads(bindings.propertyValue as RDF.Term, rdf.first).length !== 0) {
        result.listsToKeep.push(bindings.propertyValue as RDF.Term);
  }

  const woot = r.some(t => 
    QuadStar.containsTerm(t, $variable('propertyKey'))
    || QuadStar.containsTerm(t, bindings.propertyKey as RDF.Term)
  );

  if (woot) {
    result.usedProperties.push(bindings.propertyKey as RDF.Term);
  }

  return result;
}


/**
 * Find the real identity of the term to resolve depending on the input dataset
 * and the context
 * @param termToResolve The term for which the final identity is required
 * @param inputDataset The original PREC-0 dataset
 * @param context The context
 */
function deepResolve(termToResolve: RDF.Quad_Subject, inputDataset: DStar, context: Context): RDF.Term[] {
  const myType = findTypeOfEntity(inputDataset, termToResolve)!;

  if (myType.equals(prec.NodeProperties)) {
    // No rule can modify the identity of a node
    return [termToResolve];
  } else if (myType.equals(prec.EdgeProperties)) {
    const edgeBindings = inputDataset.matchAndBind([
      $quad(termToResolve, rdf.type, pgo.Edge),
      $quad(termToResolve, rdf.subject  , $variable("subject")  ),
      $quad(termToResolve, rdf.predicate, $variable("predicate")),
      $quad(termToResolve, rdf.object   , $variable("object")   )
    ])[0];
    edgeBindings.edge = termToResolve;

    const ruleNode =
      inputDataset.getQuads(termToResolve, prec.__appliedEdgeRule, null, $defaultGraph)[0]
      .object as RDF.Quad_Subject;
    
    return context.findEdgeTemplate(ruleNode).selfIs
      .map(theEntityTemplate => {
        const trueEntityTemplate = QuadStar.remapPatternWithVariables(
          theEntityTemplate,
          [
            [$variable('edge')     , pvar.self       ],
            [$variable('edge')     , pvar.edge       ],
            [$variable('subject')  , pvar.source     ],
            [$variable('predicate'), pvar.edgeIRI    ],
            [$variable('label')    , pvar.label      ],
            [$variable('object')   , pvar.destination],
          ]
        ) as RDF.Quad_Subject;

        return bindVariables(edgeBindings as Bindings, $quad(trueEntityTemplate, prec._, prec._)).subject;
      });
  } else if (myType.equals(prec.MetaProperties)) {
    const binding = inputDataset.matchAndBind([
      $quad($variable('propertyNode'), prec.hasMetaProperties, termToResolve),
      $quad($variable('propertyNode'), prec.__appliedPropertyRule, $variable('ruleNode')),
      $quad($variable('holder'), $variable('whatever'), $variable('propertyNode'))
    ])[0];
    
    const ruleNode = binding.ruleNode as RDF.Quad_Subject;
    const propertyNode = binding.propertyNode as RDF.Quad_Subject;

    return context.findPropertyTemplate(ruleNode, findTypeOfEntity(inputDataset, binding.holder as RDF.Quad_Subject))
      .selfIs
      .map(term => $quad(term as RDF.Quad_Subject, prec._, prec._))
      .map(me => instanciateProperty(inputDataset, propertyNode, [me], context).produced)
      .flatMap(producedQuads => producedQuads.map(quad => quad.subject));
  } else {
    // Should not happen
    throw Error("logic erroc in deepResolve: unknown type " + myType.value + " for " + termToResolve.value);
  }
}


/* Namespace for the functions used to transform a property modelization */
function extractIndividualValues(dataset: DStar, propertyValue: RDF.Quad_Object, ignore: boolean) {
  if (ignore === true) return [];

  // A literal alone
  if (propertyValue.termType === 'Literal') return [propertyValue];

  // An RDF list
  let result = [];
  let currentList = propertyValue;

  while (!rdf.nil.equals(currentList)) {
    let theLiteral = dataset.getQuads(currentList, rdf.first, null, $defaultGraph);
    if (theLiteral.length !== 1)
      throw Error(`Malformed list ${currentList.value}: ${theLiteral.length} values for rdf:first`);

    result.push(theLiteral[0].object);

    let theRest = dataset.getQuads(currentList, rdf.rest, null, $defaultGraph);
    if (theRest.length !== 1)
      throw Error(`Malformed list ${currentList.value}: ${theRest.length} values for rdf:rest`);

    let nextElement = theRest[0].object;
    currentList = nextElement as RDF.Quad_Subject;
  }

  return result;
}

function bindMultipleVariableSets(listOfBindings: Bindings[], pattern: RDF.Quad[][]) {
  for (let bindings of listOfBindings) {
    pattern = bindVariables(bindings, pattern);
  }

  return pattern;
}
