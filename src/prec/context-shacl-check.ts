import SHACLValidator from 'rdf-validate-shacl';
import fs from 'fs';
import path from 'path';
import * as n3 from 'n3';
import factory from 'rdf-ext';
import * as RDF from '@rdfjs/types';

const contextValidator: SHACLValidator = buildValidator();

function buildValidator() {
  const shapePath = path.join(__dirname, "..", "..", "data", "PRECContextShape.ttl");
  const shapeContent = fs.readFileSync(shapePath, 'utf-8');
  const shapeStore = new n3.Store(new n3.Parser().parse(shapeContent));

  return new SHACLValidator(shapeStore, { factory });
}


/**
 * Return true if the dataset is a valid context according to the context shape
 * graph
 * @param dataset The context
 */
export function isShaclValidContext(dataset: RDF.DatasetCore): true | string {
  const validation = contextValidator.validate(dataset);
  
  if (validation.conforms) return true;
  else return validation.results.map(x => x.message + " " + x.focusNode?.value).join("\n");
}
