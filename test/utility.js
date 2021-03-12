const N3 = require("n3");

function readQuads(turtleContent) {
    const prefixes =
          "@prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#>.\n"
        + "@prefix prec: <http://bruy.at/prec#>                       .\n"
        + "@prefix     : <http://test/>                               .\n"
        + "@prefix pgo:  <http://ii.uwb.edu.pl/pgo#>                  .\n";

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
