/*
 *  alternateColor.test.js  --  chess server tests
 *	The Alternate Start Color
 *  Random in a player's first game, then the opposite of their last game: AI games (new game & Restart), friend games (invite & Rematch) & guests.
 *  Tested through the real routes & the real data service
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const testServer = require("./helpers/server.js");
const { call, player, peek } = testServer;

let server;
before(async () => { server = await testServer.start(); });
after(() => server.close());
beforeEach(() => testServer.reset());

const opposite = (color) => color == "w" ? "b" : "w";
const sideOf = (gameId, playerId) => peek("chess_db", gameId).white_player_id.S == playerId ? "w" : "b";

describe("alternate color", () => {
	test("the first AI game can be either side", async () => {
		const seen = new Set();
		for (let i = 0; i < 30 && seen.size < 2; i++) {
			const alice = player(`alice${i}`);
			const game = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "alternate" } });
			seen.add(sideOf(game.game_id, `alice${i}`));
		}
		assert.equal(seen.size, 2);
	});

	test("AI games switch on each Restart & each new game, and keep the setting", async () => {
		const alice = player("alice");
		let game = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "alternate" } });
		let color = sideOf(game.game_id, "alice");
		assert.equal(JSON.parse(peek("chess_db", game.game_id).start_params.S).color, "alternate");

		game = await call("POST", `/api/chess/game/${game.game_id}/restart`, { as: alice });
		assert.equal(sideOf(game.game_id, "alice"), opposite(color));
		color = sideOf(game.game_id, "alice");
		assert.equal(JSON.parse(peek("chess_db", game.game_id).start_params.S).color, "alternate");

		game = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "alternate", replace_current: true } });
		assert.equal(sideOf(game.game_id, "alice"), opposite(color));
	});

	test("switches from a game with a picked color", async () => {
		const alice = player("alice");
		await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w" } });
		const game = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "alternate", replace_current: true } });
		assert.equal(sideOf(game.game_id, "alice"), "b");
	});

	test("the picked colors & Random aren't changed by it", async () => {
		const alice = player("alice");
		await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w" } });
		const game = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w", replace_current: true } });
		assert.equal(sideOf(game.game_id, "alice"), "w");
		const again = await call("POST", `/api/chess/game/${game.game_id}/restart`, { as: alice });
		assert.equal(sideOf(again.game_id, "alice"), "w");
		assert.equal(JSON.parse(peek("chess_db", again.game_id).start_params.S).color, "w");
		const random = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "random", replace_current: true } });
		assert.equal(JSON.parse(peek("chess_db", random.game_id).start_params.S).color, "random");
	});

	test("friend games switch on a Rematch & the next invite, an unplayed invite doesn't count", async () => {
		const alice = player("alice");
		const bob = player("bob");
		const first = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email, start_color: "alternate" } });
		const color = sideOf(first.game_id, "alice");
		await call("POST", `/api/chess/game/${first.game_id}/accept`, { as: bob, body: {} });
		await call("POST", `/api/chess/game/${first.game_id}/forfeit`, { as: alice });

		await call("POST", `/api/chess/game/${first.game_id}/rematch`, { as: alice });
		const rematch = await call("POST", `/api/chess/game/${first.game_id}/rematch`, { as: bob });
		assert.equal(sideOf(rematch.new_game_id, "alice"), opposite(color));
		assert.equal(JSON.parse(peek("chess_db", rematch.new_game_id).start_params.S).color, "alternate");
		await call("POST", `/api/chess/game/${rematch.new_game_id}/forfeit`, { as: alice });

		const next = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email, start_color: "alternate" } });
		assert.equal(sideOf(next.game_id, "alice"), color);
	});

	test("AI & friend games alternate apart", async () => {
		const alice = player("alice");
		const bob = player("bob");
		await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w" } });
		const invite = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email, start_color: "w" } });
		await call("POST", `/api/chess/game/${invite.game_id}/accept`, { as: bob, body: {} });
		assert.equal(peek("user_db", "alice").last_ai_color.S, "w");
		assert.equal(peek("user_db", "alice").last_friend_color.S, "w");
		assert.equal(peek("user_db", "bob").last_friend_color.S, "b");
		assert.equal(peek("user_db", "bob").last_ai_color, undefined);
	});

	test("a guest's game switches on each Restart", async () => {
		let game = await call("POST", "/api/chess/game", { body: { start_color: "alternate" } });
		const color = sideOf(game.game_id, game.game_id);
		game = await call("POST", `/api/chess/game/${game.game_id}/restart`, {});
		assert.equal(sideOf(game.game_id, game.game_id), opposite(color));
		game = await call("POST", `/api/chess/game/${game.game_id}/restart`, {});
		assert.equal(sideOf(game.game_id, game.game_id), color);
	});
});
