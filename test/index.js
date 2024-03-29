const N3 = require('n3');

require('./rdf/quad-star.test');
require('./rdf/path-travelling.test');

require("./dataset/DatasetCore.test.js")({
    quad: N3.DataFactory.quad,
    literal: N3.DataFactory.literal,
    blankNode: N3.DataFactory.blankNode,
    dataset: t => new (require('../src/dataset/index').default)(t)
});

require("./dataset/DStar.test");
