/*
 * facing.js -- piece facing rules shared by the 2D draw paths
 */

/* ---------------------------------------------------------------- */
// Parsed response lists
/* ---------------------------------------------------------------- */
const parsedLists = new Map();

/** Parse a response list once until its raw value changes. */
function parseList(name, raw) {
	const cached = parsedLists.get(name);
	if (cached && cached.raw === raw) return cached.parsed;
	const parsed = JSON.parse(raw);
	parsedLists.set(name, { raw, parsed });
	return parsed;
}

/* ---------------------------------------------------------------- */
// Sliding piece facing
/* ---------------------------------------------------------------- */
function pieceRow(square, viewColor) {
	const rank = square.split("")[1];
	if (viewColor === 'w') return 8 - rank;
	if (viewColor === 'b') return rank - 1;
	return undefined;
}

/** Return row facing information for a king, queen, bishop, or rook. */
function pieceFacing(list, square, { viewColor, slide, landed }) {
	for (let n = 0; n < list.length; n++) {
		if (slide && slide.from[1] != slide.to[1]) {
			return { yFrom: pieceRow(slide.from, viewColor), yTo: pieceRow(slide.to, viewColor) };
		}
		if (list[n].from && list[n].to == square) {
			return { yFrom: pieceRow(list[n].from, viewColor), yTo: pieceRow(list[n].to, viewColor) };
		}
		if (list[n].from == null && list[n].to == square) return { yFrom: null, yTo: null };
		if (landed && square == landed.from && list[n].to == landed.to) {
			if (list[n].from) return { yFrom: pieceRow(list[n].from, viewColor), yTo: pieceRow(list[n].to, viewColor) };
			return { yFrom: undefined, yTo: undefined };
		}
	}
	return null;
}

/* ---------------------------------------------------------------- */
// Knight facing
/* ---------------------------------------------------------------- */
function knightColumn(square, color, viewColor) {
	const file = square.split("")[0].charCodeAt(0) - 96;
	if (color === 'w' && (viewColor === 'w' || viewColor === 'b')) return file - 1;
	if (color === 'b' && viewColor === 'w') return file - 1;
	if (color === 'b' && viewColor === 'b') return 8 - file;
	return undefined;
}

/** Return direction or starting side for a knight. */
function knightFacing(list, square, color, { viewColor, slide, landed }) {
	for (let n = 0; n < list.length; n++) {
		if (slide) return { kind: "dir", xFrom: knightColumn(slide.from, color, viewColor), xTo: knightColumn(slide.to, color, viewColor) };
		if (list[n].from && list[n].to == square) {
			return { kind: "dir", xFrom: knightColumn(list[n].from, color, viewColor), xTo: knightColumn(list[n].to, color, viewColor) };
		}
		if (list[n].from == null && list[n].to) {
			if (list[n].to == square && square.split("")[0] < 'e') {
				if (viewColor === 'w') return { kind: "side", side: "right" };
				if (viewColor === 'b') return { kind: "side", side: "left" };
			} else if (list[n].to == square) {
				if (viewColor === 'w') return { kind: "side", side: "left" };
				if (viewColor === 'b') return { kind: "side", side: "right" };
			}
		} else if (landed && square == landed.from && list[n].from && list[n].to == landed.to) {
			const from = color === 'w' ? list[n].from.split("")[0].charCodeAt(0) - 96 - 1 : knightColumn(list[n].from, color, viewColor);
			const to = color === 'w' ? list[n].to.split("")[0].charCodeAt(0) - 96 - 1 : knightColumn(list[n].to, color, viewColor);
			return { kind: "dir", xFrom: from, xTo: to };
		}
	}
	return null;
}

module.exports = { parseList, pieceFacing, knightFacing };
