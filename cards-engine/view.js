/*
 *  view.js  --  chess cards engine
 *	What each player may see: playerView and playerEvents remove what a player may not see (the server sends only these); fromView rebuilds a playable state from a view for Vesper's search.
 *
 */

const rng = require("./rng.js");
const board = require("./board.js");
const hand = require("./hand.js");
const { inCheck } = require("./rules.js");
const { makeCtx } = require("./ctx.js");
const { CARDS, baseKey } = require("./cards/index.js");
const duel = require("./duel.js");
const { isSight } = require("./cards/sight.js");

const other = (c) => (c === "w" ? "b" : "w");
const copy = (x) => JSON.parse(JSON.stringify(x));
const byId = (a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1));
const handOf = (p) => [...p.moves, ...p.actives, ...(p.passive ? [p.passive] : []), ...p.curses];
const disguise = (c) => ({ id: c.id, key: "move", piece: c.piece }); // MIRAGE AS ITS HOLDER SEES IT
const OPEN_FIELDS = ["king", "used", "skips", "refillLock", "curseWait", "lostTurns", "kingSkulls", "captured"]; // THE OPPONENT'S PLAYER FIELDS A VIEW SHOWS
const onHalf = (i, color) => (color === "w" ? i >= 32 : i < 32); // SQUARE INDEX i (0 = a8) ON color'S HALF OF THE BOARD

/**
 * @description The ids of color's pieces on color's half: the pieces a Fog of War of color's hides.
 */
const hiddenIds = (state, color) => state.board.sq.filter((p, i) => p && p.c === color && onHalf(i, color)).map((p) => p.id);

const SQUARE_KEYS = ["square", "from", "to", "ep", "sq", "through"]; // FIELDS THAT HOLD SQUARE NAMES, NEVER PIECE IDS

/**
 * @description x with every trace of these piece ids removed, in place, at any depth: an array element or a property value equal to one, and a property keyed by one; fields in SQUARE_KEYS are left alone.
 * shortcut: a square name held under any other key (a card target) that equals a hidden black piece's id is removed too; name such a field in SQUARE_KEYS if a client misses it.
 */
function scrub(x, ids) {
	if (!x || typeof x !== "object" || !ids.length) return x;
	if (Array.isArray(x)) for (let i = x.length - 1; i >= 0; i--) if (ids.includes(x[i])) x.splice(i, 1);
	for (const k of Object.keys(x)) {
		if (SQUARE_KEYS.includes(k)) continue; // A SQUARE NAME (b1..b8) CAN LOOK LIKE A BLACK PIECE'S ID
		if (!Array.isArray(x) && (ids.includes(k) || ids.includes(x[k]))) delete x[k];
		else scrub(x[k], ids);
	}
	return x;
}

/**
 * @description True when color's pieces on color's half are hidden from viewer: viewer is the other player and color has a Fog of War (any version) up.
 */
function fogged(state, color, viewer) {
	return color !== viewer && state.enchant.some((e) => baseKey(e.key) === "fog-of-war" && e.owner === color);
}

/**
 * @description True when viewer may see this card of the opponent's: face up, any curse (the giver knows it), the whole hand while the opponent's base Fog of War lasts (its versions, under their own keys, keep it hidden), revealed by viewer's Foresight/Witness (viewer's seen.ids, or the whole hand with seen.all), or an option of viewer's current choice that shows the opponent's cards (pending.show: Pickpocket's pick).
 */
function shownTo(state, viewer, card) {
	const opp = other(viewer), seen = state.players[viewer].seen, p = state.pending;
	return !!card.faceUp || state.enchant.some((e) => e.key === "fog-of-war" && e.owner === opp) || state.players[opp].curses.some((c) => c.id === card.id)
		|| (!!seen && (!!seen.all || seen.ids.includes(card.id))) || (!!p && !!p.show && p.player === viewer && p.options.includes(card.id));
}

/**
 * @description The state as player may see it: no rng; the opponent's Player rebuilt from OPEN_FIELDS plus hand { count, shown } (count = every card held but the King card; shown = the cards player may see plus Interdicted Foresight's fakes, by id, a fake under a card shown for real left out), so a field not listed stays hidden; no enchantment's data.ids or data.fake (sight bookkeeping); Phalanx's denied and Peasant Immunity's stopping only on player's own passives, and not under the opponent's Fog of War (they tell a hidden piece is a pawn); no seen field on player's own side (it would tell the fakes apart); an entered Mirage in player's own hand as a move card of its fake type, a waiting one (given, not yet entered at a refill) nowhere; Trapdoor's square only for its owner; the current pending choice in full only to its player (the other sees { player, kind }), queued choices to nobody; under the opponent's Fog of War its pieces on its half are not in the view at all (their squares null, board.hidden = how many, and every field holding one of their ids removed: statuses, enchantment pieces and data, card fields, choice options), its captured list all "?", its castling rights and en passant square removed, and the history [] and half 0 (their castling and en passant tokens and the reset counter name fogged pieces; the state keeps both). View.you = player.
 */
function playerView(state, player) {
	const v = copy(state), opp = other(player), me = v.players[player], o = v.players[opp], seen = state.players[player].seen;
	const vo = v.players[opp] = Object.fromEntries(OPEN_FIELDS.map((k) => [k, o[k]]));
	delete v.rng;
	v.you = player;
	me.moves = hand.moveCards(me).map((c) => (c.key === "move" ? c : disguise(c))); // BY ID; AN ENTERED MIRAGE AS A MOVE CARD
	me.curses = me.curses.filter((c) => baseKey(c.key) !== "mirage"); // A WAITING ONE SHOWS NOWHERE UNTIL IT ENTERS AT A REFILL
	delete me.seen;
	const real = handOf(o).filter((c) => shownTo(state, player, c));
	const shown = real.concat(seen ? seen.fake.filter((f) => !real.some((c) => c.id === f.id)) : []).sort(byId); // A FAKE WEARING THE ID OF A CARD SHOWN FOR REAL GIVES WAY
	vo.hand = { count: handOf(o).length, shown };
	for (const e of v.enchant) if (baseKey(e.key) === "trapdoor" && e.owner !== player && e.data) delete e.data.square;
	for (const e of v.enchant) if (e.data && isSight(e)) { delete e.data.ids; delete e.data.fake; } // WHICH CARDS A SIGHT SHOWS, AND WHICH ARE FAKE (sight.js), STAY HIDDEN
	const fog = fogged(state, opp, player);
	for (const e of v.effects) if (fog || e.owner !== player) { delete e.card.denied; delete e.card.stopping; } // PHALANX'S AND PEASANT IMMUNITY'S BOOKKEEPING READS TRUE PIECE TYPES (A FOGGED "?" PAWN): player'S OWN STAYS WHILE NO FOG HIDES A PIECE (fromView NEEDS IT TO PLAY AS THE REAL GAME)
	if (v.duel) duel.hide(v.duel); // NO DECK, NO FACE-DOWN CARD, FOR EITHER PLAYER
	if (v.pending) { // THE CURRENT CHOICE ONLY: QUEUED ONES (next) SHOW TO NOBODY UNTIL THEY ARE CURRENT
		const { next, ...cur } = v.pending;
		v.pending = cur.player === player ? cur : { player: cur.player, kind: cur.kind }; // THE OTHER PLAYER: WHAT THE choice EVENT TOLD THEM
	}
	if (fog) {
		const b = v.board, letters = opp === "w" ? /[PNBRQK]/g : /[pnbrqk]/g;
		const ids = hiddenIds(state, opp);
		b.sq.forEach((p, i) => { if (p && ids.includes(p.id)) b.sq[i] = null; });
		b.hidden = ids.length; // HOW MANY, NEVER WHICH OR WHERE (fromView PLACES THAT MANY)
		scrub(v, ids); // STATUSES, ENCHANTMENT PIECES AND DATA, CARD FIELDS, CHOICE OPTIONS: NOTHING KEEPS A HIDDEN PIECE'S ID
		vo.captured = vo.captured.map(() => "?");
		b.history = [];
		b.half = 0;
		b.castling = b.castling.replace(letters, "") || "-";
		if (b.ep && b.ep[1] === (opp === "w" ? "3" : "6")) b.ep = null; // AN EN PASSANT SQUARE NAMES THE PIECE A PAWN
	}
	return v;
}

/**
 * @description The events of one action as player may see them, given state = the state after the action (inputs unchanged): under a Fog of War no event names a piece hidden after the action or a fogged piece taken in it (the id is removed wherever it stands: piece, by, any card field); a hidden piece's move is { type, player } alone and any other event about it is left out; a piece that came out of the fog loses its from; the fogged side's captures and promotions are masked, on the open half too (deliberately more than the view hides: never less); the opponent's draws and discards of cards player can't see become { type, player }, except one under a fake of player's (a sight entry's data.fake: Interdicted Foresight), which carries that fake, as real sight would carry the card; player's own Mirage reads as a move card (its curse-given is left out: it shows only once it has taken over a held move card at a refill: that card's id and type), except in its curse-cleared and curse-fired (it is gone then); the other player sees it as it is; a Trapdoor placement by the opponent loses its square; under the opponent's fog its moves lose the spent card and castle flag, and captures and promotions of its pieces t "?".
 */
function playerEvents(state, events, player) {
	const opp = other(player), fog = fogged(state, opp, player);
	const colorOf = (ev) => { // FROM THE BOARD (OR THE CAPTURE EVENT), NEVER THE ID: A PIECE HANDED OVER KEEPS ITS ID
		const q = state.board.sq.find((x) => x && x.id === ev.piece), cap = events.find((e) => e.type === "capture" && e.piece === ev.piece && e.c);
		return ev.c || (q ? q.c : cap && cap.c);
	};
	const gone = fog ? events.filter((e) => e.type === "capture" && colorOf(e) === opp).map((e) => e.piece) : []; // TAKEN IN THIS ACTION: OFF THE BOARD, STILL NOT NAMED
	const hid = fog ? hiddenIds(state, opp) : [];
	const fakes = state.enchant.filter((e) => e.owner === player && e.data && e.data.fake && isSight(e)).flatMap((e) => e.data.fake); // KEPT AFTER resight DROPS A GONE CARD'S FAKE
	return copy(events).map((ev) => scrub(see(ev), hid.concat(gone))).filter(Boolean);
	function see(ev) {
		const c = ev.card && typeof ev.card === "object" ? ev.card : null;
		if (c) { delete c.denied; delete c.stopping; } // AS IN THE VIEW: THIS BOOKKEEPING NAMES A FOGGED PAWN
		if (c && baseKey(c.key) === "mirage" && (ev.type === "curse-given" ? other(ev.player) : ev.player) === player) { // player HOLDS IT (A curse-given NAMES THE GIVER)
			if (ev.type === "curse-given") return null;
			if (ev.type !== "curse-cleared" && ev.type !== "curse-fired") ev.card = disguise(c);
		}
		if (ev.veiled) { // TREMOR'S FROZEN (GIVEN OR ENDED) ON A PAWN STILL FOGGED: NOT TOLD
			const i = state.board.sq.findIndex((q) => q && q.id === ev.piece);
			if (fog && i >= 0 && state.board.sq[i].c === opp && onHalf(i, opp)) return null;
			delete ev.veiled;
		}
		if (hid.includes(ev.piece)) { // A PIECE HIDDEN NOW: ITS MOVE IS TOLD BARE, ANYTHING ELSE ABOUT IT NOT AT ALL
			if (ev.type !== "move") return null;
			return { type: "move", player: ev.player };
		}
		if (fog && ev.type === "move" && colorOf(ev) === opp && onHalf(board.sqIndex(ev.from), opp)) delete ev.from; // IT CAME OUT OF THE FOG: WHERE IT STOOD STAYS HIDDEN
		if (fog && (ev.type === "capture" || ev.type === "promote") && colorOf(ev) === opp) ev.t = "?";
		if (ev.player !== opp) return ev;
		if ((ev.type === "draw" || ev.type === "discard") && c && !shownTo(state, player, c)) {
			const f = fakes.find((x) => x.id === c.id);
			return f ? { ...ev, card: { ...f } } : { type: ev.type, player: opp };
		}
		if (c && baseKey(c.key) === "trapdoor") { delete ev.square; delete ev.target; }
		if (fog && ev.type === "move") { delete ev.card; delete ev.castle; delete ev.through; }
		return ev;
	}
}

/**
 * @description Give color's "?" pieces types from ctx.rng: a king (unless color's king is in sight, off its fogged half) and the rest from a shuffled starting set (queens past it), no pawn on a back rank. Re-drawn, one try per "?" piece, until the side not to move isn't in check; if no try works the last one stays (that position is illegal).
 */
function fillPieces(ctx, color) {
	const sq = ctx.state.board.sq, unknown = sq.map((p, i) => i).filter((i) => sq[i] && sq[i].c === color && sq[i].t === "?");
	const king = sq.some((p) => p && p.c === color && p.t === "k");
	for (const k of king ? unknown.map(() => -1) : ctx.rng.shuffle([...unknown])) {
		const pool = ctx.rng.shuffle([..."qrrbbnnpppppppp"]);
		for (const i of unknown) {
			const j = i < 8 || i >= 56 ? pool.findIndex((t) => t !== "p") : 0;
			sq[i].t = i === k ? "k" : (j >= 0 && pool[j]) ? pool.splice(j, 1)[0] : "q";
		}
		if (!inCheck(ctx.state, other(ctx.state.board.turn))) return;
	}
}

/**
 * @description Rebuild color's hand from { count, shown }: shown cards to their slots by kind, then the unknown rest drawn from ctx.rng (move cards up to 6, an active if none is shown, then move cards).
 */
function fillHand(ctx, color) {
	const p = ctx.state.players[color], { count, shown } = p.hand;
	delete p.hand;
	Object.assign(p, { moves: [], actives: [], passive: null, curses: [] });
	for (const c of shown) {
		const kind = c.key === "move" ? "move" : CARDS[c.key] && CARDS[c.key].kind;
		if (kind === "move") p.moves.push(c);
		else if (kind === "passive" && !p.passive) p.passive = c;
		else if (kind === "curse") p.curses.push(c);
		else p.actives.push(c);
	}
	let left = count - shown.length;
	while (left > 0 && hand.moveCards(p).length < hand.MOVES && hand.drawMove(ctx, color)) left--; // A SHOWN MIRAGE COUNTS AS A MOVE CARD
	if (left > 0 && !p.actives.length && hand.drawCard(ctx, color, "active")) left--;
	while (left > 0 && hand.moveCards(p).length < hand.MOVE_CAP && hand.drawMove(ctx, color)) left--;
}

/**
 * @description A full state from a view, for Vesper's search only: rng from seed (rng.seed: a 64-character hex string or an integer), the fogged pieces (board.hidden of them) put on empty squares of their half under ids "<colour>?<n>" and given types, and the opponent's unknown cards, all filled from it (deterministic for a view and seed), seen null. The view is not changed. A hidden Trapdoor stays without its square.
 */
function fromView(view, seed) {
	const s = copy(view);
	delete s.you;
	s.rng = rng.seed(seed);
	const ctx = makeCtx(s);
	ctx.trigger = () => {}; // FILLING IN HIDDEN CARDS IS NOT PLAY: NO CARD FIRES ON THESE DRAWS
	if (s.board.hidden) { // THE FOGGED PIECES, GUESSED ONTO EMPTY SQUARES OF THEIR HALF ("?" TYPES, FILLED BELOW)
		const c = other(view.you), free = s.board.sq.map((p, i) => i).filter((i) => !s.board.sq[i] && onHalf(i, c));
		ctx.rng.shuffle(free).slice(0, s.board.hidden).forEach((i, n) => { s.board.sq[i] = { id: c + "?" + n, c, t: "?" }; });
	}
	delete s.board.hidden;
	for (const c of ["w", "b"]) fillPieces(ctx, c);
	for (const c of ["w", "b"]) {
		if (s.players[c].hand) fillHand(ctx, c);
		s.players[c].seen = null;
		s.players[c].lostTurns = s.players[c].lostTurns || 0; // A VIEW FROM BEFORE THE FIELD
		if (s.players[c].kingSkulls === undefined) s.players[c].kingSkulls = require("./index.js").KING_SKULLS; // LAZY: index.js REQUIRES THIS FILE
	}
	if (s.duel) duel.fill(ctx, s.duel); // THE DUEL'S HIDDEN CARDS AND DECK, DEALT AGAIN FROM THE SEED
	return s;
}

/**
 * @description FEN of a state's or a view's board; a fogged view prints its hidden squares empty.
 */
function toFen(stateOrView) {
	return board.toFen(stateOrView.board);
}

/**
 * @description The legal actions player is told: all of them, but under the opponent's Fog of War none that would show where a hidden piece stands: no move, no action with a move in it (Last Stand) and none naming a hidden piece. The rules don't change: applyAction still takes any legal action.
 */
function playerLegal(state, player) {
	const all = require("./turn.js").legalActions(state, player); // LAZY: turn.js LOADS THE CARDS, WHICH LOAD THIS FILE'S NEIGHBOURS
	if (!fogged(state, other(player), player)) return all;
	const ids = hiddenIds(state, other(player));
	return all.filter((a) => !JSON.stringify(a).includes('"move"') && !ids.some((id) => JSON.stringify(a).includes('"' + id + '"')));
}

module.exports = { playerView, playerEvents, fromView, toFen, shownTo, playerLegal, fogged };
