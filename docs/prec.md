# The PREC ontology

[PREC](https://github.com/BruJu/PREC/) is composed of two modules:
- PREC-0, a Property Graph to RDF graph converter
- PREC-Context, a RDF Graph generated from PREC-0 to more readable graphs converter

To define the transformations to apply, PREC-Context uses a *Context* provided
by the user in [Turtle-Star](https://w3c.github.io/rdf-star/cg-spec/editors_draft.html#turtle-star) format.


*This ontology is currently very tentative and is subject to change.*

## Introduction

### Schema of the PREC-0 graphs

**TODO**

### Use of a context

The context can be automatically applied during the convertion of the Property Graph to RDF:
- For example, for a Neo4j graph for which you have already extacted the content in Json format, use `node prec.js path_to_property_graph_content.json path_to_context.ttl`

If you have already genereted the PREC-0 graph, you can use the ApplyContext tool:
- `node tools.js ApplyContext path_to_prec0_graph.ttl path_to_context.ttl`


### Example of a context

**TODO**

## IRIs used by PREC0


### http://bruy.at/prec#CreatedVocabulary

Type of IRIs that has been created by PREC and that
should be mapped to an actual ontology.

It only applies to labels and property names.


### http://bruy.at/prec#Property

Type of property keys / labels.

### http://bruy.at/prec#PropertyValue

Type of property values. Can be seed as the counterpart of
[pgo:Property](http://ii.uwb.edu.pl/pgo#) in the PREC modelization.


### http://bruy.at/prec#hasMetaProperties

States to which (RDF) node the meta properties of a property are attached to.

*Example*

```
_:bob :live_in [
    rdf:type prec:PropertyValue ;
    rdf:value "Paris ;
    prec:hasMetaProperties [
        :status [ rdf:value "Tenant" ; rdf:type prec:PropertyValue ]
    ]
] .

:live_in a prec:Property .
:status  a prec:Property .
```


### Reserved IRIs

IRIs in the `prec` namespace are reserved for the ontology (obviously).

[The default implementation](https://github.com/BruJu/PREC/). reserves for
itself the IRIs prefixed with `_` and `__` are reserved for implementation.
Using them in a context is undefined behaviour.


## Keep the provenance

### http://bruy.at/prec#KeepProvenance

By default, a triple is created for each node / relationship / property /
property value between its IRI / blank node and the type.

If this flag is set to false, the triples in the form `ex:node1 a pgo:Node`
are deleted from the output graph.

```ttl
PREFIX prec: <http://bruy.at/prec#>

# Alternative 1: keep the types (default behaviour)
prec:KeepProvenance prec:flagState true .

# Alternative 2: remove the types
prec:KeepProvenance prec:flagState false .
```

### http://bruy.at/prec#flagState

See http://bruy.at/prec#KeepProvenance


## Change the schema of the generated graph

PREC-0 generates an RDF Graph with a certain format. It is possible to change the
way the properties and the relationships are modelled in the RDF graph.

By default:
- Relationships are materialized using a standard RDF Reification
- Properties are materialized with the following format:
```
_:eitherTheNodeOrTheEdge :propertyKey _:aBlankNode
_:aBlankNode rdf:value :propertyValue
_:aBlankNode prec:hasMetaProperties _:aNodeWithTheMetaPropertiesIfAny

:propertyKey a prec:Property .
_:aBlankNode a prec:PropertyValue .
```

PREC-Context is able to change the format used to represent the properties and
the relationships by using models.

In PREC, we call a *model* the format wanted by the user.

### Basics to use a model

#### http://bruy.at/prec#modelAs

States that the subject must be modelled in the format described in the object.

#### http://bruy.at/prec#Relationships

The group of every relationships.


*Examples*

- [prec:RDFReification](http://bruy.at/prec#RDFReification)
    - `prec:Relationships prec:modelAs prec:RDFReification .`
    - Relationships must be modeled as a standard RDF Reification (default behaviour).
- [prec:RDFStarUnique](http://bruy.at/prec#RdfStarUnique)
    - `prec:Relationships prec:modelAs prec:RdfStarUnique .`
    - Relationships are modeled as a triple that is added to the graph, and meta properties are added using RDF-star. This model will cause information loss if there are two edges with the same label between two nodes.
- [prec:RDFStarOccurrence](http://bruy.at/prec#RDFStarOccurrence)
    - `prec:Relationships prec:modelAs prec:RDFStarOccurrence .`
    - Relationships are modeled as an RDF-star occurence: a blank node represents the occurrence and [prec:occurenceOf](http://bruy.at/prec#occurrenceOf) is used to link the node to the triple it is an occurence of.
- [prec:SingletonProperty](http://bruy.at/prec#SingletonProperty)
    - `prec:Relationships prec:modelAs prec:SingletonProperty .`
    - Relationships must be modeled using singleton properties.


#### http://bruy.at/prec#Properties

The group of every properties

*Examples*

- `prec:Properties prec:modelAs prec:Prec0Property .`: Properties are modeled in the format presented in the [prec:hasMetaProperties](http://bruy.at/prec#hasMetaProperties) example. This is the default behaviour.
- `prec:Properties prec:modelAs prec:CombinedBlankNodes .`: Properties are modeled in the same format as `prec:Prec0Property`, but the propertyValue and the metaProperty nodes are merged.
- `prec:Properties prec:modelAs prec:DirectTriples .`: Properties are modeled without any blank node (`:node :propertyKey :thePropertyValueLiteral`), and the meta properties are represented using RDF-star.

#### http://bruy.at/prec#NodeProperties

The group of every properties on nodes. Properties on relationships are not
affected. The usage is similar as `prec:Properties`.

#### http://bruy.at/prec#RelationshipProperties

The group of every properties on relationships. Properties on edges are not
affected. The usage is similar as `prec:Properties`.

### Writting your own models

So far, this document described how to use predefined models. It is also
possible to write you own models.

Models uses the `pvar` namespace (http://bruy.at/prec-trans#) as variable. pvar
can be seen as a way to write `?` in a Turtle file without actually using a real
variable.

#### http://bruy.at/prec#composedOf

Used to state the list of RDF triples that composes the model. When the model
is applied, every triple used in the default PREC0 model will be replaced with
the triples that composes the model.

Models and the variables it contains can be seen as a template.

#### http://bruy.at/prec#EdgeTransformation

The type of models that can be used for relationships.

`EdgeTransformation`s use the following variable:
- `pvar:self`: The RDF node that was created to identify the relationship.
- `pvar:source`: The RDF node that represents the PG source node of the relationship.
- `pvar:destiantion`: The RDF node that represents the PG destination relationship.
- `pvar:relationshipIRI`: The RDF node that represents the label of the edge.
- `pvar:propertyKey`: matchs every other predicates. Supposed to represent each property key.
- `pvar:propertyValue`: matchs every other objects. Supposed to represent each property value.

The full list of *built in PREC* relationship transformations is available in
https://github.com/BruJu/PREC/blob/master/prec3/builtin_rules.ttl

*Example 1 of a `prec:EdgeTransformation`: identity / RDF Reification*:

```
prec:RDFReification a prec:EdgeTransformation ;
  prec:composedOf
    << pvar:self a pgo:Edge >> ,
    << pvar:self rdf:subject      pvar:source          >> ,
    << pvar:self rdf:predicate    pvar:relationshipIRI >> ,
    << pvar:self rdf:object       pvar:destination     >> ,
    << pvar:self pvar:propertyKey pvar:propertyValue   >>
  .
```

Note that `prec:RDFReification` is the pattern that is matched against, which
means modelling a relationship as `prec:RDFReification` will result in the same
graph.

*Example 2 of a `prec:EdgeTransformation`: RDFStarUnique*:

```
prec:RdfStarUnique a prec:EdgeTransformation ;
  prec:composedOf
    <<    pvar:source pvar:relationshipIRI pvar:destination               >> , # (a)
    << << pvar:source pvar:relationshipIRI pvar:destination >> a pgo:Edge >> , # (b)
    << << pvar:source pvar:relationshipIRI pvar:destination >> pvar:propertyKey pvar:propertyValue >>  # (c)
  .
```

If we suppose we have the following RDF Graph:

```
_:edge1 rdf:subject _:src ;
        rdf:predicate _:label ;
        rdf:object _:dest ;
        a pgo:Edge ;
        _:propPlace _:propValuePlace ;
        _:propTime  _:propValueTime .
```

The variables will match as follow:

| Variable name            | Value              |
| ------------------------ | ------------------ |
| `pvar:self`              | `_:edge1`          |
| `pvar:source`            | `_:src`            |
| `pvar:destination`       | `_:dest`           |
| `pvar:relationshipIRI`   | `_:label`          |
| `pvar:propertyKey`   (1) | `_:propPlace`      |
| `pvar:propertyValue` (2) | `_:propValuePlace` |
| `pvar:propertyKey`   (2) | `_:propTime`       |
| `pvar:propertyValue` (2) | `_:propValueTime`  |

And the produced graph will be the following:
```
_:src _:label _:dest .                  # From (a)
<< _:src _:label _:dest >> a pgo:Edge . # From (b)
<< _:src _:label _:dest >> _:propPlace _:propValuePlace . # From (c) using (1) bindings
<< _:src _:label _:dest >> _:propTime  _:propValueTime  . # From (c) using (2) bindings
```


#### http://bruy.at/prec#PropertyTransformation

The type of property models.

`prec:PropertyTransformation`s use the following variables:
- `pvar:entity`: The RDF node that was created to identify the edge of the node.
- `pvar:propertyKey`: The node that represents the edge label.
- `pvar:property`: The blank node that represents the property.
- `pvar:propertyValue`: The literal that contains the property value.
- `pvar:metaProperties`: <span color="#808080">The node that contains the meta properties</span> (not yet supported).

The subsititution mecanism is the same as described in the
[prec:EdgeTransformation](http://bruy.at/prec#EdgeTransformation) section.

The built in transformations are `prec:Prec0Property` (identity transformation),
`prec:CombinedBlankNodes` (merges the property and the meta property blank nodes)
and `prec:DirectTriples` (uses a triple for the property and RDF-star for meta
properties).

#### Built-in models

Here is the list of built in models:

- http://bruy.at/prec#RDFReification
- http://bruy.at/prec#RdfStarUnique
- http://bruy.at/prec#RdfStarOccurrence
- http://bruy.at/prec#SingletonProperty
- http://bruy.at/prec#Prec0Property
- http://bruy.at/prec#DirectTriples
- http://bruy.at/prec#CombinedBlankNodes

Their current composition can be directly checked in the
[builtin rules file](https://github.com/BruJu/PREC/blob/master/prec3/builtin_rules.ttl).



##### http://bruy.at/prec#occurrenceOf

*This IRI is used in the generated graphs and should not be used in contexts as a "keyword".*

Used in the http://bruy.at/prec#RdfStarOccurrence model.

Specifies for which triple the relationship is an occurrenceOf.

*Example*

> Joe Biden "worked" for the White House from 2009 to 2017 as the vice president and since 2021 as the president.

```turtle
_:first  prec:occurrenceOf << :joe_biden :workingFor :white_house >>
_:second prec:occurrenceOf << :joe_biden :workingFor :white_house >>

_:first  :from 2009; :to 2017 ; :role "Vice President" .
_:second :from 2021;            :role "President"      .
```

*Why do we need this?*

If we write

```turtle
<< :joe_biden :workingFor :white_house >> :from 2009; :to 2017 ; :role "Vice President" .
<< :joe_biden :workingFor :white_house >> :from 2021;            :role "President"      .
```

it is equivalent to writing
```turtle
<< :joe_biden :workingFor :white_house >>
    :from 2009, 2021 ;
    :to 2017 ;
    :role "Vice President", "President" .
```

While we can deduce from the semantic of `:from`, `:to` and years that Joe Biden
worked from 2009 to 2017 then from 2021 for the White House, and while we know
that we worked as the Vice President and the President, we are unable to
distinguish when he was Vice President and when he was President.

### Model "patching"

*This feature / section is a candidate to be obsoleted / modified in the future*
*as its result can be already be achieved by writing full models ; because the*
*concept and the involved mechanims may be too hard to explain / understand.*

In addition to a model, it is possible to add directives to modify the model
used. This is achieved by using subsitution terms. A substitution term targets
a *replaced term* with the *replaced with term*.

The advantage of modifying an existing model is to reduce the risk of error by
omitting to write a triple that composes the model.


- For each description node, a term must be replaced at most once. In other words,
for the same description node, you can't use two or more times the same
substitution terms, like two `prec:subject`, neither you can use two
substitution terms which shares the same substitution target.

- Every subsitution of the same are computed at the same time. It means that it
is possible to use substitutiosn to swap some elements of the model

*Example*

```
prec:subject prec:substitutionTarget rdf:subject .

prec:Relationships prec:modelAs prec:RDFReification ;
  prec:subject :theSource .
```

In this example, `prec:subject` is a substitution term for `rdf:subject`. It will
search `rdf:subject` in the model and replace it with something else.

In `prec:Relationships`, the model is `prec:RDFReification`. As `prec:subject`
is also used on prec:Relationships, occurrence of `rdf:subject` will be searched
and replaced with *something else*. *Something else* is the object of the
`prec:Relationships prec:subject :theSource` triple: `:theSource`. So the
applied model will be the model prec:RDFReification, where every instance of
`rdf:subject` will be replaced with `:theSource`.

It is equivalent to writing:
```
prec:Relationships prec:modelAs [
    prec:composedOf
        << pvar:self a pgo:Edge >> ,
        << pvar:self :theSource       pvar:source          >> , # rdf:subject has been replaced with :theSource
        << pvar:self rdf:predicate    pvar:relationshipIRI >> ,
        << pvar:self rdf:object       pvar:destination     >> ,
        << pvar:self pvar:propertyKey pvar:propertyValue   >>
] .
```


#### http://bruy.at/prec#SubstitutionTerm

The type of subsitution term


#### http://bruy.at/prec#substitutionTarget

States what is the term that is searched by a `SubstitutionTerm`

#### Built in subsitution terms

The expected usage of substitution terms is to use an RDF Reification like
representation to represent a relationship, but with predicates that are more
accurate to the reality than using the "RDF grounded" terms. This is inspired
by http://www.bobdc.com/blog/reification-is-a-red-herring/.

The built in substitution terms are:
- `prec:subject` for `rdf:subject`
- `prec:predicate` for `rdf:predicate`
- `prec:object` for `rdf:object`


*Example*

*Property Graph*
```
           (edge):like
[(alice)] ------------> [(bob)]
```

Values in parenthesis doesn't actually appear in the graph and are solely for
clarity.

*Context*
```turtle
prec:Properties prec:modelAs prec:RDFReificaiton ;
  prec:subject <https://example.org/user> ;
  prec:predicate rdf:type ;
  prec:object <https://example.org/influencer> .
```

*Output will be isomorphic with:*
```
_:edge rdf:type pgo:Edge, _:like ;
  <https://example.org/user> _:alice ;
  <https://example.org/influencer> _:bob .

_:like rdfs:value "like" .
```


## Remap the IRIs generated by PREC to existing IRI

PREC-0 generates an RDF Graph with fresh IRIs. By applying a context through
PREC-Context, it is possible to map these artificial IRIs to any IRI.

### http://bruy.at/prec#IRIOfNodeLabel

States the IRI to use for a given node label.

*Usage*: ` :iRItOMapTo prec:IRIOfNodeLabel "Label" .`

*Example*

Given the following property graph with two nodes, one with the label Person and
one with the label Aniaml:
```
[ :Person ]    [ :Animal ]
```

PREC0 will convert this graph into the following RDF graph:
```
_:node1 a pgo:Node, [ rdfs:label "Person" ] .
_:node2 a pgo:Node, [ rdfs:label "Animal" ] .
```

If the following context is applied:

```
schema:Person prec:IRIOfNodeLabel "Person" .
schema:Animal prec:IRIOfNodeLabel "Animal" .
```


### http://bruy.at/prec#IRIOfRelationship

States the IRI to use for a given relationship label.

The object can either be:
- A literal, which corresponds to the label of the relationship.
- A Blank node, named *descriptio nnode* which describes more constraints than
only the label of the relationship, and also a model.

*Example: with a literal*

Property Graph: `[a] ---:like--> [b] ---:love--> [c]`

Context: `ex:like prec:IRIOfRelationship "like" .`

Output:
```
_:a a pgo:Node .
_:b a pgo:Node .
_:c a pgo:Node .

_:edge1 a pgo:Edge ;
  rdf:subject   _:a ;
  rdf:object    _:b ;
  rdf:predicate ex:like .   # The predicate object has been changed by the rule

_:edge2 a pgo:Edge ;
  rdf:subject   _:b ;
  rdf:object    _:c ;
  rdf:predicate [ rdfs:label "love" ] . # Doesn't match the rule
```

#### Relationship description node

A description node enables to write further directives than only a relationship
label.

##### http://bruy.at/prec#relationshipLabel

A relationship description node must have one relationship label. It states
the condition on the label of the relationship (similar as having a literal in
place of the descriptio node).

These two contexts are equivalent:
- `ex:like prec:IRIOfRelationship "like" .`
- `ex:like prec:IRIOfRelationship [ prec:relationshipLabel "like" ] .`


##### http://bruy.at/prec#sourceLabel

States that this rule must only be applied if the source node has the given
label.

*Example*

Property Graph:
```
[ :Person ] --- :Like --> [ :Cat ] --- :Like --> [ :Food ] 
```

Context:
```turtle
prec:Relationships prec:modelAs prec:RRDFStarUnique .

# Rule 1
<https://example.org/hates> prec:IRIOfRelationship [
    prec:relationshipLabel "Like" ;
    prec:sourceLabel       "Person"
] .

ex:Person prec:IRIOfNodeLabel "Person" .
ex:Cat    prec:IRIOfNodeLabel "Cat"    .
ex:Food   prec:IRIOfNodeLabel "Food"   .
```

Output:

```turtle
# The first relation has the relationship label "Like"
# and the source has he label "Person". It matches Rule 1 so we change
# the IRI of the label.
# We still apply the model directive.
_:p <https://example.org/hates> _:c .
<< _:p <https://example.org/hates> _:c >> a pgo:Edge .

# Source is not a Person (it is a Cat). we don't change anything.
# We still apply the modelAs directive .
_:c _:like _:f .
<< _:c _:like _:f >> a pgo:Edge .

# Types of nodes
_:p a pgo:Node, ex:Person .
_:c a pgo:Node, ex:Cat .
_:f a pgo:Node, ex:Food .
```

##### http://bruy.at/prec#destinationLabel

States that this rule must only be applied if the destination node has the given
label.

See http://bruy.at/prec#sourceLabel for (almost) an example.


##### Adding a model

It is also possible to specify a model for the currently described relationship
by using `prec:modelAs`. Subsitution terms are also supported.

*Example*

```
prec:Relationships prec:modelAs prec:RdfStarOccurrence .

ex:like prec:IRIOfRelationship [
    prec:relationshipLabel "knows" ;
    prec:modelAs prec:RDFStarUnique
] .

```

In this context, every relationship will be modeled as a RDF Star Occurrence,
except the ones with "knows" as a label which will use the `RDFStarUnique` model
instead.



### http://bruy.at/prec#IRIOfProperty

States the IRI to use for a given property label. The object can either be a
literal with the name or a description node (a blank node that contains several
instructions).

*Example*

Property Graph: `create (obama { name: 'Obama' })`

Context: `<https://schema.org/familyName> prec:IRIOfProperty "name" .`

Output:
```
_:obama a pgo:Node ;
<https://schema.org/familyName> [ rdf:value "Obama" ; a prec:PropertyValue ] .
```

#### Property description node

##### http://bruy.at/prec#propertyName

States that this rule must be applied only if the property key has the given
name. It is mandatory to have a triple with this predicate for a property
description node.

The context
`<https://schema.org/familyName> prec:IRIOfProperty [ prec:propertyName "name" ] .`
is equivalent to
`<https://schema.org/familyName> prec:IRIOfProperty "name" .`


##### http://bruy.at/prec#nodeLabel

States that this rule must be applied only if the node have a given label.

Multiple `prec:nodeLabel` directives can be used. In this case, the node must
have every described label.

*Example*

Property Graph:
```
[ :Person { name: "Gates", givenName: "Bill" }]

[ :Animal { name: "Nemo" }]
```

Context:
```
<https://schema.org/familyName> prec:IRIOfProperty [
    prec:propertyName "name" ;
    prec:nodeLabel "Person"
] .
```

Output:
```
_:gates a pgo:Node, [ rdfs:label "Person" ] ;
    # The first property of the "Bill Gates" node matches the conditions:
    # - The key label is "name"
    # - The node has the label "Person"
    <https://schema.org/familyName> [ rdf:value "Gates" ; a prec:PropertyValue ] ;
    # The second property of the "Bill Gates" node doesn't match the conditions:
    # - The key label is "givenName" which is different from "name"
    _:givenName [ rdf:value "Bill" ; a prec:PropertyValue ] .

_:nemo a pgo:Node, [ rdfs:label "Animal" ] ;
    # The property of the "Nemo" node doesn't match the conditions
    # - The key label is "name"
    # - But the node doesn't have the label "Person", its only label is Animal
    _:name [ rdf:value "Nemo" ] .
```


##### http://bruy.at/prec#relationshipLabel

Same as http://bruy.at/prec#nodeLabel but for relationship labels.

Note as no property can be both on nodes and relationship, the use of both
prec:nodeLabel and prec:relationshipLabel results in an unmatchable rule.


##### http://bruy.at/prec#any

A magic IRI that matches with every label.

*Example*

```
<https://schema.org/familyName> prec:IRIOfProperty [
    prec:propertyName "name" ;
    prec:nodeLabel prec:any
] .
```

Maps the IRI https://schema.org/familyName to the property that has "name" as a
key and that are on nodes (properties on relationships are unchanged).



##### Adding a model

Similarly as relationship, it is possible to add a model to property description
nodes.


### http://bruy.at/prec#priority

States what is the priority of a rule described by a description node.

Predicate of quads that indicates the priority of a rule. The higher, the more
the rule will take priority.

If unspecified the rules priority is:
- http://bruy.at/prec#IRIOfProperty : 0 + 1 per restriction on the node label
- http://bruy.at/prec#IRIOfRelationship : 0 + 1 per restriction on source or destination node

In case of priority ties, the smaller IRI in lexicographical order will be
applied at first.





## Test infrastructure

Used in `./test/prec/*.ttl` files, which are used for unit tests. These files
are inputs for `./z_prec.js`.

Each unit test contains:
- where are the inputs by using `prec:testMetaData` as a subject
- the expected triples generated by PREC. Blank nodes are used as wildcards.

### Unit test using external files

#### http://bruy.at/prec#testMetaData

Subject of triples that are inputs for `z_prec.js`. The triples with
`prec:testMetaData` as a subject won't be tested against the actual output.

#### http://bruy.at/prec#pgPath

Relative path of the expected output file to the structure of the property
graph.

#### http://bruy.at/prec#pgSource

An IRI that corresponds used to the method to obtain the Property Graph
structure.

Only https://neo4j.com/developer/neo4j-apoc/ is currently supported.
It corresponds for the output of the `apoc.export.json.all` function in Neo4J.

#### http://bruy.at/prec#contextPath

Relative path of the expected output file to the used context.

### Self sufficient unit test 

#### http://bruy.at/prec#kind

If the turtle fight contains `prec:testMetaData prec:kind "SmallExamples ."`,
it means this turtle file contains multiple tests.


#### http://bruy.at/prec#unitTest

Type of a single unit test

#### http://bruy.at/prec#context

`prec:context` states what is the content of the context.

`_:someTest prec:context _:context` means that the unit test `_:someTest` uses
the content of the graph `_:context` as the context.


#### http://bruy.at/prec#output

`prec:output` states what is the expected output.

`_:someTest prec:output _:output` means that the unit test `_:someTest` expects
the content of the graph `_:output` as the output of PREC.


#### http://bruy.at/prec#propertyGraph

`prec:propertyGraph` states the content of the property graph as a string in the
JSON APOC export format.


