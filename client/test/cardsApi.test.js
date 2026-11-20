/*
 *  cardsApi.test.js  --  chess frontend tests
 *	The Chess Cards requests (client/src/js/gameplay/cards/api.js): each card route (server/routes/api/cardsRoutes.js) gets its method, url & body. Run with npm run test:client
 *
 */

const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { newCardsGame, getCardsGame, sendAction, cardGuyTurn, getCardGuy } = require("../src/js/gameplay/cards/api.js");

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test("each card route gets its method, url & body, & the answer's body comes back", async () => {
	const sent = [];
	globalThis.fetch = async (url, options) => {
		sent.push([url, options.method, options.body && JSON.parse(options.body)]);
		return { status: 409, ok: false, json: async () => ({ status: 409, stale: true }) };
	};
	assert.deepEqual(await newCardsGame("/api/chess", "alternate", "1300", true), { status: 409, stale: true }); // A 409 IS AN ANSWER, NOT A FAILURE
	await getCardsGame("/api/chess", "a/b");
	await sendAction("/api/chess", "g1", { type: "move", from: "e2", to: "e4" });
	await cardGuyTurn("/api/chess", "g1");
	await getCardGuy("/api/chess");
	assert.deepEqual(sent, [
		["/api/chess/cards", "POST", { start_color: "alternate", ai_level: "1300", replace_current: true }],
		["/api/chess/cards/a%2Fb", "GET", undefined],
		["/api/chess/cards/g1/action", "POST", { action: { type: "move", from: "e2", to: "e4" } }],
		["/api/chess/cards/g1/card-guy", "POST", undefined],
		["/api/chess/cards/card-guy", "GET", undefined],
	]);
});
