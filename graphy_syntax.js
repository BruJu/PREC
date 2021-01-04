const N3 = require('n3');
const graphy = require('@graphy/core.data.factory')
const ds = require('@graphy/memory.dataset.fast')


function n(r) {
    return graphy.namedNode("http://" + r);
}


const dataset = ds();

dataset.add(graphy.quad(n("s1"), n("o1"), n("p1"), graphy.defaultGraph()));
dataset.add(graphy.quad(n("s2"), n("o1"), n("p1"), graphy.defaultGraph()));
dataset.add(graphy.quad(n("s3"), n("o1"), n("p1"), graphy.defaultGraph()));
dataset.add(graphy.quad(n("s4"), n("o1"), n("p1"), graphy.defaultGraph()));
dataset.add(graphy.quad(n("s1"), n("o1"), n("p7"), graphy.defaultGraph()));
dataset.add(graphy.quad(n("s2"), n("o1"), n("p8"), graphy.defaultGraph()));
dataset.add(graphy.quad(n("s3"), n("o1"), n("p9"), graphy.defaultGraph()));
dataset.add(graphy.quad(n("s3"), n("o1"), n("p5"), graphy.defaultGraph()));
dataset.add(graphy.quad(n("s3"), n("o1"), n("p6"), graphy.defaultGraph()));
dataset.add(graphy.quad(n("s3"), n("o2"), n("p6"), graphy.defaultGraph()));
dataset.add(graphy.quad(n("s3"), n("o2"), n("pA"), graphy.defaultGraph()));
dataset.add(graphy.quad(n("s3"), n("o2"), n("pB"), graphy.defaultGraph()));

console.log(dataset._h_quad_tree);

console.log(dataset._h_quad_tree['*']['>http://s1'])

console.log(dataset._h_quad_tree['*']['>http://s3'])


const m = dataset.match(n("s3"));

console.log("==========")

console.log(m._h_quad_tree['*']);
console.log(m._h_quad_tree['*']['>http://s3']);

dataset.add(graphy.quad(n("s3"), n("o2"), n("pB"), n("GGG")));


dataset.add(graphy.quad(n("s3"), n("o2"), n("UOERGBONERONGR"), graphy.defaultGraph()));


for (let q of m) {
    console.log("A quad:");
    console.log(q)
}

console.log("==========")


const dataset2 = ds();
const quadStar = graphy.quad(n("sstar"), n("pstar"), n("ostar"));
dataset2.add(graphy.quad(quadStar, n("p"), n("s")));

for (let q of dataset2) {
    console.log(q);
}

//console.log(m._h_quad_tree['*']['>http://s3']);


//console.log(m);

//const store = new N3.Store(x);
//
//function logStore(store) {
//    const writer = new N3.Writer({ format: 'application/trig' });    
//
//    store.match()
//        .on('data', (q) => (writer.addQuad(q)))
//        .on('end', () => (writer.end((error, result) => console.log(result)) ));    
//}
//
//logStore(store);