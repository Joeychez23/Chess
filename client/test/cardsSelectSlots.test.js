// TASK 25 (T25-I1, CONTRACT a): OPPOSING FINALITY'S HIDDEN SLOTS ("?1".."?k") READ "A hidden piece" ON THE PROMPT'S BUTTONS; A "?n" OF ANOTHER CARD'S CHOICE STAYS "A hidden card"
const { test } = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/js/gameplay/cards/select.js");

const sq = Array(64).fill(null);
sq[52] = { id: "w13", c: "w", t: "p" }; // e2
const view = (card) => ({ you: "b", board: { sq }, players: { w: {}, b: {} }, effects: [], enchant: [], pending: { player: "b", kind: card, card, options: ["w13", "?1", "?2"] } });
const labels = (card) => S.promptButtons({ pick: ["w13", "?1", "?2"].map((option) => ({ type: "choice", option })), choosing: true, duel: false }, view(card), {}).map((b) => b.label);

test("T25-I1: an Opposing Finality choice names its visible piece & calls each slot a hidden piece", () => {
	const got = labels("opposing-finality");
	assert.deepEqual(got.slice(1), ["A hidden piece", "A hidden piece"]);
	assert.notEqual(got[0], "w13");
	assert.deepEqual(labels("opposing-finality-rare").slice(1), ["A hidden piece", "A hidden piece"]); // A VERSION OF THE CARD TOO
});

test("T25-I1: another card's \"?n\" option is still a hidden card", () => {
	assert.deepEqual(labels("pickpocket").slice(1), ["A hidden card", "A hidden card"]);
});
