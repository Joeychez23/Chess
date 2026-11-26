/*
 *  routes.js  --  chess server tests
 *	Shared setup for the Chess Cards routes tests (test/cards/routes/): the test server started once per file and reset before each test
 *  with one known deal, a call signed in as me, and the stored-state, request & expected-response helpers
 *
 */

const { before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const testServer = require("./server.js");
const { player, peek, poke } = testServer;
const E = require("../../../cards-engine/index.js");

let server, me;
before(async () => { server = await testServer.start(); });
after(() => server.close());
beforeEach(() => { testServer.reset(); process.env.CARDS_TEST_SEED = "1"; me = player("me"); }); // ONE KNOWN DEAL: A RANDOM ONE NOW AND THEN HAS NO FIRST MOVE, OR A CARD GUY CARD THAT ANSWERS A MATE

const call = (method, path, options = {}) => testServer.call(method, path, options.as || options.guest || options.cookie ? options : { ...options, as: me }); // SIGNED IN AS me UNLESS TOLD: GUESTS CAN'T PLAY CHESS CARDS (#491)

const stored = (gameId) => JSON.parse(peek("chess_db", gameId).cards_state.S);
const store = (gameId, state) => poke("chess_db", gameId, { cards_state: { S: JSON.stringify(state) } });
const version = (gameId) => peek("chess_db", gameId).cards_version.N;
const start = (body = {}, options = {}) => call("POST", "/api/chess/cards", { ...options, body: { start_color: "w", ...body } });
const act = (gameId, action, options = {}) => call("POST", `/api/chess/cards/${gameId}/action`, { ...options, body: { action } });
const load = (gameId, options = {}) => call("GET", `/api/chess/cards/${gameId}`, options);
const firstMove = (state, color) => {
	const move = E.legalActions(state, color).find((a) => a.type === "move");
	assert.ok(move, "this deal has no move for " + color); // NEVER undefined: A TEST WOULD SEND NO ACTION
	return move;
};

/**
 * @description What a response must hold for color on this state (the stored game still open)
 */
function expected(state, color, events = []) {
	const cardGuy = color === "w" ? "b" : "w";
	return { mode: "cards", you: color, view: E.playerView(state, color), legal: E.playerLegal(state, color), legal_hidden: state.enchant.some((e) => e.key.startsWith("fog-of-war") && e.owner === cardGuy), events: E.playerEvents(state, events, color), card_guy_due: E.legalActions(state, cardGuy).length > 0, result: state.result };
}

const pick = (response) => ({ mode: response.mode, you: response.you, view: response.view, legal: response.legal, legal_hidden: response.legal_hidden, events: response.events, card_guy_due: response.card_guy_due, result: response.result });

module.exports = { call, stored, store, version, start, act, load, firstMove, expected, pick };
