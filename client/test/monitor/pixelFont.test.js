/*
 *  pixelFont.test.js  --  chess frontend tests
 *	The CRT monitor's 5 x 7 font (client/src/js/gameplay/three/pixelFont.js). Run with npm run test:client
 *
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { GLYPHS, WIDTH, HEIGHT, ADVANCE, textWidth, textCells, fitText, drawable } = require("../../src/js/gameplay/three/pixelFont.js");

describe("pixel font", () => {
	test("the font has the glyphs the monitor needs", () => {
		for (const char of "+#=%()◀▶…") { assert.ok(Object.hasOwn(GLYPHS, char), char); }
	});

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

	test("has every lower case letter and the marks [ ] >", () => {
		for (const char of "abcdefghijklmnopqrstuvwxyz[]>") { assert.ok(GLYPHS[char], char); }
	});

	test("lower case draws as lower case, an unknown character as a box", () => {
		assert.notDeepEqual(textCells("a"), textCells("A"));
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

	test("accents are dropped, not drawn as boxes", () => {
		assert.deepEqual(textCells("Réti"), textCells("Reti"));
		assert.deepEqual(textCells("Grünfeld"), textCells("Grunfeld")); // A COMBINING MARK, ALREADY DECOMPOSED
		assert.equal(textWidth("Grünfeld"), textWidth("GRUNFELD"));
		assert.equal(fitText("Réti", 100), "Reti");
	});

	test("text with spaces is cut at the last whole word that fits, ending in an ellipsis", () => {
		const cut = fitText("A30 English Opening: Symmetrical Variation", 136);
		assert.equal(cut, "A30 English Opening…");
		assert.ok(textWidth(cut) <= 136);
		assert.equal(fitText("WHITE WINS! BY CHECKMATE", 12 * ADVANCE - 1), "WHITE WINS!…");
	});

	test("at size 1 each glyph is laid out from its rows, one advance apart", () => {
		const cells = [];
		[..."Aa"].forEach((char, i) => GLYPHS[char].split(" ").forEach((row, y) => [...row].forEach((c, x) => { if (c === "#") { cells.push([i * ADVANCE + x, y]); } })));
		assert.deepEqual(textCells("Aa", 1), cells);
		assert.deepEqual(textCells("Aa"), cells);
	});

	test("at size 3 every lit pixel is a 3 x 3 block", () => {
		const big = new Set(textCells("A/", 3).map(([x, y]) => `${x},${y}`));
		for (const [x, y] of textCells("A/", 1)) {
			for (let j = 0; j < 3; j++) { for (let i = 0; i < 3; i++) { assert.ok(big.has(`${x * 3 + i},${y * 3 + j}`), `${x},${y}`); } }
		}
	});

	test("at size 3 a corner-only touch fills a wedge in both empty corner cells", () => {
		const lit = textCells("/", 1).length;
		const big = textCells("/", 3);
		assert.ok(big.length > 9 * lit);
		const keys = big.map(([x, y]) => `${x},${y}`);
		assert.equal(new Set(keys).size, keys.length); // NO PIXEL LISTED TWICE
		// "/" ROW 1 COL 4 LIT, ROW 2 COL 3 LIT: THE EMPTY CELLS (3, 1) & (4, 2) EACH GAIN A WEDGE FILLING THEIR CORNER NEAREST THE STEP
		assert.ok(keys.includes(`${3 * 3 + 2},${1 * 3 + 2}`));
		assert.ok(keys.includes(`${4 * 3},${2 * 3}`));
		assert.ok(big.every(([x, y]) => x >= 0 && x < WIDTH * 3 && y >= 0 && y < HEIGHT * 3));
	});

	test("at size 3 each wedge fills the corner of its empty cell nearest the step, on both diagonals", () => {
		const keys = new Set(textCells(">", 3).map(([x, y]) => `${x},${y}`));
		const cell = (gx, gy) => [0, 1, 2].map((j) => [0, 1, 2].map((i) => (keys.has(`${gx * 3 + i},${gy * 3 + j}`) ? "#" : ".")).join("")).join(" ");
		// FALLING STEP: (0, 0) & (1, 1) LIT, SO (1, 0) FILLS ITS BOTTOM LEFT & (0, 1) ITS TOP RIGHT
		assert.equal(cell(1, 0), "... #.. ##.");
		assert.equal(cell(0, 1), ".## ..# ...");
		// RISING STEP: (1, 5) & (0, 6) LIT, SO (0, 5) FILLS ITS BOTTOM RIGHT & (1, 6) ITS TOP LEFT
		assert.equal(cell(0, 5), "... ..# .##");
		assert.equal(cell(1, 6), "##. #.. ...");
	});

	test("the lower case and the marks keep their drawn shapes", () => {
		assert.equal(GLYPHS.a, "..... ..... .###. ....# .#### #...# .####");
		assert.equal(GLYPHS.g, "..... .#### #...# #...# .#### ....# .###.");
		assert.equal(GLYPHS.q, "..... ..... .##.# #..## .#### ....# ....#");
		assert.equal(GLYPHS.w, "..... ..... #...# #...# #.#.# #.#.# .#.#.");
		assert.equal(GLYPHS[">"], "#.... .#... ..#.. ...#. ..#.. .#... #....");
		assert.equal(GLYPHS["["], ".###. .#... .#... .#... .#... .#... .###.");
	});

	test("a size that is not a whole number of at least 1 draws at size 1, or rounds down", () => {
		assert.deepEqual(textCells("A", 0), textCells("A"));
		assert.deepEqual(textCells("A", -2), textCells("A"));
		assert.deepEqual(textCells("A", NaN), textCells("A"));
		assert.deepEqual(textCells("A", Infinity), textCells("A"));
		assert.deepEqual(textCells("A", 2.5), textCells("A", 2));
	});

	test("size 1 adds no wedges", () => {
		assert.equal(textCells("/", 1).length, GLYPHS["/"].split("").filter((c) => c === "#").length);
	});

	test("drawable is true only for a character the font has", () => {
		assert.equal(drawable("e"), true);
		assert.equal(drawable(" "), true);
		assert.equal(drawable("é"), false);
		assert.equal(drawable("😀"), false);
		assert.equal(drawable("~"), false);
		for (const value of [5, 0, ["A"], { toString() { return "A"; } }, null, undefined]) { assert.equal(drawable(value), false, String(value)); }
	});
});
