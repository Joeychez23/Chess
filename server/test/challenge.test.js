/*
 *  challenge.test.js  --  chess server tests
 *	Challenge Links (#68)
 *  Real requests through the API, the page routes & the data service: making a link, taking its seat, the one-friend-game rule & who gets the join screen
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const express = require("express");
const testServer = require("./helpers/server.js");
const fakeDynamo = require("../../data-service/test/helpers/fakeDynamo.js");
const { call, page, player, peek, listen } = testServer;

let server;
let sentPage; // THE PAGE A ROUTE SENT, THE SERVER TESTS DON'T BUILD client/dist
const sendFile = express.response.sendFile;
before(async () => {
	server = await testServer.start();
	express.response.sendFile = function (file) { sentPage = path.basename(file); return this.status(200).end(); };
});
after(() => { express.response.sendFile = sendFile; testServer.reset(); server.close(); });
beforeEach(() => { testServer.reset(); sentPage = null; });

const makeLink = (who, body = { start_color: "w" }) => call("POST", "/api/chess/challenge", { as: who, body });
const home = (who) => call("GET", `/api/chess/user/${who.id}`, { as: who });

describe("a challenge link", () => {
	test("player A's link, player B joins: both are in the same game, a third is told it's taken", async () => {
		const [alice, bob, carol] = [player("alice"), player("bob"), player("carol")];
		const link = await makeLink(alice);
		assert.equal(link.status, 200);
		assert.equal(link.state, "PENDING");
		assert.deepEqual((await home(alice)).sent_invite, { game_id: link.game_id, name: null, player_color: "w", start_params: { color: "w" }, open_seat: true });

		const shown = await call("GET", `/api/chess/game/${link.game_id}/challenge`, { as: bob });
		assert.equal(shown.open, true);
		assert.equal(shown.name, "Alice");
		assert.equal(shown.player_color, "b");

		const joined = await call("POST", `/api/chess/game/${link.game_id}/join`, { as: bob });
		assert.equal(joined.status, 200);
		assert.equal(joined.state, "OPEN");

		const alicesGame = await call("GET", `/api/chess/game/${link.game_id}`, { as: alice });
		const bobsGame = await call("GET", `/api/chess/game/${link.game_id}`, { as: bob });
		assert.equal(alicesGame.player_color, "w");
		assert.equal(alicesGame.opponent_name, "Bob");
		assert.equal(bobsGame.player_color, "b");
		assert.equal(bobsGame.opponent_name, "Alice");
		assert.equal((await home(alice)).friend_game_id, link.game_id);
		assert.equal((await home(alice)).sent_invite, null);
		assert.equal((await home(bob)).friend_game_id, link.game_id);
		assert.equal((await call("PUT", `/api/chess/game/${link.game_id}`, { as: alice, body: { move: ["e2", "e4"] } })).status, 200);

		const taken = await call("POST", `/api/chess/game/${link.game_id}/join`, { as: carol });
		assert.equal(taken.http, 409);
		assert.equal(taken.message, "Game is taken");
		assert.equal((await call("GET", `/api/chess/game/${link.game_id}/challenge`, { as: carol })).open, false);
		assert.equal((await call("GET", `/api/chess/game/${link.game_id}`, { as: carol })).http, 403);
	});

	test("two players at once: only one wins the seat", async () => {
		const [alice, bob, carol] = [player("alice"), player("bob"), player("carol")];
		const link = await makeLink(alice);
		const answers = await Promise.all([bob, carol].map((who) => call("POST", `/api/chess/game/${link.game_id}/join`, { as: who })));
		assert.deepEqual(answers.map((answer) => answer.http).sort(), [200, 409]);
		const item = peek("chess_db", link.game_id);
		const winner = answers[0].http == 200 ? "bob" : "carol";
		assert.equal(item.black_player_id.S, winner);
		assert.deepEqual(JSON.parse(peek("user_db", winner).open_games.S), [link.game_id]);
		assert.deepEqual(JSON.parse(peek("user_db", winner == "bob" ? "carol" : "bob")?.open_games?.S || "[]"), []);
	});

	test("the creator can't take their own seat", async () => {
		const alice = player("alice");
		const link = await makeLink(alice);
		const own = await call("POST", `/api/chess/game/${link.game_id}/join`, { as: alice });
		assert.equal(own.http, 403);
		assert.equal(own.message, "That's your own link");
		assert.equal(peek("chess_db", link.game_id).state.S, "PENDING");
	});

	test("signed out can't make or join one", async () => {
		const alice = player("alice");
		const link = await makeLink(alice);
		assert.equal((await call("POST", "/api/chess/challenge", { body: {} })).http, 401);
		assert.equal((await call("POST", `/api/chess/game/${link.game_id}/join`)).http, 401);
		assert.equal((await call("GET", `/api/chess/game/${link.game_id}/challenge`)).http, 401);
	});

	test("it's the creator's one sent invite: each new link or invite replaces the last", async () => {
		const [alice, bob] = [player("alice"), player("bob")];
		const first = await makeLink(alice);
		const second = await makeLink(alice);
		assert.equal(peek("chess_db", first.game_id), undefined);
		assert.equal((await home(alice)).sent_invite.game_id, second.game_id);

		const invite = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email } });
		assert.equal(peek("chess_db", second.game_id), undefined);
		assert.equal((await home(alice)).sent_invite.open_seat, undefined);

		const third = await makeLink(alice);
		assert.equal(peek("chess_db", invite.game_id), undefined);
		assert.equal((await home(alice)).sent_invite.game_id, third.game_id);
	});

	test("keeps the start settings, and refuses a position that can't be played", async () => {
		const alice = player("alice");
		const fen = "4k3/8/8/8/8/8/8/R3K3 w - - 0 1";
		const link = await makeLink(alice, { start_color: "b", start_fen: fen, takebacks: 0 });
		assert.deepEqual((await home(alice)).sent_invite.start_params, { color: "b", fen, takebacks: 0 });
		assert.equal(peek("chess_db", link.game_id).game_board.S, fen);
		assert.equal((await makeLink(alice, { start_fen: "not a fen" })).http, 400);
		assert.equal(peek("chess_db", link.game_id).state.S, "PENDING"); // THE REFUSED ONE CHANGED NOTHING
	});

	test("the joiner's open friend game: 409 keeps it, replace_current forfeits it & tells the board", async () => {
		const [alice, bob, carol] = [player("alice"), player("bob"), player("carol")];
		const invite = await call("POST", "/api/chess/invite", { as: carol, body: { opponent_email: bob.email, start_color: "w" } });
		await call("POST", `/api/chess/game/${invite.game_id}/accept`, { as: bob });
		const link = await makeLink(alice);

		const busy = await call("POST", `/api/chess/game/${link.game_id}/join`, { as: bob });
		assert.equal(busy.http, 409);
		assert.equal(busy.game_id, invite.game_id);
		assert.equal(peek("chess_db", link.game_id).state.S, "PENDING");

		const carolsTab = await listen(carol, invite.game_id);
		const over = carolsTab.heard("game-over");
		const joined = await call("POST", `/api/chess/game/${link.game_id}/join`, { as: bob, body: { replace_current: true } });
		assert.equal(joined.status, 200);
		await over;
		assert.equal(peek("chess_db", invite.game_id).state.S, "CLOSED");
		assert.equal((await home(bob)).friend_game_id, link.game_id);
	});

	test("the creator's open friend game: making a link answers 409 until replace_current forfeits it", async () => {
		const [alice, bob] = [player("alice"), player("bob")];
		const invite = await call("POST", "/api/chess/invite", { as: bob, body: { opponent_email: alice.email } });
		await call("POST", `/api/chess/game/${invite.game_id}/accept`, { as: alice });
		const busy = await makeLink(alice);
		assert.equal(busy.http, 409);
		assert.equal(busy.game_id, invite.game_id);
		assert.equal((await makeLink(alice, { replace_current: true })).status, 200);
		assert.equal(peek("chess_db", invite.game_id).state.S, "CLOSED");
	});

	test("the creator's Home hears when someone joins", async () => {
		const [alice, bob] = [player("alice"), player("bob")];
		const link = await makeLink(alice);
		const tab = await listen(alice);
		const heard = tab.heard("games");
		await call("POST", `/api/chess/game/${link.game_id}/join`, { as: bob });
		assert.equal((await heard).game_id, link.game_id);
	});

	test("a cancelled link is gone", async () => {
		const [alice, bob] = [player("alice"), player("bob")];
		const link = await makeLink(alice);
		assert.equal((await call("POST", `/api/chess/game/${link.game_id}/decline`, { as: alice })).status, 200);
		assert.equal((await home(alice)).sent_invite, null);
		assert.equal((await call("POST", `/api/chess/game/${link.game_id}/join`, { as: bob })).http, 404);
		assert.equal((await call("GET", `/api/chess/game/${link.game_id}/challenge`, { as: bob })).http, 404);
	});

	test("only the creator can cancel it", async () => {
		const [alice, bob] = [player("alice"), player("bob")];
		const link = await makeLink(alice);
		assert.equal((await call("POST", `/api/chess/game/${link.game_id}/decline`, { as: bob })).http, 403);
		assert.equal(peek("chess_db", link.game_id).state.S, "PENDING");
	});

	test("the player who just joined sees the game, even on a read from before they joined", async () => {
		const [alice, bob] = [player("alice"), player("bob")];
		const link = await makeLink(alice);
		await call("GET", `/api/chess/game/${link.game_id}/challenge`, { as: bob });
		fakeDynamo.staleReads(true);
		await call("POST", `/api/chess/game/${link.game_id}/join`, { as: bob });
		const game = await call("GET", `/api/chess/game/${link.game_id}`, { as: bob });
		fakeDynamo.staleReads(false);
		assert.equal(game.http, 200);
		assert.equal(game.player_color, "b");
	});
});

describe("the page a link opens", () => {
	test("signed out goes through sign in & comes back to the link", async () => {
		const alice = player("alice");
		const link = await makeLink(alice);
		const url = `/play/${link.game_id}`;
		assert.equal((await page(url)).location, `/api/auth/resume?returnTo=${encodeURIComponent(url)}`);
	});

	test("the join screen for anyone else, Home for its creator, the board once it's theirs", async () => {
		const [alice, bob, carol] = [player("alice"), player("bob"), player("carol")];
		const link = await makeLink(alice);
		const url = `/play/${link.game_id}`;

		assert.equal((await page(url, { as: alice })).location, "/");
		assert.equal(sentPage, null);
		await page(url, { as: bob });
		assert.equal(sentPage, "join.html");

		await call("POST", `/api/chess/game/${link.game_id}/join`, { as: bob });
		await page(url, { as: bob });
		assert.equal(sentPage, "play.html");
		await page(url, { as: alice });
		assert.equal(sentPage, "play.html");

		sentPage = null;
		await page(url, { as: carol }); // THE JOIN SCREEN SAYS IT'S TAKEN
		assert.equal(sentPage, "join.html");
	});

	test("an ordinary invite still goes Home, and someone else's game is still the play page", async () => {
		const [alice, bob, carol] = [player("alice"), player("bob"), player("carol")];
		const invite = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email } });
		assert.equal((await page(`/play/${invite.game_id}`, { as: bob })).location, "/");
		await page(`/play/${invite.game_id}`, { as: carol });
		assert.equal(sentPage, "play.html");
	});
});
