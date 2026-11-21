/*
 *  cardsClient.test.js  --  chess server tests
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
	{ type: "discard", card: "c1" },
];
const view = (fields = {}) => ({
	you: "w", board: START(),
	players: {
		w: { king: true, moves: [{ id: "c1", key: "move", piece: "p" }, { id: "c2", key: "move", piece: "p" }, { id: "c3", key: "move", piece: "n" }], actives: [{ id: "c9", key: "stronghold" }, { id: "c10", key: "foresight" }], passive: { id: "c11", key: "veto" }, curses: [{ id: "c12", key: "shackles" }] },
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

test("actionsFor: a lifted card's plays (moves, active targets, the passive's placing, a curse's clear) and its discard when legal lists one", () => {
	const v = view(), legal = [...LEGAL, { type: "clear", card: "c12", discard: "c3" }];
	assert.deepEqual(S.actionsFor(legal, v, "c1"), [...LEGAL.slice(0, 2), { type: "discard", card: "c1" }]);
	assert.deepEqual(S.actionsFor(legal, v, "c3"), [LEGAL[4]]); // NO DISCARD LISTED FOR IT: NONE
	assert.deepEqual(S.actionsFor(legal, v, "c11"), [{ type: "passive" }]);
	assert.deepEqual(S.actionsFor(legal, v, "c12"), [{ type: "clear", card: "c12", discard: "c3" }]);
	assert.deepEqual(S.actionsFor(legal, v, "c10"), [{ type: "active", card: "c10" }]);
});

test("picking squares: a move card glows its pieces, then the picked piece's squares, and the last square makes the move ready", () => {
	const v = view();
	let sel = S.lift(LEGAL, v, "c1");
	assert.deepEqual(S.options(sel, v.board), { glow: ["d2", "e2"], ready: [{ type: "discard", card: "c1" }] }); // ITS DISCARD: A BUTTON WHILE ITS PIECES GLOW
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

test("under Card Guy's Fog of War (no moves listed) a move card offers every move of its piece type, sent blind; the King card the king's", () => {
	const v = view();
	const blind = S.lift([], v, "c3", true);
	assert.deepEqual(S.options(blind, v.board).glow, ["b1", "g1"]); // BOTH KNIGHTS
	const g1 = S.pick(blind, v.board, "g1");
	assert.ok(S.options(g1, v.board).glow.includes("g8"), "any square but its own pieces': the server decides");
	assert.ok(!S.options(g1, v.board).glow.includes("e2"));
	assert.deepEqual(S.options(S.pick(g1, v.board, "f3"), v.board).ready, [{ type: "move", card: "c3", from: "g1", to: "f3" }]);
	assert.deepEqual(S.options(S.lift([], v, "king", true), v.board).glow, ["e1"]);
	const pawn = S.pick(S.pickPiece([], v, "e2", true), v.board, "e8");
	assert.deepEqual(S.options(pawn, v.board).ready.map((a) => [a.card, a.promotion]), [["c1", "q"], ["c1", "r"], ["c1", "b"], ["c1", "n"]]); // THE FIRST PAWN CARD, EACH PROMOTION
	assert.equal(S.pickPiece([], v, "e7", true), null); // NOT THE PLAYER'S PIECE
	const fogged = view();
	fogged.board.sq = fogged.board.sq.map((p) => (p && p.c === "b" ? null : p)); // HIDDEN SQUARES ARE EMPTY IN THE VIEW
	assert.doesNotThrow(() => S.options(S.lift([], fogged, "c1", true), fogged.board));
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
	assert.equal(S.label({ type: "choice", option: "c3" }, v, catalog), "Knight card");
	assert.equal(S.label({ type: "choice", option: "?2" }, v, catalog), "A hidden card");
	assert.equal(S.label({ type: "clear", card: "c12" }, v, catalog), "Pay: skip this move");
	assert.equal(S.label({ type: "clear", card: "c12", discard: "c3" }, v, catalog), "Pay with your Knight card");
	assert.equal(S.label({ type: "clear", card: "c12", discard: ["c1", "c3"] }, v, catalog), "Pay with your Pawn card & Knight card");
	assert.equal(S.label({ type: "active", card: "c10" }, v, catalog), "Play it");
	assert.equal(S.label({ type: "discard", card: "c1" }, v, catalog), "Discard (uses your turn)");
	assert.equal(S.label({ type: "move", card: null, from: "c1", to: "g5" }, v, catalog), "c1 to g5 without a card");
	assert.equal(S.label({ type: "move", card: null, from: "e7", to: "e8", promotion: "q" }, v, catalog), "Queen without a card");
});

test("label: Pickpocket's take-back names the card taken from the player (the card-taken event's), or says what it is when that event isn't at hand (I2)", () => {
	const v = view({ pending: { player: "w", kind: "pickpocket", card: "pickpocket", stolen: "c84", options: ["c84", "?1", "?2"] } }), catalog = { foresight: { name: "Foresight" } };
	assert.equal(S.label({ type: "choice", option: "c84" }, v, catalog, { id: "c84", key: "move", piece: "n" }), "Your Knight card");
	assert.equal(S.label({ type: "choice", option: "c84" }, v, catalog, { id: "c84", key: "foresight" }), "Your Foresight card");
	assert.equal(S.label({ type: "choice", option: "c84" }, v, catalog), "The card taken from you"); // A RELOAD: NO EVENT
	assert.equal(S.label({ type: "choice", option: "c84" }, v, catalog, { id: "c70", key: "move", piece: "q" }), "The card taken from you"); // AN OLDER TAKE
	assert.equal(S.label({ type: "choice", option: "?1" }, v, catalog), "A hidden card");
});

test("lift: a card with only a discard can be lifted, its prompt offers the discard; a no-target active offers both", () => {
	const v = view(), only = [{ type: "discard", card: "c3" }];
	assert.deepEqual(S.options(S.lift(only, v, "c3"), v.board), { glow: [], ready: only });
	assert.deepEqual(S.options(S.lift(LEGAL.concat({ type: "discard", card: "c10" }), v, "c10"), v.board).ready, [{ type: "active", card: "c10" }, { type: "discard", card: "c10" }]);
});

test("dimmed: the hand cards with no play but a discard this turn; none under fog, none when it isn't the player's turn or a choice is asked", () => {
	const v = view();
	assert.deepEqual(S.dimmed(LEGAL, v, false), ["c12"]); // THE CURSE HAS NO CLEAR LISTED
	assert.deepEqual(S.dimmed(LEGAL.filter((a) => a.type !== "passive" && a.card !== "c3"), v, false), ["c3", "c11", "c12"]);
	assert.deepEqual(S.dimmed([{ type: "discard", card: "c1" }], v, false), ["king", "c1", "c2", "c3", "c9", "c10", "c11", "c12"]); // A DISCARD IS NO PLAY: c1 STILL LIFTS FOR IT
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
	assert.deepEqual(S.options(S.lift([{ type: "discard", card: "c3" }], v, "c3", true), v.board).ready, [{ type: "discard", card: "c3" }]); // ITS BLIND MOVES & ITS DISCARD
	const hs = hidden({ enchant: [{ id: "e1", key: "heretical-subjection", owner: "w", pieces: ["w11"] }] }); // THE c1 BISHOP, NO BISHOP CARD HELD
	assert.deepEqual(S.options(S.pick(S.pickPiece([], hs, "c1", true), hs.board, "g5"), hs.board).ready, [{ type: "move", card: null, from: "c1", to: "g5" }]);
	assert.equal(S.pickPiece([], hs, "f1", true), null); // NOT ENCHANTED, NO CARD
	const ea = hidden({ effects: [{ id: "c20", owner: "w", card: { id: "c20", key: "escape-artist" } }] }); // MAYBE IN CHECK: BOTH, A PROMPT CHOOSES
	assert.deepEqual(S.options(S.pick(S.pickPiece([], ea, "e2", true), ea.board, "e4"), ea.board).ready, [{ type: "move", card: null, from: "e2", to: "e4" }, { type: "move", card: "c1", from: "e2", to: "e4" }]);
	const rt = hidden({ effects: [{ id: "c21", owner: "w", card: { id: "c21", key: "retaliation", open: true, target: "b13" } }] }); // b13: BLACK'S e7 PAWN (a8..h8 = b1..b8, a7..h7 = b9..b16), IN SIGHT
	const e2 = S.pickPiece([], rt, "e2", true);
	assert.deepEqual(S.options(S.pick(e2, rt.board, "e7"), rt.board).ready, [{ type: "move", card: null, from: "e2", to: "e7" }, { type: "move", card: "c1", from: "e2", to: "e7" }]); // ONLY THE TARGET'S SQUARE GOES CARDLESS
	assert.deepEqual(S.options(S.pick(e2, rt.board, "e4"), rt.board).ready, [{ type: "move", card: "c1", from: "e2", to: "e4" }]);
	const off = { ...rt, effects: [{ id: "c21", owner: "w", card: { id: "c21", key: "retaliation", open: false } }] };
	assert.deepEqual(S.options(S.pick(S.pickPiece([], off, "e2", true), off.board, "e4"), off.board).ready, [{ type: "move", card: "c1", from: "e2", to: "e4" }]); // CLOSED: THE CARD ONLY
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

test("stepFocus: the arrows step through a list and stop at its ends; none yet starts at the first", () => {
	assert.equal(S.stepFocus(3, null, "ArrowRight"), 0);
	assert.equal(S.stepFocus(3, 0, "ArrowRight"), 1);
	assert.equal(S.stepFocus(3, 2, "ArrowDown"), 2);
	assert.equal(S.stepFocus(3, 0, "ArrowLeft"), 0);
	assert.equal(S.stepFocus(3, 1, "ArrowUp"), 0);
	assert.equal(S.stepFocus(3, 1, "Enter"), 1);
	assert.equal(S.stepFocus(0, null, "ArrowRight"), null);
});

test("keyPlan: while a card game is on, the arrows and Enter never reach the page's nav; off the turn the arrows step the hand and Enter does nothing (N1)", () => {
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

test("keyPlan: an arrow takes the focus off a focused button first; a focused button keeps Enter, on the turn or off it (N1)", () => {
	const plan = (key, k = {}) => S.keyPlan({ key, on: true, yours: true, button: true, ...k });
	assert.equal(plan("ArrowDown"), "blur");
	assert.equal(plan("ArrowRight", { yours: false }), "blur");
	assert.equal(plan("Enter"), "page");
	assert.equal(plan("Enter", { yours: false }), "page");
	assert.equal(plan("Escape", { picked: true }), "hand");
});

test("keyPlan: while the promotion cards are out only Escape is the hand's; a held key does nothing more, whatever has the focus (N3)", () => {
	const plan = (key, k = {}) => S.keyPlan({ key, on: true, yours: true, ...k });
	assert.equal(plan("ArrowRight", { promoting: true, picked: true }), "page"); // handleCardKey's
	assert.equal(plan("Enter", { promoting: true, picked: true }), "page");
	assert.equal(plan("Escape", { promoting: true, picked: true }), "hand");
	for (const k of [{}, { button: true }, { yours: false }, { promoting: true, picked: true }]) {
		assert.equal(plan("Enter", { repeat: true, ...k }), "stop", JSON.stringify(k));
		assert.equal(plan("ArrowDown", { repeat: true, ...k }), "stop", JSON.stringify(k));
	}
});

test("promptFocus: the prompt's button the keys focus: Cancel when the first is a discard, else the first (N2)", () => {
	const discard = { type: "discard", card: "c3" }, play = { type: "active", card: "c3" };
	assert.equal(S.promptFocus([discard]), 1); // A DIMMED CARD: [Discard, Cancel], A THIRD ENTER PUTS IT DOWN
	assert.equal(S.promptFocus([play, discard]), 0);
	assert.equal(S.promptFocus([]), 0); // THE SKULL'S [Play, Cancel]
	assert.equal(S.promptFocus([{ type: "choice", option: "a" }, { type: "choice", option: "b" }]), 0);
});
