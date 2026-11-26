// TASK 25 F6: cards/flow.js, CARD GUY'S LOOP & act ON ANSWERS THAT THROW, FINAL REFUSALS & LOST ANSWERS (RD-I1, RD-M1, RD-M2), A LOST TURN TOLD (RA-I1),
// A FINISHED GAME OF AN OLDER ENGINE VERSION OPENED READ-ONLY (CONTRACT c) & THE BARE DESK'S TAP (T25-M5). flow.js IS AN ES MODULE THAT ALSO require()s: ITS SOURCE IS
// COMPILED AS CommonJS WITH ITS export KEYWORDS STRIPPED, ITS IMPORTS STUBBED (THE REAL store.js, select.js, duelShow.js & boardShow.js), ITS TIMERS AT 0 MS (scratch-t25-RD/harness.js)
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module");

const G = path.join(__dirname, "../src/js/gameplay");
const realTimeout = global.setTimeout;
global.setTimeout = (fn) => realTimeout(fn, 0); // CARD_GUY_WAIT & RETRY_WAIT AT ONCE
global.document = { getElementById: () => null, querySelectorAll: () => [], activeElement: null };

const log = [];
const game = { GAME_URL: "/api/chess", GAME_ID: "g1", gameOver: false };
const chess = { loads: [], throwOnce: false };
const api = { calls: { action: 0, cardGuy: 0, get: 0 }, cardGuyAnswers: [], actionAnswers: [], getAnswers: [] };
const next = (list) => { const a = list.length > 1 ? list.shift() : list[0]; return typeof a === "function" ? a() : a; }; // THE LAST ANSWER REPEATS
let tablePick = null;
const stubs = {
	[path.join(G, "state/index.js")]: { game, chessInst: { load(fen) { if (chess.throwOnce) { chess.throwOnce = false; throw new Error("boom in show"); } chess.loads.push(fen); } } },
	[path.join(G, "cards/api.js")]: {
		sendAction: async () => { api.calls.action++; return next(api.actionAnswers); },
		cardGuyTurn: async () => { api.calls.cardGuy++; return next(api.cardGuyAnswers); },
		getCardsGame: async () => { api.calls.get++; return next(api.getAnswers); },
		getCardGuy: async () => ({ name: "Card Guy" }),
	},
	[path.join(G, "bots/say.js")]: { showBot() {} },
	[path.join(G, "menu/offers.js")]: { showGameOver(r) { log.push(["gameOver", r]); game.gameOver = true; } },
	[path.join(G, "status/index.js")]: { showStatus: (k, m) => log.push(["status", k, m]), clearStatus: (k) => log.push(["clear", k]), MESSAGE_TIME: 1 },
	[path.join(G, "renderer/index.js")]: new Proxy({}, { get: (o, k) => k === "onTablePick" ? (fn) => { tablePick = fn; } : k === "boardStep3D" ? async () => {} : () => { log.push(["renderer", k]); return false; } }),
	[path.join(G, "three/tableLayout.js")]: { plaqueAnchor: () => null },
	[path.join(G, "three/cardFaces.js")]: { rarityColor: () => "" },
	[path.join(G, "validate/index.js")]: { forfeitGame: async () => ({ status: 200 }) },
};
const origLoad = Module._load;
Module._load = function (req, parent, ...rest) {
	let f; try { f = Module._resolveFilename(req, parent); } catch { f = null; }
	return f && stubs[f] ? stubs[f] : origLoad.call(this, req, parent, ...rest);
};
const FILE = path.join(G, "cards/flow.js");
const src = fs.readFileSync(FILE, "utf8").replace(/^export (async )?function /gm, (m, a) => `${a || ""}function `) + "\nmodule.exports = { startCards, act, playCardGuy };";
const m = new Module(FILE, module); m.filename = FILE; m.paths = Module._nodeModulePaths(path.dirname(FILE));
m._compile(src, FILE);
Module._load = origLoad;
const flow = m.exports;
const { cards } = require("../src/js/gameplay/cards/store.js");
const settle = () => new Promise((r) => realTimeout(r, 30));

const board = (turn) => ({ sq: Array(64).fill(null), turn, castling: "-", ep: null, half: 0, full: 1, hidden: 0 });
const view = (turn) => ({ board: board(turn), players: { w: {}, b: {} }, duel: null, result: null, effects: [], piled: [] });
const answer = (extra = {}) => ({ status: 200, you: "w", view: view("b"), legal: [], card_guy_due: false, result: null, events: [], ...extra });
const statuses = () => log.filter((l) => l[0] === "status").map((l) => l[2]);
const OLDER = "This Chess Cards game is from an older version and can't go on.", NOT_LOADED = "The game couldn't be loaded. Reload the page to try again.";

beforeEach(async () => {
	game.gameOver = true; // ANY LOOP STILL RUNNING STOPS
	await settle();
	game.gameOver = false;
	Object.assign(cards, { view: null, legal: [], you: null, result: null, cardGuyDue: false, hidden: false, catalog: {} });
	Object.assign(api.calls, { action: 0, cardGuy: 0, get: 0 });
	api.cardGuyAnswers = []; api.actionAnswers = []; api.getAnswers = [];
	chess.loads = []; chess.throwOnce = false;
	log.length = 0;
});

/* ---- A5 (RD-I1): an answer whose show throws doesn't stop Card Guy for good ---- */

test("a throw showing Card Guy's answer tells the player & he is asked again", async () => {
	let n = 0;
	api.cardGuyAnswers = [() => { n++; if (n === 1) { chess.throwOnce = true; } return answer({ card_guy_due: n < 3 }); }];
	flow.startCards(answer({ card_guy_due: true }));
	await settle(); await settle();
	assert.equal(api.calls.cardGuy, 3);
	assert.ok(log.some((l) => l[0] === "status" && l[1] === "ai" && /couldn't be shown/.test(l[2])));
	assert.equal(cards.cardGuyDue, false);
});

test("a throw showing the player's own answer still starts Card Guy's loop", async () => {
	flow.startCards(answer({ view: view("w") }));
	chess.throwOnce = true;
	api.actionAnswers = [answer({ card_guy_due: true })];
	api.cardGuyAnswers = [answer()];
	await flow.act({ type: "move", from: "e2", to: "e4" });
	await settle();
	assert.equal(api.calls.cardGuy, 1);
	assert.ok(statuses().some((s) => /couldn't be shown/.test(s)));
});

/* ---- D13 (RD-M1): a final refusal with no view stops the loop & act ---- */

test("the older-version 409 from /card-guy is asked once & offers the forfeit", async () => {
	api.cardGuyAnswers = [{ status: 409, game_id: "g1", message: "This game is from an older version" }];
	flow.startCards(answer({ card_guy_due: true }));
	await settle(); await settle();
	assert.equal(api.calls.cardGuy, 1);
	assert.ok(statuses().includes(OLDER));
	assert.ok(!statuses().includes("Card Guy isn't answering. Trying again…"));
});

for (const status of [404, 403]) {
	test(`a ${status} from /card-guy is asked once & says the game couldn't be loaded`, async () => {
		api.cardGuyAnswers = [{ status, message: "no" }];
		flow.startCards(answer({ card_guy_due: true }));
		await settle(); await settle();
		assert.equal(api.calls.cardGuy, 1);
		assert.ok(statuses().includes(NOT_LOADED));
	});
}

test("no answer or a 5xx from /card-guy is still asked again", async () => {
	api.cardGuyAnswers = [undefined, { status: 500, serverError: true }, answer()];
	flow.startCards(answer({ card_guy_due: true }));
	await settle(); await settle();
	assert.equal(api.calls.cardGuy, 3);
	assert.ok(statuses().includes("Card Guy isn't answering. Trying again…"));
});

test("act on the older-version 409 offers the forfeit, no retry message, no re-read", async () => {
	flow.startCards(answer({ view: view("w") }));
	api.actionAnswers = [{ status: 409, game_id: "g1", message: "This game is from an older version" }];
	assert.deepEqual(await flow.act({ type: "move", from: "e2", to: "e4" }), []);
	assert.ok(statuses().includes(OLDER));
	assert.ok(!statuses().includes("That didn't go through. Try again."));
	assert.equal(api.calls.get, 0);
});

test("act on a 404 says the game couldn't be loaded, no re-read", async () => {
	flow.startCards(answer({ view: view("w") }));
	api.actionAnswers = [{ status: 404, message: "gone" }];
	assert.deepEqual(await flow.act({ type: "move", from: "e2", to: "e4" }), []);
	assert.ok(statuses().includes(NOT_LOADED));
	assert.equal(api.calls.get, 0);
});

/* ---- D14 (RD-M2): a lost answer re-reads the game & goes on from it ---- */

test("an action's lost answer re-reads the game once & asks Card Guy when he is owed", async () => {
	flow.startCards(answer({ view: view("w") }));
	api.actionAnswers = [undefined];
	api.getAnswers = [answer({ card_guy_due: true })];
	api.cardGuyAnswers = [answer()];
	await flow.act({ type: "move", from: "e2", to: "e4" });
	await settle();
	assert.equal(api.calls.get, 1);
	assert.equal(api.calls.cardGuy, 1);
	assert.ok(!statuses().includes("That didn't go through. Try again.")); // THE RE-READ SHOWS THE GAME MOVED ON: THE PLAY WAS SAVED (F6-M3)
});

test("a lost answer whose re-read is lost too changes nothing & asks nothing more", async () => {
	flow.startCards(answer({ view: view("w") }));
	api.actionAnswers = [undefined];
	api.getAnswers = [undefined];
	assert.deepEqual(await flow.act({ type: "move", from: "e2", to: "e4" }), []);
	await settle();
	assert.equal(api.calls.get, 1);
	assert.equal(api.calls.cardGuy, 0);
});

test("a lost answer whose re-read is the older-version 409 offers the forfeit", async () => {
	flow.startCards(answer({ view: view("w") }));
	api.actionAnswers = [undefined];
	api.getAnswers = [{ status: 409, game_id: "g1", message: "older" }];
	await flow.act({ type: "move", from: "e2", to: "e4" });
	assert.ok(statuses().includes(OLDER));
});

/* ---- A7 (RA-I1): a lost turn is told, contract (f) ---- */

test("a turn-skipped event tells whose turn was lost, once per event", async () => {
	flow.startCards(answer({ view: view("w") }));
	api.actionAnswers = [answer({ view: view("w"), events: [{ type: "turn-skipped", player: "b" }] })];
	await flow.act({ type: "move", from: "e2", to: "e4" });
	assert.deepEqual(statuses().filter((s) => /loses? this turn/.test(s)), ["Card Guy loses this turn."]);
	log.length = 0;
	api.actionAnswers = [answer({ card_guy_due: true })];
	api.cardGuyAnswers = [answer({ events: [{ type: "turn-skipped", player: "w" }], card_guy_due: true }), answer({ view: view("w") })];
	await flow.act({ type: "move", from: "d2", to: "d4" });
	await settle();
	assert.deepEqual(statuses().filter((s) => /loses? this turn/.test(s)), ["You lose this turn."]);
	assert.ok(log.some((l) => l[0] === "status" && l[1] === "action" && l[2] === "You lose this turn."));
});

/* ---- A2 / contract (c): a finished game of an older version opens read-only ---- */

test("a finished older-version game opens read-only: sides, the board from fen, the result, no forfeit, no table, no Card Guy", async () => {
	const fen = "4k3/8/8/8/8/8/8/4K3 w - - 0 1", result = { winner: "w", reason: "king" };
	const loaded = flow.startCards({ status: 200, game_id: "g1", older: true, you: "b", fen, result, message: "This game is from an older version" });
	await settle();
	assert.equal(loaded, true);
	assert.equal(game.playerColor, "b");
	assert.equal(game.opponentColor, "w");
	assert.deepEqual(chess.loads, [fen]);
	assert.deepEqual(log.filter((l) => l[0] === "gameOver"), [["gameOver", result]]);
	assert.ok(!statuses().includes(OLDER));
	assert.ok(!log.some((l) => l[0] === "renderer" && l[1] === "setTable3D"));
	assert.equal(api.calls.cardGuy, 0);
});

test("an open older-version game (the 409, no result) still offers the forfeit", () => {
	assert.equal(flow.startCards({ status: 409, game_id: "g1", message: "This game is from an older version" }), false);
	assert.ok(statuses().includes(OLDER));
});

/* ---- T25-M5: flow.js:231's desk branch, kept as it is ---- */

test("the bare desk tapped while the promotion cards are out puts them back; with none out it does nothing", () => {
	const promos = ["q", "r", "b", "n"].map((p) => ({ type: "move", from: "e7", to: "e8", promotion: p }));
	const v = view("w"); v.board.sq[52] = { t: "p", c: "w", id: "wp5" };
	flow.startCards(answer({ view: v, legal: promos }));
	tablePick({ kind: "desk" });
	assert.equal(game.currPromotion, undefined);
	tablePick({ kind: "square", square: "e7", touch: true });
	tablePick({ kind: "square", square: "e8", touch: true });
	assert.equal(game.currPromotion, true);
	tablePick({ kind: "desk" });
	assert.equal(game.currPromotion, false);
});

/* ---- the F6 review's Minors ---- */

test("after a throw showing an answer the board is drawn once more from the answer's view (the turn may be the player's again)", async () => {
	flow.startCards(answer({ view: view("w") }));
	const before = chess.loads.length;
	chess.throwOnce = true;
	api.actionAnswers = [answer({ view: view("w") })]; // THE TURN COMES BACK: NO LATER ANSWER WOULD REDRAW IT
	await flow.act({ type: "move", from: "e2", to: "e4" });
	await settle();
	assert.equal(chess.loads.length, before + 1);
	let n = 0;
	api.cardGuyAnswers = [() => { n++; chess.throwOnce = true; return answer({ view: view("w") }); }];
	cards.cardGuyDue = true;
	const loads = chess.loads.length;
	await flow.playCardGuy();
	assert.equal(chess.loads.length, loads + 1);
	assert.ok(log.some((l) => l[0] === "status" && l[1] === "ai" && /Reload the page if the board looks wrong/.test(l[2])));
});

test("a lost answer whose re-read shows the play was saved isn't called a failure; one that shows nothing changed is", async () => {
	flow.startCards(answer({ view: view("w") }));
	api.actionAnswers = [undefined];
	api.getAnswers = [answer({ view: view("b") })]; // THE GAME MOVED ON: THE PLAY LANDED
	await flow.act({ type: "move", from: "e2", to: "e4" });
	await settle();
	assert.ok(!statuses().includes("That didn't go through. Try again."));
	api.getAnswers = [answer({ view: view("b") })]; // THE SAME AGAIN: NOTHING LANDED
	await flow.act({ type: "move", from: "e7", to: "e5" });
	await settle();
	assert.ok(statuses().includes("That didn't go through. Try again."));
});

test("a 401 that is still a 401, & /card-guy's 400, stop the loop too; act stops on the 401 but a 400 there is not final", async () => {
	for (const status of [401, 400]) {
		api.calls.cardGuy = 0; log.length = 0;
		api.cardGuyAnswers = [{ status, message: "no" }];
		flow.startCards(answer({ card_guy_due: true }));
		await settle(); await settle();
		assert.equal(api.calls.cardGuy, 1, "asked once on " + status);
		assert.ok(statuses().includes(NOT_LOADED));
		cards.cardGuyDue = false;
	}
	flow.startCards(answer({ view: view("w") }));
	log.length = 0; api.calls.get = 0;
	api.actionAnswers = [{ status: 401, message: "no" }];
	assert.deepEqual(await flow.act({ type: "move", from: "e2", to: "e4" }), []);
	assert.equal(api.calls.get, 0);
	assert.ok(statuses().includes(NOT_LOADED));
	api.actionAnswers = [{ status: 400, message: "bad" }];
	api.getAnswers = [answer({ view: view("w") })];
	await flow.act({ type: "move", from: "e2", to: "e4" });
	assert.equal(api.calls.get, 1); // NOT FINAL: THE GAME IS READ AGAIN
});

test("a finished older-version game with no stored board (fen null) still opens with its result, no throw", async () => {
	const result = { winner: null, reason: "forfeit" };
	assert.equal(flow.startCards({ status: 200, game_id: "g1", older: true, you: "w", fen: null, result, message: "This game is from an older version" }), true);
	await settle();
	assert.deepEqual(chess.loads, []);
	assert.deepEqual(log.filter((l) => l[0] === "gameOver"), [["gameOver", result]]);
});
