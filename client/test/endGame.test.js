// TASK 25 F10: THE SHARED RESULT REASONS (pages/utils/resultReasons.js, D16 / RD-M4), A CARD GAME'S RESULT LINE, A FAILED FORFEIT ON CARD GUY'S TURN (D15 / RD-M3)
// & RESTART'S 503 (CONTRACT d). endGame.js MIXES require & import: A LOAD HOOK TURNS ITS require LINES INTO imports & A RESOLVE HOOK SWAPS EVERY IMPORT BUT
// resultReasons.js FOR data: MODULES THAT READ & RECORD THROUGH globalThis.__F10 (NO DOM, NO SERVER)
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { registerHooks } = require("node:module");

const { RESULT_REASONS, reasonLine } = require("../src/js/pages/utils/resultReasons.js");

/* ---- the pure module ---- */

test("RESULT_REASONS keeps the chess server's words & adds the card engine's", () => {
	assert.deepEqual(RESULT_REASONS, {
		"checkmate": "by Checkmate",
		"stalemate": "by Stalemate",
		"insufficient material": "by insufficient material",
		"fifty-move rule": "by the fifty-move rule",
		"threefold repetition": "by threefold repetition",
		"agreement": "by agreement",
		"timeout": "on time",
		"king": "by taking the King",
		"repetition": "by threefold repetition",
		"fifty": "by the fifty-move rule",
		"material": "by insufficient material",
	});
});

test("reasonLine gives the line, or \"\" for a forfeit, null, an unknown word or an Object key", () => {
	assert.equal(reasonLine("king"), "by taking the King");
	assert.equal(reasonLine("checkmate"), "by Checkmate");
	assert.equal(reasonLine("fifty"), "by the fifty-move rule");
	for (const none of ["forfeit", null, undefined, "", "nope", "toString", "constructor", "__proto__"]) {
		assert.equal(reasonLine(none), "", String(none));
	}
});

/* ---- endGame.js on stubs ---- */

const el = () => ({ innerText: "", innerHTML: "", textContent: "", hidden: false, style: {}, parentElement: { hidden: false }, closest: () => ({ parentElement: {} }) });
const S = globalThis.__F10 = { calls: [], game: {}, turn: "b", newCards: [], forfeit: [], els: {} };
global.document = { getElementById: (id) => (S.els[id] = S.els[id] || el()), activeElement: null };
const BTN = S.restartBtn = el();
const STUBS = {
	"../state/index.js": "const S = globalThis.__F10; export const game = S.game; export const chessInst = { turn: () => S.turn }; export function stopFrames() { S.calls.push('stopFrames'); }",
	"../validate/index.js": "const S = globalThis.__F10; export async function forfeitGame() { S.calls.push('forfeit'); return S.forfeit.shift(); } export async function restartGame() {} export async function rematchGame() {} export async function cancelRematch() {}",
	"../cards/api.js": "const S = globalThis.__F10; export async function newCardsGame(url, color, level, replace) { S.calls.push(['newCards', replace]); return S.newCards.shift(); }",
	"../draw/index.js": "export function handleInitialData() {}",
	"../animate/index.js": "export function getRestartPieces() {} export function startRestartSlide() {}",
	"../moves/index.js": "export async function setInitialData() {} export async function refreshData() {}",
	"../../auth/index.js": "export class InternalAuth {}",
	"../../socket/index.js": "export function joinGame() {} export function leaveGame() {}",
	"../status/index.js": "const S = globalThis.__F10; export const MESSAGE_TIME = 1; export function showStatus(slot, text) { S.calls.push(['status', slot, text]); } export function clearStatus() {}",
	"../../pages/utils/confirm.js": "export function confirmPress() { return true; }",
	"../../pages/utils/menuItem.js": "const S = globalThis.__F10; export function setUnavailable() {} export function setFill() {} export function stopFill() {} export function isBusy() { return false; } export function fillThenGo(btn, href) { S.calls.push(['go', href]); }",
	"../renderer/index.js": "export function monitorState3D() { return 'off'; }",
	"./index.js": "const S = globalThis.__F10; export const optRestartBtn = S.restartBtn, optBtn = { style: {} }, nav = {}, optResumeBtn = {}, optHomepageBtn = {}, optHintBtn = {}, optTypeMoveBtn = {}, optEvalBarBtn = {}, socketHandlers = {}, optExitBtn = {}; export function moveInFlight() { return false; }",
	"./offers.js": "const S = globalThis.__F10; export function showGameOver(r) { S.calls.push('gameOver'); } export const optTakebackBtn = {}, optDrawBtn = {};",
};
const IS_END_GAME = (url) => url && url.endsWith("/gameplay/menu/endGame.js");
registerHooks({
	resolve: (specifier, context, next) => (IS_END_GAME(context.parentURL) && STUBS[specifier]
		? { url: "data:text/javascript," + encodeURIComponent(STUBS[specifier]), shortCircuit: true } : next(specifier, context)),
	load: (url, context, next) => {
		const out = next(url, context);
		if (!IS_END_GAME(url)) { return out; }
		const source = String(out.source).replace(/const (\{[^}]*\}) = require\(("[^"]+")\);/g, "import $1 from $2;"); // ESM CAN'T require
		return { ...out, format: "module", source };
	},
});
const endGame = require("../src/js/gameplay/menu/endGame.js");
const press = () => endGame.handleRestart({ preventDefault() {}, stopPropagation() {} });

beforeEach(() => {
	S.calls.length = S.forfeit.length = S.newCards.length = 0;
	S.turn = "b";
	for (const k of Object.keys(S.game)) { delete S.game[k]; }
	BTN.innerHTML = "";
});

test("a card game won by taking the King shows its line under the result", () => {
	endGame.showResult({ winner: "w", reason: "king" });
	assert.equal(endGame.resultDisplay.innerText, "White Wins!");
	assert.equal(endGame.resultReason.innerText, "by taking the King");
	assert.equal(endGame.resultReason.hidden, false);
	for (const [reason, line] of [["repetition", "by threefold repetition"], ["fifty", "by the fifty-move rule"], ["material", "by insufficient material"]]) {
		endGame.showResult({ winner: null, reason });
		assert.equal(endGame.resultDisplay.innerText, "Draw");
		assert.equal(endGame.resultReason.innerText, line);
	}
	endGame.showResult({ winner: "b", reason: "forfeit" });
	assert.equal(endGame.resultReason.innerText, "");
	assert.equal(endGame.resultReason.hidden, true);
});

test("a failed forfeit on Card Guy's turn doesn't block the next Forfeit", async () => {
	Object.assign(S.game, { ai: true, cardGame: { startColor: "w" }, playerColor: "w", gameOver: false });
	S.turn = "b"; // CARD GUY'S TURN
	S.forfeit.push({ status: 500, message: "down" }, { state: "CLOSED" });
	await press();
	assert.notEqual(S.game.aiTurn, true, "a card game's Card Guy turn is flow.js's, nothing would clear aiTurn");
	assert.deepEqual(S.calls.at(-1), ["status", "action", "The forfeit didn't go through. Try again."]);
	await press();
	assert.equal(S.calls.filter((c) => c === "forfeit").length, 2, "the second press reaches the server");
	assert.equal(S.calls.at(-1), "gameOver");
});

test("a card game with aiTurn left set still forfeits; a chess AI game still waits", async () => {
	Object.assign(S.game, { ai: true, cardGame: { startColor: "w" }, aiTurn: true, playerColor: "w", gameOver: false });
	S.forfeit.push({ state: "CLOSED" });
	await press();
	assert.deepEqual(S.calls, ["forfeit", "gameOver"]);
	S.calls.length = 0;
	delete S.game.cardGame;
	await press();
	assert.deepEqual(S.calls, [["status", "action", "Wait for the AI's move to finish."]]);
});

test("a chess AI game's failed forfeit on the AI's turn still hands the turn back to the AI", async () => {
	Object.assign(S.game, { ai: true, playerColor: "w", gameOver: false });
	S.turn = "b";
	S.forfeit.push(null);
	await press();
	assert.equal(S.game.aiTurn, true);
});

test("Restart's other failures keep today's line & clear the replace", async () => {
	Object.assign(S.game, { ai: true, gameOver: true, cardGame: { startColor: "w" }, response: { ai_level: 3 }, GAME_URL: "/api/chess" });
	S.newCards.push({ status: 500 }, { status: 200, game_id: "g3" });
	await press();
	assert.deepEqual(S.calls, [["newCards", false], ["status", "action", "A new game couldn't be started. Try again."]]);
	assert.equal(BTN.innerHTML, "Restart");
	S.calls.length = 0;
	await press();
	assert.deepEqual(S.calls[0], ["newCards", false]);
});

test("Restart's 503 shows its line & leaves Restart as it was (still Forfeit & restart, the next press replaces)", async () => {
	Object.assign(S.game, { ai: true, gameOver: true, cardGame: { startColor: "w" }, response: { ai_level: 3 }, GAME_URL: "/api/chess" });
	S.newCards.push({ status: 409, message: "open" }, { status: 503, message: "Your other game couldn't be closed. Try again." }, { status: 200, game_id: "g2" });
	await press();
	assert.equal(BTN.innerHTML, "Forfeit & restart");
	S.calls.length = 0;
	await press();
	assert.deepEqual(S.calls, [["newCards", true], ["status", "action", "Your other game couldn't be closed. Try again."]]);
	assert.equal(BTN.innerHTML, "Forfeit & restart");
	S.calls.length = 0;
	await press();
	assert.deepEqual(S.calls, [["newCards", true], "stopFrames", ["go", "/play/g2"]]);
});

test("a 503 on a first press (no replace asked: the data service is down) is not the forfeit's: the plain line, the next press still asks first", async () => {
	Object.assign(S.game, { ai: true, gameOver: true, cardGame: { startColor: "w" }, response: { ai_level: 3 }, GAME_URL: "/api/chess" });
	S.newCards.push({ status: 500 }, { status: 503, message: "Try again in a moment" }, { status: 409, message: "open" });
	await press(); // ANY OTHER FAILURE PUTS replaceOpen BACK TO false
	S.calls.length = 0;
	await press();
	assert.deepEqual(S.calls.filter((c) => c[0] === "newCards" || c[0] === "status"), [["newCards", false], ["status", "action", "A new game couldn't be started. Try again."]]);
	S.calls.length = 0;
	await press();
	assert.deepEqual(S.calls.filter((c) => c[0] === "newCards"), [["newCards", false]]);
	assert.equal(BTN.innerHTML, "Forfeit & restart");
});
