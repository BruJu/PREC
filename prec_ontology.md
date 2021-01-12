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
