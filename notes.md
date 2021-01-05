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
