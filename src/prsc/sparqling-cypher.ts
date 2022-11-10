import * as RDF from "@rdfjs/types";
import { PRSCSchema } from "./PrscContext";

export function buildQuery(
  context: RDF.Quad[],
  query: RDF.Quad[]
): string | null {
  const schema = PRSCSchema.build(context);
  if ('violations' in schema) {
    console.error("Not a PRSC schema");
    return null;
  }

  const keptRules = new Set<number>();

  for (const queryQuad of query) {
    for (let iRule = 0; iRule != schema.schema.prscRules.length; ++iRule) {
      const rule = schema.schema.prscRules[iRule];
      
      if (doesMatch(queryQuad, rule.template)) {
        keptRules.add(iRule);
      }
    }
  }



  



  return '';

}

function doesMatch(queryQuad: RDF.Quad, template: RDF.Quad[]): boolean {
  throw new Error("Function not implemented.");
}

