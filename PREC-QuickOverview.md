# Quick overview of what PREC can do


PREC enables to convert PG into RDF. Unlike other tools, PREC enables the user to choose the modelization.

## Quick example


### Example 1

Let us consider that we have the following property graph:

<img src="docs/img/annlikesdan.svg" />

PREC enables to convert the PG depending of a mapping.

For example, by using this mapping:
            
```ttl
PREFIX prec: <http://bruy.at/prec#>
PREFIX pvar: <http://bruy.at/prec-trans#>
PREFIX ex:   <http://example.org/>
PREFIX rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

prec:this_is a prec:prscContext .

ex:PersonForm a prec:prsc_node ;
  prec:nodeLabel "Person" ;
  prec:propertyName "name" ;
  prec:composedOf
    << pvar:node ex:hasLabel ex:person >> ,
    << pvar:node ex:name "name"^^prec:_valueOf >> .

ex:LovesForm a prec:prsc_edge ;
  prec:edgeLabel "Likes" ;
  prec:prscSource      ex:PersonForm ;
  prec:prscDestination ex:PersonForm ;
  prec:composedOf
    << pvar:edge rdf:type ex:Like >>,
    << pvar:edge ex:from pvar:source >>,
    << pvar:edge ex:content_producer pvar:destination >> .
```

This RDF graph is produced:

```ttl

_:node9 <http://example.org/hasLabel> <http://example.org/person>;
    <http://example.org/name> "Ann".
_:node10 <http://example.org/hasLabel> <http://example.org/person>;
    <http://example.org/name> "Dan".
_:edge12 a <http://example.org/Like>;
    <http://example.org/from> _:node9;
    <http://example.org/content_producer> _:node10.

```

Note that the Ann node has been mapped to `_:node9`, the Dan node has been mapped to `_:node10` and the edge has been mapped to `_:edge12`.

Some users may consider that this mapping is not very interesting.



### Example 2: Less triples

For the same PG


<img src="docs/img/annlikesdan.svg" />

We will use instead this property graph:


```ttl
PREFIX prec: <http://bruy.at/prec#>
PREFIX pvar: <http://bruy.at/prec-trans#>
PREFIX ex:   <http://example.org/>
PREFIX rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

prec:this_is a prec:prscContext .

ex:PersonForm a prec:prsc_node ;
  prec:nodeLabel "Person" ;
  prec:propertyName "name" ;
  prec:composedOf
    << pvar:node rdf:type ex:Person >> ,
    << pvar:node ex:name "name"^^prec:_valueOf >> .

ex:LovesForm a prec:prsc_edge ;
  prec:edgeLabel "Likes" ;
  prec:composedOf
    << pvar:source ex:likes pvar:destination >> .
```

Note that 



