const N3 = require("n3");

function readQuads(turtleContent) {
    const prefixes =
    `
        @prefix     : <http://test/>                                .
        @prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
        @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>       .
        @prefix prec: <http://bruy.at/prec#>                        .
        @prefix pgo:  <http://ii.uwb.edu.pl/pgo#>                   .
        @prefix pvar: <http://bruy.at/prec-trans#>                  .
    `;

    const parser = new N3.Parser();

    try {
        let p = parser.parse(prefixes + turtleContent);
        return p;
    } catch (e) {
        console.error("Passed turtle file is not valid\n" + turtleContent);
        throw e;
    }
}

module.exports = {
    turtleToQuads: readQuads,
    turtleToStore: content => new N3.Store(readQuads(content))
};
