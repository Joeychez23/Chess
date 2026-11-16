const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// room.js IMPORTS three & clock.js (WHICH NEEDS window), SO THE TEST READS ITS SOURCE
const source = fs.readFileSync(path.join(__dirname, "../src/js/gameplay/three/room.js"), "utf8");
const list = /export const OWN_MATERIALS = \[([^\]]*)\]/.exec(source);
const OWN_MATERIALS = list ? (list[1].match(/"[^"]+"/g) || []).map((q) => q.slice(1, -1)) : [];

test("the card keeps its own materials like the screen, and a room without one still loads", () => {
	assert.ok(OWN_MATERIALS.includes("card"));
	assert.ok(OWN_MATERIALS.includes("screen"));
	assert.match(source, /card:\s*group\.getObjectByName\(CARD\)\s*\|\|\s*null/); // NO THROW FOR AN OLD library.glb
});
