const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseList, awayFromRows, rightFromFiles, startsRight, facesAway, knightFacesRight } = require("../src/js/gameplay/draw/facing.js");

const pieceAway = (list, sq, color, o) => facesAway(list, sq, color, o);
const knightRight = (list, sq, color, o) => knightFacesRight(list, sq, color, o);
const hopRight = (from, to, color, viewColor) => rightFromFiles(from, to, viewColor);

test("parseList caches by name and raw value, and recovers after invalid JSON", () => {
	const first = parseList("cache", '[{"to":"a1"}]');
	assert.equal(parseList("cache", '[{"to":"a1"}]'), first);
	assert.notEqual(parseList("cache", '[{"to":"b1"}]'), first);
	assert.throws(() => parseList("broken", "{"), SyntaxError);
	assert.deepEqual(parseList("broken", '[]'), []);
});

test("facing table: today's outputs, both views and colours", () => {
	const rows = [
		[[{from:"a2",to:"a4"}],"a4","w","w",null,null,true], [[{from:"a2",to:"a4"}],"a4","w","b",null,null,false],
		[[{from:"a7",to:"a5"}],"a5","b","w",null,null,false], [[{from:"a7",to:"a5"}],"a5","b","b",null,null,true],
		[[{from:"a1",to:"c1"}],"c1","w","w",null,null,true], [[{from:"a1",to:"c1"}],"c1","w","b",null,null,false],
		[[{from:"a8",to:"c8"}],"c8","b","w",null,null,false], [[{from:"a8",to:"c8"}],"c8","b","b",null,null,true],
	];
	for (const [sq,color,view,expected] of [["a1","w","w",true],["a1","w","b",false],["a1","b","w",false],["a1","b","b",true]]) rows.push([[{from:null,to:"a1"}],sq,color,view,null,null,expected]);
	rows.push([[{from:"b1",to:"b3"}],"a1","w","w",null,null,null], [[{from:null,to:null}],"a1","w","w",null,null,null], [[],"a1","w","w",{from:"a1",to:"a2"},null,null]);
	rows.push([[{from:"a1",to:"a2"}],"a2","w","w",{from:"b2",to:"b4"},null,true], [[{from:"a1",to:"a2"}],"a2","w","b",{from:"b2",to:"b4"},null,false], [[{from:"a1",to:"a2"}],"a2","w","w",{from:"b2",to:"c2"},null,true]);
	rows.push([[{from:"b1",to:"b3"}],"a1","w","w",null,{from:"a1",to:"b3"},true], [[{from:"b1",to:"b3"}],"a1","w","b",null,{from:"a1",to:"b3"},false], [[{from:null,to:"b3"}],"a1","w","w",null,{from:"a1",to:"b3"},true], [[{from:null,to:"b3"}],"a1","b","w",null,{from:"a1",to:"b3"},false]);
	for (const [list,square,color,viewColor,slide,landed,expected] of rows) assert.equal(pieceAway(list,square,color,{viewColor,slide,landed}),expected, JSON.stringify([list,square,color,viewColor,slide,landed]));
});

test("facing table: hopping knight", () => {
	const rows = [];
	for (const [from,to,expectedByView] of [["b1","c3",[true,false]], ["c3","b1",[false,true]]]) {
		for (const color of ["w","b"]) for (const [viewIndex,viewColor] of ["w","b"].entries()) {
			rows.push([[{from,to}],to,color,viewColor,null,null,expectedByView[viewIndex]]);
		}
	}
	for (const [square,color,view,expected] of [["b1","w","w",true],["b1","w","b",false],["g1","w","w",false],["g1","w","b",true],["b8","b","w",true],["b8","b","b",false],["g8","b","w",false],["g8","b","b",true]]) rows.push([[{from:null,to:square}],square,color,view,null,null,expected]);
	for (const [list,square,color,expectedW,expectedB] of [[[ {from:"a7",to:"a8"} ],"a8","w",false,false],[[{from:"a2",to:"a1"}],"a1","b",true,true]]) for (const [view,expected] of [["w",expectedW],["b",expectedB]]) rows.push([list,square,color,view,null,null,expected]);
	for (const [color,viewColor,expected] of [["w","w",true],["w","b",false],["b","w",true],["b","b",false]]) rows.push([[{from:null,to:null}],"c3",color,viewColor,{from:"b1",to:"c3"},null,expected]);
	rows.push([[{from:null,to:"h8"},{from:"b1",to:"c3"}],"a1","w","w",null,{from:"a1",to:"c3"},true], [[{from:null,to:"h8"},{from:"b1",to:"c3"}],"a1","b","b",null,{from:"a1",to:"c3"},false], [[],"a1","w","w",{from:"a1",to:"b3"},null,null], [[{from:"b1",to:"c3"}],"d4","w","w",null,null,null]);
	for (const [from,to,color,view,expected] of [
		["b1","c3","w","w",true], ["b1","c3","w","b",false], ["b1","c3","b","w",true], ["b1","c3","b","b",false],
		["g8","f6","w","w",false], ["g8","f6","w","b",true], ["g8","f6","b","w",false], ["g8","f6","b","b",true],
		["c3","b1","w","w",false], ["c3","b1","w","b",true], ["c3","b1","b","w",false], ["c3","b1","b","b",true],
		["f6","g8","w","w",true], ["f6","g8","w","b",false], ["f6","g8","b","w",true], ["f6","g8","b","b",false],
	]) rows.push([from,to,color,view,null,null,expected]);
	for (const [list,square,color,viewColor,slide,landed,expected] of rows) {
		if (typeof list === "string") assert.equal(hopRight(list,square,color,viewColor),expected);
		else assert.equal(knightRight(list,square,color,{viewColor,slide,landed}),expected, JSON.stringify([list,square,color,viewColor,slide,landed]));
	}
});


test("awayFromRows, rightFromFiles, startsRight", () => {
	assert.equal(awayFromRows(6,4,'b','w'), true);
	assert.equal(awayFromRows(1,3,'w','w'), false);
	assert.equal(awayFromRows(null,null,'w','w'), true);
	assert.equal(awayFromRows(undefined,undefined,'w','b'), false);
	assert.equal(rightFromFiles("b1","c3","w"), true);
	assert.equal(rightFromFiles("b1","c3","b"), false);
	assert.equal(rightFromFiles("a7","a8","w"), false);
	assert.equal(startsRight("d1","w"), true);
	assert.equal(startsRight("e1","w"), false);
	assert.equal(startsRight("d8","b"), false);
	assert.equal(startsRight("e8","b"), true);
});

test("a missing list (a card game's response) faces like an unmoved piece", () => {
	assert.equal(parseList("w_piece", undefined), null);
	assert.equal(parseList("w_piece", null), null);
	for (const square of ["a1","e1","h1","d4","e8","b8","g8","c3"]) for (const color of ["w","b"]) for (const viewColor of ["w","b"]) {
		for (const slide of [null, {from:square,to:"a5"}, {from:square,to:square[0] + "6"}]) {
			const o = { viewColor, slide, landed: null };
			const unmoved = [{ from: null, to: square }];
			assert.equal(facesAway(null,square,color,o), facesAway(unmoved,square,color,o), JSON.stringify([square,color,o]));
			assert.equal(knightFacesRight(null,square,color,o), knightFacesRight(unmoved,square,color,o), JSON.stringify([square,color,o]));
		}
	}
	assert.equal(facesAway(null,"e1","w",{viewColor:"w",slide:null,landed:null}), true);
	assert.equal(facesAway(null,"e8","b",{viewColor:"w",slide:null,landed:null}), false);
});
