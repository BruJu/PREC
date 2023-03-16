import * as utility from "./utility";
import { checkOutput } from "./utility";
import * as graphBuilder from '../src/prec/graph-builder';
import graphReducer from "../src/prec/graph-reducer";
import { PropertyGraph } from "./mock-pg/pg-implem";

function runATest_(
  dict: {[x: string]: string},
  graphName: string,
  contextName: string,
  expected: string
) {
  it(graphName + " x " + contextName, function() {
    const store   = utility.turtleToDStar(dict[graphName]);
    const context = utility.turtleToQuads(dict[contextName]);
    graphReducer(store, context);

    const expectedStore = utility.turtleToDStar(expected);
    checkOutput(dict[graphName], dict[contextName], store, expectedStore);
  });
}

function test(name: string, source: string, context: string, expected: string) {
  it(name, function () {
    const store = utility.turtleToDStar(source);
    const ctx   = utility.turtleToQuads(context);
    graphReducer(store, ctx);

    const expectedStore = utility.turtleToDStar(expected);
    checkOutput(source, context, store, expectedStore);
  });
}

function testFromMockPG(name: string, source: PropertyGraph, context: string, expected: string) {
  it(name, () => {
    const { nodes, edges } = source.convertToProductFromTinkerProp() as any;
    const store = graphBuilder.fromTinkerPop(nodes, edges)[0];
    const ctx = utility.turtleToQuads(context);
    graphReducer(store, ctx);

    const expectedStore = utility.turtleToDStar(expected);
    checkOutput("", context, store, expectedStore);
  });
}



require('./prec_impl/prec-0.test')(testFromMockPG);

describe('Context Applier', () => {
  require('./prec_impl/prec-c-template-deducing.test')();
  require('./prec_impl/rules-for-edges.test')(test);
  require('./prec_impl/rules-for-properties-on-nodes.test')(test);
  require('./prec_impl/rules-for-properties-on-edges.test')(test);
  require('./prec_impl/prec-c-map-blank-nodes.test')();
  require('./prec_impl/prec-c-rule-properties.test')(test);
  require('./prec_impl/prsc.test')();
});

describe("Property convertion", () => {
  const graphs = {
    empty: ``,
    oneEdge: `
      :edge a pgo:Edge ;
        rdf:subject :s ;
        rdf:predicate :p ;
        rdf:object :o .
    `,
    oneSimpleGraph: `
      :edge a pgo:Edge ;
        rdf:subject :s ;
        rdf:predicate :p ;
        rdf:object :o .
      
      :s a pgo:Node ; :propertyA [ rdf:value "VANode" ; a prec:PropertyKeyValue ] ; a [ rdfs:label "Subject" ] .
      :o a pgo:Node ; :propertyB [ rdf:value "VBNode" ; a prec:PropertyKeyValue ] ; a [ rdfs:label "Object"  ] .
      :p rdfs:label "LabelOfEdge" .
      :edge :propertyA [ rdf:value "VAEdge" ; a prec:PropertyKeyValue ] .
      :edge :propertyB [ rdf:value "VBEdge" ; a prec:PropertyKeyValue ] .
      :propertyA a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "PropertyA" .
      :propertyB a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "PropertyB" .
    `,
    oneNodeWithMetaProperty: `    
      :name a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "NAME" .
      :town a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "TOWN" .
      :description a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "DESCRIPTION" .

      :node a pgo:Node ;
        :name :name_value_1 ;
        :name :name_value_2 ;
        :town :town_value   .
        
      :name_value_1 a prec:PropertyKeyValue ;
        rdf:value "NAME VALUE 1" .
        
      :name_value_2 a prec:PropertyKeyValue ;
        rdf:value "NAME VALUE 2" ;
        prec:hasMetaProperties :name_value_2_meta_properties .
        
      :town_value a prec:PropertyKeyValue ;
        rdf:value "LYON" ;
        prec:hasMetaProperties :town_value_meta_properties .
        
      :name_value_2_meta_properties :description :name_value_2_meta_properties_description .

      :name_value_2_meta_properties_description a prec:PropertyKeyValue ;
        rdf:value "NAME VALUE 2: Meta Property" .
        
      :town_value_meta_properties
        :description :town_value_meta_properties_description ;
        :name :town_value_meta_properties_name .
        
      :town_value_meta_properties_description a prec:PropertyKeyValue ;
        rdf:value "Not like the animal" .

      :town_value_meta_properties_name a prec:PropertyKeyValue ;
        rdf:value "Capital of Lights" .
    `,
    contextForPB: ` :knows prec:IRIOfProperty "PropertyB" . `,
    contextForNodes: `
      [] a prec:PropertyRule ;
        prec:propertyIRI  :knows ;
        prec:propertyName "PropertyA" ; 
        prec:onKind prec:Node
      .
    `,
    contextForPASubjectNodes: `
      [] a prec:PropertyRule ;
        prec:propertyIRI  :mappedA ;
        prec:propertyName "PropertyA" ;
        prec:onKind prec:Node ; prec:label "Subject"
      .
    `,
    contextForPAOnLabelOfEdge: `
      [] a prec:PropertyRule ;
        prec:propertyIRI  :mappedA ;
        prec:propertyName "PropertyA" ;
        prec:label    "LabelOfEdge" ; prec:onKind prec:Edge
      .
    `
  };

  describe('Empty context', () => {
    runATest_(graphs, 'empty'                  , 'empty', graphs.empty);
    runATest_(graphs, 'oneEdge'                , 'empty', graphs.oneEdge);
    runATest_(graphs, 'oneSimpleGraph'         , 'empty', graphs.oneSimpleGraph);
    runATest_(graphs, 'oneNodeWithMetaProperty', 'empty', graphs.oneNodeWithMetaProperty);
  });

  describe("Simple properties", function() {
    runATest_(graphs, 'oneSimpleGraph', 'contextForPB',
      `
        :edge a pgo:Edge ;
          rdf:subject :s ;
          rdf:predicate :p ;
          rdf:object :o .

        :s a pgo:Node ; :propertyA [ rdf:value "VANode" ; a prec:PropertyKeyValue ] ; a [ rdfs:label "Subject" ] .
        :o a pgo:Node ; :knows     [ rdf:value "VBNode" ; a prec:PropertyKeyValue ] ; a [ rdfs:label "Object"  ] .
        :p rdfs:label "LabelOfEdge" .
        :edge :propertyA [ rdf:value "VAEdge" ; a prec:PropertyKeyValue ] .
        :edge :knows     [ rdf:value "VBEdge" ; a prec:PropertyKeyValue ] .
        :propertyA a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "PropertyA" .
      `
    );

    runATest_(graphs, 'oneSimpleGraph', 'contextForNodes',
      `
        :edge a pgo:Edge ;
          rdf:subject :s ;
          rdf:predicate :p ;
          rdf:object :o .

        :s a pgo:Node ; :knows     [ rdf:value "VANode" ; a prec:PropertyKeyValue ] ; a [ rdfs:label "Subject" ] .
        :o a pgo:Node ; :propertyB [ rdf:value "VBNode" ; a prec:PropertyKeyValue ] ; a [ rdfs:label "Object"  ] .
        :p rdfs:label "LabelOfEdge" .
        :edge :propertyA [ rdf:value "VAEdge" ; a prec:PropertyKeyValue ] .
        :edge :propertyB [ rdf:value "VBEdge" ; a prec:PropertyKeyValue ] .
        :propertyA a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "PropertyA" .
        :propertyB a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "PropertyB" .
      `
    );
    
    runATest_(graphs, 'oneSimpleGraph', 'contextForPASubjectNodes',
      `
        :edge a pgo:Edge ;
          rdf:subject :s ;
          rdf:predicate :p ;
          rdf:object :o .
        
        :s a pgo:Node ; :mappedA   [ rdf:value "VANode" ; a prec:PropertyKeyValue ] ; a [ rdfs:label "Subject" ] .
        :o a pgo:Node ; :propertyB [ rdf:value "VBNode" ; a prec:PropertyKeyValue ] ; a [ rdfs:label "Object"  ] .
        :p rdfs:label "LabelOfEdge" .
        :edge :propertyA [ rdf:value "VAEdge" ; a prec:PropertyKeyValue ] .
        :edge :propertyB [ rdf:value "VBEdge" ; a prec:PropertyKeyValue ] .
        :propertyA a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "PropertyA" .
        :propertyB a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "PropertyB" .
      `
    );

    runATest_(graphs, 'oneSimpleGraph', 'contextForPAOnLabelOfEdge',
      `
        :edge a pgo:Edge ;
          rdf:subject :s ;
          rdf:predicate :p ;
          rdf:object :o .
          
        :s a pgo:Node ; :propertyA [ rdf:value "VANode" ; a prec:PropertyKeyValue ] ; a [ rdfs:label "Subject" ] .
        :o a pgo:Node ; :propertyB [ rdf:value "VBNode" ; a prec:PropertyKeyValue ] ; a [ rdfs:label "Object"  ] .
        :p rdfs:label "LabelOfEdge" .
        :edge :mappedA   [ rdf:value "VAEdge" ; a prec:PropertyKeyValue ] .
        :edge :propertyB [ rdf:value "VBEdge" ; a prec:PropertyKeyValue ] .
        :propertyA a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "PropertyA" .
        :propertyB a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "PropertyB" .
      `
    );
  });

  describe("Meta properties", function() {
    test("oneNodeWithMetaProperty x with collapsed meta properties",
      graphs.oneNodeWithMetaProperty,
      "prec:MetaProperties prec:templatedBy prec:DirectTriples .",
      `
        :name a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "NAME" .
        :town a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "TOWN" .
        :description a prec:PropertyKey, prec:CreatedPropertyKey ; rdfs:label "DESCRIPTION" .

        :node a pgo:Node ;
          :name :name_value_1 ;
          :name :name_value_2 ;
          :town :town_value   .
        
        :name_value_1 a prec:PropertyKeyValue ;
          rdf:value "NAME VALUE 1" .
        
        :name_value_2 a prec:PropertyKeyValue ;
          rdf:value "NAME VALUE 2" ;
          prec:hasMetaProperties :name_value_2_meta_properties .
        
        :town_value a prec:PropertyKeyValue ;
          rdf:value "LYON" ;
          prec:hasMetaProperties :town_value_meta_properties .
        
        :name_value_2_meta_properties :description "NAME VALUE 2: Meta Property" .
        
        :town_value_meta_properties
          :description "Not like the animal" ;
          :name "Capital of Lights" .
      `
    );
  });
})

describe('Node label rules', () => {
  describe('Template redefinition', () => {
    test('should let the user defined how node labels are defined',
      `
        :alice rdf:type pgo:Node, _:person .
        _:person a prec:CreatedNodeLabel ; rdfs:label "Person" .
      `,
      `
        prec:NodeLabels prec:templatedBy [
          prec:composedOf
            << pvar:node :somePGsaysThatTheyAreA pvar:nodeLabelIRI >> ,
            << pvar:nodeLabelIRI :labelsTheNode pvar:node  >> ,
            << << pvar:node pvar:node pvar:node >> rdf:type :rdfstartriple >>
        ] .
      `,
      `
        :alice rdf:type pgo:Node .
        :alice :somePGsaysThatTheyAreA _:person .
        _:person :labelsTheNode :alice .
        << :alice :alice :alice >> rdf:type :rdfstartriple .
        _:person a prec:CreatedNodeLabel ; rdfs:label "Person" .
      `
    );

    test('should let the user use string literal labels',
      `
        :myNode rdf:type pgo:Node ;
          rdf:type pgo:myLabel .
        
        :myOtherNode rdf:type pgo:Node ;
          rdf:type pgo:myLabel, pgo:myOtherLabel .
        
        pgo:myLabel      a prec:CreatedNodeLabel ; rdfs:label "Cat" .
        pgo:myOtherLabel a prec:CreatedNodeLabel ; rdfs:label "Kitten" .
      `,
      `
        prec:NodeLabels prec:templatedBy [
            prec:composedOf << pvar:node :isLabeled pvar:label >>
        ] .
      `,
      `
        :myNode      rdf:type pgo:Node ; :isLabeled "Cat" .
        :myOtherNode rdf:type pgo:Node ; :isLabeled "Cat", "Kitten" .        
      `
    );
  });
});

describe('Synonyms', function () {
  test('should properly map relationship to edge', 
    `
      :edge1 a pgo:Edge ;
        rdf:subject :nodes ;
        rdf:object  :node1o ;
        rdf:predicate :knows .
    
      :edge2 a pgo:Edge ;
        rdf:subject :nodes ;
        rdf:object  :node2o ;
        rdf:predicate :ignores .
        
      :nodes a pgo:Node .
      :node1o a pgo:Node .
      :node2o a pgo:Node .

      :knows   a prec:CreatedEdgeLabel ; rdfs:label "WhoKnows" .
      :ignores a prec:CreatedEdgeLabel ; rdfs:label "DoesntKnow" .
    `,
    `
      :worstTemplate a prec:RelationshipTemplate ;
        prec:composedOf
          << pvar:source          :startArrow pvar:relationship >> ,
          << pvar:relationship    :endArrow   pvar:destination  >> ,
          << pvar:relationshipIRI :labels     pvar:relationship >> .
        
      prec:Relationships prec:templatedBy :worstTemplate .

      :whoKnows prec:IRIOfRelationshipLabel "WhoKnows" .

      :doesntRule a prec:RelationshipRule ;
        prec:label "DoesntKnow" ;
        prec:relationshipIRI :imlost ;
        prec:templatedBy prec:RdfStarUnique .
    `,
    `
      :nodes a pgo:Node .
      :node1o a pgo:Node .
      :node2o a pgo:Node .

      # First edge
      :nodes :startArrow :edge1 .
      :edge1 :endArrow :node1o .
      :whoKnows :labels :edge1 .

      # Second edge
      :nodes :imlost :node2o .
      << :nodes :imlost :node2o >> rdf:type pgo:Edge .
    `
  );
})