/*
 *  balance.js  --  chess server
 *	The Chess Cards balance report
 *  Card Guy plays both sides of a game through cardGuyTurn (playGame), and summarize turns many games into one row per card with flags for the cards that are too strong, never turn up or are never played.
 *  A report to tune card rarity & Card Guy's weights from, not a gate. See scripts/cardsBalance.js
 *
 */

const engine = require("../../../cards-engine/index.js");
const { CARDS } = require("../../../cards-engine/cards/index.js");
const cardGuy = require("./index.js");

const MAX_PLIES = 300; // A LONGER GAME IS A DRAW
const MAX_ACTIONS = 3000; // ACTIONS (DUEL PICKS, CHOICES AND ALL) A GAME MAY TAKE: A GAME NO TURN CAN END STOPS HERE, A DRAW. NO REAL GAME COMES NEAR
const MAX_REFUSALS = 8; // TIMES ONE ACTION IS ASKED FOR AGAIN AFTER THE GAME REFUSED IT (A FOG OF WAR GUESS), AS cardsController DOES

// THE FLAGS' STARTING VALUES (DESIGN)
const STRONG_WIN_RATE = 0.6; // too-strong: A WIN RATE OVER THIS...
const STRONG_MIN_GAMES = 20; // ...IN AT LEAST THIS MANY GAMES THE CARD WAS PLAYED IN
const RARE_MIN_SHARE = 0.1; // rare-missing: A RARE CARD DRAWN IN FEWER THAN THIS SHARE OF THE GAMES
const DUD_MIN_GAMES = 20; // dud: A CARD DRAWN IN AT LEAST THIS MANY GAMES...
const DUD_PLAYED_SHARE = 0.25; // ...PLAYED OR FIRED IN FEWER THAN THIS SHARE OF THEM

const TURN_BANDS = [1, 10, 20, 30]; // THE FIRST TURN OF EACH BAND THE RARITY DRAWN IS REPORTED BY: 1-9, 10-19, 20-29, 30+ (THE CLIMB ENDS AT TURN 30, cards/index.js CLIMB_END)
const bandNames = () => TURN_BANDS.map((from, i) => (TURN_BANDS[i + 1] ? from + "-" + (TURN_BANDS[i + 1] - 1) : from + "+"));

const other = (c) => (c === "w" ? "b" : "w");
const tally = () => ({ w: { drawn: 0, played: 0, fired: 0 }, b: { drawn: 0, played: 0, fired: 0 } });
const COUNTS = { draw: "drawn", "card-played": "played", "passive-placed": "played", "passive-fired": "fired" }; // EVENT TYPE -> TALLY

/* ---------------------------------------------------------------- */
// Play
/* ---------------------------------------------------------------- */
/**
 * @description Plays one game, Card Guy on both sides, and counts the cards from the engine's own events (an active drawn to refill one thrown out by the free discard isn't counted as drawn). The result is the engine's, or a draw at MAX_PLIES.
 * When cardGuyTurn throws or the game refuses its action every time, the first legal action is played (a move when there is one) and stats.fallbacks counts it: the game never waits
 * @param  {[number]} seed [the game's seed, an integer. Card Guy's own dice come from it too, never from the engine's rng]
 * @param  {[object]} options [{ evaluate(fen) -> centipawns from White's side, bestOf(fen, lans) -> { from, to, promotion }, level: Card Guy's level,
 * stats: an object filled with { plies, capped (no result at MAX_PLIES), actionCapped (no result at MAX_ACTIONS), stuck (no result and no one can act), fallbacks, turnActions, discards (free discards of a move card or an active), singles (those of a move card: one card each since Task 20e), singleRedraws (automatic redraws right after one: it left no card action), rerolls (free discards of the passive, counted apart) } for the caller to read, optional }]
 * @return {[object]} game [{ winner: "w" | "b" | null, cards: { [key]: { w: Tally, b: Tally } }, moveTypes: { [piece]: move cards of the type drawn }, rarityByBand: { [band, "1-9" ... "30+"]: { [rarity]: actives & passives drawn in those turns } } } with Tally = { drawn, played, fired }]
 */
async function playGame(seed, { evaluate, bestOf, level, stats = {} }) {
	Object.assign(stats, { plies: 0, capped: false, actionCapped: false, stuck: false, fallbacks: 0, turnActions: 0, discards: 0, singles: 0, singleRedraws: 0, rerolls: 0 });
	let state = engine.newGame({ cardGuy: "b", level, seed });
	const cards = {}, owed = { w: 0, b: 0 }; // owed: ACTIVES A SIDE THREW OUT BY THE FREE DISCARD AND HASN'T DRAWN BACK
	const moveTypes = {}, names = bandNames(), rarityByBand = Object.fromEntries(names.map((n) => [n, {}]));
	const count = (e, full) => { // full: THE TURN (board.full) THE ACTION WAS TAKEN IN, SO A REFILL COUNTS FOR THE TURN IT ENDS
		const key = e.card && e.card.key, kind = CARDS[key] && CARDS[key].kind;
		if (e.type === "draw" && key === "move") { moveTypes[e.card.piece] = (moveTypes[e.card.piece] || 0) + 1; } // EVERY MOVE-CARD DRAW, A LOST ONE TOO: WHAT THE DRAW GAVE
		if (e.type === "draw" && (kind === "active" || kind === "passive")) { const band = rarityByBand[names[TURN_BANDS.findLastIndex((from) => full >= from)]]; band[CARDS[key].rarity] = (band[CARDS[key].rarity] || 0) + 1; } // EVERY DRAW, LOST OR A FREE DISCARD'S REFILL TOO
		if (!COUNTS[e.type] || !(kind === "active" || kind === "passive") || e.lost) { return; } // NO MOVE CARDS (KEY "move"), NO CURSES, NO CARD THAT NEVER REACHED A HAND
		if (e.type === "draw" && kind === "active" && owed[e.player] > 0) { owed[e.player]--; return; } // THE REFILL OF A FREE DISCARD ISN'T "drawn": CARD GUY CYCLING ITS ACTIVE WOULD RAISE EVERY CARD'S DRAWN-UNPLAYED COUNT AND THE dud FLAG
		(cards[key] = cards[key] || tally())[e.player][COUNTS[e.type]]++;
	};
	for (const c of ["w", "b"]) { [...state.players[c].moves, ...state.players[c].actives, state.players[c].passive].filter(Boolean).forEach((card) => count({ type: "draw", player: c, card }, 1)); } // newGame DEALS THE OPENING HAND BUT RETURNS NO EVENTS: COUNT IT FROM THE HANDS

	let actions = 0;
	while (!state.result && state.ply < MAX_PLIES && actions < MAX_ACTIONS) {
		const me = [state.board.turn, other(state.board.turn)].find((c) => engine.legalActions(state, c).length); // A DUEL PICK OR A CHOICE MAY BE THE OTHER SIDE'S
		if (!me) { stats.stuck = true; break; } // NO ONE CAN ACT AND THERE IS NO RESULT: SHOULDN'T HAPPEN, A DRAW
		const view = engine.playerView(state, me), refused = [], legal = engine.playerLegal(state, me);
		let next = null;
		while (!next && refused.length <= MAX_REFUSALS) {
			let action;
			try {
				const dice = (Math.imul(seed, 0x9E3779B1) + Math.imul(actions + 1, 0x85EBCA6B) + refused.length * 0x1000) >>> 0; // OUR OWN COUNTER: NEVER state.rng
				action = await cardGuy.cardGuyTurn(view, level, { evaluate, bestOf, seed: dice, refused, legal });
				next = engine.applyAction(state, me, action);
			} catch (err) {
				if (!action || err.code !== "ILLEGAL") { break; } // CARD GUY ITSELF THREW: ASKING AGAIN GIVES THE SAME
				refused.push(engine.actionKey(action));
			}
			const discard = !!next && action.type === "discard", reroll = discard && !!state.players[me].passive && action.cards[0] === state.players[me].passive.id; // state IS STILL THE ONE BEFORE THE ACTION
			const active = discard && state.players[me].actives.some((c) => c.id === action.cards[0]), single = discard && !reroll && !active; // single: A MOVE CARD'S (AN ENTERED MIRAGE TOO), ONE CARD EACH
			if (active) { owed[me]++; } // ONLY AN ACTIVE'S: THE REROLL DRAWS ITS PASSIVE AT ONCE AND A MOVE CARD'S PAIR DRAWS A MOVE CARD, REAL DRAWS
			if (next) {
				Object.assign(stats, { turnActions: stats.turnActions + (["duel", "choice", "discard", "drop"].includes(action.type) ? 0 : 1), discards: stats.discards + (discard && !reroll ? 1 : 0), rerolls: stats.rerolls + (reroll ? 1 : 0) }); // A DROP IS FREE, AS A DISCARD
				Object.assign(stats, { singles: stats.singles + (single ? 1 : 0), singleRedraws: stats.singleRedraws + (single && next.events.some((e) => e.type === "redraw" && e.player === me) ? 1 : 0) });
			}
		}
		if (!next) {
			const legal = engine.legalActions(state, me), moves = legal.filter((a) => a.type === "move");
			next = engine.applyAction(state, me, (moves.length ? moves : legal)[0]);
			stats.fallbacks++;
		}
		next.events.forEach((e) => count(e, state.board.full));
		state = next.state;
		actions++;
	}
	stats.plies = state.ply;
	stats.capped = !state.result && state.ply >= MAX_PLIES;
	stats.actionCapped = !state.result && !stats.stuck && !stats.capped;
	return { winner: state.result ? state.result.winner || null : null, cards, moveTypes, rarityByBand };
}

/* ---------------------------------------------------------------- */
// Summary
/* ---------------------------------------------------------------- */
/**
 * @description One row for every card that can be drawn (an active or a passive, each version its own card), cards that never turned up too. A game counts for a card once, whichever sides drew or played it.
 * winRateWhenPlayed: over each side that played the card in a game (so a game both sides played it in counts twice, once each), a win is 1 and a draw 0.5, null when it was never played
 * @param  {[array]} games [playGame results]
 * @return {[array]} rows [{ key, rarity, drawnGames, playedGames, winRateWhenPlayed, drawnNotPlayedGames, flags }, ...]
 */
function summarize(games) {
	return Object.keys(CARDS).filter((key) => CARDS[key].kind === "active" || CARDS[key].kind === "passive").map((key) => {
		let drawnGames = 0, playedGames = 0, drawnNotPlayedGames = 0, usedGames = 0, plays = 0, points = 0;
		for (const g of games) {
			const t = g.cards[key];
			if (!t) { continue; }
			const drawn = t.w.drawn + t.b.drawn > 0, played = t.w.played + t.b.played > 0;
			if (drawn) { drawnGames++; }
			if (played) { playedGames++; }
			if (drawn && !played) { drawnNotPlayedGames++; }
			if (played || t.w.fired + t.b.fired > 0) { usedGames++; }
			for (const c of ["w", "b"]) {
				if (!t[c].played) { continue; }
				plays++;
				points += g.winner === c ? 1 : g.winner === null ? 0.5 : 0;
			}
		}
		const winRateWhenPlayed = plays ? points / plays : null, rarity = CARDS[key].rarity, flags = [];
		if (winRateWhenPlayed > STRONG_WIN_RATE && playedGames >= STRONG_MIN_GAMES) { flags.push("too-strong"); }
		if (rarity === "rare" && drawnGames < games.length * RARE_MIN_SHARE) { flags.push("rare-missing"); }
		if (drawnGames >= DUD_MIN_GAMES && usedGames < drawnGames * DUD_PLAYED_SHARE) { flags.push("dud"); }
		return { key, rarity, drawnGames, playedGames, winRateWhenPlayed, drawnNotPlayedGames, flags };
	});
}

/**
 * @description The share of the games each rarity turned up in (any card of it drawn by either side)
 * @param  {[array]} games [playGame results]
 * @return {[object]} shares [{ [rarity]: 0 - 1 }, every rarity of the cards that can be drawn]
 */
function rarityShares(games) {
	const rarities = [...new Set(Object.keys(CARDS).filter((k) => CARDS[k].kind === "active" || CARDS[k].kind === "passive").map((k) => CARDS[k].rarity))];
	return Object.fromEntries(rarities.map((r) => [r, games.length ? games.filter((g) => Object.keys(g.cards).some((k) => CARDS[k].rarity === r && g.cards[k].w.drawn + g.cards[k].b.drawn > 0)).length / games.length : 0]));
}

/**
 * @description The games' draws added up: the move cards drawn by type, and the actives & passives drawn by turn band and rarity
 * @param  {[array]} games [playGame results]
 * @return {[object]} totals [{ moveTypes: { [piece]: n }, rarityByBand: { [band]: { [rarity]: n } } }]
 */
function drawTotals(games) {
	const add = (to, from) => { for (const [k, n] of Object.entries(from)) { to[k] = (to[k] || 0) + n; } return to; };
	const moveTypes = {}, rarityByBand = {};
	for (const g of games) {
		add(moveTypes, g.moveTypes);
		for (const [band, counts] of Object.entries(g.rarityByBand)) { rarityByBand[band] = add(rarityByBand[band] || {}, counts); }
	}
	return { moveTypes, rarityByBand };
}

module.exports = { playGame, summarize, rarityShares, drawTotals, TURN_BANDS, MAX_PLIES, STRONG_WIN_RATE, STRONG_MIN_GAMES, RARE_MIN_SHARE, DUD_MIN_GAMES, DUD_PLAYED_SHARE };
