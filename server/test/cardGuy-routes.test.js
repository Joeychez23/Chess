/*
 *  cardGuy-routes.test.js  --  chess server tests
 *	Card Guy's turn & profile routes (POST /api/chess/cards/:gameId/card-guy, GET /api/chess/cards/card-guy, server/controllers/cardsController.js)
 *  Real requests to the API, with the tables in memory and the real rules engine (cards-engine/). The chess engine is down unless a test says so: Card Guy plays by its static & card scores
 *
 */

require("./helpers/env.js");
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const testServer = require("./helpers/server.js");
const { player, peek, poke, engineCalls, dataServiceWillWait } = testServer;
const E = require("../../cards-engine/index.js");
const hand = require("../../cards-engine/hand.js");
const { fromFen, sqIndex } = require("../../cards-engine/board.js");
const bot = require("../utils/card-guy/index.js");

let server, me;
before(async () => { server = await testServer.start(); });
after(() => server.close());
beforeEach(() => { testServer.reset(); process.env.CARDS_TEST_SEED = "1"; me = player("me"); });
const call = (method, path, options = {}) => testServer.call(method, path, options.as || options.guest || options.cookie ? options : { ...options, as: me }); // SIGNED IN AS me UNLESS TOLD: GUESTS CAN'T PLAY CHESS CARDS (#491), AS cards-routes.test.js // ONE KNOWN DEAL, AS cards-routes.test.js

const stored = (gameId) => JSON.parse(peek("chess_db", gameId).cards_state.S);
const store = (gameId, state) => poke("chess_db", gameId, { cards_state: { S: JSON.stringify(state) } });
const version = (gameId) => peek("chess_db", gameId).cards_version.N;
const start = (body = {}) => call("POST", "/api/chess/cards", { body: { start_color: "w", replace_current: true, ...body } }); // replace_current: A SIGNED IN PLAYER HAS ONE OPEN GAME, A TEST'S SECOND GAME FORFEITS ITS FIRST
const act = (gameId, action) => call("POST", `/api/chess/cards/${gameId}/action`, { body: { action } });
const load = (gameId) => call("GET", `/api/chess/cards/${gameId}`);
const turn = (gameId, options = {}) => call("POST", `/api/chess/cards/${gameId}/card-guy`, options);
const body = (response) => ({ mode: response.mode, you: response.you, view: response.view, legal: response.legal, legal_hidden: response.legal_hidden, events: response.events, card_guy_due: response.card_guy_due, result: response.result });
const expected = (state, color, events = []) => { // WHAT A RESPONSE MUST HOLD FOR color ON THIS STATE (THE STORED GAME STILL OPEN)
	const cardGuy = color === "w" ? "b" : "w";
	return { mode: "cards", you: color, view: E.playerView(state, color), legal: E.playerLegal(state, color), legal_hidden: state.enchant.some((e) => e.key.startsWith("fog-of-war") && e.owner === cardGuy), events: E.playerEvents(state, events, color), card_guy_due: E.legalActions(state, cardGuy).length > 0, result: state.result };
};

/**
 * @description A game where Card Guy (Black) owes its first action: the player made their first move
 */
async function cardGuyToMove() {
	const created = await start();
	const moved = await act(created.game_id, E.legalActions(stored(created.game_id), "w").find((a) => a.type === "move"));
	assert.equal(moved.card_guy_due, true);
	return created.game_id;
}

test("two concurrent /card-guy calls play one turn, and both get it", async () => {
	const gameId = (await start({ start_color: "b" })).game_id; // CARD GUY IS WHITE: IT MOVES FIRST
	const hold = dataServiceWillWait(`/games/${gameId}/cards`); // THE FIRST CALL'S TURN IS RUNNING UNTIL ITS SAVE IS LET GO
	const first = turn(gameId);
	await hold.reached;
	const second = turn(gameId);
	await load(gameId); await load(gameId); // THE SECOND CALL HAS READ THE GAME BY NOW: IT WAITS ON THE RUNNING TURN
	hold.release();
	const [a, b] = await Promise.all([first, second]);
	assert.equal(a.http, 200);
	assert.deepEqual(b, a);
	assert.ok(a.events.length > 0);
	assert.equal(version(gameId), "2");
	assert.deepEqual(body({ ...a, events: [] }), expected(stored(gameId), "b"));
});

test("a reload while Card Guy's turn is due, then /card-guy, plays it once; asking again changes nothing", async () => {
	const gameId = (await start({ start_color: "b" })).game_id;
	const reloaded = await load(gameId);
	assert.equal(reloaded.card_guy_due, true);
	assert.equal(version(gameId), "1");

	const played = await turn(gameId);
	assert.equal(played.http, 200);
	assert.equal(played.status, 200);
	assert.ok(played.events.some((e) => e.player === "w"));
	assert.equal(version(gameId), "2");
	const after = stored(gameId);
	assert.deepEqual(body({ ...played, events: [] }), expected(after, "b"));

	if (!played.card_guy_due) { // ONE CALL PLAYS ONE ACTION: card_guy_due SAYS WHETHER TO CALL AGAIN
		const again = await turn(gameId);
		assert.equal(again.http, 200);
		assert.deepEqual(body(again), expected(after, "b"));
		assert.equal(version(gameId), "2");
	}
});

test("/card-guy when it isn't Card Guy's turn, or the game is over, changes nothing", async () => {
	const created = await start();
	const before = stored(created.game_id);
	const spy = test.mock.method(bot, "cardGuyTurn");
	try {
		const idle = await turn(created.game_id);
		assert.equal(idle.http, 200);
		assert.deepEqual(body(idle), expected(before, "w"));

		const gameId = await cardGuyToMove(); // CARD GUY IS DUE, THEN THE PLAYER FORFEITS
		const due = stored(gameId);
		assert.equal((await call("POST", `/api/chess/game/${gameId}/forfeit`)).http, 200);
		const over = await turn(gameId);
		assert.equal(over.http, 200);
		assert.deepEqual([over.card_guy_due, over.legal, over.events, over.result], [false, [], [], { winner: "b", reason: "forfeit" }]);
		assert.deepEqual(stored(gameId), due);
		assert.equal(version(gameId), "2");

		assert.equal(spy.mock.callCount(), 0); // CARD GUY IS NEVER ASKED: IT THROWS FOR BOTH
		assert.deepEqual(stored(created.game_id), before);
		assert.equal(version(created.game_id), "1");
	} finally { spy.mock.restore(); }
});

test("only the game's player gets Card Guy to play", async () => {
	const gameId = await cardGuyToMove();
	assert.equal((await turn(gameId, { guest: "other" })).http, 401);
	assert.equal((await turn("no-such-game")).http, 404);
	assert.equal(version(gameId), "2");
});

test("with the chess engine down Card Guy's turn still completes", async () => {
	const gameId = await cardGuyToMove();
	store(gameId, { ...stored(gameId), discarded: "b" }); // THE FREE DISCARD USED: THE TURN GOES TO THE SEARCH, WHICH ASKS THE ENGINE
	const played = await turn(gameId); // NOTHING IS QUEUED: engine.test IS DOWN
	assert.equal(played.http, 200);
	assert.ok(engineCalls() > 0);
	assert.ok(played.events.length > 0);
	assert.equal(version(gameId), "3");
});

test("Card Guy owes a card duel pick: it's made", async () => {
	const created = await start();
	const state = E.newGame({ cardGuy: "b", level: 1300, seed: 1 });
	state.board = fromFen("4k3/8/8/8/4P3/8/8/4K3 w - - 0 1");
	const card = hand.newCard(state, "all-or-nothing");
	state.players.w.actives = [card];
	store(created.game_id, state);
	const opened = await act(created.game_id, { type: "active", card: card.id, target: { piece: state.board.sq[sqIndex("e4")].id } });
	assert.equal(opened.card_guy_due, true); // BOTH PICK
	const owed = E.legalActions(stored(created.game_id), "b");
	assert.ok(owed.length > 0 && owed.every((a) => a.type === "duel" && a.pick !== undefined));

	const picked = await turn(created.game_id);
	assert.equal(picked.http, 200);
	assert.equal(version(created.game_id), "3");
	const after = stored(created.game_id);
	assert.ok(!E.legalActions(after, "b").some((a) => a.type === "duel" && a.pick !== undefined)); // ITS PICK IS IN
	assert.deepEqual(body({ ...picked, events: [] }), expected(after, "w"));
	assert.ok(!JSON.stringify(picked).includes(JSON.stringify(after.rng))); // AS EVERY CARD RESPONSE: NOTHING OF THE DICE
});

test("Card Guy is asked with its own view, the game's level and a random whole seed; an action the real game refuses is asked again with its key in refused", async (t) => {
	const gameId = await cardGuyToMove();
	const state = stored(gameId), illegal = { type: "move", from: "a8", to: "a1" };
	const asked = []; // refused AS IT WAS AT EACH CALL (THE CALLER ADDS TO ONE LIST)
	const real = bot.cardGuyTurn, logged = t.mock.method(console, "log");
	const spy = t.mock.method(bot, "cardGuyTurn", (...args) => (asked.push([...args[2].refused]) > 1 ? real(...args) : illegal));

	const played = await turn(gameId);
	assert.equal(played.http, 200);
	assert.equal(spy.mock.callCount(), 2);
	assert.ok(!logged.mock.calls.some((c) => String(c.arguments[0]).includes("FOUND NO ACTION"))); // THE SECOND ASK ANSWERED: NOT THE FALLBACK
	const [view, level, options] = spy.mock.calls[0].arguments;
	assert.deepEqual(view, E.playerView({ ...state, cardGuy: "b" }, "b")); // ALL CARD GUY KNOWS, NEVER THE STATE
	assert.equal(level, 1300);
	assert.ok(Number.isInteger(options.seed) && options.seed >= 0 && options.seed < 2 ** 32);
	assert.notEqual(options.seed, state.rng.key[0]);
	assert.equal(typeof options.evaluate, "function");
	assert.equal(typeof options.bestOf, "function");
	assert.deepEqual(asked, [[], [E.actionKey(illegal)]]);
	assert.equal(spy.mock.calls[1].arguments[2].seed, options.seed);
	assert.equal(version(gameId), "3");
});

test("when Card Guy has no action to take, or only refused ones, a legal action is played all the same: the game never waits on it", async (t) => {
	// A THROW (ALSO AN IllegalAction OF ITS OWN: IT NAMED NO ACTION TO REFUSE) IS ASKED ONCE, A REFUSED ACTION 1 + MAX_REFUSALS TIMES
	for (const [answer, asks] of [[() => { throw new Error("Card Guy has no action to take"); }, 1], [() => ({ type: "move", from: "a8", to: "a1" }), 9], [() => { throw new E.IllegalAction(); }, 1]]) {
		testServer.reset();
		const gameId = await cardGuyToMove();
		const before = stored(gameId);
		const spy = t.mock.method(bot, "cardGuyTurn", answer);
		const played = await turn(gameId);
		spy.mock.restore();
		assert.equal(played.http, 200);
		assert.equal(spy.mock.callCount(), asks); // ASKED AGAIN A FEW TIMES AT MOST: EACH IS A WHOLE TURN OF THINKING
		assert.equal(version(gameId), "3");
		assert.notDeepEqual(stored(gameId), before);
		assert.ok(played.events.some((e) => e.type === "move" && e.player === "b")); // A MOVE WHEN THERE IS ONE
		assert.deepEqual(body({ ...played, events: [] }), expected(stored(gameId), "w"));
	}
});

test("the events of Card Guy's action reach the player redacted: its hidden discard carries no card", async (t) => {
	const gameId = await cardGuyToMove();
	const state = { ...stored(gameId), cardGuy: "b" };
	const action = E.legalActions(state, "b").find((a) => a.type === "discard");
	assert.ok(action, "this deal has no discard for Card Guy");
	const next = E.applyAction(state, "b", action);
	const gone = next.events.filter((e) => e.type === "discard" && e.player === "b").map((e) => e.card.id);
	assert.ok(gone.length > 0);
	t.mock.method(bot, "cardGuyTurn", () => action);

	const played = await turn(gameId);
	assert.equal(played.http, 200);
	assert.deepEqual(body(played), expected(next.state, "w", next.events)); // legal & legal_hidden AS EVERY CARD RESPONSE
	assert.notDeepEqual(played.events, JSON.parse(JSON.stringify(next.events))); // THE RAW EVENTS NAME THE DISCARDED CARD
	for (const id of gone) { assert.ok(!JSON.stringify(played).includes(`"${id}"`), id); }
	assert.deepEqual(stored(gameId), JSON.parse(JSON.stringify(next.state)));
});

test("a forfeit that lands while Card Guy thinks: its action isn't saved, the call answers with the game as it is", async () => {
	const gameId = await cardGuyToMove();
	const hold = dataServiceWillWait(`/games/${gameId}/cards`);
	const playing = turn(gameId);
	await hold.reached;
	assert.equal((await call("POST", `/api/chess/game/${gameId}/forfeit`)).http, 200);
	hold.release();
	const late = await playing;
	assert.equal(late.http, 200);
	assert.deepEqual([late.card_guy_due, late.legal, late.events, late.result], [false, [], [], { winner: "b", reason: "forfeit" }]);
	assert.equal(version(gameId), "2");
});

test("GET /card-guy is the bot's name and nothing else", async () => {
	const { http, retry_after, ...answer } = await call("GET", "/api/chess/cards/card-guy");
	assert.equal(http, 200);
	assert.deepEqual(answer, { name: "Card Guy" }); // NO bio, avatar OR lines: THE BOT IS ONLY TEXT
});
