/*
 *  pixelFont.js  --  chess frontend
 *	The CRT Monitor's Font
 *	A 5 x 7 pixel font for the monitor's terminal (three/monitor/), so its text is as chunky as its picture. Capitals, lower case,
 *	digits & a little punctuation: accents are dropped (é as e), anything else as a box. Larger text keeps the small text's pixel size
 *	and spends the extra pixels smoothing the steps
 *	No DOM & no three.js here, so the tests load it in Node (client/test/monitor/pixelFont.test.js)
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
	a: "..... ..... .###. ....# .#### #...# .####",
	b: "#.... #.... #.##. ##..# #...# #...# ####.",
	c: "..... ..... .###. #.... #.... #...# .###.",
	d: "....# ....# .##.# #..## #...# #...# .####",
	e: "..... ..... .###. #...# ##### #.... .###.",
	f: "..##. .#..# .#... ###.. .#... .#... .#...",
	g: "..... .#### #...# #...# .#### ....# .###.",
	h: "#.... #.... #.##. ##..# #...# #...# #...#",
	i: "..#.. ..... .##.. ..#.. ..#.. ..#.. .###.",
	j: "...#. ..... ..##. ...#. ...#. #..#. .##..",
	k: "#.... #.... #..#. #.#.. ##... #.#.. #..#.",
	l: ".##.. ..#.. ..#.. ..#.. ..#.. ..#.. .###.",
	m: "..... ..... ##.#. #.#.# #.#.# #...# #...#",
	n: "..... ..... #.##. ##..# #...# #...# #...#",
	o: "..... ..... .###. #...# #...# #...# .###.",
	p: "..... ..... ####. #...# ####. #.... #....",
	q: "..... ..... .##.# #..## .#### ....# ....#",
	r: "..... ..... #.##. ##..# #.... #.... #....",
	s: "..... ..... .###. #.... .###. ....# ####.",
	t: ".#... .#... ###.. .#... .#... .#..# ..##.",
	u: "..... ..... #...# #...# #...# #..## .##.#",
	v: "..... ..... #...# #...# #...# .#.#. ..#..",
	w: "..... ..... #...# #...# #.#.# #.#.# .#.#.",
	x: "..... ..... #...# .#.#. ..#.. .#.#. #...#",
	y: "..... ..... #...# #...# .#### ....# .###.",
	z: "..... ..... ##### ...#. ..#.. .#... #####",
	"[": ".###. .#... .#... .#... .#... .#... .###.",
	"]": ".###. ...#. ...#. ...#. ...#. ...#. .###.",
	">": "#.... .#... ..#.. ...#. ..#.. .#... #....",
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
 * @return {[number]} width [in font pixels, no trailing gap; at size k the text is textWidth * k grid pixels wide]
 */
function textWidth(text) {
	return Math.max(0, [...plain(text)].length * ADVANCE - 1);
}

/**
 * @description Whether the font has a character, so the console's input only takes what it can draw
 * @param  {[string]} char
 * @return {[boolean]}
 */
function drawable(char) {
	return typeof char === "string" && Object.hasOwn(GLYPHS, char);
}

/**
 * @description The lit pixels of a line of text. At size k each font pixel is a k x k block, and where two lit pixels touch only at a
 * corner, each of the two empty cells between them gains a one-pixel-stepped wedge, so large text reads smooth, not stepped
 * @param  {[string]} text
 * @param  {[number]} size [a whole number, 1 the plain font]
 * @return {[number[][]]} cells [[x, y] in grid pixels, (0, 0) the text's top left, each listed once]
 */
function textCells(text, size = 1) {
	const k = Number.isFinite(size) && size >= 1 ? Math.floor(size) : 1; // A BAD SIZE DRAWS PLAIN, NEVER FRACTIONAL OR ENDLESS
	const cells = [];
	const seen = new Set();
	const lit = (x, y) => { const key = `${x},${y}`; if (!seen.has(key)) { seen.add(key); cells.push([x, y]); } };
	[...plain(text)].forEach(function (char, n) {
		const rows = (Object.hasOwn(GLYPHS, char) ? GLYPHS[char] : BOX).split(" ");
		const on = (gx, gy) => rows[gy]?.[gx] === "#";
		const ox = n * ADVANCE * k;
		const wedge = (gx, gy, m) => { // FILLS THE PIXELS OF AN EMPTY CELL WHERE m(i, j) < k - 1
			for (let j = 0; j < k; j++) { for (let i = 0; i < k; i++) { if (m(i, j) < k - 1) { lit(ox + gx * k + i, gy * k + j); } } }
		};
		for (let gy = 0; gy < HEIGHT; gy++) {
			for (let gx = 0; gx < WIDTH; gx++) {
				if (on(gx, gy)) { wedge(gx, gy, () => -1); }
				if (k < 2) { continue; }
				const a = on(gx, gy), b = on(gx + 1, gy), d = on(gx, gy + 1), e = on(gx + 1, gy + 1); // THE 2 x 2 NEIGHBOURHOOD
				if (a && e && !b && !d) { wedge(gx + 1, gy, (i, j) => i + (k - 1 - j)); wedge(gx, gy + 1, (i, j) => (k - 1 - i) + j); }
				if (b && d && !a && !e) { wedge(gx, gy, (i, j) => (k - 1 - i) + (k - 1 - j)); wedge(gx + 1, gy + 1, (i, j) => i + j); }
			}
		}
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

export { GLYPHS, WIDTH, HEIGHT, ADVANCE, textWidth, textCells, fitText, drawable };
