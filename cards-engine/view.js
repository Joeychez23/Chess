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
const { CARDS } = require("./cards/index.js");
const duel = require("./duel.js");

const other = (c) => (c === "w" ? "b" : "w");
const copy = (x) => JSON.parse(JSON.stringify(x));
const byId = (a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1));
const handOf = (p) => [...p.moves, ...p.actives, ...(p.passive ? [p.passive] : []), ...p.curses];
const disguise = (c) => ({ id: c.id, key: "move", piece: c.piece }); // MIRAGE AS ITS HOLDER SEES IT
const OPEN_FIELDS = ["king", "used", "skips", "refillLock", "curseWait", "lostTurns", "kingSkulls", "captured"]; // THE OPPONENT'S PLAYER FIELDS A VIEW SHOWS

/**
 * @description True when color's pieces are hidden from viewer: viewer is the other player and color has a Fog of War up.
 */
function fogged(state, color, viewer) {
	return color !== viewer && state.enchant.some((e) => e.key === "fog-of-war" && e.owner === color);
}

/**
 * @description True when viewer may see this card of the opponent's: face up, any curse (the giver knows it), the whole hand while the opponent's fog lasts, or revealed by viewer's Foresight/Witness (viewer's seen.ids).
 */
function shownTo(state, viewer, card) {
	const opp = other(viewer), seen = state.players[viewer].seen;
	return !!card.faceUp || fogged(state, opp, viewer) || state.players[opp].curses.some((c) => c.id === card.id) || (!!seen && seen.ids.includes(card.id));
}

/**
 * @description The state as player may see it: no rng; the opponent's Player rebuilt from OPEN_FIELDS plus hand { count, shown } (count = every card held but the King card; shown = the cards player may see plus Interdicted Foresight's fakes, by id), so a field not listed stays hidden; no seen field on player's own side (it would tell the fakes apart); Mirage in player's own hand as a move card of its fake type; Trapdoor's square only for its owner; the current pending choice in full only to its player (the other sees { player, kind }), queued choices to nobody; under the opponent's Fog of War its pieces t "?", its captured list all "?", its castling rights and en passant square removed, and the history [] and half 0 (their castling and en passant tokens and the reset counter name fogged pieces; the state keeps both). View.you = player.
 */
function playerView(state, player) {
	const v = copy(state), opp = other(player), me = v.players[player], o = v.players[opp], seen = state.players[player].seen;
	const vo = v.players[opp] = Object.fromEntries(OPEN_FIELDS.map((k) => [k, o[k]]));
	delete v.rng;
	v.you = player;
	me.moves = [...me.moves, ...me.curses.filter((c) => c.key === "mirage").map(disguise)].sort(byId);
	me.curses = me.curses.filter((c) => c.key !== "mirage");
	delete me.seen;
	const shown = handOf(o).filter((c) => shownTo(state, player, c)).concat(seen ? seen.fake : []).sort(byId);
	vo.hand = { count: handOf(o).length, shown };
	for (const e of v.enchant) if (e.key === "trapdoor" && e.owner !== player && e.data) delete e.data.square;
	if (v.duel) duel.hide(v.duel); // NO DECK, NO FACE-DOWN CARD, FOR EITHER PLAYER
	if (v.pending) { // THE CURRENT CHOICE ONLY: QUEUED ONES (next) SHOW TO NOBODY UNTIL THEY ARE CURRENT
		const { next, ...cur } = v.pending;
		v.pending = cur.player === player ? cur : { player: cur.player, kind: cur.kind }; // THE OTHER PLAYER: WHAT THE choice EVENT TOLD THEM
	}
	if (fogged(state, opp, player)) {
		const b = v.board, letters = opp === "w" ? /[PNBRQK]/g : /[pnbrqk]/g;
		for (const p of b.sq) if (p && p.c === opp) p.t = "?";
		vo.captured = vo.captured.map(() => "?");
		b.history = [];
		b.half = 0;
		b.castling = b.castling.replace(letters, "") || "-";
		if (b.ep && b.ep[1] === (opp === "w" ? "3" : "6")) b.ep = null; // AN EN PASSANT SQUARE NAMES THE PIECE A PAWN
	}
	return v;
}

/**
 * @description The events of one action as player may see them, given state = the state after the action (inputs unchanged): the opponent's draws and discards of cards player can't see become { type, player }; a Mirage reads as a move card to everyone but its giver, and its curse-given as player's draw; a Trapdoor placement by the opponent loses its square; under the opponent's fog its moves lose the spent card and castle flag, and captures and promotions of its pieces t "?".
 */
function playerEvents(state, events, player) {
	const opp = other(player), fog = fogged(state, opp, player);
	const colorOf = (ev) => { // FROM THE BOARD (OR THE CAPTURE EVENT), NEVER THE ID: A PIECE HANDED OVER KEEPS ITS ID
		const q = state.board.sq.find((x) => x && x.id === ev.piece), cap = events.find((e) => e.type === "capture" && e.piece === ev.piece && e.c);
		return ev.c || (q ? q.c : cap && cap.c);
	};
	const gave = (c) => state.players[opp].curses.some((x) => x.id === c.id); // A MIRAGE PLAYER GAVE SITS IN THE OPPONENT'S HAND
	return copy(events).map((ev) => {
		const c = ev.card && typeof ev.card === "object" ? ev.card : null;
		if (c && c.key === "mirage" && !gave(c)) {
			if (ev.type === "curse-given") return { type: "draw", player, card: disguise(c) };
			ev.card = disguise(c);
		}
		if (fog && (ev.type === "capture" || ev.type === "promote") && colorOf(ev) === opp) ev.t = "?";
		if (ev.player !== opp) return ev;
		if ((ev.type === "draw" || ev.type === "discard") && c && !shownTo(state, player, c)) return { type: ev.type, player: opp };
		if (c && c.key === "trapdoor") { delete ev.square; delete ev.target; }
		if (fog && ev.type === "move") { delete ev.card; delete ev.castle; }
		return ev;
	});
}

/**
 * @description Give color's "?" pieces types from ctx.rng: a king and the rest from a shuffled starting set (queens past it), no pawn on a back rank. Re-drawn, one try per king square, until the side not to move isn't in check; if no try works the last one stays (that position is illegal).
 */
function fillPieces(ctx, color) {
	const sq = ctx.state.board.sq, unknown = sq.map((p, i) => i).filter((i) => sq[i] && sq[i].c === color && sq[i].t === "?");
	for (const k of ctx.rng.shuffle([...unknown])) {
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
	while (left > 0 && p.moves.length < hand.MOVES && hand.drawMove(ctx, color)) left--;
	if (left > 0 && !p.actives.length && hand.drawCard(ctx, color, "active")) left--;
	while (left > 0 && p.moves.length < hand.MOVE_CAP && hand.drawMove(ctx, color)) left--;
}

/**
 * @description A full state from a view, for Vesper's search only: rng from seed (rng.seed: a 64-character hex string or an integer), "?" pieces and the opponent's unknown cards filled from it (deterministic for a view and seed), seen null. The view is not changed. A hidden Trapdoor stays without its square.
 */
function fromView(view, seed) {
	const s = copy(view);
	delete s.you;
	s.rng = rng.seed(seed);
	const ctx = makeCtx(s);
	ctx.trigger = () => {}; // FILLING IN HIDDEN CARDS IS NOT PLAY: NO CARD FIRES ON THESE DRAWS
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
 * @description FEN of a state's or a view's board; a fogged piece prints as "?" (not a valid FEN).
 */
function toFen(stateOrView) {
	return board.toFen(stateOrView.board);
}

module.exports = { playerView, playerEvents, fromView, toFen, shownTo };
