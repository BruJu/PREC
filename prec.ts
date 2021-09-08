#!/usr/bin/env node

import { main } from './src/cli_';

export {
  stringToApocDocuments,
  apocToRDF,
  cypherJsontoRDF,
  gremlinToPREC0Graph,
  gremlinToRDF,
  cypherToRDF,
} from './src/cli_';

if (require.main === module) {
  main();
}
