/*
 *  pixelFont.js  --  chess frontend
 *	The CRT Monitor's Font
 *	A 5 x 7 pixel font for the monitor's name & status strip (three/screen.js), so its text is as chunky as its picture. Capitals,
 *	digits & a little punctuation: lower case is drawn as capitals, anything else as a box.
 *	No DOM & no three.js here, so the tests load it in Node (client/test/pixelFont.test.js)
 *
 */

const WIDTH = 5;
const HEIGHT = 7;
const ADVANCE = WIDTH + 1; // ONE DARK COLUMN BETWEEN LETTERS

// EACH GLYPH: 7 ROWS OF 5, TOP FIRST, # LIT & . DARK
const GLYPHS = {
	" ": "..... ..... ..... ..... ..... ..... .....",
	A: ".###. #...# #...# ##### #...# #...# #...#",
	B: "####. #...# #...# ####. #...# #...# ####.",
	C: ".###. #...# #.... #.... #.... #...# .###.",
	D: "####. #...# #...# #...# #...# #...# ####.",
	E: "##### #.... #.... ####. #.... #.... #####",
	F: "##### #.... #.... ####. #.... #.... #....",
	G: ".###. #...# #.... #.### #...# #...# .###.",
	H: "#...# #...# #...# ##### #...# #...# #...#",
	I: ".###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.",
	J: "..### ...#. ...#. ...#. ...#. #..#. .##..",
	K: "#...# #..#. #.#.. ##... #.#.. #..#. #...#",
	L: "#.... #.... #.... #.... #.... #.... #####",
	M: "#...# ##.## #.#.# #.#.# #...# #...# #...#",
	N: "#...# ##..# #.#.# #..## #...# #...# #...#",
	O: ".###. #...# #...# #...# #...# #...# .###.",
	P: "####. #...# #...# ####. #.... #.... #....",
	Q: ".###. #...# #...# #...# #.#.# #..#. .##.#",
	R: "####. #...# #...# ####. #.#.. #..#. #...#",
	S: ".#### #.... #.... .###. ....# ....# ####.",
	T: "##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..",
	U: "#...# #...# #...# #...# #...# #...# .###.",
	V: "#...# #...# #...# #...# #...# .#.#. ..#..",
	W: "#...# #...# #...# #.#.# #.#.# ##.## #...#",
	X: "#...# #...# .#.#. ..#.. .#.#. #...# #...#",
	Y: "#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..",
	Z: "##### ....# ...#. ..#.. .#... #.... #####",
	0: ".###. #...# #..## #.#.# ##..# #...# .###.",
	1: "..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.",
	2: ".###. #...# ....# ...#. ..#.. .#... #####",
	3: "####. ....# ....# .###. ....# ....# ####.",
	4: "...#. ..##. .#.#. #..#. ##### ...#. ...#.",
	5: "##### #.... ####. ....# ....# #...# .###.",
	6: ".###. #.... #.... ####. #...# #...# .###.",
	7: "##### ....# ...#. ..#.. .#... .#... .#...",
	8: ".###. #...# #...# .###. #...# #...# .###.",
	9: ".###. #...# #...# .#### ....# ....# .###.",
	".": "..... ..... ..... ..... ..... ..... ..#..",
	",": "..... ..... ..... ..... ..... ..#.. .#...",
	"!": "..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..",
	"?": ".###. #...# ....# ...#. ..#.. ..... ..#..",
	"-": "..... ..... ..... .###. ..... ..... .....",
	"_": "..... ..... ..... ..... ..... ..... #####",
	"'": "..#.. ..#.. ..... ..... ..... ..... .....",
	":": "..... ..#.. ..... ..... ..#.. ..... .....",
	"/": "....# ....# ...#. ..#.. .#... #.... #....",
};
const BOX = "##### #...# #...# #...# #...# #...# #####"; // A CHARACTER THE FONT DOESN'T HAVE

/**
 * @description How wide a line of text is
 * @param  {[string]} text
 * @return {[number]} width [in font pixels, no trailing gap]
 */
function textWidth(text) {
	return Math.max(0, [...String(text)].length * ADVANCE - 1);
}

/**
 * @description The lit pixels of a line of text
 * @param  {[string]} text [drawn in capitals]
 * @return {[number[][]]} cells [[x, y] in font pixels, (0, 0) the text's top left]
 */
function textCells(text) {
	const cells = [];
	[...String(text).toUpperCase()].forEach(function (char, i) {
		(Object.hasOwn(GLYPHS, char) ? GLYPHS[char] : BOX).split(" ").forEach(function (row, y) {
			[...row].forEach(function (c, x) {
				if (c === "#") { cells.push([i * ADVANCE + x, y]); }
			});
		});
	});
	return cells;
}

/**
 * @description Cuts text to what fits a width, ending in a dot when it was cut
 * @param  {[string]} text
 * @param  {[number]} width [font pixels]
 * @return {[string]}
 */
function fitText(text, width) {
	const chars = [...String(text)];
	const max = Math.max(1, Math.floor((width + 1) / ADVANCE));
	return chars.length <= max ? chars.join("") : `${chars.slice(0, max - 1).join("")}.`;
}

export { GLYPHS, WIDTH, HEIGHT, ADVANCE, textWidth, textCells, fitText };
