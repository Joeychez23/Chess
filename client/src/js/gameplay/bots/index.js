/*
 *  index.js  --  chess frontend
 *	AI Bots (#76)
 *	Each AI level is a bot (server/utils/bots.js, sent by GET /api/chess/levels). This picks a game's bot & when it speaks, from the moves.
 *	& the face the 3D board's monitor makes. No DOM & no process.env here, so the tests load it in Node (client/test/bots.test.js). The page side is say.js
 *
 */

/**
 * @description The bot that plays at a level
 * @param  {[object]} levelsResponse [GET /levels, { levels: [{ level, name, ... }], old_levels }]
 * @param  {[any]} aiLevel [the game's ai_level, a game saved with the 8 old levels (1 - 8) has one of those]
 * @return {[object]} bot [the level from levels, null when there isn't one or the levels didn't load]
 */
function botFor(levelsResponse, aiLevel) {
	if (!Array.isArray(levelsResponse?.levels) || aiLevel === null || aiLevel === undefined) { return null; }
	const oldLevels = levelsResponse.old_levels || {};
	const level = Number(Object.hasOwn(oldLevels, aiLevel) ? oldLevels[aiLevel] : aiLevel);
	return levelsResponse.levels.find((bot) => bot.level === level) || null;
}

/**
 * @description What the bot says about its own move. Mate beats check, check beats a capture (a capture that checks says check)
 * @param  {[object]} move [chess.js verbose move just played]
 * @param  {[object]} chess [chess.js board after the move]
 * @param  {[string]} botColor ["w" | "b"]
 * @return {[string]} moment ["win" | "check" | "capture" | null (nothing to say, or the player's move)]
 */
function momentFor(move, chess, botColor) {
	if (!move || move.color !== botColor) { return null; }
	if (chess.isCheckmate()) { return "win"; }
	if (chess.isCheck()) { return "check"; }
	if (move.captured) { return "capture"; }
	return null;
}

/**
 * @description What the bot says when the game ends
 * @param  {[object]} result [showGameOver's { winner: "w" | "b" | "draw" }]
 * @param  {[string]} botColor ["w" | "b"]
 * @return {[string]} moment ["win" | "lose" | null (a draw)]
 */
function endMomentFor(result, botColor) {
	if (result?.winner !== "w" && result?.winner !== "b") { return null; }
	return result.winner === botColor ? "win" : "lose";
}

/**
 * @description One of the bot's lines for a moment
 * @param  {[object]} bot [from botFor]
 * @param  {[string]} moment ["start" | "capture" | "check" | "win" | "lose"]
 * @param  {[function]} random [0 - 1, Math.random]
 * @return {[string]} line [null when the bot has none]
 */
function pickLine(bot, moment, random = Math.random) {
	const lines = bot?.lines?.[moment];
	if (!Array.isArray(lines) || !lines.length) { return null; }
	return lines[Math.min(lines.length - 1, Math.floor(random() * lines.length))];
}

/**
 * @description The face the 3D board's monitor makes at a move by either side (three/faces.js has the faces). Mate beats check, check beats a capture, like momentFor
 * @param  {[object]} move [chess.js verbose move just played]
 * @param  {[object]} chess [chess.js board after the move]
 * @param  {[string]} botColor ["w" | "b"]
 * @return {[string]} face ["happy" | "sad" | "angry" | "won" | "lost" | null (a quiet move: no change)]
 */
function faceFor(move, chess, botColor) {
	if (!move) { return null; }
	const bots = move.color === botColor;
	if (chess.isCheckmate()) { return bots ? "won" : "lost"; }
	if (chess.isCheck()) { return bots ? "happy" : "angry"; }
	if (!move.captured) { return null; }
	if (bots) { return "happy"; }
	return move.captured === "r" || move.captured === "q" ? "angry" : "sad"; // LOSING A ROOK OR QUEEN STINGS
}

/**
 * @description The monitor's face when the game ends, held until the next game
 * @param  {[object]} result [showGameOver's { winner: "w" | "b" | "draw" }]
 * @param  {[string]} botColor ["w" | "b"]
 * @return {[string]} face ["won" | "lost" | "neutral" (a draw) | null (no result)]
 */
function endFaceFor(result, botColor) {
	if (result?.winner === "draw") { return "neutral"; }
	if (result?.winner !== "w" && result?.winner !== "b") { return null; }
	return result.winner === botColor ? "won" : "lost";
}

module.exports = { botFor, momentFor, endMomentFor, pickLine, faceFor, endFaceFor };
