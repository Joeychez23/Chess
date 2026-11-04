/*
 *  draw.test.js  --  chess server tests
 *	Draw Offers (POST /api/chess/game/:gameId/draw, server/controllers/chessController.js)
 *  Real requests to the API & the data service, with the tables in memory and a stand-in Auth0 & engine (helpers/server.js)
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { aiAcceptsDraw } = require("../utils/ai.js");
const testServer = require("./helpers/server.js");
const { call, player, named, listen, engineWillPlay, engineWillScore, engineCalls, peek } = testServer;

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const realFetch = globalThis.fetch;

describe("aiAcceptsDraw", () => {
	afterEach(() => { globalThis.fetch = realFetch; mock.restoreAll(); });

	const engineSays = (answer) => { globalThis.fetch = mock.fn(async () => new Response(JSON.stringify(answer), { status: 200 })); };

	test("the AI accepts at 50% or less, winChance is from White's side", async () => {
		engineSays({ type: "bestmove", winChance: 20 });
		assert.equal(await aiAcceptsDraw(START, "w"), true);
		assert.equal(await aiAcceptsDraw(START, "b"), false);

		engineSays({ type: "bestmove", winChance: 80 });
		assert.equal(await aiAcceptsDraw(START, "w"), false);
		assert.equal(await aiAcceptsDraw(START, "b"), true);

		engineSays({ type: "bestmove", winChance: 50 });
		assert.equal(await aiAcceptsDraw(START, "w"), true);
		assert.equal(await aiAcceptsDraw(START, "b"), true);
	});

	test("the engine's search isn't held back, and no score or no engine is a no", async () => {
		mock.method(console, "log", () => { });
		engineSays({ type: "bestmove", winChance: 10 });
		await aiAcceptsDraw(START, "w");
		const body = JSON.parse(globalThis.fetch.mock.calls[0].arguments[1].body);
		assert.equal(body.elo, undefined);
		assert.equal(body.skillLevel, undefined);

		engineSays({ type: "bestmove", winChance: null });
		assert.equal(await aiAcceptsDraw(START, "w"), false);

		globalThis.fetch = mock.fn(async () => { throw new Error("connection refused"); });
		assert.equal(await aiAcceptsDraw(START, "w"), false);
		assert.ok(console.log.mock.calls.at(-1).arguments[0].startsWith("STOCKFISH FAILED")); // THE ALARM MATCHES THIS START
	});
});

describe("draw routes", () => { // AFTER "aiAcceptsDraw": ITS afterEach PUTS BACK THE REAL fetch, start() SETS THE STAND-IN
	let server;
	before(async () => { server = await testServer.start(); });
	after(() => server.close());
	beforeEach(() => testServer.reset());

	/**
	 * @description An open friend game, Alice is white
	 */
	async function friendGame() {
		const alice = player("alice");
		const bob = player("bob");
		const invite = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_username: await named(bob), start_color: "w" } });
		await call("POST", `/api/chess/game/${invite.game_id}/accept`, { as: bob, body: {} });
		return { alice, bob, gameId: invite.game_id };
	}

	describe("friend games", () => {
		test("one player offers, the other accepts, and both boards show a draw", async () => {
			const { alice, bob, gameId } = await friendGame();
			const alicesTab = await listen(alice, gameId);
			const bobsTab = await listen(bob, gameId);

			const offered = await call("POST", `/api/chess/game/${gameId}/draw`, { as: alice });
			assert.equal(offered.status, 200);
			assert.equal(offered.offered, true);
			assert.equal(offered.opponent_name, "Bob");
			assert.deepEqual(await bobsTab.heard("draw-offer"), { game_id: gameId, player_id: "alice", state: "offered" });
			assert.equal((await call("GET", `/api/chess/game/${gameId}`, { as: bob })).draw_offer, "w");

			const accepted = await call("POST", `/api/chess/game/${gameId}/draw`, { as: bob });
			assert.equal(accepted.state, "CLOSED");
			assert.equal(accepted.winner, "draw");
			assert.equal(accepted.reason, "agreement");
			assert.equal(accepted.draw_offer, null);
			assert.deepEqual(await alicesTab.heard("game-over"), { game_id: gameId, player_id: "bob", winner: "draw", reason: "agreement" });

			for (const who of [alice, bob]) {
				const game = await call("GET", `/api/chess/game/${gameId}`, { as: who });
				assert.equal(game.state, "CLOSED");
				assert.equal(game.winner, "draw");
				assert.equal(game.reason, "agreement");
			}
			assert.equal(peek("chess_db", gameId).draw_offer_player_id, undefined);
			assert.match((await call("GET", `/api/chess/game/${gameId}/pgn`, { as: alice })).pgn, /\[Termination "agreement"\]/);
		});

		test("a declined offer leaves the game going, and that player can't offer again until the next move", async () => {
			const { alice, bob, gameId } = await friendGame();
			const alicesTab = await listen(alice, gameId);
			await call("POST", `/api/chess/game/${gameId}/draw`, { as: alice });

			const declined = await call("POST", `/api/chess/game/${gameId}/draw/decline`, { as: bob });
			assert.equal(declined.declined, true);
			const heard = await alicesTab.heard("draw-offer");
			assert.equal(heard.player_id, "alice"); // THE OFFER ITSELF COMES FIRST
			await new Promise((resolve) => setTimeout(resolve, 50));
			assert.deepEqual(alicesTab.events.filter(({ event }) => event == "draw-offer").at(-1).data, { game_id: gameId, player_id: "bob", state: "declined" });

			const game = await call("GET", `/api/chess/game/${gameId}`, { as: alice });
			assert.equal(game.state, "OPEN");
			assert.equal(game.draw_offer, null);

			const again = await call("POST", `/api/chess/game/${gameId}/draw`, { as: alice });
			assert.equal(again.status, 409);
			assert.equal(again.message, "You already offered a draw this move");

			assert.equal((await call("POST", `/api/chess/game/${gameId}/draw`, { as: bob })).offered, true); // BOB'S OFFER ISN'T USED YET
			await call("POST", `/api/chess/game/${gameId}/draw/decline`, { as: alice });

			assert.equal((await call("PUT", `/api/chess/game/${gameId}`, { as: alice, body: { move: ["e2", "e4"] } })).status, 200);
			assert.equal((await call("POST", `/api/chess/game/${gameId}/draw`, { as: alice })).offered, true);
		});

		test("the next move ends the offer, it can't be accepted after that", async () => {
			const { alice, bob, gameId } = await friendGame();
			await call("POST", `/api/chess/game/${gameId}/draw`, { as: bob });

			const moved = await call("PUT", `/api/chess/game/${gameId}`, { as: alice, body: { move: ["e2", "e4"] } });
			assert.equal(moved.draw_offer, null);
			assert.equal(peek("chess_db", gameId).draw_offer_player_id, undefined);
			assert.equal(peek("chess_db", gameId).draw_offered_b, undefined);

			assert.equal((await call("POST", `/api/chess/game/${gameId}/draw/decline`, { as: alice })).status, 409);
			const pressed = await call("POST", `/api/chess/game/${gameId}/draw`, { as: alice }); // A NEW OFFER, NOT AN ACCEPT
			assert.equal(pressed.offered, true);
			assert.equal((await call("GET", `/api/chess/game/${gameId}`, { as: alice })).state, "OPEN");
		});

		test("pressing again while your own offer stands doesn't accept it", async () => {
			const { alice, gameId } = await friendGame();
			await call("POST", `/api/chess/game/${gameId}/draw`, { as: alice });
			assert.equal((await call("POST", `/api/chess/game/${gameId}/draw`, { as: alice })).offered, true);
			assert.equal((await call("GET", `/api/chess/game/${gameId}`, { as: alice })).state, "OPEN");
		});

		test("refused for someone else, a finished game and a pending invite", async () => {
			const { alice, bob, gameId } = await friendGame();
			const carol = player("carol");
			assert.equal((await call("POST", `/api/chess/game/${gameId}/draw`, { as: carol })).status, 403);
			assert.equal((await call("POST", `/api/chess/game/${gameId}/draw/decline`, { as: carol })).status, 403);

			await call("POST", `/api/chess/game/${gameId}/forfeit`, { as: bob });
			assert.equal((await call("POST", `/api/chess/game/${gameId}/draw`, { as: alice })).message, "Game is already over");
			assert.equal((await call("GET", `/api/chess/game/${gameId}`, { as: alice })).reason, "forfeit");

			const invite = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_username: await named(carol), start_color: "w" } });
			assert.equal((await call("POST", `/api/chess/game/${invite.game_id}/draw`, { as: alice })).message, "Invite not accepted yet");
		});
	});

	describe("AI games", () => {
		/**
		 * @description A guest's AI game after both sides' first moves
		 * @param  {[string]} color [the guest's color]
		 */
		async function pastFirstMoves(gameId, color) {
			await call("POST", "/api/chess/game", { body: { game_id: gameId, start_color: color } });
			if (color == "w") {
				await call("PUT", `/api/chess/game/${gameId}`, { body: { move: ["e2", "e4"] } });
				engineWillPlay("e7", "e5");
				await call("POST", `/api/chess/game/${gameId}/ai-move`);
			} else {
				engineWillPlay("e2", "e4");
				await call("POST", `/api/chess/game/${gameId}/ai-move`);
				await call("PUT", `/api/chess/game/${gameId}`, { body: { move: ["e7", "e5"] } });
			}
		}

		const assertDrawn = (response) => {
			assert.equal(response.state, "CLOSED");
			assert.equal(response.winner, "draw");
			assert.equal(response.reason, "agreement");
		};

		describe("before both sides have made their first move", () => {
			for (const color of ["w", "b"]) {
				const ai = color == "w" ? "black" : "white";

				test(`an offer before any move is accepted, the AI playing ${ai}, without asking the engine`, async () => {
					await call("POST", "/api/chess/game", { body: { game_id: "guest1", start_color: color } });
					assertDrawn(await call("POST", "/api/chess/game/guest1/draw")); // NOTHING QUEUED: THE ENGINE IS DOWN
					assert.equal(engineCalls(), 0);
				});
			}

			test("an offer after White's first move is accepted, the AI playing black", async () => {
				await call("POST", "/api/chess/game", { body: { game_id: "guest1", start_color: "w" } });
				await call("PUT", "/api/chess/game/guest1", { body: { move: ["e2", "e4"] } });
				assertDrawn(await call("POST", "/api/chess/game/guest1/draw"));
				assert.equal(engineCalls(), 0);
			});

			test("an offer after White's first move is accepted, the AI playing white", async () => {
				await call("POST", "/api/chess/game", { body: { game_id: "guest1", start_color: "b" } });
				engineWillPlay("e2", "e4");
				await call("POST", "/api/chess/game/guest1/ai-move");
				const calls = engineCalls();
				assertDrawn(await call("POST", "/api/chess/game/guest1/draw"));
				assert.equal(engineCalls(), calls);
			});

			test("a signed in player's AI game too", async () => {
				const alice = player("alice");
				const game = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w" } });
				assertDrawn(await call("POST", `/api/chess/game/${game.game_id}/draw`, { as: alice }));
			});
		});

		describe("after both first moves", () => {
			test("accepted when the AI is losing, as white or black", async () => {
				await pastFirstMoves("guest1", "w"); // THE AI IS BLACK
				engineWillScore(90);
				assertDrawn(await call("POST", "/api/chess/game/guest1/draw"));

				await pastFirstMoves("guest2", "b"); // THE AI IS WHITE
				engineWillScore(10);
				assertDrawn(await call("POST", "/api/chess/game/guest2/draw"));
			});

			test("declined when the AI is winning, as white or black", async () => {
				await pastFirstMoves("guest1", "w"); // THE AI IS BLACK
				engineWillScore(10);
				assert.equal((await call("POST", "/api/chess/game/guest1/draw")).declined, true);

				await pastFirstMoves("guest2", "b"); // THE AI IS WHITE
				engineWillScore(90);
				assert.equal((await call("POST", "/api/chess/game/guest2/draw")).declined, true);
			});

			test("only one offer per move asks the engine, the next move brings a new one", async () => {
				await pastFirstMoves("guest1", "w");
				const calls = engineCalls();
				engineWillScore(10);
				const declined = await call("POST", "/api/chess/game/guest1/draw");
				assert.equal(declined.status, 200);
				assert.equal(declined.declined, true);
				assert.equal(engineCalls(), calls + 1);
				assert.equal(peek("chess_db", "guest1").draw_offer_player_id, undefined);

				const again = await call("POST", "/api/chess/game/guest1/draw");
				assert.equal(again.status, 409);
				assert.equal(engineCalls(), calls + 1);
				assert.equal((await call("GET", "/api/chess/game/guest1")).state, "OPEN");

				await call("PUT", "/api/chess/game/guest1", { body: { move: ["g1", "f3"] } });
				engineWillPlay("b8", "c6");
				await call("POST", "/api/chess/game/guest1/ai-move");
				engineWillScore(90);
				assertDrawn(await call("POST", "/api/chess/game/guest1/draw"));
			});

			test("the engine being down is a no", async () => {
				await pastFirstMoves("guest1", "w");
				assert.equal((await call("POST", "/api/chess/game/guest1/draw")).declined, true); // NOTHING QUEUED: THE ENGINE IS DOWN
				assert.equal((await call("GET", "/api/chess/game/guest1")).state, "OPEN");
			});

			test("a move during the engine's search ends the offer", async () => {
				await pastFirstMoves("guest1", "w");
				let answer;
				engineWillPlay("e2", "e4", undefined, new Promise((resolve) => { answer = resolve; }));
				const offer = call("POST", "/api/chess/game/guest1/draw");
				await new Promise((resolve) => setTimeout(resolve, 200));
				assert.equal((await call("PUT", "/api/chess/game/guest1", { body: { move: ["g1", "f3"] } })).status, 200);
				answer();

				assert.equal((await offer).status, 409);
				assert.equal((await call("GET", "/api/chess/game/guest1")).state, "OPEN");
			});
		});
	});
});
