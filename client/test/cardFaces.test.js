const { test } = require("node:test");
const assert = require("node:assert/strict");
const { faceOf, rarityColor, RARITY_COLORS } = require("../src/js/gameplay/three/cardFaces.js");

const catalog = {
	"fog-of-war-rare": { name: "Fog of War", kind: "active", text: "For 3 turns ...", skulls: 0, rarity: "rare" },
	"double-time": { name: "Double Time", kind: "active", text: "Move two different pieces this turn.", skulls: 3, rarity: "rare" },
	rust: { name: "Rust", kind: "curse", text: "Your next active card has no effect.", rarity: "uncommon" },
};

test("a move card shows its piece, the King card the king: Move, no skulls, the promotion cards' gold", () => {
	assert.deepEqual(faceOf({ id: "c1", key: "move", piece: "n" }, catalog), { name: "Knight", type: "Move", text: "", skulls: null, rarity: null, glyph: "n" });
	assert.deepEqual(faceOf({ id: "king" }, catalog), { name: "King", type: "Move", text: "", skulls: null, rarity: null, glyph: "k" });
	assert.equal(rarityColor(null), "#C9A227");
});

test("an active, passive or curse shows the catalog's name, type, text and rarity; skulls only on actives and passives", () => {
	assert.deepEqual(faceOf({ id: "c9", key: "double-time" }, catalog), { name: "Double Time", type: "Active", text: "Move two different pieces this turn.", skulls: 3, rarity: "rare", glyph: null });
	assert.equal(faceOf({ id: "c9", key: "fog-of-war-rare" }, catalog).name, "Fog of War"); // A VERSION: ITS BASE CARD'S NAME, IN ITS OWN RARITY'S FRAME
	assert.equal(rarityColor(faceOf({ id: "c9", key: "fog-of-war-rare" }, catalog).rarity), RARITY_COLORS.rare);
	assert.deepEqual(faceOf({ id: "c12", key: "rust" }, catalog), { name: "Rust", type: "Curse", text: "Your next active card has no effect.", skulls: null, rarity: "uncommon", glyph: null });
});

test("five rarity frames, each its own colour", () => {
	assert.deepEqual(Object.keys(RARITY_COLORS), ["common", "uncommon", "rare", "epic", "legendary"]);
	assert.equal(new Set(Object.values(RARITY_COLORS)).size, 5);
});

test("a card the catalog doesn't know, or with fields the face doesn't know, never throws: it shows its key as an Effect", () => {
	assert.deepEqual(faceOf({ id: "c40", key: "new-card" }, catalog), { name: "new-card", type: "Effect", text: "", skulls: null, rarity: null, glyph: null });
	assert.deepEqual(faceOf({ id: "c9", key: "double-time", denied: ["w3"], stopping: true }, catalog), faceOf({ id: "c9", key: "double-time" }, catalog));
	assert.doesNotThrow(() => faceOf({ id: "c41" }));
});
