/*
 *  board.js  --  chess cards engine
 *	Board shape and FEN. Index 0 = a8, 63 = h1.
 *
 */

/**
 * @description Square name for an index, e.g. 0 -> "a8"; null unless i is an integer 0..63.
 */
function sqName(i) {
	if (!Number.isInteger(i) || i < 0 || i > 63) return null;
	return "abcdefgh"[i % 8] + (8 - Math.floor(i / 8));
}

/**
 * @description Index for a square name, e.g. "a8" -> 0; -1 unless the name is a-h then 1-8.
 */
function sqIndex(name) {
	if (!/^[a-h][1-8]$/.test(name)) return -1;
	return (8 - Number(name[1])) * 8 + "abcdefgh".indexOf(name[0]);
}

/**
 * @description FEN without the move counters, used for repetition.
 */
function positionKey(b) {
	return toFen(b).split(" ").slice(0, 4).join(" ");
}

/**
 * @description Build a Board from a FEN; ids are numbered per colour in square order. Missing trailing fields default to "- - 0 1"; a bad FEN throws.
 */
function fromFen(fen) {
	const [placement, turn, castling = "-", ep = "-", half = "0", full = "1"] = fen.trim().split(/\s+/);
	const ranks = placement.split("/");
	if (ranks.length !== 8) throw new Error("FEN needs 8 ranks");
	if (turn !== "w" && turn !== "b") throw new Error("FEN turn must be w or b");
	if (castling !== "-" && !/^K?Q?k?q?$/.test(castling)) throw new Error("FEN castling field is not valid");
	if (ep !== "-" && !/^[a-h][36]$/.test(ep)) throw new Error("FEN en passant square is not valid");
	if (!/^\d+$/.test(half) || !/^\d+$/.test(full)) throw new Error("FEN counters must be non-negative integers");
	const sq = [], count = { w: 0, b: 0 };
	for (const rank of ranks) {
		let width = 0;
		for (const ch of rank) {
			if (/[1-8]/.test(ch)) { for (let n = 0; n < Number(ch); n++) sq.push(null); width += Number(ch); continue; }
			if (!"pnbrqkPNBRQK".includes(ch)) throw new Error("FEN piece letter " + ch + " is not valid");
			const c = ch === ch.toUpperCase() ? "w" : "b";
			sq.push({ id: c + ++count[c], c, t: ch.toLowerCase() });
			width++;
		}
		if (width !== 8) throw new Error("FEN rank " + rank + " is not 8 squares");
	}
	const b = { sq, turn, castling, ep: ep === "-" ? null : ep, half: Number(half), full: Number(full), history: [] };
	b.history.push(positionKey(b));
	return b;
}

/**
 * @description FEN string for a Board.
 */
function toFen(b) {
	const rows = [];
	for (let r = 0; r < 8; r++) {
		let row = "", empty = 0;
		for (let f = 0; f < 8; f++) {
			const p = b.sq[r * 8 + f];
			if (!p) { empty++; continue; }
			if (empty) { row += empty; empty = 0; }
			row += p.c === "w" ? p.t.toUpperCase() : p.t;
		}
		rows.push(row + (empty || ""));
	}
	return [rows.join("/"), b.turn, b.castling, b.ep || "-", b.half, b.full].join(" ");
}

/**
 * @description Square index of the piece with this id, or -1.
 */
function pieceById(b, id) {
	return b.sq.findIndex((p) => p && p.id === id);
}

module.exports = { fromFen, toFen, sqName, sqIndex, pieceById, positionKey };
