# PREC ontology

*This ontology is currently very tentative and is subject to*
*change.*


## Flags / Transformations

## http://bruy.at/prec#flagState

Predicate of triples that indicates if a featuere must be activated or not.


## http://bruy.at/prec#MetaProperty

Tells if the Property Graph contains meta properties or not.

If there are no meta properties, no intermediate node is created between a node / its property
and the associated value.


```ttl
PREFIX prec: <http://bruy.at/prec#>

# Keep a node between the property and its value (current default)
prec:MetaProperty prec:flagState true .

# Erase the node between the property and its value
prec:MetaProperty prec:flagState false .
```


### Result example

Property graph input: `create ({ name: 'Joe Biden' })` (Cypher format)

`+` is when set to true, `-` is when set to false

```diff
+   indiv:node/id/1 vocab/node/property/name indiv:literal/1.
+   indiv:literal/1 rdf:value "Joe Biden" .
-   indiv:node/id/1 vocab/node/property/name "Joe Biden" .

    indiv:node/id/1 a pgo:Node .
    vocab:node/property/name a prec:Property .
+   indiv:literal/1 a prec:PropertyValue .
```





# Unclassified

## http://bruy.at/prec#propertyIRI

Specifies the IRI of the property of a node in a Property Graph.

- Vocab: `<https://schema.org/familyName> prec:propertyIRI "name" .`
- \+ Cypher: `create (obama { name: 'Obama' })`
- = `_:obama <https://schema.org/familyName> "Obama".`



## http://bruy.at/prec#relationshipIRI

Same as attribute but for relationship labels

## http://bruy.at/prec#alwaysAsserted

Type of labels of relationships that are always asserted.

- Vocab : `<https://cat> a prec:alwaysAsserted`


# http://bruy.at/prec#occurrence

Specifies for which triple the relationship is an occurrence.

Example:

> Steve Jobs worked for apple from 1976 to 1985 and from 1997 to 2011

```turtle
<< <stevejobs> <workingFor> <apple> >> prec::occurrence _:first, _second.

_:first <from> 1976
_:first <to> 1985

_:second <from> 1997
_:second <to> 2011
```

# http://bruy.at/prec#MetaData

Subject for meta data

# http://bruy.at/prec#GenerationModel

Generation model used

# http://bruy.at/prec#RelationshipAsRDFReification

RDF graphs generated from PREC3 with the default mode / relationship encoded as standard RDF reification have
the triple

```
prec:MetaData prec:GenerationModel prec:RelationshipAsRDFReification
```


# http://bruy.at/prec#RelationshipAsRDFStar

RDF graphs generated from PREC3 with the relationship encoded as RDF star have
the triple

```
prec:MetaData prec:GenerationModel prec:RelationshipAsRDFStar
```


# http://bruy.at/prec#CreatedVocabulary

Type of IRIs that has been created by PREC and that
should be mapped to an actual ontology.

It only applies to labels and property names.

