# Comparaison with NeoSemantics

## Ann likes Dan

Example used by Jesus Barrasa in one of his presentation
https://youtu.be/OVweE--RJqM?t=710 


### Input

```cypher
create (ann:Person { name: 'Ann' }), (dan:Person { name: 'Dan' });

match (ann:Person { name: 'Ann' }), (dan:Person { name: 'Dan' })
where ann.name = 'Ann' and dan.name = 'Dan'
create (ann)-[like1:Likes]->(dan), (ann)-[like2:Likes]->(dan), (ann)-[like3:Likes]->(dan);
```

### Input graph

`match (m)-[x]->(n) return m, x, n`

| "m"              | "x"  | "n"              |
|------------------|------|------------------|
| `{"name":"Ann"}` | `{}` | `{"name":"Dan"}` |
| `{"name":"Ann"}` | `{}` | `{"name":"Dan"}` |
| `{"name":"Ann"}` | `{}` | `{"name":"Dan"}` |


### NeoSemantics output

`:POST http://localhost:7474/rdf/neo4j/cypher { "cypher" : "match (m)-[x]->(n) return m, x, n", "format": "Turtle*"}`

```turtle
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix neovoc: <neo4j://vocabulary#> .
@prefix neoind: <neo4j://individuals#> .

neoind:9 a neovoc:Person;
  neovoc:name "Ann";
  neovoc:Likes neoind:10 .

neoind:10 a neovoc:Person;
  neovoc:name "Dan" .
```

### Problem

- We lose the information Ann liked Dan 3 times

### Our output

We use [Bob DuCharme proposition in his blog post "Reification is a red herring"](http://www.snee.com/bobdc.blog/2018/04/reification-is-a-red-herring.html)
to reify multiple edges into RDF nodes.

(Optional) Export the property graph in JSON format:
`CALL apoc.export.json.all("annlikesdan.json",{useTypes:true})`

(Optional) Copy it here as `data/annlikesdan.json`

`node attempt2-hardcode.js data/annlikesdan.json`

```turtle
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.

<http://node/9> a <http://types/Person>;
    <http://attribute/name> "Ann".
<http://node/10> a <http://types/Person>;
    <http://attribute/name> "Dan".
<http://relationshipnode/12> rdf:subject <http://node/9>;
    rdf:predicate <http://relationship/Likes>;
    rdf:object <http://node/10>.
<http://relationshipnode/13> rdf:subject <http://node/9>;
    rdf:predicate <http://relationship/Likes>;
    rdf:object <http://node/10>.
<http://relationshipnode/14> rdf:subject <http://node/9>;
    rdf:predicate <http://relationship/Likes>;
    rdf:object <http://node/10>.
```

### Discussion

If would be hard to restore the Property Graph with 3 edges instead
of creating nodes for the likes.

We use `rdf:predicate` as we use standard RDF reification. rdf:type would
actually bring more semantic in a sense, but then we would lose the
"standard-ness" of rdf:subject and rdf:object usage.

We don't have any direct edge between Ann and Dan anymore.


## The movies example


In Neo4J type: `:play movie-graph`

In the second page, a cypher request to create the Movie Database will appear. Use this request.

- [data/movies_neo4j.ttl](data/movies_neo4j.ttl) exposes NeoSemantic result
- [data/movies.json](data/movies.json) is the input for our script (`./attempt2-hardcode.js data/movies.json`)


### Discussion

This example was mostly useful for bug fixing (multiple values for a single property).

NeoSemantics and we produce a similar RDF graph.

**TODO: rdf diff to confirm it**

The main difference is that NeoSemantics uses the PG mode while we use the SA.

This means that we don't actually affirm that actors acted in movies : This is
a problem as we could infer that if someone acted in something with a role
(`<<a b c>> d e.`), then he actually acted in it (`a b c.`).

**TODO: find a (generic) way to add this inference in the produced graph**


## Barack Obama

`create (bobama: DAD:HUSBAND:PRESIDENT:CITIZEN { name: 'Obama', surname: 'Barack' })`


### NeoSemantics
`:POST http://localhost:7474/rdf/neo4j/cypher { "cypher" : "match (m) return m", "format": "Turtle*"}`

```turtle
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix neovoc: <neo4j://vocabulary#> .
@prefix neoind: <neo4j://individuals#> .

neoind:173 a neovoc:DAD, neovoc:HUSBAND, neovoc:CITIZEN, neovoc:PRESIDENT;
  neovoc:name "Obama";
  neovoc:surname "Barack" .
```

### Our output


`CALL apoc.export.json.all("obama.json",{useTypes:true})`
`node attempt2-hardcode.js data/obama.json`


```turtle
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.

<http://node/173> a <http://types/CITIZEN>, <http://types/DAD>, <http://types/HUSBAND>, <http://types/PRESIDENT>;
    <http://attribute/surname> "Barack";
    <http://attribute/name> "Obama".
```


It is similar.

### Discussion: Enriching the semantic

`http://attribute/surname` and `http://attribute/name` brings no semantics (we could use foaf). Some of the types are probably also defined in vocalubaries like schema.org.

If we know that his name is Barack and his surname is Obama, then maybe `http://dbpedia.org/resource/Barack_Obama` exists? But does it refers to the same person?
