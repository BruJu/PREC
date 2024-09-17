const assert = require('assert');
const gremlin = require('gremlin');
const DriverRemoteConnection = gremlin.driver.DriverRemoteConnection;
const fs = require('fs');
const fromGremlin = require('../../src/prec-0/from-gremlin');

/*
 * ==== TINKERPOP TEST ====
 * https://tinkerpop.apache.org/
 * - Download both Gremlin Console and Gremlin Server
 * - Start Gremlin Server
 * 
 * Most tests requires to load a graph
 * In the Gremlin Client, type:
 * :remote connect tinkerpop.server conf/remote.yaml
 * 
 * See the tests comments to know how to load the proper graph
 * 
 * To clean the database, use:
 * :> g.V().drop().iterate()
 * 
 * 
 * Note that the : and the :> are part of the command
 */

// TODO: how to delete a graph?

// TODO: split the file into several or see how to pass args

const TINKERPOP_URL = "ws://localhost:8182/gremlin";

describe("Tinkerpop connection (one of the test should pass, see comments in file)", async function() {
    let r;

    before(async function() {
        let connection = new DriverRemoteConnection(TINKERPOP_URL);
        r = await fromGremlin(connection);
        await connection.close();
    });

    /*
     * Extraction of the modern graph: 
     * :remote connect tinkerpop.server conf/remote.yaml
     * :> TinkerFactory.generateModern(graph)
     */
    it("should be able to extract the modern graph", function() {
        assert.deepStrictEqual(
            r,
            JSON.parse(fs.readFileSync("./test/with_property_graph/modern.json")),
            "Modern graph"
        );
    });

    /*
     * Extraction of the Kitchsink graph
     * :remote connect tinkerpop.server conf/remote.yaml
     * :> TinkerFactory.generateKitchenSink(graph)
     */
    it("should be able to extract the kitchen sink graph", function() {
        assert.deepStrictEqual(
            r,
            JSON.parse(fs.readFileSync("./test/with_property_graph/kitchensink.json")),
            "Kitchen sink"
        );
    });
    

})