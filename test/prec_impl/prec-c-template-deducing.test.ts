import assert from 'assert';
import { isomorphic } from "rdf-isomorphic";
import * as N3 from "n3";
import * as RDF from "@rdfjs/types";

import DStar from '../../src/dataset/index';
import EdgeRules from '../../src/prec-c/rules-for-edges';
import PropertyRules from '../../src/prec-c/rules-for-properties';
import { readRawTemplate } from '../../src/prec-c/context-loader';
import { RuleDomain } from '../../src/prec-c/RuleType';
import { $quad, prec } from '../../src/PRECNamespace';
import { termToString } from 'rdf-string';

const prefixes =
`
    @prefix     : <http://test/>                                .
    @prefix rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
    @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#>       .
    @prefix prec: <http://bruy.at/prec#>                        .
    @prefix pgo:  <http://ii.uwb.edu.pl/pgo#>                   .
    @prefix pvar: <http://bruy.at/prec-trans#>                  .

    :theTestedRule 
`;

function loadTemplate(rule: string, domain: RuleDomain) {
  const ttl = prefixes + rule;
  const parser = (new N3.Parser()).parse(ttl);
  
  return readRawTemplate(
    new DStar(parser),
    N3.DataFactory.namedNode('http://test/theTestedRule'),
    domain
  );
}

function nestTerms(terms: RDF.Term[]): RDF.Quad[] {
  return terms.map(term => $quad(term as RDF.Quad_Subject, prec._, prec._));
}

function areEquivalentTemplates(name: string, domain: RuleDomain, rule1: string, rule2: string) {
  it(name, () => {
    const template1 = loadTemplate(rule1, domain);
    const template2 = loadTemplate(rule2, domain);

    assert.ok(
      isomorphic(template1.templateGraph, template2.templateGraph),
      'composed of should be isomorphic'
    );

    assert.ok(
      isomorphic(nestTerms(template1.selfIs), nestTerms(template2.selfIs)),
      'terms should be iso'
    );
  });
}


function notEquivalentHolder(name: string, domain: RuleDomain, rule1: string, rule2: string) {
  it(name, () => {
    const template1 = loadTemplate(rule1, domain);
    const template2 = loadTemplate(rule2, domain);

    assert.ok(
      isomorphic(template1.templateGraph, template2.templateGraph),
      'composed of should be isomorphic'
    );

    assert.ok(
      !isomorphic(nestTerms(template1.selfIs), nestTerms(template2.selfIs)),
      'terms should not be iso'
    );
  });
}

function cantFindHolder(name: string, domain: RuleDomain, rule: string) {
  it (name, () => {
    const template = loadTemplate(rule, domain);

    assert.ok(
      template.selfIs.length === 0,
      'should not be able to find self identity but found <' + 
      template.selfIs.map(t => termToString(t)).join("/") +
      ">"
    );
  })
}


const PrecRDFReification = `
      << pvar:edge a pgo:Edge >> ,
      << pvar:edge rdf:subject   pvar:source      >> ,
      << pvar:edge rdf:predicate pvar:edgeIRI     >> ,
      << pvar:edge rdf:object    pvar:destination >>
  `;

const PrecZeroProperty = `
<< pvar:holder           pvar:propertyKey           pvar:propertyNode      >> ,
<< pvar:propertyNode     rdf:value                  pvar:propertyValue     >> ,
<< pvar:propertyNode     rdf:type                   prec:PropertyKeyValue  >>
`;

const PrecDirectTriples = `
<< pvar:holder pvar:propertyKey pvar:propertyValue >>
`;

const PrecCombined = `
  << pvar:holder       pvar:propertyKey pvar:propertyNode     >> ,
  << pvar:propertyNode rdf:value        pvar:propertyValue    >> ,
  << pvar:propertyNode rdf:type         prec:PropertyKeyValue >>
`;


module.exports = () => {
  describe("Implicit self identity deduction", () => {
    
    areEquivalentTemplates(
      "The same template is itself", // testing the test
      EdgeRules.domain,      
      `
        prec:selfIs pvar:edge ;
        prec:produces ${PrecRDFReification} .
      `,
      `
        prec:selfIs pvar:edge ;
        prec:produces ${PrecRDFReification} .
      `
    );

    areEquivalentTemplates(
      "Can deduce edge",
      EdgeRules.domain,
      ` prec:produces ${PrecRDFReification} .`,
      `
        prec:selfIs pvar:edge ;
        prec:produces ${PrecRDFReification} .
      `
    );

    notEquivalentHolder(
      "Can override",
      EdgeRules.domain,
      ` prec:produces ${PrecRDFReification} .`,
      `
        prec:selfIs :toto ;
        prec:produces ${PrecRDFReification} .
      `
    );

    areEquivalentTemplates(
      "Can deduce edge",
      EdgeRules.domain,
      ` prec:produces << pvar:source pvar:edgeIRI pvar:destination >> .`,
      `
        prec:selfIs     << pvar:source pvar:edgeIRI pvar:destination >> ;
        prec:produces << pvar:source pvar:edgeIRI pvar:destination >> .
      `
    );

    areEquivalentTemplates(
      "Can deduce edge from old syntax",
      EdgeRules.domain,
      ` prec:produces << pvar:source pvar:edgeIRI pvar:destination >> .`,
      `
        prec:produces << pvar:source pvar:edgeIRI pvar:destination >> ;
        prec:selfIs << pvar:source pvar:edgeIRI pvar:destination >> .
      `
    );

    areEquivalentTemplates(
      "Can deduce in prec:Prec0Property",
      PropertyRules.domain,
      ` prec:produces ${PrecZeroProperty} .`,
      `
        prec:produces ${PrecZeroProperty} ;
        prec:selfIs  pvar:propertyNode .
      `
    );

    areEquivalentTemplates(
      "Can deduce in prec:DirectTriples ",
      PropertyRules.domain,
      ` prec:produces ${PrecDirectTriples} .`,
      `
        prec:produces ${PrecDirectTriples} ;
        prec:selfIs  << pvar:holder pvar:propertyKey pvar:propertyValue >> .
      `
    );

    areEquivalentTemplates(
      "Can deduce in prec:CombinedTriples",
      PropertyRules.domain,
      ` prec:produces ${PrecCombined} .`,
      `
        prec:produces ${PrecCombined} ;
        prec:selfIs   pvar:propertyNode .
      `
    );

    cantFindHolder("Should not be able to find any self identity in an empty rule",
      PropertyRules.domain,
      ` prec:_ prec:_ . `
    );

    cantFindHolder("should not be able to find any self identity if edge is broken",
      EdgeRules.domain,
      `
      prec:produces << :myGraph :hasNode        pvar:source      >> ;
      prec:produces << :myGraph :hasNode        pvar:destination >> ;
      prec:produces << :myGraph :hasAnEdgeLabel pvar:edgeIRI     >> .
      `
    );
  });
};
