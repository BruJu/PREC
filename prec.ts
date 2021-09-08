#!/usr/bin/env node

import { main } from './src/cli_';

export {
  stringToApocDocuments,
  apocToRDF,
  cypherJsontoRDF,
  gremlinToPREC0Graph,
  gremlinToRDF,
  cypherToRDF,
  prec0ToCypherQuery,
  prec0ToCypher,
  prec0ToGremlin
} from './src/cli_';

if (require.main === module) {
  main();
}
