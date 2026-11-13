/*
 *  pixelFont.js  --  chess frontend
 *	The CRT Monitor's Font
 *	A 5 x 7 pixel font for the monitor's name & status strip (three/screen.js), so its text is as chunky as its picture. Capitals,
 *	digits & a little punctuation: lower case is drawn as capitals, accents are dropped (é as E), anything else as a box.
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
	"+": "..... ..#.. ..#.. ##### ..#.. ..#.. .....",
	"#": ".#.#. ##### .#.#. .#.#. .#.#. ##### .#.#.",
	"=": "..... ..... ##### ..... ##### ..... .....",
	"%": "##..# ##..# ...#. ..#.. .#... #..## #..##",
	"(": "...#. ..#.. .#... .#... .#... ..#.. ...#.",
	")": ".#... ..#.. ...#. ...#. ...#. ..#.. .#...",
	"◀": "....# ...## ..### .#### ..### ...## ....#",
	"▶": "#.... ##... ###.. ####. ###.. ##... #....",
	"…": "..... ..... ..... ..... ..... ..... #.#.#",
};
const BOX = "##### #...# #...# #...# #...# #...# #####"; // A CHARACTER THE FONT DOESN'T HAVE

/* ---------------------------------------------------------------- */
// Text
/* ---------------------------------------------------------------- */

/**
 * @description The text without its accents: decomposed, then the combining marks dropped, so "Réti" draws as RETI
 * @param  {[string]} text
 * @return {[string]}
 */
function plain(text) {
	return String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * @description How wide a line of text is
 * @param  {[string]} text
 * @return {[number]} width [in font pixels, no trailing gap]
 */
function textWidth(text) {
	return Math.max(0, [...plain(text)].length * ADVANCE - 1);
}

/**
 * @description The lit pixels of a line of text
 * @param  {[string]} text [drawn in capitals]
 * @return {[number[][]]} cells [[x, y] in font pixels, (0, 0) the text's top left]
 */
function textCells(text) {
	const cells = [];
	[...plain(text).toUpperCase()].forEach(function (char, i) {
		(Object.hasOwn(GLYPHS, char) ? GLYPHS[char] : BOX).split(" ").forEach(function (row, y) {
			[...row].forEach(function (c, x) {
				if (c === "#") { cells.push([i * ADVANCE + x, y]); }
			});
		});
	});
	return cells;
}

/**
 * @description Cuts text to what fits a width: at the last whole word that fits, ending in an ellipsis; a single word that doesn't fit is cut
 * mid word, ending in a dot
 * @param  {[string]} text [its accents are dropped]
 * @param  {[number]} width [font pixels]
 * @return {[string]}
 */
function fitText(text, width) {
	const chars = [...plain(text)];
	const max = Math.max(1, Math.floor((width + 1) / ADVANCE));
	if (chars.length <= max) { return chars.join(""); }
	const space = chars.lastIndexOf(" ", max - 1); // THE LAST BREAK THAT LEAVES ROOM FOR THE ELLIPSIS
	const words = space > 0 ? chars.slice(0, space).join("").replace(/[\s:;,-]+$/, "") : ""; // NO DANGLING COLON OR DASH BEFORE THE ELLIPSIS
	return words ? `${words}…` : `${chars.slice(0, max - 1).join("")}.`;
}

export { GLYPHS, WIDTH, HEIGHT, ADVANCE, textWidth, textCells, fitText };
