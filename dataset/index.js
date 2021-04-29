const N3 = require('n3');


function isRdfStarQuad(quad) {
    return quad.subject.termType === 'Quad'
        || quad.predicate.termType === 'Quad'
        || quad.object.termType === 'Quad'
        || quad.graph.termType === 'Quad';
}

function isLikeNone(something) {
    return something === null || something === undefined;
}

class Dataset {
    constructor(quads) {
        // A store that contains the non rdf star quads
        this.store = new N3.Store();
        // A list of RDF-star quads
        this.starQuads = [];

        if (quads !== undefined) {
            for (const quad of quads) {
                this.add(quad);
            }
        }
    }

    get size() {
        return this.store.size + this.starQuads.length;
    }

    add(quad) {
        if (isRdfStarQuad(quad)) {
            if (!this.has(quad)) {
                this.starQuads.push(quad);
            }
        } else {
            this.store.addQuad(quad);
        }

        return this;
    }

    delete(quad) {
        if (isRdfStarQuad(quad)) {
            let q = this.starQuads.findIndex(here => quad.equals(here));
            if (q !== -1) {
                this.starQuads.splice(q, 1);
            }
        } else {
            this.store.removeQuad(quad.subject, quad.predicate, quad.object, quad.graph);
        }

        return this;
    }

    has(quad) {
        if (isRdfStarQuad(quad)) {
            return this.starQuads.find(here => here.equals(quad)) !== undefined;
        } else {
            return this.store.countQuads(quad.subject, quad.predicate, quad.object, quad.graph) === 1;
        }
    }

    match(subject, predicate, object, graph) {
        let inStore = this.store.getQuads(subject, predicate, object, graph);

        let inArray = this.starQuads.filter(quad => {
            return (isLikeNone(subject)   || quad.subject  .equals(subject))
                && (isLikeNone(predicate) || quad.predicate.equals(predicate))
                && (isLikeNone(object)    || quad.object   .equals(object))
                && (isLikeNone(graph)     || quad.graph    .equals(graph));
        });

        return new Dataset([...inStore, ...inArray]);
    }

    *[Symbol.iterator]() {
        for (let quad of this.store.getQuads()) {
            yield quad;
        }

        for (let quad of this.starQuads) {
            yield quad;
        }
    }
};




module.exports = Dataset;
