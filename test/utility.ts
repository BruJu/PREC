import * as RDF from '@rdfjs/types';
import { Parser } from 'n3';
import DStar from '../src/dataset/index';
import checkIsomorphism, { quadsToString } from "@bruju/rdf-test-util";
import assert from "assert";

function readQuads(turtleContent: string): RDF.Quad[] {
  const prefixes =
  `
    @prefix     : <http://test/>                                .
    @prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
    @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>       .
    @prefix prec: <http://bruy.at/prec#>                        .
    @prefix pgo:  <http://ii.uwb.edu.pl/pgo#>                   .
    @prefix pvar: <http://bruy.at/prec-trans#>                  .
  `;

  const parser = new Parser();

  try {
    const p = parser.parse(prefixes + turtleContent);
    return p;
  } catch (e) {
    console.error("Passed turtle file is not valid\n" + turtleContent);
    throw e;
  }
}

export { readQuads as turtleToQuads };

export function turtleToDStar(content: string) {
  return new DStar(readQuads(content));
}

export function checkOutput(
  input: DStar | string,
  context: RDF.Quad[] | string,
  output: RDF.Quad[] | RDF.DatasetCore,
  expected: RDF.Quad[] | RDF.DatasetCore
) {
  if (!Array.isArray(output)) output = [...output];
  if (!Array.isArray(expected)) expected = [...expected];

  const isoResult = checkIsomorphism(output, expected);

  let msg = "";
  if (isoResult.areIsomorphic === false) {
    msg = '\x1b[0m' + "• Base Graph:";
    msg += '\n' + (typeof input === 'string' ? input : quadsToString(input.getQuads()).join("\n"));
    msg += '\n' + "• Context:";
    msg += '\n' + (typeof context === 'string' ? context : quadsToString(context).join("\n"));
    msg += '\n' + `• Result (${isoResult.output.size} quads):`;
    msg += '\n' + isoResult.output.text;
    msg += '\n' + `• Expected (${isoResult.expected.size} quads):`;
    msg += '\n' + isoResult.expected.text;
  }

  assert.ok(isoResult.areIsomorphic, msg);
}
