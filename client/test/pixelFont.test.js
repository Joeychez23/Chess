/*
 *  pixelFont.test.js  --  chess frontend tests
 *	The CRT monitor's 5 x 7 font (client/src/js/gameplay/three/pixelFont.js). Run with npm run test:client
 *
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { GLYPHS, WIDTH, HEIGHT, ADVANCE, textWidth, textCells, fitText } = require("../src/js/gameplay/three/pixelFont.js");

describe("pixel font", () => {
	test("every glyph is 7 rows of 5, of # and .", () => {
		for (const [char, glyph] of Object.entries(GLYPHS)) {
			const rows = glyph.split(" ");
			assert.equal(rows.length, HEIGHT, char);
			for (const row of rows) { assert.match(row, new RegExp(`^[#.]{${WIDTH}}$`), char); }
		}
	});

	test("has every capital and digit", () => {
		for (const char of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789") { assert.ok(GLYPHS[char], char); }
	});

	test("lower case draws as capitals, an unknown character as a box", () => {
		assert.deepEqual(textCells("mabel"), textCells("MABEL"));
		assert.equal(textCells("~").length, 2 * WIDTH + 2 * (HEIGHT - 2));
		assert.equal(textCells(" ").length, 0);
	});

	test("letters sit one gap apart and stay inside the text's width", () => {
		const cells = textCells("AB");
		assert.equal(textWidth("AB"), 2 * ADVANCE - 1);
		assert.ok(cells.every(([x, y]) => x >= 0 && x < textWidth("AB") && y >= 0 && y < HEIGHT));
		assert.ok(cells.every(([x]) => x !== WIDTH)); // THE GAP COLUMN IS DARK
		assert.equal(textWidth(""), 0);
	});

	test("long text is cut to fit, ending in a dot", () => {
		assert.equal(fitText("MABEL", 100), "MABEL");
		const cut = fitText("A_VERY_LONG_USERNAME", 5 * ADVANCE - 1);
		assert.equal(cut, "A_VE.");
		assert.ok(textWidth(cut) <= 5 * ADVANCE - 1);
	});
});
