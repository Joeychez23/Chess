/*
 *  cards-clientSelect.test.js  --  chess server tests
 *	The Chess Cards client's pure modules (client/src/js/gameplay/cards/): store.js, the game as the card routes last told it
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cards, takeResponse } = require("../../client/src/js/gameplay/cards/store.js");

// A CARD ROUTE'S BODY (cardsResponse IN server/controllers/cardsController.js), WITH WHAT A TEST CHANGES
const body = (fields = {}) => ({ status: 200, game_id: "g1", mode: "cards", ai_level: 1300, you: "w", view: { board: { turn: "w" } }, legal: [{ type: "move", from: "e2", to: "e4" }], legal_hidden: false, events: [], card_guy_due: false, result: null, ...fields });

test("takeResponse keeps the view, the legal actions and the side, and hands back the events to show", () => {
	const events = [{ type: "card-played", player: "b" }, { type: "move", player: "b", from: "e7", to: "e5" }];
	const r = body({ you: "b", view: { board: { turn: "w" } }, events, card_guy_due: true });
	assert.deepEqual(takeResponse(r), events);
	assert.deepEqual(cards, { view: r.view, legal: r.legal, you: "b", result: null, cardGuyDue: true, hidden: false, catalog: {} });
});

test("a stale reply replaces everything with the fresh game, and has no events to show", () => {
	takeResponse(body({ card_guy_due: true, events: [{ type: "move", player: "w", from: "e2", to: "e4" }] }));
	const fresh = body({ status: 409, stale: true, you: "b", view: { board: { turn: "b" } }, legal: [], card_guy_due: false, result: { winner: "w", reason: "forfeit" }, message: "Game is over" });
	assert.deepEqual(takeResponse(fresh), []);
	assert.deepEqual(cards, { view: fresh.view, legal: [], you: "b", result: { winner: "w", reason: "forfeit" }, cardGuyDue: false, hidden: false, catalog: {} });
});

test("an answer with no game in it (an error, or no answer) changes nothing and has no events", () => {
	const r = body();
	takeResponse(r);
	for (const answer of [undefined, { status: 400, message: "Invalid action" }, { status: 409, game_id: "g1", message: "This game is from an older version" }, { status: 502, serverError: true }]) {
		assert.deepEqual(takeResponse(answer), []);
	}
	assert.deepEqual(cards, { view: r.view, legal: r.legal, you: "w", result: null, cardGuyDue: false, hidden: false, catalog: {} });
});

test("takeResponse keeps legal_hidden and the catalog, and an older answer without them reads as none", () => {
	const catalog = { veto: { name: "Veto", kind: "passive", text: "t", skulls: 0, rarity: "rare" } };
	takeResponse(body({ legal_hidden: true, catalog }));
	assert.deepEqual([cards.hidden, cards.catalog], [true, catalog]);
	takeResponse(body({ legal_hidden: undefined, catalog: undefined }));
	assert.deepEqual([cards.hidden, cards.catalog], [false, {}]);
});

/* ---- select.js: what the table lets the player pick, from the server's legal list ---- */

const S = require("../../client/src/js/gameplay/cards/select.js");
const { fromFen } = require("../../cards-engine/board.js");

// THE START POSITION: fromFen NUMBERS PIECES IN SQUARE ORDER, SO WHITE'S a2..h2 ARE w1..w8, a1..h1 w9..w16 (e1 = w13, g1 = w15, b1 = w10)
const START = () => fromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
const LEGAL = [
	{ type: "move", card: "c1", from: "e2", to: "e4" },
	{ type: "move", card: "c1", from: "d2", to: "d4" },
	{ type: "move", card: "c2", from: "e2", to: "e4" }, // A SECOND PAWN CARD: THE SAME MOVES
	{ type: "move", card: "c2", from: "d2", to: "d4" },
	{ type: "move", card: "c3", from: "g1", to: "f3" },
	{ type: "move", card: "king", from: "e1", to: "d1" },
	{ type: "active", card: "c9", target: { piece: "w15" } },
	{ type: "active", card: "c9", target: { piece: "w10" } },
	{ type: "active", card: "c10" },
	{ type: "passive" },
	{ type: "discard", cards: ["c1"] }, // THE FREE DISCARD: ONE CARD AT A TIME (TASK 20e), A MOVE CARD OR AN ACTIVE
];
const view = (fields = {}) => ({
	you: "w", board: START(),
	players: {
		w: { king: true, moves: [{ id: "c1", key: "move", piece: "p" }, { id: "c2", key: "move", piece: "p" }, { id: "c3", key: "move", piece: "m" }], actives: [{ id: "c9", key: "stronghold" }, { id: "c10", key: "foresight" }], passive: { id: "c11", key: "veto" }, curses: [{ id: "c12", key: "shackles" }] },
		b: { hand: { count: 9, shown: [] } },
	},
	...fields,
});

test("movesForCard: the legal moves that spend this card, and nothing for a card with none", () => {
	assert.deepEqual(S.movesForCard(LEGAL, "c1"), LEGAL.slice(0, 2));
	assert.deepEqual(S.movesForCard(LEGAL, "king"), [LEGAL[5]]);
	assert.deepEqual(S.movesForCard(LEGAL, "c9"), []);
});

test("targetsForActive: the legal plays of this active, one per target (no target: one)", () => {
	assert.deepEqual(S.targetsForActive(LEGAL, "c9"), LEGAL.slice(6, 8));
	assert.deepEqual(S.targetsForActive(LEGAL, "c10"), [{ type: "active", card: "c10" }]);
	assert.deepEqual(S.targetsForActive(LEGAL, "c1"), []);
});

test("shortcutFor: picking a piece directly gives one move per destination, the first card that allows it spent, duplicates interchangeable", () => {
	assert.deepEqual(S.shortcutFor(LEGAL, "e2"), [LEGAL[0]]); // c1, NOT c2
	assert.deepEqual(S.shortcutFor(LEGAL, "e1"), [LEGAL[5]]); // THE KING: ITS CARD
	assert.deepEqual(S.shortcutFor(LEGAL, "a1"), []);
	const both = [{ type: "move", card: "c4", from: "c1", to: "g5" }, { type: "move", card: null, from: "c1", to: "g5" }, { type: "move", card: "c4", from: "c1", to: "h6" }];
	assert.deepEqual(S.shortcutFor(both, "c1"), [both[1], both[2]]); // A MOVE NEEDING NO CARD (HERETICAL SUBJECTION, ESCAPE ARTIST) SPENDS NONE
	const promo = ["q", "n"].map((promotion) => ({ type: "move", card: "c1", from: "e7", to: "e8", promotion }));
	assert.deepEqual(S.shortcutFor([...promo, ...promo.map((a) => ({ ...a, card: "c2" }))], "e7"), promo); // EACH PROMOTION IS ITS OWN DESTINATION
});

test("canPlace: the passive can be placed only when legal says so", () => {
	assert.equal(S.canPlace(LEGAL), true);
	assert.equal(S.canPlace(LEGAL.filter((a) => a.type !== "passive")), false);
	assert.equal(S.canPlace([]), false);
});

test("handCards: the King card, the move cards, the actives, the passive, then the curses; no King card once it is lost", () => {
	assert.deepEqual(S.handCards(view()).map((c) => [c.id, c.kind]), [["king", "king"], ["c1", "move"], ["c2", "move"], ["c3", "move"], ["c9", "active"], ["c10", "active"], ["c11", "passive"], ["c12", "curse"]]);
	const lost = view();
	lost.players.w.king = false;
	lost.players.w.passive = null;
	assert.deepEqual(S.handCards(lost).map((c) => c.id), ["c1", "c2", "c3", "c9", "c10", "c12"]);
	assert.deepEqual(S.handCards({ you: "w", board: START(), players: { w: { king: true, moves: [], actives: [], curses: [], denied: 1, extra: {} }, b: {} } }).map((c) => c.id), ["king"]); // FIELDS IT DOESN'T KNOW ARE LEFT ALONE
});

test("actionsFor: a lifted card's plays (moves, active targets, the passive's placing, a curse's clear) and the free discards it's in when legal lists them", () => {
	const v = view(), legal = [...LEGAL, { type: "clear", card: "c12", discard: "c3" }];
	assert.deepEqual(S.actionsFor(legal, v, "c1"), [...LEGAL.slice(0, 2), { type: "discard", cards: ["c1"] }]);
	assert.deepEqual(S.actionsFor(legal, v, "c2"), LEGAL.slice(2, 4)); // NO DISCARD LISTED WITH IT: NONE
	assert.deepEqual(S.actionsFor(legal, v, "c11"), [{ type: "passive" }]);
	assert.deepEqual(S.actionsFor(legal, v, "c12"), [{ type: "clear", card: "c12", discard: "c3" }]);
	assert.deepEqual(S.actionsFor(legal, v, "c10"), [{ type: "active", card: "c10" }]);
});

test("actionsFor: one free discard per card, its own (two Pawn cards each have theirs), and an active's own", () => {
	const v = view(), singles = ["c1", "c2", "c3", "c10"].map((id) => ({ type: "discard", cards: [id] }));
	assert.deepEqual(S.actionsFor(singles, v, "c1"), [singles[0]]);
	assert.deepEqual(S.actionsFor(singles, v, "c2"), [singles[1]]);
	assert.deepEqual(S.actionsFor(singles, v, "c10"), [singles[3]]);
});

test("picking squares: a move card glows its pieces, then the picked piece's squares, and the last square makes the move ready", () => {
	const v = view();
	let sel = S.lift(LEGAL, v, "c1");
	assert.deepEqual(S.options(sel, v.board), { glow: ["d2", "e2"], ready: [{ type: "discard", cards: ["c1"] }] }); // ITS DISCARD: A BUTTON WHILE ITS PIECES GLOW
	sel = S.pick(sel, v.board, "e2");
	assert.deepEqual(S.options(sel, v.board), { glow: ["e4"], ready: [] });
	assert.equal(S.pick(sel, v.board, "h5"), null); // NOT ONE OF THEM
	assert.deepEqual(S.options(S.pick(sel, v.board, "e4"), v.board), { glow: [], ready: [LEGAL[0]] });
	assert.deepEqual(S.options(S.lift(LEGAL, v, "c9"), v.board).glow, ["b1", "g1"]); // AN ACTIVE'S PIECE TARGETS, BY THEIR SQUARES
	assert.deepEqual(S.options(S.lift(LEGAL, v, "c10"), v.board), { glow: [], ready: [{ type: "active", card: "c10" }] }); // NO TARGET: READY AT ONCE
});

test("picking squares: a swap's two pieces in either order; targets that share squares are all ready together", () => {
	const v = view(), swap = [{ type: "active", card: "c9", target: { pieces: ["w13", "w15"] } }];
	const first = S.pick(S.lift(swap, v, "c9"), v.board, "g1");
	assert.deepEqual(S.options(first, v.board), { glow: ["e1"], ready: [] });
	assert.deepEqual(S.options(S.pick(first, v.board, "e1"), v.board).ready, swap);
	assert.equal(S.pick(first, v.board, "g1"), null); // THE SAME PIECE AGAIN: NOT A SWAP (I1)
	const types = ["q", "r"].map((t) => ({ type: "active", card: "c9", target: { piece: "w1", t } }));
	assert.deepEqual(S.options(S.pick(S.lift(types, v, "c9"), v.board, "a2"), v.board).ready, types); // CONSCRIPTION: A PROMPT CHOOSES
	const mixed = [{ type: "active", card: "c9", target: { curses: "all" } }, { type: "active", card: "c9", target: { piece: "w1", s: "frozen" } }];
	assert.deepEqual(S.options(S.lift(mixed, v, "c9"), v.board), { glow: ["a2"], ready: [mixed[0]] }); // CLEANSE: A BUTTON & A GLOWING PIECE
	const last = [{ type: "active", card: "c9", target: { move: { from: "e1", to: "d1" } } }];
	assert.deepEqual(S.options(S.pick(S.lift(last, v, "c9"), v.board, "e1"), v.board).glow, ["d1"]); // LAST STAND: THE KING, THEN WHERE IT GOES
});

test("pickPiece: a piece picked with nothing lifted uses shortcutFor; a choice's pieces are picked on the board too", () => {
	const v = view();
	const sel = S.pickPiece(LEGAL, v, "e2");
	assert.deepEqual(S.options(sel, v.board), { glow: ["e4"], ready: [] });
	assert.equal(S.pickPiece(LEGAL, v, "a1"), null);
	const choice = [{ type: "choice", option: "w15" }, { type: "choice", option: "c3" }];
	assert.deepEqual(S.options(S.lift(choice, v, null), v.board), { glow: ["g1"], ready: [choice[1]] });
	assert.deepEqual(S.options(S.pick(S.lift(choice, v, null), v.board, "g1"), v.board).ready, [choice[0]]);
});

test("under Card Guy's Fog of War (no moves listed) a move card offers the engine's plain moves of its piece type on the board in sight, sent blind; the King card the king's", () => {
	const v = view();
	const blind = S.lift([], v, "c3", true);
	assert.deepEqual(S.options(blind, v.board).glow, ["b1", "g1"]); // BOTH KNIGHTS
	const g1 = S.pick(blind, v.board, "g1");
	assert.deepEqual(S.options(g1, v.board).glow.sort(), ["f3", "h3"]); // THE ENGINE'S OWN MOVES ON THE BOARD IN SIGHT (USER RULING 2026-11-22), NOT ONTO ITS OWN PIECE (e2)
	assert.deepEqual(S.options(S.pick(g1, v.board, "f3"), v.board).ready, [{ type: "move", card: "c3", from: "g1", to: "f3" }]);
	assert.deepEqual(S.options(S.lift([], v, "king", true), v.board).glow, []); // THE KING HAS NO MOVE AT THE START: NOTHING GLOWS
	assert.deepEqual(S.options(S.pickPiece([], v, "e2", true), v.board).glow.sort(), ["d3", "e3", "e4", "f3"]); // A PAWN: 1 OR 2 FORWARD, NEVER THE LAST RANK FROM HERE, & BOTH DIAGONALS (A HIDDEN PIECE MAY STAND THERE)
	const seventh = view({ board: fromFen("7k/4P3/8/8/8/8/8/R2QKB1R w KQ - 0 1") });
	assert.deepEqual(S.options(S.pickPiece([], seventh, "e1", true), seventh.board).glow.sort(), ["d2", "e2", "f2"]); // THE KING: A STEP, NOT ONTO ITS OWN (d1, f1), NO CASTLE PAST THEM
	const open = view({ board: fromFen("7k/8/8/8/8/8/8/R3K2R w KQ - 0 1") });
	assert.ok(["c1", "g1"].every((to) => S.options(S.pickPiece([], open, "e1", true), open.board).glow.includes(to))); // BOTH CASTLES
	const pawn = S.pick(S.pickPiece([], seventh, "e7", true), seventh.board, "e8");
	assert.deepEqual(S.options(pawn, v.board).ready.map((a) => [a.card, a.promotion]), [["c1", "q"], ["c1", "r"], ["c1", "b"], ["c1", "n"]]); // THE FIRST PAWN CARD, EACH PROMOTION
	assert.equal(S.pickPiece([], v, "e7", true), null); // NOT THE PLAYER'S PIECE
	const fogged = view();
	fogged.board.sq = fogged.board.sq.map((p) => (p && p.c === "b" ? null : p)); // HIDDEN SQUARES ARE EMPTY IN THE VIEW
	assert.doesNotThrow(() => S.options(S.lift([], fogged, "c1", true), fogged.board));
});

test("under Card Guy's Fog of War a pawn's two forward diagonals always glow, so a hidden piece can be taken blind; nothing else is added", () => {
	const tos = (v, from) => S.blindMoves(v, { id: "c1", piece: "p" }, from).map((a) => a.to).sort();
	const v = view();
	assert.deepEqual(tos(v, "e2"), ["d3", "e3", "e4", "f3"]);
	assert.deepEqual(tos(v, "a2"), ["a3", "a4", "b3"]); // THE EDGE FILE: ONE DIAGONAL, NO WRAP TO THE h FILE
	assert.deepEqual(tos(v, "h2"), ["g3", "h3", "h4"]);
	assert.deepEqual(S.blindMoves(v, { id: "c1", piece: "p" }, "e2").find((a) => a.to === "d3"), { type: "move", card: "c1", from: "e2", to: "d3" }); // THE SERVER'S SHAPE FOR A CAPTURE
	const seen = view({ board: fromFen("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1") }); // A PIECE IN SIGHT ON d5: THE ENGINE'S OWN CAPTURE, NOT TWICE
	assert.deepEqual(tos(seen, "e4"), ["d5", "e5", "f5"]);
	const own = view({ board: fromFen("4k3/8/8/8/8/3N4/4P3/4K3 w - - 0 1") }); // THE PLAYER'S KNIGHT ON d3: NOT ONTO IT
	assert.deepEqual(tos(own, "e2"), ["e3", "e4", "f3"]);
	const ep = view({ board: fromFen("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1") }); // EN PASSANT IS THE ENGINE'S: ONE d6
	assert.deepEqual(tos(ep, "e5"), ["d6", "e6", "f6"]);
	const seventh = view({ board: fromFen("7k/4P3/8/8/8/8/8/4K3 w - - 0 1") }); // ONTO THE LAST RANK: EACH PROMOTION, AS THE ENGINE ORDERS THEM
	assert.deepEqual(S.blindMoves(seventh, { id: "c1", piece: "p" }, "e7").filter((a) => a.to === "d8"), ["q", "r", "b", "n"].map((promotion) => ({ type: "move", card: "c1", from: "e7", to: "d8", promotion })));
	assert.deepEqual(tos(seventh, "e7"), ["d8", "d8", "d8", "d8", "e8", "e8", "e8", "e8", "f8", "f8", "f8", "f8"]);
	const black = view({ you: "b", board: fromFen("4k3/4p3/8/8/8/8/8/4K3 b - - 0 1") }); // BLACK'S FORWARD IS DOWN THE BOARD
	assert.deepEqual(tos(black, "e7"), ["d6", "e5", "e6", "f6"]);
	assert.deepEqual(S.blindMoves(v, { id: "c3", piece: "m" }, "g1").map((a) => a.to).sort(), ["f3", "h3"]); // OTHER PIECES: THE ENGINE'S PLAIN MOVES, AS BEFORE
	assert.deepEqual(S.options(S.pickPiece(LEGAL, v, "e2"), v.board).glow, ["e4"]); // OUTSIDE FOG: ONLY WHAT legal LISTS
});

test("label: what a prompt's button says for each kind of play", () => {
	const v = view(), catalog = { shackles: { name: "Shackles" }, rust: { name: "Rust" } };
	assert.equal(S.label({ type: "move", card: "c1", from: "e7", to: "e8", promotion: "n" }, v, catalog), "Knight");
	assert.equal(S.label({ type: "passive" }, v, catalog), "Place in Board Effects (uses your turn)");
	assert.equal(S.label({ type: "active", card: "c9", target: { piece: "w1", t: "q" } }, v, catalog), "Queen");
	assert.equal(S.label({ type: "active", card: "c9", target: { curses: "all" } }, v, catalog), "Clear all your curses");
	assert.equal(S.label({ type: "active", card: "c9", target: { piece: "w1", s: "frozen" } }, v, catalog), "Remove Frozen from the Pawn on a2");
	assert.equal(S.label({ type: "active", card: "c9", target: { pieces: ["w13", "w15"], mark: "w15" } }, v, catalog), "Mark the Knight on g1");
	assert.equal(S.label({ type: "choice", option: "w15" }, v, catalog), "Knight on g1");
	assert.equal(S.label({ type: "choice", option: "rust" }, v, catalog), "Rust");
	assert.equal(S.label({ type: "choice", option: "c3" }, v, catalog), "Knight / Bishop card");
	assert.equal(S.label({ type: "choice", option: "?2" }, v, catalog), "A hidden card");
	assert.equal(S.label({ type: "clear", card: "c12" }, v, catalog), "Pay: skip this move");
	assert.equal(S.label({ type: "clear", card: "c12", discard: "c3" }, v, catalog), "Pay with your Knight / Bishop card");
	assert.equal(S.label({ type: "clear", card: "c12", discard: ["c1", "c3"] }, v, catalog), "Pay with your Pawn card & Knight / Bishop card");
	assert.equal(S.label({ type: "active", card: "c10" }, v, catalog), "Play it");
	assert.equal(S.label({ type: "discard", cards: ["c1"] }, v, catalog), "Discard your Pawn card (the next one discarded draws 1)");
	const kept = view();
	kept.players.w.kept = { id: "c0", key: "move", piece: "r" }; // A MOVE CARD REMEMBERED FROM AN EARLIER DISCARD: THIS ONE IS ITS PAIR
	assert.equal(S.label({ type: "discard", cards: ["c1"] }, kept, catalog), "Discard your Pawn card (draw 1)");
	kept.board = fromFen("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
	assert.equal(S.label({ type: "discard", cards: ["c1"] }, kept, catalog), "Discard your Pawn card (no card back)"); // A BARE KING DRAWS NOTHING
	assert.equal(S.label({ type: "discard", cards: ["c10"] }, v, { foresight: { name: "Foresight" } }), "Discard your Foresight (new one at turn end)"); // AN ACTIVE BY ITS NAME, AS cardName NAMES IT FOR A CLEAR
	assert.equal(S.label({ type: "move", card: null, from: "c1", to: "g5" }, v, catalog), "c1 to g5 without a card");
	assert.equal(S.label({ type: "move", card: null, from: "e7", to: "e8", promotion: "q" }, v, catalog), "Queen without a card");
});

test("label: Pickpocket's take-back names the card taken from the player (the card-taken event's), or says what it is when that event isn't at hand", () => {
	const v = view({ pending: { player: "w", kind: "pickpocket", card: "pickpocket", stolen: "c84", options: ["c84", "?1", "?2"] } }), catalog = { foresight: { name: "Foresight" } };
	assert.equal(S.label({ type: "choice", option: "c84" }, v, catalog, { id: "c84", key: "move", piece: "m" }), "Your Knight / Bishop card");
	assert.equal(S.label({ type: "choice", option: "c84" }, v, catalog, { id: "c84", key: "foresight" }), "Your Foresight card");
	assert.equal(S.label({ type: "choice", option: "c84" }, v, catalog), "The card taken from you"); // A RELOAD: NO EVENT
	assert.equal(S.label({ type: "choice", option: "c84" }, v, catalog, { id: "c70", key: "move", piece: "q" }), "The card taken from you"); // AN OLDER TAKE
	assert.equal(S.label({ type: "choice", option: "?1" }, v, catalog), "A hidden card");
});

test("lift: a card with only a discard can be lifted, its prompt offers the discard; a no-target active offers both", () => {
	const v = view(), only = [{ type: "discard", cards: ["c1"] }];
	assert.deepEqual(S.options(S.lift(only, v, "c1"), v.board), { glow: [], ready: only });
	assert.deepEqual(S.options(S.lift(only, v, "c3"), v.board), { glow: [], ready: [] }); // ONE BUTTON, ON THE CARD ITSELF: NOT ON ANOTHER MOVE CARD
	assert.deepEqual(S.options(S.lift(LEGAL.concat({ type: "discard", cards: ["c10"] }), v, "c10"), v.board).ready, [{ type: "active", card: "c10" }, { type: "discard", cards: ["c10"] }]);
});

test("dimmed: the hand cards with no play but a discard this turn; none under fog, none when it isn't the player's turn or a choice is asked", () => {
	const v = view();
	assert.deepEqual(S.dimmed(LEGAL, v, false), ["c12"]); // THE CURSE HAS NO CLEAR LISTED
	assert.deepEqual(S.dimmed(LEGAL.filter((a) => a.type !== "passive" && a.card !== "c3"), v, false), ["c3", "c11", "c12"]);
	assert.deepEqual(S.dimmed([{ type: "discard", cards: ["c1"] }], v, false), ["king", "c1", "c2", "c3", "c9", "c10", "c11", "c12"]); // A DISCARD IS NO PLAY: c1 STILL LIFTS FOR IT
	assert.deepEqual(S.dimmed(LEGAL, v, true), []);
	assert.deepEqual(S.dimmed([], v, false), []);
	assert.deepEqual(S.dimmed([{ type: "choice", option: "w15" }], v, false), []);
});

test("costsSkull: a King-card move costs a King skull while the king's own Frozen or Hexed holds it, or Shaken and it takes a piece; never with no skull left", () => {
	const v = (s, skulls = 2) => { const x = view({ statuses: { w13: [{ s, left: 2 }] } }); x.players.w.kingSkulls = skulls; x.board.sq[52] = null; return x; }; // e2 EMPTY
	const d2 = { type: "move", card: "king", from: "e1", to: "d2" };
	assert.equal(S.costsSkull(d2, v("frozen")), true);
	assert.equal(S.costsSkull(d2, v("hexed")), true);
	assert.equal(S.costsSkull(d2, v("frozen", 0)), false);
	assert.equal(S.costsSkull(d2, v("marked")), false);
	assert.equal(S.costsSkull(d2, v("shaken")), false); // NOTHING TAKEN
	const takes = v("shaken");
	takes.board.sq[51] = { id: "b40", c: "b", t: "n" }; // A BLACK KNIGHT ON d2 (d2 = 51)
	assert.equal(S.costsSkull(d2, takes), true);
	assert.equal(S.costsSkull({ ...d2, card: "c1" }, v("frozen")), false); // NOT THE KING CARD
	assert.equal(S.costsSkull(d2, view()), false); // NO STATUS
});

test("under Card Guy's Fog of War: Last Stand is tried blind (the king's queen lines), discards stay listed, a cardless move goes without a card", () => {
	const v = view(), hidden = (fields) => ({ ...view(), ...fields });
	const ls = hidden({ players: { w: { ...v.players.w, actives: [{ id: "c30", key: "last-stand-rare" }] }, b: v.players.b } });
	ls.board.sq[52] = null; // e2 EMPTY: THE KING'S FILE OPENS
	const king = S.pick(S.lift([], ls, "c30", true), ls.board, "e1");
	assert.deepEqual(S.options(king, ls.board).glow, ["e2", "e3", "e4", "e5", "e6", "e7"]); // UP TO THE FIRST PIECE (BLACK'S PAWN, TAKEN), OWN PIECES BLOCK THE REST
	assert.deepEqual(S.options(S.pick(king, ls.board, "e4"), ls.board).ready, [{ type: "active", card: "c30", target: { move: { from: "e1", to: "e4" } } }]);
	assert.deepEqual(S.options(S.lift([{ type: "discard", cards: ["c1"] }], v, "c1", true), v.board).ready, [{ type: "discard", cards: ["c1"] }]); // ITS BLIND MOVES & ITS DISCARD
	const hs = hidden({ board: fromFen("4k3/8/8/8/8/8/8/2B1K3 w - - 0 1") }); // THE c1 BISHOP, NO KNIGHT / BISHOP CARD HELD
	hs.players.w.moves = hs.players.w.moves.slice(0, 2);
	hs.enchant = [{ id: "e1", key: "heretical-subjection", owner: "w", pieces: [hs.board.sq[58].id] }];
	assert.deepEqual(S.options(S.pick(S.pickPiece([], hs, "c1", true), hs.board, "g5"), hs.board).ready, [{ type: "move", card: null, from: "c1", to: "g5" }]);
	assert.deepEqual(S.options(S.pick(S.pickPiece([], hs, "c1", true), hs.board, "c2"), hs.board).ready, [{ type: "move", card: null, from: "c1", to: "c2" }]); // LIKE A KING TOO (THE CARD'S OWN MOVE: THE ENGINE'S PLAIN ONES DON'T HAVE IT)
	assert.equal(S.pickPiece([], { ...hs, enchant: [] }, "c1", true), null); // NOT ENCHANTED, NO CARD
	const ea = hidden({ effects: [{ id: "c20", owner: "w", card: { id: "c20", key: "escape-artist" } }] }); // MAYBE IN CHECK: BOTH, A PROMPT CHOOSES
	assert.deepEqual(S.options(S.pick(S.pickPiece([], ea, "e2", true), ea.board, "e4"), ea.board).ready, [{ type: "move", card: null, from: "e2", to: "e4" }, { type: "move", card: "c1", from: "e2", to: "e4" }]);
	const rt = hidden({ board: fromFen("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1") }); // BLACK'S d5 PAWN IS THE TARGET, IN SIGHT
	rt.effects = [{ id: "c21", owner: "w", card: { id: "c21", key: "retaliation", open: true, target: rt.board.sq[27].id } }];
	const e4 = S.pickPiece([], rt, "e4", true);
	assert.deepEqual(S.options(S.pick(e4, rt.board, "d5"), rt.board).ready, [{ type: "move", card: null, from: "e4", to: "d5" }, { type: "move", card: "c1", from: "e4", to: "d5" }]); // ONLY THE TARGET'S SQUARE GOES CARDLESS
	assert.deepEqual(S.options(S.pick(e4, rt.board, "e5"), rt.board).ready, [{ type: "move", card: "c1", from: "e4", to: "e5" }]);
	const off = { ...rt, effects: [{ id: "c21", owner: "w", card: { id: "c21", key: "retaliation", open: false } }] };
	assert.deepEqual(S.options(S.pick(S.pickPiece([], off, "e4", true), off.board, "e5"), off.board).ready, [{ type: "move", card: "c1", from: "e4", to: "e5" }]); // CLOSED: THE CARD ONLY
});

test("promotionPick: the ready plays are one move's promotions (the 3D promotion cards deal); anything else is not", () => {
	const promo = ["q", "r", "b", "n"].map((promotion) => ({ type: "move", card: "c1", from: "e7", to: "e8", promotion }));
	assert.equal(S.promotionPick(promo), true);
	assert.equal(S.promotionPick([...promo, ...promo.map((a) => ({ ...a, card: null }))]), true); // BOTH FORMS UNDER FOG: THE PIECE FIRST, THEN THE PROMPT
	assert.equal(S.promotionPick(promo.slice(0, 1)), false); // ONE: SENT
	assert.equal(S.promotionPick([promo[0], { type: "move", card: "c1", from: "d7", to: "d8", promotion: "q" }]), false);
	assert.equal(S.promotionPick([{ type: "active", card: "c9", target: { piece: "w1", t: "q" } }, { type: "active", card: "c9", target: { piece: "w1", t: "r" } }]), false); // CONSCRIPTION: THE PROMPT
});

test("focusList: the keyboard's stops: the hand, then the pieces with a move that needs no card, then the Board Effects piles that hold a card", () => {
	const v = view({ effects: [{ id: "c40", owner: "b", card: { id: "c40", key: "veto" } }] });
	const legal = [...LEGAL, { type: "move", card: null, from: "c1", to: "g5" }, { type: "move", card: null, from: "c1", to: "h6" }];
	assert.deepEqual(S.focusList(legal, v, false), [...S.handCards(v).map((c) => ({ kind: "hand", id: c.id })), { kind: "square", square: "c1" }, { kind: "pile", pile: "his" }]);
	const hs = view({ enchant: [{ id: "e1", key: "heretical-subjection", owner: "w", pieces: ["w11", "w14"] }] });
	assert.deepEqual(S.focusList([], hs, true).filter((x) => x.kind !== "hand"), [{ kind: "square", square: "c1" }, { kind: "square", square: "f1" }]); // UNDER FOG: THE PIECES A CARDLESS CARD COVERS
});

test("focusList: the discard list is the last stop once a card has gone to either discard pile", () => {
	const v = view({ piled: [{ player: "b", card: { down: true } }], effects: [{ id: "c40", owner: "b", card: { id: "c40", key: "veto" } }] });
	assert.deepEqual(S.focusList(LEGAL, v, false).slice(-2), [{ kind: "pile", pile: "his" }, { kind: "pile", pile: "discard" }]);
	assert.ok(!S.focusList(LEGAL, view({ piled: [] }), false).some((x) => x.pile === "discard"));
	assert.ok(!S.focusList(LEGAL, view(), false).some((x) => x.pile === "discard")); // A VIEW FROM BEFORE THE LIST
	assert.deepEqual(S.pileDrops([{ type: "drop", card: "c40" }], v, "discard"), []); // ENTER ON IT OPENS IT (flow.js handKey): NOTHING TO DROP THERE
});

test("stepFocus: the arrows step through a list and stop at its ends; none yet starts at the first", () => {
	assert.equal(S.stepFocus(3, null, "ArrowRight"), 0);
	assert.equal(S.stepFocus(3, 0, "ArrowRight"), 1);
	assert.equal(S.stepFocus(3, 2, "ArrowDown"), 2);
	assert.equal(S.stepFocus(3, 0, "ArrowLeft"), 0);
	assert.equal(S.stepFocus(3, 1, "ArrowUp"), 0);
	assert.equal(S.stepFocus(3, 1, "Enter"), 1);
	assert.equal(S.stepFocus(0, null, "ArrowRight"), null);
});

test("keyPlan: while a card game is on, the arrows and Enter never reach the page's nav; off the turn the arrows step the hand and Enter does nothing", () => {
	const plan = (key, k = {}) => S.keyPlan({ key, on: true, yours: true, ...k });
	for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", "Escape"]) { assert.equal(plan(key, { on: false }), "page", key); } // NOT LOADED OR OVER: THE PAGE'S KEYS
	assert.equal(plan("ArrowRight", { yours: false }), "hand"); // CARD GUY'S TURN, AN ACTION ON ITS WAY: THE HAND'S FOCUS STILL MOVES
	assert.equal(plan("Enter", { yours: false }), "stop"); // NOTHING, & NOT THE PAGE'S (IT WOULD FOCUS THE MENU BUTTON)
	assert.equal(plan("Escape", { yours: false }), "page"); // NOTHING TO PUT DOWN: THE MENU'S ESCAPE
	assert.equal(plan("ArrowLeft"), "hand");
	assert.equal(plan("Enter"), "hand");
	assert.equal(plan("Escape", { picked: true }), "hand");
	assert.equal(plan("Escape"), "page");
});

test("keyPlan: Escape closes an opened pile before it goes to the menu, on the turn & off it; a pick goes down first", () => {
	const plan = (k = {}) => S.keyPlan({ key: "Escape", on: true, yours: true, ...k });
	assert.equal(plan({ pile: true }), "hand");
	assert.equal(plan({ pile: true, yours: false }), "hand");
	assert.equal(plan({ pile: true, picked: true }), "hand");
	assert.equal(plan({ pile: true, repeat: true }), "hand");
	assert.equal(plan({ pile: true, promoting: true }), "hand");
	assert.equal(plan({ pile: false, yours: false }), "page");
	assert.equal(plan({ pile: true, on: false }), "page"); // THE GAME OVER: THE PAGE'S
});

test("keyPlan: an arrow takes the focus off a focused button first; a focused button keeps Enter, on the turn or off it", () => {
	const plan = (key, k = {}) => S.keyPlan({ key, on: true, yours: true, button: true, ...k });
	assert.equal(plan("ArrowDown"), "blur");
	assert.equal(plan("ArrowRight", { yours: false }), "blur");
	assert.equal(plan("Enter"), "page");
	assert.equal(plan("Enter", { yours: false }), "page");
	assert.equal(plan("Escape", { picked: true }), "hand");
});

test("keyPlan: while the promotion cards are out only Escape is the hand's; a held key does nothing more, whatever has the focus", () => {
	const plan = (key, k = {}) => S.keyPlan({ key, on: true, yours: true, ...k });
	assert.equal(plan("ArrowRight", { promoting: true, picked: true }), "page"); // handleCardKey's
	assert.equal(plan("Enter", { promoting: true, picked: true }), "page");
	assert.equal(plan("Escape", { promoting: true, picked: true }), "hand");
	for (const k of [{}, { button: true }, { yours: false }, { promoting: true, picked: true }]) {
		assert.equal(plan("Enter", { repeat: true, ...k }), "stop", JSON.stringify(k));
		assert.equal(plan("ArrowDown", { repeat: true, ...k }), "stop", JSON.stringify(k));
	}
});

test("promptFocus: the prompt's button the keys focus: Cancel when the first is a discard, else the first", () => {
	const discard = { type: "discard", cards: ["c3"] }, play = { type: "active", card: "c3" };
	assert.equal(S.promptFocus([discard]), 1); // A DIMMED CARD: [Discard, Cancel], A THIRD ENTER PUTS IT DOWN
	assert.equal(S.promptFocus([play, discard]), 0);
	assert.equal(S.promptFocus([]), 0); // THE SKULL'S [Play, Cancel]
	assert.equal(S.promptFocus([{ type: "choice", option: "a" }, { type: "choice", option: "b" }]), 0);
});

/* ---- Task 20b: the draw-back floor's label, the passive reroll, a piece picked with its card spent for the player ---- */

test("select.js keeps the engine's values for the floor's label and its table of what each move card moves: the same", () => {
	assert.deepEqual(S.PIECE_VALUE, require("../../cards-engine/hand.js").PIECE_VALUE);
	assert.deepEqual(S.CARD_MOVES, require("../../cards-engine/hand.js").CARD_MOVES);
});

/* ---- Task 20c: the Knight / Bishop card ---- */

test("the Knight / Bishop card's name, on a card, a discard button and a choice", () => {
	const v = view();
	assert.equal(S.PIECE_NAMES.m, "Knight / Bishop");
	assert.equal(S.label({ type: "discard", cards: ["c3"] }, v, {}), "Discard your Knight / Bishop card (the next one discarded draws 1)");
	assert.equal(S.label({ type: "choice", option: "c3" }, v, {}), "Knight / Bishop card");
});

test("under fog one Knight / Bishop card moves a knight and a bishop: pickPiece finds it for either, blindMoves lists each piece's own moves", () => {
	const v = view({ board: fromFen("4k3/8/8/8/8/8/8/RNB1K3 w - - 0 1") });
	assert.deepEqual(S.blindMoves(v, { id: "c3", piece: "m" }).map((a) => a.from).filter((x, i, all) => all.indexOf(x) === i).sort(), ["b1", "c1"]);
	assert.deepEqual(S.blindMoves(v, { id: "c3", piece: "m" }, "b1").map((a) => a.to).sort(), ["a3", "c3", "d2"]);
	for (const [from, to] of [["b1", "c3"], ["c1", "g5"]]) {
		assert.deepEqual(S.options(S.pick(S.pickPiece([], v, from, true), v.board, to), v.board).ready, [{ type: "move", card: "c3", from, to }]);
	}
	assert.equal(S.pickPiece([], v, "a1", true), null); // IT MOVES NO ROOK
	const old = view({ board: v.board });
	old.players.w.moves = [{ id: "c3", key: "move", piece: "n" }]; // AN OLD KNIGHT CARD MOVES NOTHING
	assert.equal(S.pickPiece([], old, "b1", true), null);
});

test("discardsFor: one button per move card, also with two cards of a type", () => {
	const v = view();
	v.players.w.moves = [{ id: "c1", key: "move", piece: "p" }, { id: "c2", key: "move", piece: "m" }, { id: "c3", key: "move", piece: "m" }, { id: "c4", key: "move", piece: "r" }];
	const singles = ["c1", "c2", "c3", "c4"].map((id) => ({ type: "discard", cards: [id] }));
	for (const [i, id] of ["c1", "c2", "c3", "c4"].entries()) assert.deepEqual(S.actionsFor(singles, v, id), [singles[i]]);
});

test("label: a free discard of 2 move cards names its draw-back floor, by the lower card's own type", { skip: "the draw-back floor was dropped (user 2026-11-22, the draw-back is random again): kept for reference" }, () => {
	const types = { p: "c1", m: "c3", m2: "c4", r: "c5", q: "c6", q2: "c7", r2: "c8" };
	const v = view();
	v.players.w.moves = Object.entries(types).map(([t, id]) => ({ id, key: "move", piece: t[0] }));
	const says = (a, b, w = v) => S.label({ type: "discard", cards: [types[a], types[b]] }, w, {});
	assert.equal(says("p", "q"), "Discard your Pawn card & Queen card (draw 1)"); // A PAWN IN THE PAIR: ANYTHING, AS BEFORE
	assert.equal(says("m", "r"), "Discard your Knight / Bishop card & Rook card (draw a Knight / Bishop or better)");
	assert.equal(says("m", "q"), "Discard your Knight / Bishop card & Queen card (draw a Knight / Bishop or better)");
	assert.equal(says("m", "m2"), "Discard your Knight / Bishop card & Knight / Bishop card (draw a Knight / Bishop or better)"); // A FLOOR OF 3 IS THE CARD'S OWN NAME (TASK 20c)
	assert.equal(says("r", "q"), "Discard your Rook card & Queen card (draw a Rook or better)");
	assert.equal(says("r", "r2"), "Discard your Rook card & Rook card (draw a Rook or better)");
	assert.equal(says("q", "q2"), "Discard your Queen card & Queen card (draw a Queen)");
});

test("label: a floor the player has no piece for names what they can draw, the most valuable card type they still have", { skip: "the draw-back floor was dropped (user 2026-11-22, the draw-back is random again): kept for reference" }, () => {
	const only = (fen) => { const v = view({ board: fromFen(fen) }); v.players.w.moves = ["r", "r", "q", "q", "m"].map((piece, i) => ({ id: "m" + i, key: "move", piece })); return v; };
	const says = (v, a, b) => S.label({ type: "discard", cards: [a, b] }, v, {});
	assert.equal(says(only("4k3/8/8/8/8/8/PPPP4/1NB1K3 w - - 0 1"), "m0", "m1"), "Discard your Rook card & Rook card (draw a Knight / Bishop)");
	assert.equal(says(only("4k3/8/8/8/8/8/PPPP4/1N2K3 w - - 0 1"), "m2", "m3"), "Discard your Queen card & Queen card (draw a Knight / Bishop)"); // A KNIGHT ALONE: STILL THE CARD'S NAME
	assert.equal(says(only("4k3/8/8/8/8/8/PPPP4/4K3 w - - 0 1"), "m0", "m2"), "Discard your Rook card & Queen card (draw a Pawn)");
	assert.equal(says(only("4k3/8/8/8/8/8/PPPP4/R3K3 w - - 0 1"), "m2", "m3"), "Discard your Queen card & Queen card (draw a Rook)");
	assert.equal(says(only("4k3/8/8/8/8/8/PPPP4/Q3K3 w - - 0 1"), "m0", "m1"), "Discard your Rook card & Rook card (draw a Rook or better)"); // A QUEEN IS WORTH THE FLOOR: NOT DROPPED
	assert.equal(says(only("4k3/8/8/8/8/8/PPPP4/1B2K3 w - - 0 1"), "m4", "m0"), "Discard your Knight / Bishop card & Rook card (draw a Knight / Bishop)"); // NOTHING BETTER IS LEFT TO DRAW: NO "or better" (REVIEW 2 M6)
	assert.equal(says(only("4k3/8/8/8/8/8/PPPP4/RN2K3 w - - 0 1"), "m0", "m1"), "Discard your Rook card & Rook card (draw a Rook)"); // THE SAME FOR A ROOK'S FLOOR WITH NO QUEEN
	assert.equal(says(only("4k3/8/8/8/8/8/PPPP4/RN2K3 w - - 0 1"), "m4", "m0"), "Discard your Knight / Bishop card & Rook card (draw a Knight / Bishop or better)"); // A ROOK IS BETTER: AS RULED
	assert.equal(says(only("qqqqkqqq/8/8/8/8/8/PPPP4/4K3 w - - 0 1"), "m2", "m3"), "Discard your Queen card & Queen card (draw a Pawn)"); // CARD GUY'S QUEENS AREN'T THE PLAYER'S
	assert.equal(says(only("4k3/8/8/8/8/8/8/4K3 w - - 0 1"), "m0", "m1"), "Discard your Rook card & Rook card (no card back)"); // A BARE KING DRAWS NOTHING, & THE BUTTON SAYS SO (USER RULING 2026-11-22)
});

test("the passive reroll: a lifted passive's prompt has it after the place button, labelled by the card's name; Enter alone never rerolls", () => {
	const v = view(), reroll = { type: "discard", cards: ["c11"] }, legal = [...LEGAL, { type: "discard", cards: ["c10"] }, reroll];
	assert.deepEqual(S.actionsFor(legal, v, "c11"), [{ type: "passive" }, reroll]);
	assert.deepEqual(S.options(S.lift(legal, v, "c11"), v.board).ready, [{ type: "passive" }, reroll]);
	assert.equal(S.label(reroll, v, { veto: { name: "Veto" } }), "Reroll your Veto (new passive now)");
	assert.equal(S.label({ type: "discard", cards: ["c10"] }, v, { foresight: { name: "Foresight" } }), "Discard your Foresight (new one at turn end)"); // AN ACTIVE'S IS STILL ITS OWN
	assert.deepEqual(S.actionsFor(legal, v, "c10"), [{ type: "active", card: "c10" }, { type: "discard", cards: ["c10"] }]); // THE REROLL IS ONLY THE PASSIVE'S BUTTON
	assert.deepEqual(S.actionsFor(legal, v, "c1"), [...LEGAL.slice(0, 2), { type: "discard", cards: ["c1"] }]);
	assert.equal(S.promptFocus(S.actionsFor(legal, v, "c11")), 0); // [Place, Reroll, Cancel]: PLACE
	const unplaceable = legal.filter((a) => a.type !== "passive");
	assert.deepEqual(S.actionsFor(unplaceable, v, "c11"), [reroll]);
	assert.equal(S.promptFocus(S.actionsFor(unplaceable, v, "c11")), 1); // [Reroll, Cancel]: CANCEL (N2)
	assert.ok(S.dimmed(unplaceable, v, false).includes("c11") && !S.dimmed(legal, v, false).includes("c11")); // NO PLAY BUT A DISCARD: DIMMED, AS ANY CARD
	assert.deepEqual(S.actionsFor(LEGAL, v, "c11"), [{ type: "passive" }]); // NO REROLL LISTED: NONE
});

test("pickPiece: the card is spent for the player: a move card's piece, the King card's king, a no-card move first; a piece with nothing to play can't be picked", () => {
	const v = view(), free = { type: "move", card: null, from: "g1", to: "h3" }, legal = [...LEGAL, free];
	assert.deepEqual(S.options(S.pick(S.pickPiece(legal, v, "e2"), v.board, "e4"), v.board).ready, [LEGAL[0]]); // THE FIRST PAWN CARD
	assert.deepEqual(S.options(S.pick(S.pickPiece(legal, v, "e1"), v.board, "d1"), v.board).ready, [LEGAL[5]]); // THE KING CARD
	assert.deepEqual(S.options(S.pickPiece(legal, v, "g1"), v.board).glow.sort(), ["f3", "h3"]);
	assert.deepEqual(S.options(S.pick(S.pickPiece(legal, v, "g1"), v.board, "h3"), v.board).ready, [free]); // NO CARD SPENT
	for (const sq of ["a1", "a2", "e7", "e4"]) assert.equal(S.pickPiece(legal, v, sq), null, sq); // NO ROOK CARD, A PAWN WITH NO MOVE LISTED, CARD GUY'S PAWN, AN EMPTY SQUARE
	const open = view();
	open.board.sq[52] = null; // e2 EMPTY
	assert.deepEqual(S.options(S.pick(S.pickPiece([], open, "e1", true), open.board, "e2"), open.board).ready, [{ type: "move", card: "king", from: "e1", to: "e2" }]); // UNDER FOG: THE KING CARD, BLIND
	assert.equal(S.pickPiece([], v, "a1", true), null); // UNDER FOG: NO ROOK CARD HELD
	const lost = view();
	lost.players.w.king = false;
	assert.equal(S.pickPiece([], lost, "e1", true), null); // THE KING CARD GONE (HOLLOW CROWN)
});

test("pressPick: a mouse press on one of the player's pieces picks it as a click would, when it has squares to be dragged to", () => {
	const v = view(), free = { type: "move", card: null, from: "g1", to: "h3" }, legal = [...LEGAL, free];
	assert.deepEqual(S.pressPick(null, legal, v, "e2"), S.pickPiece(legal, v, "e2")); // NOTHING LIFTED: THE PIECE, A CARD OF ITS TYPE SPENT
	assert.deepEqual(S.pressPick(null, legal, v, "e1").actions, [LEGAL[5]]); // THE KING CARD
	assert.deepEqual(S.options(S.pressPick(null, legal, v, "g1"), v.board).glow.sort(), ["f3", "h3"]); // ITS NO-CARD MOVE TOO
	for (const sq of ["a1", "a2", "e7", "e4"]) assert.equal(S.pressPick(null, legal, v, sq), null, sq); // NOTHING TO PLAY, CARD GUY'S PIECE, AN EMPTY SQUARE: NOTHING IS HELD
	assert.deepEqual(S.pressPick(null, [], v, "e2", true), S.pickPiece([], v, "e2", true)); // UNDER FOG: THE BLIND MOVES
	assert.equal(S.pressPick(null, [], v, "a1", true), null);
});

test("pressPick: with a card lifted a press on one of its glowing pieces plays through that card; another piece is picked directly; a play's next square is the click's", () => {
	const v = view(), second = S.lift(LEGAL, v, "c2");
	const held = S.pressPick(second, LEGAL, v, "e2");
	assert.deepEqual([held.card, held.picks, held.actions], ["c2", ["e2"], LEGAL.slice(2, 4)]); // THE LIFTED SECOND PAWN CARD, NOT THE FIRST
	assert.deepEqual(S.options(S.pick(held, v.board, "e4"), v.board).ready, [LEGAL[2]]);
	assert.deepEqual(S.pressPick(held, LEGAL, v, "d2").picks, ["d2"]); // ANOTHER OF ITS PIECES
	assert.equal(S.pressPick(held, LEGAL, v, "d2").card, "c2");
	assert.deepEqual(S.pressPick(second, LEGAL, v, "g1"), S.pickPiece(LEGAL, v, "g1")); // NOT ONE OF ITS PIECES: THE KNIGHT, ITS OWN CARD
	const stronghold = S.lift(LEGAL, v, "c9");
	assert.equal(S.pressPick(stronghold, LEGAL, v, "g1"), null); // AN ACTIVE'S TARGET PIECE: A CLICK PLAYS IT, NOTHING TO DRAG TO
	const swap = [{ type: "active", card: "c9", target: { pieces: ["w13", "w15"] } }, { type: "active", card: "c9", target: { pieces: ["w13", "w10"] } }];
	const one = S.pick(S.lift(swap, v, "c9"), v.board, "e1");
	assert.equal(S.pressPick(one, swap, v, "g1"), null); // THE SWAP'S SECOND PIECE: THE CLICK FINISHES IT, THE PRESS DOESN'T START AGAIN
	const last = [{ type: "active", card: "c9", target: { move: { from: "e1", to: "d1" } } }];
	assert.equal(S.pressPick(null, last, v, "e1"), null); // LAST STAND IS NEVER OFFERED BY THE KING'S PRESS
	assert.deepEqual(S.pressPick(S.lift(last, v, "c9"), last, v, "e1").picks, ["e1"]); // LIFTED FIRST: THE KING DRAGS THROUGH IT
});

test("a press, then its release: on a target the one play is ready (or a move's promotions, or both forms of a square); elsewhere the pick stays; a tap's click picks the same again", () => {
	const v = view(), held = S.pressPick(null, LEGAL, v, "e2");
	assert.deepEqual(S.options(S.pick(held, v.board, "e4"), v.board).ready, [LEGAL[0]]); // DROPPED ON A TARGET
	for (const sq of ["e5", "e2", "d2", "a8"]) assert.equal(S.pick(held, v.board, sq), null, sq); // NOT A TARGET (ITS OWN SQUARE TOO): flow.js LEAVES THE PICK AS IT IS
	assert.equal(S.pick(held, v.board, "e2"), null);
	assert.deepEqual(S.pickPiece(LEGAL, v, "e2"), held); // THE CLICK AFTER A PRESS THAT DIDN'T DRAG (flow.js clickSquare): THE SAME PICK, NOT A PUT-DOWN
	const lifted = S.pressPick(S.lift(LEGAL, v, "c2"), LEGAL, v, "e2");
	assert.deepEqual(S.pick({ ...lifted, picks: [] }, v.board, "e2"), lifted); // WITH A CARD LIFTED: THE SAME PICK THROUGH THE SAME CARD
	const promos = ["q", "r", "b", "n"].map((promotion) => ({ type: "move", card: "c1", from: "e2", to: "e4", promotion }));
	assert.ok(S.promotionPick(S.options(S.pick(S.pressPick(null, promos, v, "e2"), v.board, "e4"), v.board).ready)); // THE PROMOTION CARDS DEAL
	const both = [{ type: "move", card: null, from: "e2", to: "e4" }, { type: "move", card: "c1", from: "e2", to: "e4" }, { type: "move", card: "c1", from: "e2", to: "e3" }];
	const ea = { ...view(), effects: [{ id: "c20", owner: "w", card: { id: "c20", key: "escape-artist" } }] };
	assert.equal(S.options(S.pick(S.pressPick(null, [], ea, "e2", true), ea.board, "e4"), ea.board).ready.length, 2); // UNDER FOG, WITH & WITHOUT A CARD: THE PROMPT CHOOSES
	assert.deepEqual(S.options(S.pick(S.pressPick(null, both, v, "e2"), v.board, "e4"), v.board).ready, [both[0]]); // NOT UNDER FOG shortcutFor TAKES THE NO-CARD MOVE
});

