/*
 *  select.js  --  chess frontend
 *	Chess Cards Select
 *	What the table lets the player pick, from the server's legal list (store.js cards.legal): the moves a lifted card allows, an active's targets, the move a piece
 *	picked directly spends a card on, the squares that glow while a play is picked & what a prompt's buttons say. It never decides what's legal: every play it
 *	offers is one of legal's, except under Card Guy's Fog of War (legal_hidden: no moves listed), when a move card offers the engine's plain moves of its piece type on the
 *	board in sight (blindMoves) & the server refuses the ones that aren't legal. No DOM, the server tests require it (server/test/cardsClient.test.js)
 *
 */

const { sqName, sqIndex } = require("../../../../../cards-engine/board.js"); // SQUARE INDEX <-> "e4" (0 = a8), THE ENGINE'S OWN
const { pseudoMoves } = require("../../../../../cards-engine/movegen.js"); // THE ENGINE'S PLAIN MOVES, FOR THE FOG'S PREVIEWS (blindMoves)

const PIECE_NAMES = { p: "Pawn", n: "Knight", b: "Bishop", m: "Knight / Bishop", r: "Rook", q: "Queen", k: "King" }; // A PIECE TYPE'S NAME, & A MOVE CARD TYPE'S (m: THE KNIGHT / BISHOP CARD)
const VALUE = { p: 1, n: 3, b: 3, m: 3, r: 5, q: 9 }; // THE FREE DISCARD'S FLOOR: A COPY OF THE ENGINE'S (cards-engine/hand.js VALUE, WHICH WOULD BRING THE CARD REGISTRY INTO THE BUNDLE); cardsClient.test.js KEEPS THE TWO THE SAME
const CARD_MOVES = { p: "p", m: "nb", r: "r", q: "q" }; // THE PIECE TYPES EACH MOVE CARD TYPE MOVES: A COPY OF THE ENGINE'S TOO (hand.js CARD_MOVES), KEPT THE SAME BY THE SAME TEST
const capital = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const isCard = (key, base) => key === base || String(key).startsWith(base + "-"); // THE CARD OR ONE OF ITS VERSIONS (THE ENGINE KEYS THEM base-rarity)

/* ---------------------------------------------------------------- */
// Cards
/* ---------------------------------------------------------------- */
/**
 * @description The legal moves that spend this card
 * @param  {[array]} legal [cards.legal]
 * @param  {[string]} cardId [a move card's id, or "king"]
 * @return {[array]} actions
 */
function movesForCard(legal, cardId) {
	return legal.filter((a) => a.type === "move" && a.card === cardId);
}

/**
 * @description The legal plays of an active, one per target (one with no target when it needs none)
 * @param  {[array]} legal [cards.legal]
 * @param  {[string]} cardId [the active's id]
 * @return {[array]} actions
 */
function targetsForActive(legal, cardId) {
	return legal.filter((a) => a.type === "active" && a.card === cardId);
}

/**
 * @description A piece picked with no card lifted: one legal move per destination (each promotion its own), the card it spends being the first legal names for it,
 * so duplicate cards are interchangeable. A move that needs no card (Heretical Subjection, Escape Artist, Retaliation) is taken first: it spends none
 * @param  {[array]} legal [cards.legal]
 * @param  {[string]} fromSquare ["e2"]
 * @return {[array]} actions
 */
function shortcutFor(legal, fromSquare) {
	const moves = legal.filter((a) => a.type === "move" && a.from === fromSquare);
	const out = [];
	for (const a of [...moves.filter((m) => m.card === null), ...moves.filter((m) => m.card !== null)]) {
		if (!out.some((b) => b.to === a.to && b.promotion === a.promotion)) { out.push(a); }
	}
	return out;
}

/**
 * @description Whether the passive can go into Board Effects now
 * @param  {[array]} legal [cards.legal]
 * @return {[boolean]}
 */
function canPlace(legal) {
	return legal.some((a) => a.type === "passive");
}

/**
 * @description The player's hand in the order the table lays it out: the King card (while they hold it), the move cards, the actives, the passive, the curses.
 * Each card as the view has it, plus its kind ("king", "move", "active", "passive" or "curse"); fields it doesn't know (denied, stopping) are kept & never read
 * @param  {[object]} view [cards.view]
 * @return {[array]} cards
 */
function handCards(view) {
	const me = view.players[view.you] || {};
	return [
		...(me.king ? [{ id: "king", key: "king", kind: "king" }] : []),
		...(me.moves || []).map((c) => ({ ...c, kind: "move" })),
		...(me.actives || []).map((c) => ({ ...c, kind: "active" })),
		...(me.passive ? [{ ...me.passive, kind: "passive" }] : []),
		...(me.curses || []).map((c) => ({ ...c, kind: "curse" })),
	];
}

/**
 * @description What a lifted card can do: its moves, its targets, placing the passive (then its reroll), paying a curse off (a clear action), & the free discards it's in when legal lists them (buttons on its prompt)
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[string]} cardId
 * @return {[array]} actions
 */
function actionsFor(legal, view, cardId) {
	const card = handCards(view).find((c) => c.id === cardId);
	if (!card) { return []; }
	if (card.kind === "passive") { return [...legal.filter((a) => a.type === "passive"), ...discardsFor(legal, view, cardId)]; } // PLACE, THEN THE REROLL
	return [...legal.filter((a) => a.card === cardId), ...discardsFor(legal, view, cardId)];
}

/**
 * @description The free discard of a hand card (Task 20e: one card at a time, a move card, an active, or the held passive, its reroll): its own, when legal lists it. A button for the keys & a tap; the mouse drags the card to the discard pile (dropPlay)
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[string]} cardId
 * @return {[array]} actions
 */
function discardsFor(legal, view, cardId) {
	return legal.filter((a) => a.type === "discard" && a.cards.includes(cardId));
}

/**
 * @description The hand cards drawn dimmer: those with no play this turn but a discard (a dimmed card still lifts for its discard). None under Card Guy's Fog of War (legal lists no move),
 * & none when the player has no turn to play (Card Guy's turn, a choice, a duel, the game over): the whole hand would dim & light again every turn
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[boolean]} hidden [cards.hidden]
 * @return {[array]} ids
 */
function dimmed(legal, view, hidden) {
	if (hidden || !legal.some((a) => a.type !== "choice" && a.type !== "duel")) { return []; }
	return handCards(view).filter((c) => !actionsFor(legal, view, c.id).some((a) => a.type !== "discard")).map((c) => c.id);
}

/**
 * @description Whether a King-card move spends a King skull, as the engine decides it (turn.js kingMoves): the king moves past its own Frozen or Hexed (every move), or its Shaken (a capture).
 * legal doesn't say (the action has no skull field, the server works it out), so the view's statuses do. Under fog a capture of a hidden piece can't be seen: it reads as free
 * @param  {[object]} action
 * @param  {[object]} view [cards.view]
 * @return {[boolean]}
 */
function costsSkull(action, view) {
	if (action.type !== "move" || action.card !== "king") { return false; }
	const me = view.players[view.you] || {}, sq = view.board.sq, k = sq.find((p) => p && p.c === view.you && p.t === "k");
	if (!k || !(me.kingSkulls > 0)) { return false; }
	const own = ((view.statuses || {})[k.id] || []).map((x) => x.s), to = sq[sqIndex(action.to)];
	return own.includes("frozen") || own.includes("hexed") || (own.includes("shaken") && Boolean(to && to.c !== view.you));
}

/* ---------------------------------------------------------------- */
// Fog of War
/* ---------------------------------------------------------------- */
/**
 * @description Under Card Guy's Fog of War legal lists no move: the plain chess moves of this card's piece type on the board the player can see, as the engine makes them
 * (movegen.js pseudoMoves, no card hooks; user ruling 2026-11-22: the previews of a normal game). A hidden piece blocks nothing here & its square glows as an empty one: a move onto it
 * is the capture, to the server. A pawn's two forward diagonals always glow too, so it can try one (user ruling A 2026-11-22): not onto the player's own piece, each promotion onto the last rank.
 * The king's safety isn't checked, a card that changes how a piece moves isn't counted. The server takes the legal ones & refuses the rest (409)
 * @param  {[object]} view [cards.view]
 * @param  {[object]} card [a hand card: a move card { id, piece } or the King card { id: "king" }]
 * @param  {[string]} from [only this square's piece, left out = all of them]
 * @return {[array]} actions
 */
function blindMoves(view, card, from) {
	const type = card.id === "king" ? "k" : card.piece, sq = view.board.sq, me = view.you;
	const moved = CARD_MOVES[type] || type; // A MOVE CARD'S PIECE TYPES (THE KNIGHT / BISHOP CARD: BOTH); THE KING CARD & A NO-CARD MOVE NAME THE PIECE'S OWN
	const moves = pseudoMoves({ board: view.board }, me).filter((m) => moved.includes(m.t) && (!from || m.from === from));
	if (type === "p") { // THE DIAGONALS THE ENGINE LEFT OUT: THE ONES THAT LOOK EMPTY (A PIECE IN SIGHT IS ITS CAPTURE OR THE PLAYER'S OWN, EN PASSANT IS ITS TOO)
		const dr = me === "w" ? -1 : 1, last = me === "w" ? 0 : 7;
		sq.forEach(function (p, i) {
			const r = (i >> 3) + dr, at = sqName(i);
			if (!p || p.c !== me || p.t !== "p" || (from && at !== from) || r < 0 || r > 7) { return; }
			for (const f of [(i & 7) - 1, (i & 7) + 1]) {
				const to = sqName(r * 8 + f);
				if (f < 0 || f > 7 || sq[r * 8 + f] || moves.some((m) => m.from === at && m.to === to)) { continue; }
				for (const promotion of r === last ? ["q", "r", "b", "n"] : [null]) { moves.push({ from: at, to, promotion }); }
			}
		});
	}
	return moves.map((m) => ({ type: "move", card: card.id, from: m.from, to: m.to, ...(m.promotion && { promotion: m.promotion }) })); // A CASTLE IS ITS KING'S from & to, AS IN legal
}

/**
 * @description Last Stand under fog (legal leaves it out, its target is a move): the king's queen lines from its square, each up to an own piece (not on it) or the first other piece (on it,
 * not a king). A hidden piece doesn't stop a line: the server refuses what goes through one
 * @param  {[object]} view [cards.view]
 * @param  {[object]} card [the Last Stand in hand]
 * @return {[array]} actions
 */
function blindLastStand(view, card) {
	const sq = view.board.sq, k = sq.findIndex((p) => p && p.c === view.you && p.t === "k"), out = [];
	if (k < 0) { return out; }
	for (const [dr, df] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
		for (let r = (k >> 3) + dr, f = (k & 7) + df; r >= 0 && r < 8 && f >= 0 && f < 8; r += dr, f += df) {
			const q = sq[r * 8 + f];
			if (q && (q.c === view.you || q.t === "k")) { break; }
			out.push({ type: "active", card: card.id, target: { move: { from: sqName(k), to: sqName(r * 8 + f) } } });
			if (q) { break; }
		}
	}
	return out;
}

/**
 * @description Under fog, whether one of the player's cards lets this piece move without a card: their Heretical Subjection on it, their placed Escape Artist (in check: the fog can hide the
 * checker, so always), their placed Retaliation while it's open (only onto its target's square when the target is in sight). legal can't say: no move is listed
 * @param  {[object]} view [cards.view]
 * @param  {[object]} piece [the player's piece { id, c, t }]
 * @return {[function|null]} (to) => true for the squares it may go to without a card, null for none
 */
function cardlessUnderFog(view, piece) {
	const mine = (view.effects || []).filter((e) => e && e.owner === view.you && e.card).map((e) => e.card);
	if ((view.enchant || []).some((e) => e && e.owner === view.you && isCard(e.key, "heretical-subjection") && (e.pieces || []).includes(piece.id)) || mine.some((c) => isCard(c.key, "escape-artist"))) { return () => true; }
	const open = mine.find((c) => isCard(c.key, "retaliation") && c.open);
	if (!open) { return null; }
	const at = view.board.sq.findIndex((q) => q && q.id === open.target);
	return at < 0 ? () => true : (to) => to === sqName(at);
}

/* ---------------------------------------------------------------- */
// Picking
/* ---------------------------------------------------------------- */
// A PICK IN PROGRESS: { card, actions, picks }: THE LIFTED CARD (null: A PIECE PICKED DIRECTLY, OR A CHOICE), THE PLAYS STILL IN REACH & THE SQUARES PICKED SO FAR

/**
 * @description Lifts a card: the plays it can make. With no card (null) every legal action is in reach, for a choice
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[string|null]} cardId
 * @param  {[boolean]} hidden [cards.hidden: no move listed, a move card offers blindMoves]
 * @return {[object]} pick [{ card, actions, picks: [] }]
 */
function lift(legal, view, cardId, hidden = false) {
	if (cardId === null) { return { card: null, actions: legal.slice(), picks: [] }; }
	if (view.duel) { return { card: cardId, actions: [], picks: [] }; } // A CARD DUEL IS ON: A HAND CARD PLAYS NOTHING, UNDER FOG TOO
	const card = handCards(view).find((c) => c.id === cardId), discard = discardsFor(legal, view, cardId); // DISCARDS STAY LISTED UNDER FOG
	if (hidden && card && (card.kind === "king" || card.kind === "move")) { return { card: cardId, actions: [...blindMoves(view, card), ...discard], picks: [] }; }
	if (hidden && card && isCard(card.key, "last-stand")) { return { card: cardId, actions: [...blindLastStand(view, card), ...discard], picks: [] }; }
	return { card: cardId, actions: actionsFor(legal, view, cardId), picks: [] };
}

/**
 * @description A piece picked with nothing lifted: shortcutFor's moves from its square, or under fog the blind moves of the first card of its type (the King card for the king), & before them
 * the same moves without a card where cardlessUnderFog allows them (both forms of a square: the prompt chooses)
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[string]} square ["e2"]
 * @param  {[boolean]} hidden [cards.hidden]
 * @return {[object|null]} pick [null when it can't move]
 */
function pickPiece(legal, view, square, hidden = false) {
	if (view.duel) { return null; } // A CARD DUEL IS ON: NO PIECE IS PICKED UP, UNDER FOG TOO
	if (!hidden) {
		const actions = shortcutFor(legal, square);
		return actions.length ? { card: null, actions, picks: [square] } : null;
	}
	const p = view.board.sq.find((q, i) => q && sqName(i) === square);
	if (!p || p.c !== view.you) { return null; }
	const card = handCards(view).find((c) => (p.t === "k" ? c.kind === "king" : c.kind === "move" && (CARD_MOVES[c.piece] || "").includes(p.t))), free = cardlessUnderFog(view, p);
	const plain = free ? blindMoves(view, { id: null, piece: p.t }, square) : [];
	const heretic = (view.enchant || []).some((e) => e && e.owner === view.you && isCard(e.key, "heretical-subjection") && (e.pieces || []).includes(p.id));
	const steps = heretic ? blindMoves({ ...view, board: { ...view.board, castling: "", sq: view.board.sq.map((q) => (q === p ? { ...q, t: "k" } : q)) } }, { id: null, piece: "k" }, square) : []; // HERETICAL SUBJECTION: LIKE A KING TOO, THE ONE MOVE A CARD ADDS THAT THE ENGINE'S PLAIN ONES LACK
	const actions = [...[...plain, ...steps.filter((a) => !plain.some((b) => b.to === a.to))].filter((a) => free(a.to)), ...(card ? blindMoves(view, card, square) : [])];
	return actions.length ? { card: null, actions, picks: [square] } : null;
}

// THE SQUARE OF THE PIECE WITH THIS ID, null WHEN IT ISN'T ON THE BOARD (TAKEN, OR HIDDEN BY FOG)
function squareOf(board, id) {
	const i = board.sq.findIndex((p) => p && p.id === id);
	return i < 0 ? null : sqName(i);
}

/**
 * @description The squares the player clicks to make a play, in order: a move's from & to, an active target's piece, square, pieces or king move, a choice's piece.
 * A play with none (no target, a curse to clear, a card to choose) is made from a prompt's button
 * @param  {[object]} action
 * @param  {[object]} board [cards.view.board]
 * @return {[array]} squares
 */
function squaresOf(action, board) {
	const at = (id) => squareOf(board, id);
	if (action.type === "move") { return [action.from, action.to]; }
	if (action.type === "choice") { const s = typeof action.option === "string" ? at(action.option) : null; return s ? [s] : []; }
	const t = action.type === "active" ? action.target : null;
	if (!t) { return []; }
	if (t.move) { return [t.move.from, t.move.to]; }
	if (Array.isArray(t.pieces)) { return t.pieces.map(at).filter(Boolean); }
	if (t.square) { return [t.square]; }
	if (t.piece) { const s = at(t.piece); return s ? [s] : []; }
	return [];
}

const unordered = (a) => a.type === "active" && Boolean(a.target) && Array.isArray(a.target.pieces); // SWAP: ITS TWO PIECES IN EITHER ORDER

// WHETHER THE SQUARES PICKED SO FAR LEAD TO THIS PLAY
function fits(action, picks, board) {
	const s = squaresOf(action, board);
	if (picks.length > s.length) { return false; }
	return unordered(action) ? new Set(picks).size === picks.length && picks.every((p) => s.includes(p)) : picks.every((p, i) => s[i] === p); // A SWAP'S PIECE PICKED TWICE IS NO SWAP
}

/**
 * @description Where a pick stands: the squares that glow (the next square of every play still in reach) & the plays whose squares are all picked (one: send it;
 * several: a prompt chooses; with none picked: a button, or for an active with no target a second click on the card)
 * @param  {[object]} pick [lift, pickPiece or pick's]
 * @param  {[object]} board [cards.view.board]
 * @return {[object]} { glow: squares, sorted, ready: actions }
 */
function options(pick, board) {
	const open = pick.actions.filter((a) => fits(a, pick.picks, board));
	const ready = open.filter((a) => squaresOf(a, board).length === pick.picks.length);
	const next = (a) => { const s = squaresOf(a, board); return unordered(a) ? s.filter((x) => !pick.picks.includes(x)) : [s[pick.picks.length]]; };
	const glow = [...new Set(open.filter((a) => !ready.includes(a)).flatMap(next))].sort();
	return { glow, ready };
}

/**
 * @description Picks one more square
 * @param  {[object]} pick
 * @param  {[object]} board [cards.view.board]
 * @param  {[string]} square ["e4"]
 * @return {[object|null]} pick [null when no play goes through that square]
 */
function pick(sel, board, square) {
	const picks = [...sel.picks, square];
	return sel.actions.some((a) => fits(a, picks, board)) ? { ...sel, picks } : null;
}

/**
 * @description A left mouse press on a square (flow.js pressSquare, the drag's start): the pick a click on it would give (flow.js clickSquare: one of the lifted card's pieces through that card,
 * else the piece picked directly, a card of its type spent), when the square holds one of the player's pieces & that pick has squares to be dragged to. null leaves the press to the click:
 * a piece with nothing to play, the next square of the play being picked (a Swap's second piece), a piece that is itself the play (an active's target)
 * @param  {[object|null]} sel [the play being picked, null for none]
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[string]} square ["e2"]
 * @param  {[boolean]} hidden [cards.hidden]
 * @return {[object|null]} pick [the piece is held with it]
 */
function pressPick(sel, legal, view, square, hidden = false) {
	const board = view.board, p = board.sq[sqIndex(square)];
	if (!p || p.c !== view.you) { return null; }
	const on = sel ? pick(sel, board, square) : null;
	if (on && sel.picks.length) { return null; } // THE PLAY GOES ON THROUGH THIS SQUARE: THE CLICK'S
	const next = on || (sel && sel.card !== null && sel.picks.length ? pick({ ...sel, picks: [] }, board, square) : null) || pickPiece(legal, view, square, hidden);
	if (!next) { return null; }
	const { glow, ready } = options(next, board);
	return glow.length && !ready.length ? next : null;
}

/**
 * @description Whether the plays ready are one move's promotions (the same from & to): the 3D promotion cards choose the piece, as in a normal game
 * @param  {[array]} ready [options().ready]
 * @return {[boolean]}
 */
function promotionPick(ready) {
	return ready.length > 1 && ready.every((a) => a.type === "move" && Boolean(a.promotion) && a.from === ready[0].from && a.to === ready[0].to);
}

/**
 * @description What a card dragged with the mouse & let go over a place of the desk plays (Task 20e, flow.js dropCard). A hand card on the player's discard pile: its own free discard; an active on their
 * active spot: played at once when it has one play with no target, else its targets are picked next (its plays without its discard); the held passive on their passive pile: placed.
 * One of the player's placed cards (an opened pile's) on their discard pile: its drop. Only what legal lists (under fog, Last Stand's blind plays too, as lift), anything else puts the card back
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[object]} drag [{ from: "hand" | "pile", id }: the card dragged, from the hand or from an opened pile]
 * @param  {[object|null]} place [where it was let go (three/tableLayout.js placeAt): { side: "mine" | "his", place: "spot" | "passive" | "discard" }, null for nowhere]
 * @param  {[boolean]} hidden [cards.hidden]
 * @return {[object|null]} play [{ action }: sent, { pick }: the play being picked from here on, null: the card goes back]
 */
function dropPlay(legal, view, drag, place, hidden = false) {
	if (!place || place.side !== "mine") { return null; }
	const send = (action) => (action ? { action } : null);
	if (drag.from === "pile") { return send(place.place === "discard" && legal.find((a) => a.type === "drop" && a.card === drag.id)); }
	const card = handCards(view).find((c) => c.id === drag.id);
	if (!card) { return null; }
	if (place.place === "discard") { return send(legal.find((a) => a.type === "discard" && a.cards.length === 1 && a.cards[0] === card.id)); }
	if (place.place === "passive") { return send(card.kind === "passive" && legal.find((a) => a.type === "passive")); }
	if (card.kind !== "active") { return null; }
	const pick = { card: card.id, actions: lift(legal, view, card.id, hidden).actions.filter((a) => a.type === "active"), picks: [] };
	if (!pick.actions.length) { return null; }
	const { glow, ready } = options(pick, view.board);
	return !glow.length && ready.length === 1 ? { action: ready[0] } : { pick };
}

/**
 * @description The drops the keys & a tap offer as buttons for the player's own opened pile (the mouse drags the card to the discard pile, dropPlay): one per card of it whose drop legal lists.
 * Never one of Card Guy's cards, whatever legal says
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[string]} pile [the opened pile, a key of three/tableLayout.js PILES: only "mine" (the passives waiting) & "mineSpot" (the actives in effect) hold the player's cards]
 * @param  {[string|null]} id [only this card's (a tap on it), null: every card's (Enter on the pile)]
 * @return {[array]} actions [{ type: "drop", card }]
 */
function pileDrops(legal, view, pile, id = null) {
	const own = pile === "mine" ? (view.effects || []).filter((e) => e && e.owner === view.you && e.card).map((e) => e.card) : pile === "mineSpot" ? ((view.players[view.you] || {}).spot || []).filter(Boolean) : [];
	return own.filter((c) => !c.down && c.id !== undefined && (id === null || c.id === id)).map((c) => legal.find((a) => a.type === "drop" && a.card === c.id)).filter(Boolean);
}

/**
 * @description The plays a prompt offers as buttons. The mouse plays by dragging (Task 20e), so its prompt has no discard & no placing, & an active's plays only once the card was dropped on the
 * active spot (placed: its targets with no square) or squares are picked (two plays on the same squares). A curse's clear & a move's two forms stay. The keys & a tap keep every button
 * @param  {[array]} plays [the plays ready (options().ready)]
 * @param  {[object]} how [{ mouse: the pick is the mouse's, picks: the squares picked so far, placed: the card lies on the active spot }]
 * @return {[array]} plays
 */
function promptPlays(plays, { mouse = false, picks = 0, placed = false } = {}) {
	return mouse ? plays.filter((a) => a.type !== "discard" && a.type !== "passive" && (a.type !== "active" || picks > 0 || placed)) : plays;
}

/**
 * @description The keyboard's stops, in order: the hand, then the player's pieces with a move that needs no card (cardless in legal; under fog those cardlessUnderFog covers),
 * then each Board Effects pile that holds a card ("mine" first), then each active spot that holds one ("mineSpot", "hisSpot"), then the discard list once it holds one ("discard"). While a card duel is on: only the duel cards legal lets the player pick
 * @param  {[array]} legal [cards.legal]
 * @param  {[object]} view [cards.view]
 * @param  {[boolean]} hidden [cards.hidden]
 * @return {[array]} [{ kind: "hand", id } | { kind: "square", square } | { kind: "pile", pile } | { kind: "duel", index }]
 */
function focusList(legal, view, hidden) {
	if (view.duel) { return legal.filter((a) => a.type === "duel" && Number.isInteger(a.pick)).map((a) => ({ kind: "duel", index: a.pick })); }
	const me = view.you, opp = me === "w" ? "b" : "w";
	const squares = hidden ? view.board.sq.map((p, i) => (p && p.c === me && cardlessUnderFog(view, p) ? sqName(i) : null)).filter(Boolean)
		: [...new Set(legal.filter((a) => a.type === "move" && a.card === null).map((a) => a.from))];
	const piles = [["mine", me], ["his", opp]].filter(([, owner]) => (view.effects || []).some((e) => e && e.owner === owner && e.card)).map(([pile]) => pile);
	const spots = [["mineSpot", me], ["hisSpot", opp]].filter(([, owner]) => ((view.players[owner] || {}).spot || []).length).map(([pile]) => pile); // THE ACTIVE SPOTS OPEN AS THE PILES DO (TASK 20e)
	piles.push(...spots, ...((view.piled || []).length ? ["discard"] : [])); // THE DISCARD LIST, OPENED FROM EITHER DISCARD PILE (TASK 21a)
	return [...handCards(view).map((c) => ({ kind: "hand", id: c.id })), ...squares.sort().map((square) => ({ kind: "square", square })), ...piles.map((pile) => ({ kind: "pile", pile }))];
}

/* ---------------------------------------------------------------- */
// Words
/* ---------------------------------------------------------------- */
/**
 * @description What the second move card of a free discard's pair draws back (Task 20e: the first is remembered, view.players[you].kept). Before the floor was dropped (user ruling 2026-11-22: a card worth at least the lower of the two): "draw 1" with a pawn in the pair (anything),
 * else the lower card's own type, "draw a Rook or better" (two queens: "draw a Queen"; a floor of 3 "draw a Knight / Bishop or better"). A bare king: "no card back". When the player has no piece worth more than that floor
 * (nothing better to draw, or nothing worth it: it drops) it names the most valuable card type they can still draw: "draw a Knight / Bishop" with a knight or a bishop left (review 2 M6).
 * The player's own pieces are in view.board under fog too
 * @param  {[array]} pair [the 2 move cards, as handCards has them]
 * @param  {[object]} view [cards.view]
 * @return {[string]} words
 */
function drawBack(pair, view) {
	const best = view.board.sq.some((p) => p && p.c === view.you && p.t !== "k");
	return best ? "draw 1" : "no card back"; // A BARE KING DRAWS NONE. THE DRAW-BACK IS RANDOM (USER RULING 2026-11-22, AFTER A TRIAL OF A FLOOR)
	// THE DRAW-BACK FLOOR'S LABEL, DROPPED BY THE USER 2026-11-22 AFTER A TRIAL: THE DRAW-BACK IS RANDOM AGAIN. KEPT FOR REFERENCE:
	// const low = pair.reduce((a, b) => (VALUE[b.piece] < VALUE[a.piece] ? b : a)).piece, floor = VALUE[low];
	// const own = Object.keys(CARD_MOVES).filter((t) => view.board.sq.some((p) => p && p.c === view.you && CARD_MOVES[t].includes(p.t))), best = Math.max(0, ...own.map((t) => VALUE[t])); // THE CARD TYPES THE PLAYER CAN DRAW
	// if (!best) { return "no card back"; } // A BARE KING DRAWS NONE
	// if (!(floor > 1)) { return "draw 1"; } // A PAWN (OR A CARD THE VIEW DOESN'T NAME): ANYTHING
	// if (floor >= best) { return `draw a ${own.filter((t) => VALUE[t] === best).map((t) => PIECE_NAMES[t]).join(" or ")}`; }
	// return `draw a ${PIECE_NAMES[low]} or better`; // TWO QUEENS ARE floor >= best: "draw a Queen"
}

/**
 * @description What a prompt's button says for a play
 * @param  {[object]} action
 * @param  {[object]} view [cards.view]
 * @param  {[object]} catalog [cards.catalog]
 * @param  {[object]} taken [the last card-taken event's card, flow.js keeps it: names Pickpocket's stolen card, null when it isn't at hand (a reload)]
 * @return {[string]} label
 */
function label(action, view, catalog, taken = null) {
	const board = view.board, opp = view.you === "w" ? "b" : "w";
	const pieceAt = (id) => { const i = board.sq.findIndex((p) => p && p.id === id); return i < 0 ? null : `${PIECE_NAMES[board.sq[i].t] || "Piece"} on ${sqName(i)}`; };
	const cardName = function (id) {
		const shown = (view.players[opp] && view.players[opp].hand && view.players[opp].hand.shown) || [];
		const c = [...handCards(view), ...shown].find((x) => x.id === id);
		if (!c) { return null; }
		if (c.key === "move") { return `${PIECE_NAMES[c.piece] || "Move"} card`; }
		if (c.id === "king") { return "King card"; }
		return (catalog[c.key] && catalog[c.key].name) || "card";
	};
	const t = action.target;
	switch (action.type) {
		case "move": return (action.promotion ? PIECE_NAMES[action.promotion] : `${action.from} to ${action.to}`) + (action.card === null ? " without a card" : "");
		case "passive": return "Place in Board Effects (uses your turn)";
		case "drop": { // ONE OF THE PLAYER'S PLACED CARDS: A PASSIVE WAITING OR AN ACTIVE IN EFFECT
			const c = [...(view.effects || []).map((e) => e && e.card), ...((view.players[view.you] || {}).spot || [])].find((x) => x && x.id === action.card);
			return `Discard your ${(c && catalog[c.key] && catalog[c.key].name) || "card"} from the table`;
		}
		case "discard": {
			const held = action.cards.map((id) => handCards(view).find((c) => c.id === id) || {});
			if (held[0].kind === "passive") { return `Reroll your ${cardName(action.cards[0]) || "passive"} (new passive now)`; }
			const back = held[0].kind !== "move" ? "new one at turn end" : view.players[view.you].kept ? drawBack(held, view) : "the next one discarded draws 1"; // A MOVE CARD: THE FIRST IS REMEMBERED, ITS PAIR DRAWS (TASK 20e)
			return `Discard your ${action.cards.map((id) => cardName(id) || "card").join(" & ")} (${back})`;
		}
		case "clear": {
			if (action.discard === undefined) { return "Pay: skip this move"; }
			return `Pay with your ${[].concat(action.discard).map((id) => cardName(id) || "card").join(" & ")}`;
		}
		case "choice": {
			const o = action.option;
			if (typeof o !== "string") { return String(o); }
			if (view.pending && view.pending.stolen === o) { // PICKPOCKET'S TAKE-BACK: THE CARD IS IN CARD GUY'S HIDDEN HAND NOW, ONLY THE card-taken EVENT NAMED IT
				const name = taken && taken.id === o && (taken.key === "move" ? PIECE_NAMES[taken.piece] : catalog[taken.key] && catalog[taken.key].name);
				return name ? `Your ${name} card` : "The card taken from you";
			}
			if (view.pending && isCard(view.pending.card, "all-or-nothing") && PIECE_NAMES[o]) { return PIECE_NAMES[o]; } // THE DUEL'S FIRST WIN: KNIGHT OR BISHOP
			return pieceAt(o) || (catalog[o] && catalog[o].name) || cardName(o) || (o[0] === "?" ? "A hidden card" : o);
		}
		case "active": {
			if (!t) { return "Play it"; }
			if (t.curses === "all") { return "Clear all your curses"; }
			if (t.t) { return PIECE_NAMES[t.t] || t.t; }
			if (t.s) { return `Remove ${capital(t.s)} from the ${pieceAt(t.piece) || "piece"}`; }
			if (t.mark) { return `Mark the ${pieceAt(t.mark) || "piece"}`; }
			if (t.enchant) { const e = (view.enchant || []).find((x) => x.id === t.enchant); return `End ${(e && catalog[e.key] && catalog[e.key].name) || "it"} on the ${pieceAt(t.piece) || "piece"}`; }
			if (t.move) { return `King to ${t.move.to}`; }
			if (t.square) { return t.square; }
			if (Array.isArray(t.pieces)) { return t.pieces.map((id) => pieceAt(id) || "a piece").join(" & "); }
			if (t.piece) { return pieceAt(t.piece) || "That piece"; }
			return "Play it";
		}
		case "duel": return action.stop ? "Stop" : "Continue"; // A PICK IS NEVER A BUTTON: ITS CARD IS CLICKED ON THE TABLE
		default: return capital(action.type);
	}
}

/**
 * @description The arrows step through a list (the hand, or the squares that glow) & stop at its ends. Nothing focused yet: the first
 * @param  {[number]} n [the list's length]
 * @param  {[number|null]} index [the focused one]
 * @param  {[string]} key [a KeyboardEvent.key]
 * @return {[number|null]} index [null for an empty list; index itself for other keys]
 */
function stepFocus(n, index, key) {
	if (!n) { return null; }
	const back = key === "ArrowUp" || key === "ArrowLeft", on = key === "ArrowDown" || key === "ArrowRight";
	if (!back && !on) { return index; }
	if (index === null || index === undefined) { return 0; }
	return Math.min(n - 1, Math.max(0, index + (on ? 1 : -1)));
}

/**
 * @description What a Chess Cards game's key does (cards/flow.js handKey). While the game is on the arrows & Enter never reach the page's nav, on the turn or off it: off it the
 * arrows still step the hand's focus & Enter does nothing. A focused button keeps Enter (Tab put it there: the menu stays reachable), an arrow takes the focus off it first, as
 * handleCardKey does. While the promotion cards are out only Escape is the hand's. A held key (repeat) does nothing more
 * @param  {[object]} k [{ key: a KeyboardEvent.key, repeat, on: a game loaded & not over, yours: the player may pick (flow.js yourMove), button: a button or link has the focus,
 * promoting: the promotion cards are out, picked: a pick the player can put down, pile: a pile is opened (Escape closes it, on the turn or off it, once any pick is down), zoomed: the camera is zoomed in on a hand card (Escape ends it as it closes a pile: review M4, Task 21a) }]
 * @return {[string]} plan ["page": the page has it (its nav, the focused button, handleCardKey), "stop": nobody, "hand": the hand uses it, "blur": the focus leaves the button, then "hand"]
 */
function keyPlan({ key, repeat = false, on, yours, button = false, promoting = false, picked = false, pile = false, zoomed = false }) {
	if (!on) { return "page"; }
	if (key === "Escape") { return (yours && picked) || pile || zoomed ? "hand" : "page"; } // NOTHING TO PUT DOWN, NO PILE TO CLOSE & NO ZOOM TO END: THE MENU'S ESCAPE
	if (repeat) { return "stop"; }
	if (key === "Enter" && button) { return "page"; }
	if (promoting) { return "page"; } // handleCardKey HAS THE ARROWS & ENTER
	if (key === "Enter" && !yours) { return "stop"; }
	return button ? "blur" : "hand";
}

/**
 * @description The prompt's button the keys focus: Cancel (after the plays) when the first play is a discard or a placed card's drop, so Enter alone never discards a dimmed card (N2) or drops a card, else the first
 * @param  {[array]} actions [the prompt's plays, its buttons in order; Cancel follows them]
 * @return {[number]} index [of the button]
 */
function promptFocus(actions) {
	return actions.length && (actions[0].type === "discard" || actions[0].type === "drop") ? actions.length : 0;
}

/**
 * @description Whether the player is asked for an answer: every legal action is a choice's option, or a card duel's Stop or Continue (step decide). The prompt's buttons are all of them,
 * with no Cancel, & nothing else is picked meanwhile
 * @param  {[array]} legal [cards.legal]
 * @return {[boolean]}
 */
function asking(legal) {
	return legal.length > 0 && legal.every((a) => a.type === "choice" || (a.type === "duel" && a.stop !== undefined));
}

/**
 * @description The key of the card a choice or the card duel's Stop or Continue is asked for (flow.js askingCard: the prompt's title & border): while a duel is on its own card, the version
 * played, also for All or Nothing's Knight or Bishop (the engine asks it with the base key), else the pending choice's card
 * @param  {[object]} view [cards.view]
 * @return {[string|null]} key
 */
function askedBy(view) {
	const p = view.pending, d = view.duel;
	return (d && (!p || p.card === "all-or-nothing") ? d.card : p && p.card) || null;
}

/**
 * @description Whether a click on a hand card zooms in on it to be read (an ability card: an active, the passive, a curse) rather than lifting it to be played (a move card, the King card). User ruling, Task 21a
 * @param  {[string]} kind [handCards' kind]
 * @return {[boolean]}
 */
function zooms(kind) {
	return kind === "active" || kind === "passive" || kind === "curse";
}

/**
 * @description A hand card clicked, tapped or picked with the keys (flow.js clickCard): an ability card (zooms) clicked or tapped is read, never lifted (no high lift, no readable copy: user rulings R1 R2, Task 21a),
 * & the camera zooms in on it whoever's turn it is (R4), but not while an answer's steps play, a card duel is on or the promotion cards are out (the camera can't frame it then: review M1). The keys' pick lifts as before
 * @param  {[object]} c [{ kind: handCards' kind, keys: the keys picked it, showing: an answer's steps play (flow.js showing), duel: a card duel is on, promoting: the promotion cards are out }]
 * @return {[object]} { read: it isn't lifted, zoom: the camera zooms in on it (three/pointer.js pickTable) }
 */
function handRead({ kind, keys, showing, duel, promoting }) {
	const read = zooms(kind) && !keys;
	return { read, zoom: read && !showing && !duel && !promoting };
}

/**
 * @description The hand card the table lifts (three/cardTable.js lift: the high lift & an ability card's readable copy): the card being played, unless a click or tap picked it to be read (handRead),
 * else the card the mouse let go on one of the player's places while its targets are picked or its play is on its way (flow.js onPlace)
 * @param  {[object|null]} sel [the play being picked]
 * @param  {[string|null]} onPlace [flow.js onPlace]
 * @param  {[string|null]} read [the ability card a click or tap picked last, null for none]
 * @return {[string|null]} id
 */
function liftedCard(sel, onPlace, read) {
	return sel && !(read && sel.card === read) ? sel.card : onPlace;
}

module.exports = { asking, askedBy, movesForCard, targetsForActive, shortcutFor, canPlace, handCards, actionsFor, dimmed, costsSkull, blindMoves, lift, pickPiece, pressPick, squaresOf, options, pick, promotionPick, dropPlay, pileDrops, promptPlays, focusList, label, stepFocus, keyPlan, promptFocus, zooms, handRead, liftedCard, PIECE_NAMES, VALUE, CARD_MOVES };
