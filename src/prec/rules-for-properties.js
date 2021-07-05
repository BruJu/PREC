const N3 = require('n3');
const namespace = require('@rdfjs/namespace');

const DStar    = require('../dataset/index.js');
const QuadStar = require('../rdf/quad-star.js');

const rdf  = namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", N3.DataFactory);
const rdfs = namespace("http://www.w3.org/2000/01/rdf-schema#"      , N3.DataFactory);
const prec = namespace("http://bruy.at/prec#"                       , N3.DataFactory);
const pvar = namespace("http://bruy.at/prec-trans#"                 , N3.DataFactory);
const pgo  = namespace("http://ii.uwb.edu.pl/pgo#"                  , N3.DataFactory);

const $quad         = N3.DataFactory.quad;
const $variable     = N3.DataFactory.variable;
const $defaultGraph = N3.DataFactory.defaultGraph;


/**
 * @typedef { import("rdf-js").Term } Term
 * @typedef { import("rdf-js").Quad } Quad
 * @typedef { import("./context-loader") } Context
 */

// =============================================================================
// =============================================================================
//     ==== CONTEXT LOADING ==== CONTEXT LOADING ==== CONTEXT LOADING ==== 

/** An individual property rule */
class PropertyRule {
    // ==== IRIs related to property rules, to discover the rules and build the
    // definition

    static RuleType           = prec.PropertyRule;
    static DefaultTemplate    = prec.Prec0Property;
    static MainLabel          = prec.propertyName;
    static PossibleConditions = [prec.nodeLabel, prec.edgeLabel]
    static TemplateBases = [
        [prec.NodeProperties, [prec.edgeLabel]                ],
        [prec.EdgeProperties, [                prec.nodeLabel]],
        [prec.MetaProperties, [prec.edgeLabel, prec.nodeLabel]]
    ];
    static ShortcutIRI        = prec.IRIOfProperty;
    static SubstitutionTerm   = prec.propertyIRI;

    // ==== One rule management

    /** Build a Property Rule manager from its definition */
    constructor(conditions, hash, ruleNode) {
        this.conditions = [
            [
                $quad($variable('propertyKey'), rdf.type, prec.PropertyKey)
            ]
        ];
        this.ruleNode = ruleNode;

        // prec:propertyKey
        if (conditions.label !== undefined) {
            this.conditions.push(
                [
                    $quad($variable('propertyKey'), rdfs.label, conditions.label)
                ]
            );
        }

        // prec:priority
        if (conditions.explicitPriority !== undefined) {
            this.priority = [conditions.explicitPriority, hash];
        } else {
            this.priority = [undefined, hash];
        }

        function throwError(predicate, message) {
            throw Error(
                `${iri.value} prec:IRIOfProperty ${description.value} - Error on the description node : ` +
                `${predicate.value} ${message}`
            );
        }

        // prec:nodeLabel, prec:edgeLabel
        let reservedFor = 'None';
        for (const [key, value] of conditions.other) {
            if (prec.nodeLabel.equals(key)) {
                if (reservedFor == 'Edge') {
                    throwError(p, "Found a node as object but this property rule is reserved for edges by previous rule");
                }

                PropertyRule._processRestrictionOnEntity(value, this.conditions, pgo.Node, rdf.type, mess => throwError(e, mess));
                reservedFor = 'Node';
            } else if (prec.edgeLabel.equals(key)) {
                if (reservedFor == 'Node') {
                    throwError(p, "Found an edge as object but this property rule is reserved for nodes by previous rule");
                }

                PropertyRule._processRestrictionOnEntity(value, this.conditions, pgo.Edge, rdf.predicate, mess => throwError(e, mess));
                reservedFor = 'Edge';
            } else {
                throw Error(
                    "Invalid state: found a condition of type "
                    + key.value + " but it should already have been filtered out"
                );
            }
        }
    }

    /** Adds the condition for a prec:nodeLabel / prec:edgeLabel restriction */
    static _processRestrictionOnEntity(object, conditions, type_, labelType, throwError) {
        if (prec.any.equals(object)) {
            conditions.push([
                $quad($variable("entity"), rdf.type, type_)
            ]);
        } else if (object.termType === 'Literal') {
            conditions.push([
                $quad($variable("entity"), labelType , $variable("label")),
                $quad($variable("entity"), rdf.type  , type_            ),
                $quad($variable("label") , rdfs.label, object           )
            ]);
        } else {
            throwError(p, "has invalid object");
        }
    }

    /**
     * Return the arguments to pass to `StoreAlterer::findFilterReplace` to tag
     * the properties that match this manager with its rule node.
     */
    getFilter() {
        return {
            source: [
                $quad($variable("property"), prec.__appliedPropertyRule, prec._NoPropertyRuleFound),
                $quad($variable("entity")  , $variable("propertyKey")   , $variable("property")     )
            ],
            conditions: this.conditions,
            destination: [
                $quad($variable("property"), prec.__appliedPropertyRule, this.ruleNode       ),
                $quad($variable("entity")  , $variable("propertyKey")   , $variable("property"))
            ]
        };
    }
}

const TemplateChecker = {
    /**
     * Return true if every embedded triple used in the template is asserted.
     * @param {Quad[]} template An array of quads that constitute the template
     */
    embeddedTriplesAreAsserted: function(template) {
        const invalidTriple = template.find(triple => {
            return undefined !== ["subject", "predicate", "object", "graph"].find(role => {
                const embedded = triple[role];
                if (embedded.termType !== 'Quad') return false;
                return undefined === template.find(assertedTriple => assertedTriple.equals(embedded));
            });
        });

        return invalidTriple === undefined;
    },

    /**
     * Return true if the given term only appear in subject-star position.
     * 
     * Subject-star means that the term can only be the subject, the subject
     * of the embedded triple in subject (subject-subject), ...
     * In other words, in a N-Triple-star document, it is the first pure RDF
     * term that appears in the triple.
     * @param {Quad[]} template An array of quads that constitute the template
     * @param {Term} onlyAsSubject The term that must only appear in subject-star
     * position
     */
    termMustBeInSubjectStarPosition: function(template, onlyAsSubject) {
        function _isInvalidTerm(term) {
            if (term.termType !== 'Quad') {
                return false;
            }
            
            if (QuadStar.containsTerm(term.predicate, [onlyAsSubject])) return true;
            if (QuadStar.containsTerm(term.object   , [onlyAsSubject])) return true;
            if (QuadStar.containsTerm(term.graph    , [onlyAsSubject])) return true;
    
            return _isInvalidTerm(term.subject);
        }

        return undefined === template.find(quad => _isInvalidTerm(quad));
    }
};

/**
 * Check if there are no template that have pvar:entity at another place than
 * subject.
 * 
 * Throws if there is one
 * @param {TermDict} templatess A map of map of templates
 */
function throwIfInvalidPropertyTemplates(templatess) {
    const pvarEntity = pvar.entity;

    function _hasInvalidMetaPropertyUsage(term) {
        // TODO: refine the verification
        const mpkey = term.predicate.equals(pvar.metaPropertyPredicate);
        const mpvalue = term.object.equals(pvar.metaPropertyObject);
        return mpkey !== mpvalue;
    }

    templatess.forEach((classRule, templates) => {
        templates.forEach((templateName, template) => {
            // pvar:entity in subject-star position
            if (!TemplateChecker.termMustBeInSubjectStarPosition(template, pvarEntity)) {
                throw Error(
                    "Propriety Template checker: found pvar:entity somewhere" +
                    " else as subjet in template " + classRule.value + " x " +
                    templateName.value
                );
            }

            for (const quad of template) {
                // ?s pvar:metaPropertyPredicate pvar:metaPropertyObject
                if (_hasInvalidMetaPropertyUsage(quad)) {
                    throw Error(
                        "Propriety Template checker: pvar:metaPropertyPredicate and pvar:metaPropertyObject" +
                        " may only be used in triples of form << ?s pvar:metaPropertyPredicate pvar:metaPropertyObject >>"
                        + " but the template { " + classRule.value + " x " + templateName.value + " } "
                        + " violates this restriction"
                    );
                }
            }

            // Used Embedded triples must be asserted
            if (!TemplateChecker.embeddedTriplesAreAsserted(template)) {
                throw Error("Property Template checker: the template "
                + templateName.value
                + " is used as a property template but contains an"
                + " embedded triple that is not asserted.");
            }
        });
    });
}




// =============================================================================
// =============================================================================
//            ==== CONTEXT APPLICATION ==== CONTEXT APPLICATION ==== 

// 38

function produceMarks(dataset, context) {
    // Mark every property node
    {
        const q = dataset.getQuads(null, rdf.type, prec.PropertyKey, $defaultGraph())
            .map(quad => quad.subject)
            .flatMap(propertyType => dataset.getQuads(null, propertyType, null, $defaultGraph()))
            .map(quad => quad.object)
            .map(propertyBlankNode => $quad(propertyBlankNode, prec.__appliedPropertyRule, prec._NoPropertyRuleFound));

        dataset.addAll(q);
    }

    // Find the proper rule to apply
    context.refinePropertyRules(dataset);
}

/* Return the inherited property rules for the entity */

/**
 * Return the type of the entity in the dataset, supposing it is either a node,
 * an edge or a property, and these types are exclusive.
 * @param {DStar} dataset The dataset
 * @param {Term} entity The entity
 * @returns {Term | undefined} The type of the entity if it is
 * not a property, its PGO type (`pgo.Node` or `pgo.Edge`) if it is one
 */
function findTypeOfEntity(dataset, entity) {
    if (dataset.has($quad(entity, rdf.type, pgo.Node))) {
        return prec.NodeProperties;
    }

    if (dataset.has($quad(entity, rdf.type, pgo.Edge))) {
        return prec.EdgeProperties;
    }

    // Probably a meta property
    return prec.MetaProperties;
}

/**
 * 
 * @param {DStar} destination 
 * @param {Quad} mark 
 * @param {DStar} input 
 * @param {Context} context 
 * @returns 
 */
function applyMark(destination, mark, input, context) {
    const src = [
        $quad($variable("entity"), $variable("propertyKey"), mark.subject),
        $quad(mark.subject, rdf.value, $variable("propertyValue")),
        $quad(mark.subject, rdf.type , prec.PropertyKeyValue)
    ];

    const bindingss = input.matchAndBind(src);

    if (bindingss.length !== 1) {
        throw Error(
            'rules-for-properties.js::applyMark logic error on '
            + mark.subject.value
        );
    }

    const bindings = bindingss[0];
    const label = input.getQuads(bindings.propertyKey, rdfs.label, null, $defaultGraph());
    if (label.length !== 0) {
        bindings.label = label[0].object;
    }
    
    const typeOfHolder = findTypeOfEntity(input, mark.subject);
    let template = context.findPropertyTemplate(mark.object, typeOfHolder);
    if (!Array.isArray(template)) {
        template = src;
        // I hate the fact that this node is optional
        template.push($quad(mark.subject, prec.hasMetaProperties, $variable('metaPropertyNode')));
    }

    // Build the patterns to map to
    const r = template.map(term => QuadStar.remapPatternWithVariables(term,
        [
            [$variable("entity")          , pvar.entity          ],
            [$variable("propertyKey")     , pvar.propertyKey     ],
            [$variable("label")           , pvar.label           ],
            [$variable("property")        , pvar.propertyNode    ],
            [$variable("propertyValue")   , pvar.propertyValue   ],
            [$variable("individualValue") , pvar.individualValue ],
            [$variable("metaPropertyNode"), pvar.metaPropertyNode],
        ]
    ))
        .filter(quad => !(
            QuadStar.containsTerm(quad, pvar.metaPropertyPredicate)
            || QuadStar.containsTerm(quad, pvar.metaPropertyObject)
        ));

    // Split the pattern into 4 parts
    let pattern = r.reduce(
        (previous, quad) => {
            let containerName = "";

            if (QuadStar.containsTerm(quad, $variable("metaPropertyNode"))) {
                containerName = "optional";
            } else {
                containerName = "mandatory";
            }

            if (QuadStar.containsTerm(quad, $variable("individualValue"))) {
                containerName += "Individual";
            }

            previous[containerName].push(quad);
            
            return previous;
        },
        {
            mandatory: [], optional: [], mandatoryIndividual: [], optionalIndividual: []
        }
    );

    let addedQuads = [];

    
    addedQuads.push(...DStar.bindVariables(bindings, pattern.mandatory));

    
    const { individualValues, track } = PropertyTemplateApplier.extractIndividualValues(
        input,
        bindings.propertyValue,
        pattern.mandatoryIndividual.length === 0
        && pattern.optionalIndividual.length === 0
    );

    let indiv = DStar.bindVariables(bindings, pattern.mandatoryIndividual)
    addedQuads.push(...individualValues.flatMap(value => DStar.bindVariables({ "individualValue": value }, indiv)));


    const metaProperties = (() => {
        const theQuads = input.getQuads(mark.subject, prec.hasMetaProperties, null, $defaultGraph());
        if (theQuads.length === 0) return null;
        return theQuads[0].object;
    })();
    

    if (metaProperties !== null) {

        
        let [opt1, optN] = PropertyTemplateApplier.bindMultipleVariableSets(
            [bindings, { metaPropertyNode: metaProperties }],
            [
                pattern.optional,
                pattern.optionalIndividual
            ]
        );

        addedQuads.push(...opt1);
        addedQuads.push(...individualValues.flatMap(value => DStar.bindVariables({ "individualValue": value }, optN)));

    }

    destination.addAll(addedQuads);

    // TODO: if a list was added to destination, add the complete list
    

    const woot = r.find(t => 
        QuadStar.containsTerm(t, $variable('propertyKey'))
        || QuadStar.containsTerm(t, bindings.propertyKey)
    );
    return woot !== undefined ? bindings.propertyKey : undefined;
}



/* Namespace for the functions used to transform a property modelization */
const PropertyTemplateApplier = {
    
    extractIndividualValues: function(dataset, propertyValue, ignore) {
        if (ignore === true) return { individualValues: [], track: [] };

        // A literal alone
        if (propertyValue.termType === 'Literal') {
            return { individualValues: [propertyValue], track: [] };
        }

        // An RDF list
        let result = [];
        let track = [];
        let currentList = propertyValue;

        while (!rdf.nil.equals(currentList)) {
            let theLiteral = dataset.getQuads(currentList, rdf.first, null, $defaultGraph());
            if (theLiteral.length !== 1)
                throw Error(`Malformed list ${currentList.value}: ${theLiteral.length} values for rdf:first`);

            result.push(theLiteral[0].object);

            let theRest = dataset.getQuads(currentList, rdf.rest, null, $defaultGraph());
            if (theRest.length !== 1)
                throw Error(`Malformed list ${currentList.value}: ${theRest.length} values for rdf:rest`);

            let nextElement = theRest[0].object;
            track.push(currentList);
            currentList = nextElement;
        }

        return { individualValues: result, track: track };
    },

    bindMultipleVariableSets: function(listOfBindings, pattern) {
        for (let bindings of listOfBindings) {
            pattern = DStar.bindVariables(bindings, pattern);
        }
        return pattern;
    },

}

// =============================================================================
// =============================================================================

module.exports = {
    // Context loading
    Rule: PropertyRule,
    throwIfHasInvalidTemplate: throwIfInvalidPropertyTemplates,
    
    // Context application
    produceMarks, applyMark
}
