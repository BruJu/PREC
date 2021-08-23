const N3 = require('n3');

require('./rdf/graph-substitution.test');
require('./rdf/quad-star.test');

require("./dataset/DatasetCore.test.js")({
    quad: N3.DataFactory.quad,
    literal: N3.DataFactory.literal,
    blankNode: N3.DataFactory.blankNode,
    dataset: t => new (require('../src/dataset/index').default)(t)
});
