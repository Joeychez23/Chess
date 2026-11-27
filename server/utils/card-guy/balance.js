/*
 *  balance.js  --  chess server
 *	The Chess Cards balance report
 *  Card Guy plays both sides of a game through cardGuyTurn (playGame), and summarize turns many games into one row per
 *  card, with flags for the cards that are too strong, never turn up or are never played.
 *  A report to tune card rarity and Card Guy's weights from, not a gate. See scripts/cardsBalance.js
 *
 */

const engine = require("../../../cards-engine/index.js");
const { CARDS } = require("../../../cards-engine/cards/index.js");
const cardGuy = require("./index.js");

// A longer game is a draw
const MAX_PLIES = 300;
// Actions (duel picks, choices and all) a game may take: a game no turn can end stops here, as a draw. No real game
// comes near it
const MAX_ACTIONS = 3000;
// Times one action is asked for again after the game refused it (a Fog of War guess), as cardsController does
const MAX_REFUSALS = 8;

// The flags' starting values (design)
// too-strong: a win rate over this...
const STRONG_WIN_RATE = 0.6;
// ...in at least this many games the card was played in
const STRONG_MIN_GAMES = 20;
// rare-missing: a rare card drawn in fewer than this share of the games
const RARE_MIN_SHARE = 0.1;
// dud: a card drawn in at least this many games...
const DUD_MIN_GAMES = 20;
// ...and played or fired in fewer than this share of them
const DUD_PLAYED_SHARE = 0.25;

// The first turn of each band the drawn rarity is reported by: 1-9, 10-19, 20-29, 30+ (the climb ends at turn 30,
// cards/index.js CLIMB_END)
const TURN_BANDS = [1, 10, 20, 30];

function bandNames() {
	return TURN_BANDS.map((from, i) => (TURN_BANDS[i + 1] ? from + "-" + (TURN_BANDS[i + 1] - 1) : from + "+"));
}

function other(color) {
	return color === "w" ? "b" : "w";
}

function tally() {
	return { w: { drawn: 0, played: 0, fired: 0 }, b: { drawn: 0, played: 0, fired: 0 } };
}

// Event type -> the tally it counts in
const EVENT_TALLIES = { draw: "drawn", "card-played": "played", "passive-placed": "played", "passive-fired": "fired" };

/* ---------------------------------------------------------------- */
// Play
/* ---------------------------------------------------------------- */
/**
 * @description Plays one game, Card Guy on both sides, and counts the cards from the engine's own events (an active
 * drawn to refill one thrown out by the free discard isn't counted as drawn). The result is the engine's, or a draw at
 * MAX_PLIES. When cardGuyTurn throws or the game refuses its action every time, the first legal action is played (a
 * move when there is one) and stats.fallbacks counts it: the game never waits
 * @param  {[number]} seed [the game's seed, an integer. Card Guy's own dice come from it too, never from the engine's rng]
 * @param  {[object]} options [{ evaluate(fen) -> centipawns from White's side, bestOf(fen, lans) -> { from, to, promotion },
 * level: Card Guy's level, stats: an object filled with { plies, capped (no result at MAX_PLIES), actionCapped (no result
 * at MAX_ACTIONS), stuck (no result and no one can act), fallbacks, turnActions, discards (free discards of a move card
 * or an active), singles (those of a move card: one card each), singleRedraws (automatic redraws right after one: it
 * left no card action), rerolls (free discards of the passive, counted apart) } for the caller to read, optional }]
 * @return {[object]} game [{ winner: "w" | "b" | null, cards: { [key]: { w: Tally, b: Tally } }, moveTypes: { [piece]:
 * move cards of the type drawn }, rarityByBand: { [band, "1-9" ... "30+"]: { [rarity]: actives & passives drawn in
 * those turns } } } with Tally = { drawn, played, fired }]
 */
async function playGame(seed, { evaluate, bestOf, level, stats = {} }) {
	Object.assign(stats, {
		plies: 0,
		capped: false,
		actionCapped: false,
		stuck: false,
		fallbacks: 0,
		turnActions: 0,
		discards: 0,
		singles: 0,
		singleRedraws: 0,
		rerolls: 0,
	});
	let state = engine.newGame({ cardGuy: "b", level, seed });
	const tallies = startTallies();
	countOpeningHands(tallies, state);

	let actionsTaken = 0;
	while (!state.result && state.ply < MAX_PLIES && actionsTaken < MAX_ACTIONS) {
		// A duel pick or a choice may be the other side's
		const me = [state.board.turn, other(state.board.turn)].find((color) => engine.legalActions(state, color).length);
		if (!me) {
			// No one can act and there is no result: it shouldn't happen, and counts as a draw
			stats.stuck = true;
			break;
		}
		let next = await askCardGuy(state, me, { seed, actionsTaken, evaluate, bestOf, level }, stats, tallies.owed);
		if (!next) {
			next = playFallback(state, me);
			stats.fallbacks++;
		}
		for (const event of next.events) {
			countEvent(tallies, event, state.board.full);
		}
		state = next.state;
		actionsTaken++;
	}

	stats.plies = state.ply;
	stats.capped = !state.result && state.ply >= MAX_PLIES;
	stats.actionCapped = !state.result && !stats.stuck && !stats.capped;
	return {
		winner: state.result ? state.result.winner || null : null,
		cards: tallies.cards,
		moveTypes: tallies.moveTypes,
		rarityByBand: tallies.rarityByBand,
	};
}

// owed: actives a side threw out by the free discard and hasn't drawn back yet
function startTallies() {
	const names = bandNames();
	return {
		cards: {},
		owed: { w: 0, b: 0 },
		moveTypes: {},
		names,
		rarityByBand: Object.fromEntries(names.map((name) => [name, {}])),
	};
}

// newGame deals the opening hands but returns no events: count them from the hands
function countOpeningHands(tallies, state) {
	for (const color of ["w", "b"]) {
		const player = state.players[color];
		const dealt = [...player.moves, ...player.actives, player.passive].filter(Boolean);
		for (const card of dealt) {
			countEvent(tallies, { type: "draw", player: color, card }, 1);
		}
	}
}

/**
 * @description Card Guy's action for one step of the game, asked for again after each refusal (up to MAX_REFUSALS),
 * and counted in stats. null when Card Guy itself threw or every try was refused
 * @return {[object]} the engine's { state, events } after the action, or null
 */
async function askCardGuy(state, me, { seed, actionsTaken, evaluate, bestOf, level }, stats, owed) {
	const view = engine.playerView(state, me);
	const refused = [];
	const legal = engine.playerLegal(state, me);
	let next = null;
	while (!next && refused.length <= MAX_REFUSALS) {
		let action;
		try {
			// Our own counter for Card Guy's dice: never state.rng
			const dice = (Math.imul(seed, 0x9E3779B1) + Math.imul(actionsTaken + 1, 0x85EBCA6B) + refused.length * 0x1000) >>> 0;
			action = await cardGuy.cardGuyTurn(view, level, { evaluate, bestOf, seed: dice, refused, legal });
			next = engine.applyAction(state, me, action);
		} catch (err) {
			// Card Guy itself threw: asking again would give the same
			if (!action || err.code !== "ILLEGAL") {
				break;
			}
			refused.push(engine.actionKey(action));
		}
		if (next) {
			countAction(stats, owed, state, me, action, next);
		}
	}
	return next;
}

/**
 * @description The stats for one action the game took. state is still the one before the action. A single is a move
 * card's discard (an entered Mirage's too), one card each. Only an active's discard is owed back: the reroll draws its
 * passive at once and a move card's discard draws a move card, real draws. A drop is free, as a discard is
 */
function countAction(stats, owed, state, me, action, next) {
	const player = state.players[me];
	const discard = action.type === "discard";
	const reroll = discard && !!player.passive && action.cards[0] === player.passive.id;
	const active = discard && player.actives.some((card) => card.id === action.cards[0]);
	const single = discard && !reroll && !active;
	if (active) {
		owed[me]++;
	}
	const redrew = next.events.some((event) => event.type === "redraw" && event.player === me);
	stats.turnActions += ["duel", "choice", "discard", "drop"].includes(action.type) ? 0 : 1;
	stats.discards += discard && !reroll ? 1 : 0;
	stats.rerolls += reroll ? 1 : 0;
	stats.singles += single ? 1 : 0;
	stats.singleRedraws += single && redrew ? 1 : 0;
}

// The first legal action, a move when there is one: the game never waits
function playFallback(state, me) {
	const legal = engine.legalActions(state, me);
	const moves = legal.filter((action) => action.type === "move");
	return engine.applyAction(state, me, (moves.length ? moves : legal)[0]);
}

/**
 * @description Counts one engine event into the game's tallies. full is the turn (board.full) the action was taken in,
 * so a refill counts for the turn it ends
 */
function countEvent(tallies, event, full) {
	const key = event.card && event.card.key;
	const kind = CARDS[key] && CARDS[key].kind;
	// Every move-card draw, a lost one too: what the draw gave
	if (event.type === "draw" && key === "move") {
		tallies.moveTypes[event.card.piece] = (tallies.moveTypes[event.card.piece] || 0) + 1;
	}
	// Every draw, a lost one or a free discard's refill too
	if (event.type === "draw" && (kind === "active" || kind === "passive")) {
		const band = tallies.rarityByBand[tallies.names[TURN_BANDS.findLastIndex((from) => full >= from)]];
		band[CARDS[key].rarity] = (band[CARDS[key].rarity] || 0) + 1;
	}
	// No move cards (key "move"), no curses, no card that never reached a hand
	if (!EVENT_TALLIES[event.type] || !(kind === "active" || kind === "passive") || event.lost) {
		return;
	}
	// The refill of a free discard isn't "drawn": Card Guy cycling his active would raise every card's drawn-unplayed
	// count and the dud flag
	if (event.type === "draw" && kind === "active" && tallies.owed[event.player] > 0) {
		tallies.owed[event.player]--;
		return;
	}
	const cards = tallies.cards;
	(cards[key] = cards[key] || tally())[event.player][EVENT_TALLIES[event.type]]++;
}

/* ---------------------------------------------------------------- */
// Summary
/* ---------------------------------------------------------------- */
/**
 * @description One row for every card that can be drawn (an active or a passive, each version its own card), cards that
 * never turned up too. A game counts for a card once, whichever sides drew or played it. winRateWhenPlayed: over each
 * side that played the card in a game (so a game both sides played it in counts twice, once each), a win is 1 and a
 * draw 0.5, null when it was never played
 * @param  {[array]} games [playGame results]
 * @return {[array]} rows [{ key, rarity, drawnGames, playedGames, winRateWhenPlayed, drawnNotPlayedGames, flags }, ...]
 */
function summarize(games) {
	return Object.keys(CARDS)
		.filter((key) => CARDS[key].kind === "active" || CARDS[key].kind === "passive")
		.map((key) => cardRow(key, games));
}

function cardRow(key, games) {
	let drawnGames = 0;
	let playedGames = 0;
	let drawnNotPlayedGames = 0;
	let usedGames = 0;
	let plays = 0;
	let points = 0;
	for (const game of games) {
		const cardTally = game.cards[key];
		if (!cardTally) {
			continue;
		}
		const drawn = cardTally.w.drawn + cardTally.b.drawn > 0;
		const played = cardTally.w.played + cardTally.b.played > 0;
		if (drawn) {
			drawnGames++;
		}
		if (played) {
			playedGames++;
		}
		if (drawn && !played) {
			drawnNotPlayedGames++;
		}
		if (played || cardTally.w.fired + cardTally.b.fired > 0) {
			usedGames++;
		}
		for (const color of ["w", "b"]) {
			if (!cardTally[color].played) {
				continue;
			}
			plays++;
			points += game.winner === color ? 1 : game.winner === null ? 0.5 : 0;
		}
	}

	const winRateWhenPlayed = plays ? points / plays : null;
	const rarity = CARDS[key].rarity;
	const flags = [];
	if (winRateWhenPlayed > STRONG_WIN_RATE && playedGames >= STRONG_MIN_GAMES) {
		flags.push("too-strong");
	}
	if (rarity === "rare" && drawnGames < games.length * RARE_MIN_SHARE) {
		flags.push("rare-missing");
	}
	if (drawnGames >= DUD_MIN_GAMES && usedGames < drawnGames * DUD_PLAYED_SHARE) {
		flags.push("dud");
	}
	return { key, rarity, drawnGames, playedGames, winRateWhenPlayed, drawnNotPlayedGames, flags };
}

/**
 * @description The share of the games each rarity turned up in (any card of it drawn by either side)
 * @param  {[array]} games [playGame results]
 * @return {[object]} shares [{ [rarity]: 0 - 1 }, every rarity of the cards that can be drawn]
 */
function rarityShares(games) {
	const drawable = Object.keys(CARDS).filter((key) => CARDS[key].kind === "active" || CARDS[key].kind === "passive");
	const rarities = [...new Set(drawable.map((key) => CARDS[key].rarity))];
	return Object.fromEntries(rarities.map((rarity) => [rarity, games.length ? gamesWithRarity(games, rarity) / games.length : 0]));
}

function gamesWithRarity(games, rarity) {
	const turnedUp = (game) => Object.keys(game.cards)
		.some((key) => CARDS[key].rarity === rarity && game.cards[key].w.drawn + game.cards[key].b.drawn > 0);
	return games.filter(turnedUp).length;
}

/**
 * @description The games' draws added up: the move cards drawn by type, and the actives & passives drawn by turn band
 * and rarity
 * @param  {[array]} games [playGame results]
 * @return {[object]} totals [{ moveTypes: { [piece]: n }, rarityByBand: { [band]: { [rarity]: n } } }]
 */
function drawTotals(games) {
	const moveTypes = {};
	const rarityByBand = {};
	for (const game of games) {
		addCounts(moveTypes, game.moveTypes);
		for (const [band, counts] of Object.entries(game.rarityByBand)) {
			rarityByBand[band] = addCounts(rarityByBand[band] || {}, counts);
		}
	}
	return { moveTypes, rarityByBand };
}

function addCounts(to, from) {
	for (const [key, count] of Object.entries(from)) {
		to[key] = (to[key] || 0) + count;
	}
	return to;
}

module.exports = {
	playGame,
	summarize,
	rarityShares,
	drawTotals,
	TURN_BANDS,
	MAX_PLIES,
	STRONG_WIN_RATE,
	STRONG_MIN_GAMES,
	RARE_MIN_SHARE,
	DUD_MIN_GAMES,
	DUD_PLAYED_SHARE,
};
