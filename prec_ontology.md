# PREC ontology

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

