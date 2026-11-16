/*
 *  positions.js  --  chess frontend
 *	Replay Positions
 *	Every position of a game for the replay viewer (/replay/:gameId): its board, the move that led to it & which way each piece
 *	faces. Uses the server's own facing rules (server/utils/validate.js, webpack bundles it), so a replayed position faces exactly
 *	like the game did. No page state, the server tests run it
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { Chess, DEFAULT_POSITION } = require("chess.js"); // SAME VERSION AS THE SERVER
const { startPieces, faceMove } = require("../../../../../server/utils/validate.js"); // THE FACING RULES A MOVE & AN UNDO USE ON THE SERVER

const MOVE_FIELDS = ["color", "piece", "from", "to", "san", "captured", "promotion", "flags"]; // WHAT EACH POSITION KEEPS OF ITS MOVE (FOR THE SLIDES)

/* ---------------------------------------------------------------- */
// Build Positions
/* ---------------------------------------------------------------- */
/**
 * @description Plays a game's saved moves from its start position & keeps every position on the way, the start first
 * @param  {[array]} moves [the game's SAN moves]
 * @param  {[string]} startFen [a set position's FEN, left out = the standard position]
 * @return {[array]} positions [{ fen, move, facing }: move is null at the start, else { color, piece, from, to, san, captured, promotion, flags }
 * (every key there, undefined when unset), facing is { w_knight, b_knight, w_piece, b_piece } arrays of { from, to }, a copy for each position].
 * Throws when a saved move can't be played
 */
function buildPositions(moves, startFen) {
	const fen = startFen || DEFAULT_POSITION;
	const chess = new Chess(fen);
	const facing = startPieces(fen);
	const positions = [{ fen: chess.fen(), move: null, facing: structuredClone(facing) }];
	for (const san of moves || []) {
		const played = chess.move(san); // THROWS IF IT ISN'T LEGAL HERE
		faceMove(facing, played); // CHANGES facing IN PLACE
		const move = {};
		for (const field of MOVE_FIELDS) { move[field] = played[field]; }
		positions.push({ fen: chess.fen(), move, facing: structuredClone(facing) });
	}
	return positions;
}

/**
 * @description Do the saved moves lead to the saved board? Old or damaged data doesn't, its replay would show the wrong positions
 * @param  {[array]} positions [from buildPositions]
 * @param  {[string]} gameBoard [the game's saved FEN]
 * @return {[boolean]}
 */
function checkReplay(positions, gameBoard) {
	return positions.length > 0 && positions[positions.length - 1].fen === gameBoard;
}

/* ---------------------------------------------------------------- */
// Move Label
/* ---------------------------------------------------------------- */
/**
 * @description The move that led to a position, numbered from the position it was played in: "12. Nf3" for white, "12... Nxe4" for black
 * @param  {[array]} positions [from buildPositions]
 * @param  {[number]} i [the position, 0 = the start]
 * @return {[string]} label ["Start" at the start]
 */
function moveLabel(positions, i) {
	if (!i || !positions[i]?.move) { return "Start"; }
	const fields = positions[i - 1].fen.split(" "); // SIDE TO MOVE & MOVE NUMBER WHEN IT WAS PLAYED
	return `${fields[5]}${fields[1] === "w" ? "." : "..."} ${positions[i].move.san}`;
}

/* ---------------------------------------------------------------- */
// Face Pair
/* ---------------------------------------------------------------- */
/**
 * @description Stepping back, a piece slides from its move's to square back to its from square still facing the way it did before the move
 * (a knight hops backwards). The 2D board faces a sliding piece the way two squares go (gameplay/draw slideFace: a knight by their files, a
 * king, queen, bishop or rook by their ranks), so this gives two squares that point the way its facing list said before the move
 * @param  {[object]} facingBefore [the facing lists of the position before the move]
 * @param  {[object]} move [the move being taken back, from buildPositions]
 * @return {[object|null]} pair [{ from, to }, null for a pawn or a promotion (it slides back as a pawn, pawns always face the other side)]
 */
function facePair(facingBefore, move) {
	if (!move || move.promotion || move.piece === "p") { return null; }
	const [file, rank] = move.from;
	if (move.piece === "n") {
		const entry = facingBefore[`${move.color}_knight`].find(function (e) { return e.to === move.from; });
		if (entry?.from) { return { from: entry.from, to: entry.to }; } // FACES THE WAY ITS LAST MOVE WENT
		const toward = file < "e" ? 1 : -1; // HASN'T MOVED: THE a - d FILES FACE THE h-FILE, e - h THE a-FILE (THE MIDDLE)
		return { from: move.from, to: `${String.fromCharCode(file.charCodeAt(0) + toward)}${rank}` };
	}
	const entry = facingBefore[`${move.color}_piece`].find(function (e) { return e.to === move.from; });
	if (entry?.from) { return { from: entry.from, to: entry.to }; } // FACES THE WAY ITS LAST MOVE UP OR DOWN WENT
	return move.color === "w" ? { from: `${file}1`, to: `${file}2` } : { from: `${file}8`, to: `${file}7` }; // HASN'T MOVED UP OR DOWN: FACES THE OTHER SIDE
}

/* ---------------------------------------------------------------- */
// Step Plan
/* ---------------------------------------------------------------- */
/**
 * @description How the board gets from one position to another: one step slides (forward plays the move, back slides it in reverse),
 * anything further, or a step while animating is off (a held key, a click during a slide), is set at once so slides never queue
 * @param  {[array]} positions [from buildPositions]
 * @param  {[number]} index [the position on the board]
 * @param  {[number]} target [the position to go to, clamped to the game]
 * @param  {[object]} options [{ animate }]
 * @return {[object|null]} plan [{ kind: "forward", move } | { kind: "back", move, face } (move: the one being taken back, face: facePair()) |
 * { kind: "jump", target }, null when the target is the position on the board]
 */
function stepPlan(positions, index, target, { animate }) {
	const to = Math.min(Math.max(target, 0), positions.length - 1);
	if (to === index) { return null; }
	if (animate && to === index + 1) { return { kind: "forward", move: positions[to].move }; }
	if (animate && to === index - 1) { return { kind: "back", move: positions[index].move, face: facePair(positions[to].facing, positions[index].move) }; }
	return { kind: "jump", target: to };
}


module.exports = { buildPositions, checkReplay, moveLabel, facePair, stepPlan };
