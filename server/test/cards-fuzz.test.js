/*
 *  cards-fuzz.test.js  --  chess cards engine tests
 *	The soak: 500 seeded random games through the public entry with every card the loader registers. No lock-ups, no throws, nothing hidden shown.
 *	Replay one game with CARDS_FUZZ_SEED=<n> node --test test/cards-fuzz.test.js
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { newGame, legalActions, applyAction, playerView, playerEvents, playerLegal, actionKey } = require("../../cards-engine/index.js"); // THE REAL LOADER: NO reset, NO register HERE
const { baseKey, CARDS } = require("../../cards-engine/cards/index.js");
const { inCheck } = require("../../cards-engine/rules.js");
const { fromView } = require("../../cards-engine/view.js");
const { makeCtx } = require("../../cards-engine/ctx.js");
const { fromFen, sqIndex } = require("../../cards-engine/board.js");
const hand = require("../../cards-engine/hand.js");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const os = require("node:os");

const GAMES = 500, PLIES = 600;
const other = (c) => (c === "w" ? "b" : "w");
const handOf = (p) => [...p.moves, ...p.actives, ...(p.passive ? [p.passive] : []), ...p.curses];
const isMirage = (c) => baseKey(c.key) === "mirage";
const handFog = (s, c) => s.enchant.some((e) => e.key === "fog-of-war" && e.owner === c); // ONLY THE BASE CARD SHOWS ITS OWNER'S HAND
const boardFog = (s, c) => s.enchant.some((e) => baseKey(e.key) === "fog-of-war" && e.owner === c); // EVERY VERSION HIDES THE PIECES
const noSquares = (json) => json.replace(/"(square|from|to|ep|sq)":"[a-h][1-8]"/g, ""); // SQUARES c1..c8 LOOK LIKE CARD IDS
const quoted = (x) => "\"" + x + "\"";
const hiddenIds = (s, c) => s.board.sq.filter((p, i) => p && p.c === c && (c === "w" ? i >= 32 : i < 32)).map((p) => p.id); // THE PIECES c'S FOG HIDES

/**
 * @description The picker's own seeded generator (mulberry32), so a failing seed replays: roll(n) is an integer in 0..n-1.
 */
function picker(seed) {
	let a = seed >>> 0;
	return (n) => {
		a = (a + 0x6D2B79F5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), a | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) % n;
	};
}

/**
 * @description Oracle (Task 5's, with the real cards' sight): true when viewer may see this card of the opponent's: face up, a curse, the opponent's base Fog of War, viewer's seen (ids or all), or an option of viewer's own choice that shows cards (Pickpocket's pick).
 */
function visibleTo(s, viewer, card) {
	const o = s.players[other(viewer)], seen = s.players[viewer].seen, p = s.pending;
	return !!card.faceUp || handFog(s, other(viewer)) || o.curses.some((c) => c.id === card.id) || !!(seen && (seen.all || seen.ids.includes(card.id)))
		|| !!(p && p.show && p.player === viewer && p.options.includes(card.id));
}

/**
 * @description Card keys viewer may legitimately see in this view: own hand, shown, Board Effects, used, enchantments, the played card of an open duel, the kind of an open choice (the choice event told both) and the strings of viewer's own open choice. "move" always (a move card's secret is its id and piece). Also the cards on the active spots, and what the view shows of the piles (a played or dropped card is public; checkView's secret ids catch a hidden one shown there).
 */
function allowedKeys(v, viewer) {
	const vo = v.players[other(viewer)], p = v.pending && v.pending.player === viewer ? v.pending : null;
	return new Set(["move", ...handOf(v.players[viewer]).map((c) => c.key), ...vo.hand.shown.map((c) => c.key), ...v.effects.map((e) => e.card.key),
		...v.players.w.used, ...v.players.b.used, ...v.enchant.map((e) => e.key), ...(v.duel ? [v.duel.card] : []), ...(v.pending ? [v.pending.kind] : []), ...(p ? [p.card, ...p.options] : []),
		...["w", "b"].flatMap((c) => [...(v.players[c].spot || []), v.players[c].pile && v.players[c].pile.top, v.players[c].kept]).filter(Boolean).map((c) => c.key), ...(v.players[viewer].gone || []),
		...v.piled.map((e) => e.card.key)]); // TASK 21a: THE DISCARD LIST AS THE VIEW SHOWS IT (checkView'S SECRET IDS CATCH A HIDDEN ONE SHOWN THERE)
}

/**
 * @description Every rng field and every array of 8 integers (the generator key's shape) anywhere in x.
 */
function keyLike(x, found = []) {
	if (Array.isArray(x) && x.length === 8 && x.every(Number.isInteger)) found.push(x);
	if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { if (k === "rng") found.push(k); keyLike(v, found); }
	return found;
}

/**
 * @description Every hiding rule of playerView for viewer on state s (Task 5's checkView, on the real cards). Returns the view. secret: the ids of the opponent's cards that left its hand unseen by viewer (the oracle's own list, kept by play from the raw events: a hidden discard, a move card played under a Fog of War): none may show on the opponent's discard pile, remembered card or active spot.
 */
function checkView(s, viewer, secret = []) {
	const v = playerView(s, viewer), json = JSON.stringify(v), flat = noSquares(json), opp = other(viewer), o = s.players[opp], vo = v.players[opp];
	assert.ok(!json.includes("\"rng\""), "seed in view");
	assert.deepEqual(keyLike(v), [], "generator key in view");
	assert.equal(v.you, viewer);
	assert.equal(vo.hand.count, handOf(o).length);
	for (const k of ["moves", "actives", "passive", "curses", "seen", "gone"]) assert.ok(!(k in vo), "opponent " + k + " in view");
	const places = JSON.stringify([vo.pile, vo.kept, vo.spot, v.piled.filter((e) => e.player === opp)]), top = o.pile && o.pile.top, back = { down: true }; // TASK 21a: THE OPPONENT'S CARDS IN THE DISCARD LIST TOO
	assert.equal(vo.pile.n, (o.pile && o.pile.n) || 0, "the opponent's pile count");
	assert.deepEqual(vo.spot, o.spot || [], "the opponent's active spot is public");
	assert.ok(!JSON.stringify(v.players[viewer]).includes("\"down\""), "a face-down mark on viewer's own cards");
	if (s.result) assert.deepEqual([vo.kept, vo.pile.top], [o.kept || null, top ? (({ down, ...c }) => c)(top) : null], "a finished game shows the pile's top and the remembered card");
	else {
		for (const id of secret) assert.ok(!places.includes(quoted(id)), "hidden card id " + id + " on the opponent's pile, remembered card or active spot");
		if (o.kept && !o.kept.faceUp) assert.deepEqual(vo.kept, back, "the remembered card isn't face down");
		if (top && secret.includes(top.id)) assert.deepEqual(vo.pile.top, back, "a hidden top card isn't face down");
	}
	assert.ok(["w", "b"].every((c) => s.effects.filter((e) => e.owner === c).length <= 3), "more than 3 passives wait");
	assert.ok(!("seen" in v.players[viewer]), "own seen in view (it tells the fakes apart)");
	const kept = v.effects.filter((e) => "denied" in e.card || "stopping" in e.card); // PHALANX'S AND PEASANT IMMUNITY'S BOOKKEEPING: ONLY ON viewer'S OWN, NEVER UNDER THE OPPONENT'S FOG
	assert.ok(kept.every((e) => e.owner === viewer) && !(kept.length && !s.result && boardFog(s, opp)), "passive bookkeeping in view");
	const shown = vo.hand.shown, seen = s.players[viewer].seen, fakes = seen ? seen.fake : [], allowed = allowedKeys(v, viewer);
	const asked = s.pending && s.pending.player === viewer ? [...s.pending.options, s.pending.stolen] : []; // PICKPOCKET'S TAKE-BACK NAMES THE CARD JUST TAKEN FROM viewer (THE PUBLIC card-taken EVENT SHOWED IT)
	if (s.result) assert.deepEqual(shown.map((c) => c.id + ":" + c.key).sort(), handOf(o).map((c) => c.id + ":" + c.key).sort(), "a finished game shows the whole hand, no fakes"); // USER RULING 2026-11-21 03:12
	else for (const f of fakes) assert.ok(shown.some((c) => c.id === f.id), "fake card not shown");
	for (const c of s.result ? [] : handOf(o)) {
		if (visibleTo(s, viewer, c)) { assert.ok(shown.some((x) => x.id === c.id && x.key === c.key), "visible card " + c.id + " not in shown"); continue; }
		if (!fakes.some((f) => f.id === c.id) && !asked.includes(c.id)) assert.ok(!flat.includes(quoted(c.id)), "hidden card id " + c.id + " in view"); // A FAKE WEARS THE REAL CARD'S ID (RULING)
		if (!allowed.has(c.key)) assert.ok(!json.includes(quoted(c.key)), "hidden key " + c.key + " in view");
	}
	for (const e of v.enchant) {
		if (baseKey(e.key) === "trapdoor") assert.equal(!!e.data && "square" in e.data, e.owner === viewer || !!s.result, "trapdoor square"); // OVER: SHOWN
		if (e.data) assert.ok(!("ids" in e.data) && !("fake" in e.data), "sight bookkeeping in view");
	}
	if (s.pending) {
		assert.ok(!("next" in v.pending), "queued choices in view");
		if (s.pending.player !== viewer) assert.deepEqual(v.pending, { player: s.pending.player, kind: s.pending.kind }, "the other player's choice in view");
	}
	if (s.duel) for (const set of [v.duel, v.duel.spades].filter(Boolean)) assert.ok(!("deck" in set), "duel deck in view");
	if (!s.result && boardFog(s, opp)) { // A FINISHED GAME HIDES NOTHING (USER RULING 2026-11-21)
		const letters = opp === "w" ? /[PNBRQK]/g : /[pnbrqk]/g, rank = opp === "w" ? "3" : "6";
		const { sq, castling, ep, history, half, hidden, ...rest } = v.board, real = s.board, ids = hiddenIds(s, opp);
		sq.forEach((p, i) => assert.deepEqual(p, real.sq[i] && ids.includes(real.sq[i].id) ? null : real.sq[i], "fogged square " + i)); // ONLY ITS HALF IS FOGGED (i 0 = a8): NO PIECE THERE AT ALL
		assert.equal(hidden, ids.length, "how many are hidden");
		for (const id of ids) assert.ok(!flat.includes(quoted(id)), "hidden piece id " + id + " in view");
		assert.ok(vo.captured.every((t) => t === "?"), "fogged captured list");
		assert.deepEqual(history, [], "fogged history");
		assert.equal(half, 0, "fogged half-move counter");
		assert.equal(castling, real.castling.replace(letters, "") || "-", "fogged castling");
		assert.equal(ep, real.ep && real.ep[1] === rank ? null : real.ep, "fogged en passant");
		const { sq: _s, castling: _c, ep: _e, history: _h, half: _f, ...realRest } = real;
		assert.deepEqual(rest, realRest, "other board fields");
	} else assert.deepEqual(v.board, s.board);
	const mine = s.players[viewer].curses.filter((c) => isMirage(c) && !c.waiting); // A WAITING ONE IS NOWHERE IN THE VIEW
	for (const m of s.players[viewer].curses.filter((c) => c.waiting)) assert.ok(!flat.includes(quoted(m.id)) || s.players[viewer].moves.some((c) => c.id === m.id), "waiting mirage id in its holder's view");
	const gave = o.curses.some(isMirage); // A HOLDER WHO ALSO GAVE ONE SEES THAT ONE IN shown
	if (s.players[viewer].curses.some(isMirage)) {
		const own = s.pending && s.pending.player === viewer && baseKey(s.pending.card) === "hexcraft"; // viewer'S OWN HEXCRAFT MAY OFFER A MIRAGE TO GIVE: NOT A TELL
		assert.ok(!JSON.stringify(gave ? v.players[viewer] : own ? { ...v, pending: null } : v).includes("mirage"), "mirage in its holder's view");
	}
	for (const m of mine) assert.ok(v.players[viewer].moves.some((c) => c.id === m.id && c.key === "move" && c.piece === m.piece), "mirage not a move card");
	for (const m of o.curses.filter(isMirage)) assert.ok(shown.some((c) => c.id === m.id && isMirage(c)), "giver can't see mirage");
	if (s.result) assert.deepEqual(v.statuses, s.statuses, "a finished game hides a status"); // RULING 2026-11-23 09:28 M1: THE VEILED FROZEN TOO, AS THE FOG LIFTS
	else for (const [id, list] of Object.entries(s.statuses || {})) { // #493 (RULINGS 2026-11-23 08:33, 09:28 M2): A VEILED STATUS NEVER TO ITS PIECE'S OWNER (ITS COLOUR NOW); by ONLY TO THE OWNER AND THE CASTER; EVERY OTHER STATUS AND left TO BOTH
		const q = s.board.sq.find((x) => x && x.id === id), got = (v.statuses || {})[id] || [];
		if (boardFog(s, opp) && hiddenIds(s, opp).includes(id)) continue; // FOG'S OWN RULE: THE PIECE IS NOT IN THE VIEW
		for (const e of list) {
			const g = got.find((x) => x.s === e.s);
			if (e.veiled && q && q.c === viewer) { assert.ok(!g, "a veiled " + e.s + " on " + id + " shown to its owner"); continue; }
			assert.ok(g, "status " + e.s + " on " + id + " missing");
			assert.equal(g.left, e.left, "status " + e.s + " on " + id + ": left");
			assert.equal(g.by, (q && q.c === viewer) || e.by === viewer ? e.by : undefined, "status " + e.s + " on " + id + ": by");
		}
	}
	return v;
}

/**
 * @description Every hiding rule of playerEvents for viewer (Task 5's checkEvents, on the real cards), on the events of one action and the state after it; also that neither input changes. v: viewer's view of next.
 */
function checkEvents(next, events, viewer, v) {
	const rawEvents = JSON.stringify(events), rawState = JSON.stringify(next), opp = other(viewer);
	const ev = playerEvents(next, events, viewer), json = JSON.stringify(ev), flat = noSquares(json);
	assert.equal(JSON.stringify(events), rawEvents, "events mutated");
	assert.equal(JSON.stringify(next), rawState, "state mutated");
	if (next.result) { assert.deepEqual(ev, JSON.parse(rawEvents), "the action that ended the game not told in full"); return; } // USER RULING 2026-11-21 03:12; EVERY CHECK BELOW HOLDS WHILE IT IS ON
	const card = (e) => (e.card && typeof e.card === "object" ? e.card : null);
	events = events.filter((e) => !(e.type === "curse-given" && isMirage(e.card) && e.player === opp)); // LEFT OUT FOR ITS HOLDER: IT SHOWS WHEN IT ENTERS AT A REFILL
	const hid = boardFog(next, opp) ? hiddenIds(next, opp) : [], taken = hid.length || boardFog(next, opp) ? events.filter((e) => e.type === "capture" && e.c === opp).map((e) => e.piece) : [];
	events = events.filter((e) => !(hid.includes(e.piece) && e.type !== "move")); // ABOUT A PIECE HIDDEN NOW: NOT TOLD (ITS MOVE IS, BARE)
	events = events.filter((e) => !(e.veiled && next.board.sq.some((q) => q && q.id === e.piece && q.c === viewer))); // A VEILED FROZEN: NEVER TOLD ITS PAWN'S OWNER (#493)
	assert.equal(ev.length, events.length);
	for (const id of hid.concat(taken)) assert.ok(!flat.includes(quoted(id)), "hidden piece id " + id + " in events");
	assert.ok(!json.includes("\"rng\""), "seed in events");
	assert.deepEqual(keyLike(ev), [], "generator key in events");
	assert.ok(!json.includes("\"denied\"") && !json.includes("\"stopping\"") && !json.includes("\"veiled\""), "bookkeeping in events");
	const allowed = allowedKeys(v, viewer), fog = boardFog(next, opp);
	const masked = (e) => e.player === opp && (e.type === "draw" || e.type === "discard") && card(e) && !isMirage(e.card) && !visibleTo(next, viewer, e.card); // A MIRAGE OF THE OPPONENT'S IS ONE viewer GAVE: KNOWN, ALSO ONCE IT IS GONE
	const open = new Set(events.filter((e) => !masked(e)).flatMap((e) => [card(e) && e.card.id, card(e) && e.card.key, e.key])); // PLAYED, PLACED, FIRED, GIVEN, TAKEN, ENDED, viewer'S OWN: PUBLIC IN THIS ACTION
	for (const k of open) allowed.add(k);
	const fakes = next.enchant.filter((e) => e.owner === viewer && e.data && e.data.fake).flatMap((e) => e.data.fake);
	for (const f of fakes) allowed.add(f.key); // A FAKE'S KEY MAY HAPPEN TO BE ANOTHER HIDDEN CARD'S REAL ONE
	const colorOf = (e) => e.c || (next.board.sq.find((q) => q && q.id === e.piece) || events.find((x) => x.type === "capture" && x.piece === e.piece) || {}).c; // A PIECE HANDED OVER KEEPS ITS ID; ONE TAKEN IN THIS ACTION: ITS CAPTURE'S c (AS view.js colorOf)
	events.forEach((e, i) => {
		const c = card(e);
		if (masked(e)) {
			assert.ok(!("card" in ev[i]) || fakes.some((f) => f.id === c.id && f.key === ev[i].card.key), "hidden " + e.type + " of " + c.id + " carries a card");
			if (!fakes.some((f) => f.id === c.id) && !open.has(c.id)) assert.ok(!flat.includes(quoted(c.id)), "hidden card id " + c.id + " in events");
			if (!allowed.has(c.key)) assert.ok(!json.includes(quoted(c.key)), "hidden key " + c.key + " in events");
		}
		if (c && isMirage(c) && e.type !== "curse-cleared" && e.type !== "curse-fired" && e.type !== "curse-given" && e.player === viewer) { // viewer HOLDS IT (A curse-given NAMES THE GIVER; THE HOLDER'S IS FILTERED OUT ABOVE); ALSO WHEN THIS DISCARD CLEARS IT
			assert.ok(!JSON.stringify(ev[i]).includes("mirage"), "mirage in its holder's events");
		}
		if (e.player === opp && c && baseKey(c.key) === "trapdoor") assert.ok(!("square" in ev[i]) && !("target" in ev[i]), "trapdoor square in events");
		if (fog && e.type === "move" && e.player === opp) assert.ok(!("card" in ev[i]) && !("castle" in ev[i]), "fogged move card");
		if (hid.includes(e.piece)) assert.deepEqual(ev[i], { type: "move", player: e.player }, "a hidden piece's move is told bare");
		if (fog && (e.type === "capture" || e.type === "promote") && colorOf(e) === opp) assert.equal(ev[i].t, "?", "fogged " + e.type);
		if (e.type === "status") assert.equal(ev[i].player, e.player === viewer || colorOf(e) === viewer ? e.player : undefined, "a status event's caster (#493: told only the owner and the caster)");
		if (e.type === "status-ended") assert.equal(ev[i].player, e.player, "a status-ended event's owner");
	});
}

/**
 * @description playerLegal and a veiled status (#493; rulings 2026-11-23 09:28 I1 (a), 10:08 N1 and N2): the owner (the piece's colour now) is told only actions the rules allow, and none that is legal only because of the veil (not legal once the veiled entries are gone), unless every told action is one (hiding them would leave no legal action at all: they are told).
 */
function checkLegal(s, viewer, hit) {
	const mine = Object.keys(s.statuses || {}).filter((id) => s.statuses[id].some((e) => e.veiled) && s.board.sq.some((q) => q && q.id === id && q.c === viewer));
	if (!mine.length) return;
	const fog = boardFog(s, other(viewer)), open = JSON.parse(JSON.stringify(s)), told = playerLegal(s, viewer);
	for (const id of mine) { open.statuses[id] = open.statuses[id].filter((e) => !e.veiled); if (!open.statuses[id].length) delete open.statuses[id]; }
	const real = new Set(legalActions(s, viewer, fog).map(actionKey)), ok = new Set(legalActions(open, viewer, fog).map(actionKey));
	assert.ok(told.every((a) => real.has(actionKey(a))), "told an action the rules don't allow");
	const only = told.filter((a) => !ok.has(actionKey(a)));
	hit(only.length ? "x:veil-dead-end" : "x:veil-legal");
	assert.ok(!only.length || only.length === told.length, "told " + actionKey(only[0] || {}) + ", legal only because of a veiled status on " + mine.join());
}

/**
 * @description The legal actions don't tell an entered Mirage from a real move card: out of check, the actions under its id are those under a real move card of its type that color holds (in check it can't be played: the accepted tell).
 */
function checkMirageActions(s, color, acts) {
	const p = s.players[color], under = (id) => JSON.stringify(acts.filter((a) => a.card === id).map((a) => ({ ...a, card: null })));
	for (const m of p.curses.filter((c) => isMirage(c) && !c.waiting)) {
		const twin = p.moves.find((c) => c.piece === m.piece);
		if (twin && !inCheck(s, color)) assert.equal(under(m.id), under(twin.id), "the legal actions tell the mirage " + m.id + " from the move card " + twin.id);
	}
}

/**
 * @description The free discard, one card at a time (user rulings 2026-11-21, 2026-11-22): never listed in check; one kind a turn, at most 2 move cards; it keeps the turn and the board; a move card is remembered (hit "d:single") and the next one, this turn or later, draws 1 move card back at once and puts both on the pile (hit "d:pair"); an active nothing; the held passive a different passive at once with nothing else in the hand moving (hit "d:reroll") (the counts unless the automatic redraw ran, or the game ended on it).
 */
function checkDiscard(s, color, acts, a, state, events, hit) {
	const listed = acts.filter((x) => x.type === "discard"), d = s.discarded, before = s.players[color], after = state.players[color];
	const isMove = (p, x) => hand.moveCards(p).some((c) => c.id === x.cards[0]);
	assert.ok(listed.every((x) => x.cards.length === 1), "a free discard of more than one card");
	if (listed.length) assert.ok(!inCheck(s, color) && (!d || (d.kind === "move" && d.n < 2)), "a free discard listed in check or past the turn's limit");
	if (d) assert.ok(listed.every((x) => isMove(before, x)), "a second kind of free discard this turn");
	if (a.type !== "discard") return;
	assert.equal(state.ply, s.ply, "the free discard ended the turn");
	const reroll = !!before.passive && a.cards[0] === before.passive.id, move = isMove(before, a), pair = move && !!before.kept;
	const drawn = (events.find((e) => e.type === "draw" && e.player === color) || {}).card; // THE DRAW-BACK COMES BEFORE ANY REDRAW'S
	const own = state.board.sq.some((q) => q && q.c === color && q.t !== "k"); // A LONE KING HAS NO TYPE TO DRAW (CORE RULES): NOTHING BACK
	if (reroll) {
		hit("d:reroll");
		assert.deepEqual(events.slice(0, 2).map((e) => [e.type, e.card.id]), [["discard", before.passive.id], ["draw", drawn.id]], "a reroll is the passive's discard, then a draw");
		assert.ok(CARDS[drawn.key].kind === "passive" && baseKey(drawn.key) !== baseKey(before.passive.key), "the reroll drew " + drawn.key + " for " + before.passive.key);
		assert.ok(!after.used.includes(before.passive.key) && after.used.length === before.used.length, "the rerolled passive counts as used");
	} else if (move) {
		hit(pair ? "d:pair" : "d:single");
		assert.equal(!!events[0].kept, !pair, "only the first move card of a pair is remembered");
		if (pair && own) assert.ok(drawn && drawn.key === "move" && "pmrq".includes(drawn.piece), "the pair drew back " + JSON.stringify(drawn));
		if (!pair) assert.ok(!drawn || events.some((e) => e.type === "redraw"), "a single move card drew a card back");
		assert.equal(after.pile.n, ((before.pile && before.pile.n) || 0) + (pair ? 2 : 0) + (events.some((e) => e.type === "redraw") ? hand.moveCards(before).length - 1 + (pair && own ? 1 : 0) : 0), "the pile's count after a move card's discard");
		assert.deepEqual(after.kept ? after.kept.id : null, pair ? null : a.cards[0], "the remembered card");
	}
	if (state.result) return;
	assert.deepEqual([state.board.turn, state.discarded], [color, { player: color, kind: reroll ? "passive" : move ? "move" : "active", n: move && d ? d.n + 1 : 1 }], "the turn didn't stay, or the discard isn't marked");
	assert.equal(JSON.stringify(state.board.sq), JSON.stringify(s.board.sq), "the free discard changed the board");
	const left = legalActions(state, color).filter((x) => x.type === "discard");
	assert.ok(move && state.discarded.n < 2 ? left.every((x) => isMove(after, x)) : !left.length, "a free discard past the turn's kind or count");
	if (events.some((e) => e.type === "redraw")) return;
	if (reroll) assert.deepEqual([after.passive, after.moves, after.actives, after.curses], [drawn, before.moves, before.actives, before.curses], "a reroll moved something else in the hand");
	else if (move) assert.equal(hand.moveCards(after).length, hand.moveCards(before).length - (pair && own ? 0 : 1), "a move card discarded: 1 back for the second of a pair only");
	else assert.equal(after.actives.length, before.actives.length - 1, "an active discarded, something back");
	if (!reroll) assert.deepEqual(after.passive, before.passive, "a free discard of move or active cards changed the passive");
}

/**
 * @description The drop of a placed card: listed only for color's own waiting passives and the cards on its active spot, never in a two-move turn; it keeps the turn, the board's pieces and the turn's free discard, draws nothing (unless the automatic redraw ran), the card is on top of color's pile and no longer placed, a passive not used and not drawable this turn; and it never puts a king in check.
 */
function checkDrop(s, color, acts, a, state, events) {
	const mine = [...s.effects.filter((e) => e.owner === color).map((e) => e.id), ...(s.players[color].spot || []).map((c) => c.id)];
	const listed = acts.filter((x) => x.type === "drop");
	assert.ok(listed.every((x) => mine.includes(x.card)) && !(listed.length && s.multi && !s.multi.mulled), "a drop of a card that isn't the player's own placed one, or in a two-move turn"); // AFTER MULLIGAN THEY STAY (RULING R5)
	if (boardFog(s, other(color))) { // UNDER THE OTHER PLAYER'S FOG THE TOLD DROPS ARE EVERY OWN PLACED CARD, WHATEVER CHECK A DROP WOULD GIVE: NOTHING OF A HIDDEN PIECE (FINAL REVIEW F-I1; applyAction REFUSES THE ONE THAT GIVES CHECK)
		const live = s.enchant.filter((e) => e.owner === color).map((e) => baseKey(e.key)); // AN ACTIVE IN EFFECT: A SPOT CARD WITH AN ENCHANTMENT OF ITS OWN LEFT, THE NEWEST CARD FIRST
		const spot = [...(s.players[color].spot || [])].reverse().filter((c) => { const i = live.indexOf(baseKey(c.key)); if (i >= 0) live.splice(i, 1); return i >= 0; }).reverse();
		const own = s.multi && s.multi.player === color && !s.multi.mulled ? [] : [...s.effects.filter((e) => e.owner === color).sort((x, y) => x.placedAt - y.placedAt).map((e) => e.id), ...spot.map((c) => c.id)];
		const told = playerLegal(s, color).filter((x) => x.type === "drop");
		assert.deepEqual(told, own.map((card) => ({ type: "drop", card })).filter((x) => actionKey(x) !== s.barred), "under the other player's fog the told drops aren't the player's own placed cards");
		assert.ok(listed.every((x) => told.some((y) => y.card === x.card)), "a legal drop isn't told under the other player's fog");
	}
	if (a.type !== "drop") return;
	const before = s.players[color], after = state.players[color], passive = s.effects.find((e) => e.id === a.card);
	assert.deepEqual(events[0], { type: "card-dropped", player: color, card: passive ? passive.card : before.spot.find((c) => c.id === a.card) }, "a drop's first event");
	assert.ok(!state.effects.some((e) => e.id === a.card) && !after.spot.some((c) => c.id === a.card), "the dropped card is still placed");
	assert.deepEqual(after.used, before.used, "a dropped card counts as used");
	for (const c of ["w", "b"]) assert.ok(inCheck(s, c) || !inCheck(state, c), "a drop put " + c + " in check");
	if (state.result) return;
	assert.deepEqual([state.ply, state.board.turn, state.discarded], [s.ply, color, s.discarded], "a drop ended the turn or used the free discard");
	assert.equal(JSON.stringify(state.board.sq), JSON.stringify(s.board.sq), "a drop changed the board");
	if (passive) assert.ok(after.gone.includes(baseKey(passive.card.key)) && !hand.drawable(state, color, "passive").includes(passive.card.key), "a dropped passive can be drawn this turn");
	if (events.some((e) => e.type === "redraw")) return;
	assert.ok(!events.some((e) => e.type === "draw"), "a drop drew a card");
	assert.equal(after.pile.top.id, a.card, "the dropped card isn't on top of the pile");
	assert.equal(after.pile.n, ((before.pile && before.pile.n) || 0) + 1, "the pile's count after a drop");
}

/**
 * @description Whose a new discard list entry is decides who may read it (view.js playerView): it is the player who last held its card, so a wrong colour at any hand.js toPile or throwMoves caller fails (Task 21a fix round 1, M1).
 * The holder: whose the card was before the action (hand, remembered card, active spot, placed passives), then the action's events in order (drawn, taken by Bounty or Pickpocket, a curse given). The new entries are the list's first, as many as the piles grew by (none when they shrank: Grace put an earlier state back)
 */
function checkOwners(s, state, events) {
	const grew = ["w", "b"].reduce((n, c) => n + ((state.players[c].pile || {}).n || 0) - ((s.players[c].pile || {}).n || 0), 0), holder = new Map();
	for (const c of ["w", "b"]) { const p = s.players[c]; for (const card of [...handOf(p), ...(p.kept ? [p.kept] : []), ...(p.spot || []), ...s.effects.filter((x) => x.owner === c).map((x) => x.card)]) holder.set(card.id, c); }
	for (const x of events) {
		if (!x.card || typeof x.card !== "object") continue;
		if (x.type === "draw" || x.type === "card-taken") holder.set(x.card.id, x.player);
		else if (x.type === "curse-given") holder.set(x.card.id, other(x.player)); // IT NAMES THE GIVER
	}
	for (const e of (state.piled || []).slice(0, Math.max(0, grew))) assert.equal(holder.get(e.card.id), e.player, "discard list entry " + e.card.id + " (" + e.card.key + ") marked " + e.player + "'s, last held by " + holder.get(e.card.id));
}

/**
 * @description One seeded game to its result or the ply cap, every check at every ply; throws with the ply in the message. Adds what it met to stats. A directed run passes opts: setup(state, seed) changes the new game (or returns the state to play from), plies is its cap, note(state, events, hit) counts or checks what it looks for after each action.
 */
function play(seed, stats, { setup, plies = PLIES, note } = {}) {
	let s = newGame({ cardGuy: "b", level: 1300, seed }), ply = 0;
	const roll = picker(seed), hit = (k) => { stats[k] = (stats[k] || 0) + 1; };
	const secret = { w: [], b: [] }; // PER VIEWER: THE OPPONENT'S CARDS THAT LEFT ITS HAND UNSEEN (THE ORACLE'S OWN LIST, FROM THE RAW EVENTS)
	try {
		if (setup) s = setup(s, seed) || s;
		for (const c of ["w", "b"]) checkView(s, c);
		for (; ply < plies && !s.result; ply++) {
			const toAct = s.pending ? [s.pending.player] : s.duel ? ["w", "b"] : [s.board.turn];
			const can = toAct.map((c) => [c, legalActions(s, c)]).filter((x) => x[1].length);
			assert.ok(can.length, "nobody can act and the game isn't over (to act: " + toAct.join() + ")");
			const [color, acts] = can[roll(can.length)];
			const a = acts[roll(acts.length)];
			if (!s.pending && !s.duel) checkMirageActions(s, color, acts);
			if (ply % 10 === 0) { // A JSON ROUND TRIP (THE SERVER'S STORE) CHANGES NOTHING THAT FOLLOWS: THE SAME ACTIONS, THE SAME NEXT STATE AND EVENTS; PLAY GOES ON FROM THE COPY
				const copy = JSON.parse(JSON.stringify(s));
				assert.deepEqual(copy, s, "the state isn't plain JSON (an undefined or NaN field)");
				for (const c of ["w", "b"]) assert.deepEqual(legalActions(copy, c), legalActions(s, c), "legal actions differ after a JSON round trip");
				assert.equal(JSON.stringify(applyAction(copy, color, a)), JSON.stringify(applyAction(s, color, a)), "the next action differs after a JSON round trip");
				s = copy;
			}
			const { state, events } = applyAction(s, color, a);
			checkOwners(s, state, events);
			for (const c of ["w", "b"]) {
				for (const e of events) {
					const hid = e.player === other(c) && e.card && typeof e.card === "object" && (e.type === "discard" ? !isMirage(e.card) && !visibleTo(state, c, e.card) : e.type === "move" && boardFog(state, other(c)));
					if (hid) { secret[c].push(e.card.id); hit("x:secret-" + e.type); }
				}
				checkEvents(state, events, c, checkView(state, c, secret[c]));
				checkLegal(state, c, hit);
			}
			if (!s.pending && !s.duel) { checkDiscard(s, color, acts, a, state, events, hit); checkDrop(s, color, acts, a, state, events); }
			if (note) note(state, events, hit);
			hit("a:" + a.type);
			for (const e of events) { hit("e:" + e.type); if (e.type === "card-played" || e.type === "passive-placed" || e.type === "curse-given") hit("k:" + baseKey(e.card.key)); }
			s = state;
		}
		if (!s.result) { // AT THE CAP: THE GAME IS STILL LIVE (SOMEBODY CAN ACT) AND THE DRAW RULES ARE STILL COUNTING, SO IT WOULD END
			assert.ok(["w", "b"].some((c) => legalActions(s, c).length), "stuck at the cap");
			const b = s.board, last = b.history[b.history.length - 1];
			assert.ok(Number.isInteger(b.half) && b.half >= 0 && Array.isArray(b.history), "draw counters broken");
			if (!s.pending && !s.duel && !s.multi) assert.ok(b.half < 100 && b.history.filter((k) => k === last).length < 3, "a fifty-move or repetition draw was due and not given");
		}
		assert.ok(!s.result || ["checkmate", "stalemate", "repetition", "fifty", "material", "king"].includes(s.result.reason), "an end reason the rules don't have: " + (s.result && s.result.reason));
		hit(s.result ? "end:" + s.result.reason : "end:cap");
		stats.plies = (stats.plies || 0) + ply;
	} catch (err) {
		err.message = "seed " + seed + " ply " + ply + ": " + err.message.split("\n")[0];
		throw err;
	}
}

/**
 * @description Play these seeds (opts: a directed run, see play): { stats, failed } (failed: one "seed N ply P: why" line per failing game).
 */
function soak(seeds, opts) {
	const stats = {}, failed = [];
	for (const seed of seeds) {
		try { play(seed, stats, opts); } catch (err) { failed.push(err.message + (err.name === "AssertionError" ? "" : " [" + err.name + " " + String(err.stack).split("\n")[1].trim() + "]")); }
	}
	return { stats, failed };
}

if (!isMainThread) parentPort.postMessage(soak(workerData)); // ONE SHARE OF THE GAMES: THE 500 TAKE ABOUT 4 CPU-MINUTES, SO THEY ARE SPLIT OVER THE CORES (ABOUT 35 s ON 8)
else test("500 seeded random games with every card: no throw, never stuck, nothing hidden shown, JSON-safe, every game ends or is still live at the cap", { timeout: 300000 }, async (t) => {
	const only = Number(process.env.CARDS_FUZZ_SEED), seeds = only ? [only] : Array.from({ length: GAMES }, (_, i) => i + 1);
	const n = Math.min(8, os.availableParallelism(), seeds.length), started = Date.now();
	const parts = await Promise.all(Array.from({ length: n }, (_, w) => new Promise((resolve, reject) => {
		new Worker(__filename, { workerData: seeds.filter((_, i) => i % n === w) }).once("message", resolve).once("error", reject);
	})));
	const stats = {}, failed = parts.flatMap((p) => p.failed).sort((a, b) => Number(a.split(" ")[1]) - Number(b.split(" ")[1]));
	for (const p of parts) for (const [k, v] of Object.entries(p.stats)) stats[k] = (stats[k] || 0) + v;
	const group = (p) => Object.keys(stats).filter((k) => k.startsWith(p)).sort().map((k) => k.slice(p.length) + " " + stats[k]).join(", ");
	t.diagnostic(seeds.length + " games, " + stats.plies + " plies, " + n + " threads, " + (Date.now() - started) + " ms. Ends: " + group("end:") + ". Actions: " + group("a:") + ". Cards met: " + Object.keys(stats).filter((k) => k.startsWith("k:")).length + ".");
	if (failed.length) console.log(failed.length + " failing games:\n" + failed.join("\n")); // EVERY FAILING SEED, NOT ONLY THE FIRST
	assert.equal(failed.length, 0, failed.length + " of " + seeds.length + " games failed; first: " + failed[0]);
	if (only) return;
	for (const k of new Set(Object.keys(CARDS).map(baseKey))) assert.ok(stats["k:" + k], "card " + k + " never played, placed or given"); // EVERY CARD THE LOADER REGISTERS
	for (const k of ["a:move", "a:active", "a:passive", "a:discard", "a:choice", "a:duel", "e:capture", "e:curse-given", "e:enchant", "e:turn-skipped", "e:king-skull", "d:single", "d:pair", "d:reroll", "a:drop", "e:card-dropped", "e:card-ended", "x:secret-discard", "x:secret-move"]) assert.ok(stats[k] > 20, k + " met only " + (stats[k] || 0) + " times"); // THE SOAK REACHED THE CARD PATHS
});

/*
 *	Directed runs: the same random play and the same checks, from a start the 500 games seldom reach.
 */

const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);
const place = (s, key, owner) => { const card = hand.newCard(s, key); s.effects.push({ id: card.id, owner, card, placedAt: s.ply }); };
const fogUp = (s, owner, key, left) => { const ctx = makeCtx(s); ctx.trigger = () => {}; ctx.enchant(owner, key, [], left); };
const enter = (s, c) => { const p = s.players[c], real = p.moves.shift(); p.curses.push({ id: real.id, key: "mirage", piece: real.piece }); }; // AS hand.drawMoves LEAVES IT: A MOVE CARD'S ID AND TYPE
const entered = (s) => ["w", "b"].some((c) => s.players[c].curses.some((m) => isMirage(m) && !m.waiting));
const clean = (r, t) => { t.diagnostic(Object.keys(r.stats).filter((k) => /^(x|end):/.test(k)).sort().map((k) => k + " " + r.stats[k]).join(", ")); assert.deepEqual(r.failed, [], r.failed.length + " failing games"); };

if (isMainThread) {
	test("the ply cap: games stopped at 40 plies are still live there, with the draw rules counting", (t) => {
		const r = soak(SEEDS, { plies: 40 });
		clean(r, t);
		assert.ok(r.stats["end:cap"] >= 12, "only " + r.stats["end:cap"] + " games reached the cap");
	});

	test("Unbroken Line from a start where both sides can castle at once: a castle through check fires it, once a side, and never leaves the king in check", (t) => {
		const r = soak([...SEEDS, ...SEEDS.map((n) => n + SEEDS.length)], { // TWICE THE SEEDS: THE DRAW'S WEIGHTS OF 2026-11-22 LEFT THE FIRST 24 WITH 3 CASTLES THROUGH CHECK
			plies: 60,
			setup(s) {
				for (const sq of ["b1", "c1", "d1", "f1", "g1", "b8", "c8", "d8", "f8", "g8", "d2", "e2", "f2", "d7", "e7", "f7"]) s.board.sq[sqIndex(sq)] = null;
				s.board.sq[sqIndex("d4")] = { ...s.board.sq[sqIndex("a8")], id: "b17" }; // A ROOK EACH ON THE OPEN FILES BESIDE THE KINGS: THE SQUARES THEY CASTLE PAST ARE ATTACKED
				s.board.sq[sqIndex("f5")] = { ...s.board.sq[sqIndex("a1")], id: "w17" };
				for (const c of ["w", "b"]) place(s, "unbroken-line", c);
			},
			note(state, events, hit) {
				for (const e of events.filter((x) => x.type === "move" && x.through)) {
					hit("x:through");
					assert.ok(!inCheck(state, e.player), "the king castled into check");
					assert.ok(events.some((x) => x.type === "passive-fired" && x.player === e.player && x.card.key === "unbroken-line"), "a castle through check didn't fire Unbroken Line");
					assert.deepEqual(state.players[e.player].used.filter((k) => k === "unbroken-line"), ["unbroken-line"]);
				}
			},
		});
		clean(r, t);
		assert.ok(r.stats["x:through"] >= 5, "only " + (r.stats["x:through"] || 0) + " castles through check");
	});

	test("T21 m3: a Tremor held by each side from the start: the veiled Frozen's told-list check (x:veil-legal) is reached, not only written", (t) => {
		const r = soak(SEEDS, { plies: 30, setup(s) { for (const c of ["w", "b"]) s.players[c].curses.push(hand.newCard(s, "tremor")); } });
		clean(r, t);
		assert.ok((r.stats["x:veil-legal"] || 0) + (r.stats["x:veil-dead-end"] || 0) >= 20, "the veil check ran only " + ((r.stats["x:veil-legal"] || 0) + (r.stats["x:veil-dead-end"] || 0)) + " times");
	});

	test("a held Mirage under a Fog of War (either side's, any version) and in a card duel: nothing hidden shown, the Mirage never named to its holder", (t) => {
		const r = soak(SEEDS, {
			plies: 40,
			setup(s, seed) {
				enter(s, seed % 2 ? "w" : "b");
				fogUp(s, seed % 4 < 2 ? "w" : "b", ["fog-of-war", "fog-of-war-rare", "fog-of-war-epic"][seed % 3], 8);
				for (const c of ["w", "b"]) s.players[c].actives = [hand.newCard(s, "all-or-nothing")];
			},
			note(state, events, hit) {
				if (!entered(state)) return;
				if (state.enchant.some((e) => baseKey(e.key) === "fog-of-war")) hit("x:mirage-fog");
				if (state.duel) hit("x:mirage-duel");
			},
		});
		clean(r, t);
		assert.ok(r.stats["x:mirage-fog"] >= 50, "a Mirage was held under a fog after only " + (r.stats["x:mirage-fog"] || 0) + " actions");
		assert.ok(r.stats["x:mirage-duel"] >= 5, "a Mirage was held in a duel after only " + (r.stats["x:mirage-duel"] || 0) + " actions");
	});

	test("placed cards under a Fog of War (either side's, any version): the drops a player is told are its own placed cards, whatever the hidden pieces", (t) => {
		const r = soak([...SEEDS, 72, 84, 108], { // ENGINE 3'S DRAW POOL (TASK 25b, ONE INSIDIOUS NULLIFICATION) LEFT SEEDS 1-48 WITH NO TOLD DROP THE GAME REFUSES; OF 1-300 ONLY 72, 84, 108, 181, 223, 230, 291 AND 295 REACH ONE
			plies: 60,
			setup(s, seed) {
				fogUp(s, seed % 2 ? "w" : "b", ["fog-of-war", "fog-of-war-rare", "fog-of-war-epic"][seed % 3], 40);
				for (const c of ["w", "b"]) { place(s, "grace", c); s.players[c].actives = [hand.newCard(s, "stronghold")]; }
			},
			note(state, events, hit) {
				const c = state.board.turn;
				if (state.result || state.pending || state.duel || !boardFog(state, other(c))) return;
				const told = playerLegal(state, c).filter((a) => a.type === "drop").length;
				if (told) hit("x:fog-drops");
				if (told > legalActions(state, c).filter((a) => a.type === "drop").length) hit("x:fog-drop-refused");
			},
		});
		clean(r, t);
		assert.ok(r.stats["x:fog-drops"] >= 50, "drops were told under a fog after only " + (r.stats["x:fog-drops"] || 0) + " actions");
		assert.ok(r.stats["x:fog-drop-refused"] >= 1, "the soak never reached a told drop the game refuses");
	});

	test("a Mirage holder's mating capture taken back by Grace: the Mirage it passed is back in its hand, and neither view nor the events name it to its holder", () => {
		const s = newGame({ cardGuy: "b", level: 1300, seed: 1 }), n = { w: 1, b: 1 };
		s.board = fromFen("3rkr2/3p1p2/8/8/8/8/8/R3n1K1 w - - 0 1"); // Rxe1 MATES
		s.board.sq.forEach((q) => { if (q) q.id = q.c + n[q.c]++; });
		Object.assign(s.players.w, { moves: [hand.newCard(s, "move", { piece: "r" }), hand.newCard(s, "move", { piece: "r" })], actives: [], passive: null });
		enter(s, "w");
		place(s, "grace", "b");
		const a = legalActions(s, "w").find((x) => x.type === "move" && x.card === s.players.w.moves[0].id && x.to === "e1");
		const { state, events } = applyAction(s, "w", a);
		assert.equal(state.result, null);
		assert.ok(events.some((e) => e.type === "move-undone") && !events.some((e) => e.type === "curse-given" || e.type === "curse-cleared"));
		assert.deepEqual(state.players.w.curses, s.players.w.curses);
		assert.deepEqual(state.players.b.curses, []);
		assert.deepEqual(state.board, s.board);
		for (const c of ["w", "b"]) checkEvents(state, events, c, checkView(state, c));
		checkMirageActions(state, "w", legalActions(state, "w"));
	});

	test("a state rebuilt from Black's view with a Hollow Crown (King card held or lost) or a waiting Mirage (either side's) plays on like any other", (t) => {
		const r = soak(SEEDS, {
			plies: 40,
			setup(s, seed) {
				const ctx = makeCtx(s), kind = seed % 4;
				ctx.trigger = () => {};
				if (kind < 2) assert.ok(ctx.giveCurse("w", "hollow-crown", "b"));
				if (kind === 1) s.players.w.king = false;
				if (kind >= 2) assert.ok(ctx.giveCurse(kind === 2 ? "w" : "b", "mirage", kind === 2 ? "b" : "w"));
				const t = fromView(playerView(s, "b"), seed);
				assert.deepEqual(t.players.w.curses.map((c) => baseKey(c.key)), kind < 2 ? ["hollow-crown"] : kind === 2 ? ["mirage"] : []);
				assert.equal(t.players.w.king, kind !== 1);
				assert.equal(t.players.b.curses.length, 0); // ITS OWN WAITING MIRAGE IS NOWHERE IN BLACK'S VIEW
				return t;
			},
			note(state, events, hit) {
				if (entered(state)) hit("x:entered");
				if (state.players.w.curses.some((c) => baseKey(c.key) === "hollow-crown")) hit("x:crown");
				if (!state.players.w.king) hit("x:no-king-card");
			},
		});
		clean(r, t);
		for (const k of ["x:entered", "x:crown"]) assert.ok(r.stats[k] >= 20, k + " met only " + (r.stats[k] || 0) + " times");
		assert.ok(r.stats["x:no-king-card"] >= 1, "x:no-king-card never met"); // WAS >= 20: THESE SEEDS NOW MEET IT 3 TIMES (A QUEEN COUNTS DOUBLE, THE DRAWS MOVED)
	});

	test("both sides under a Fog of War at once: each view hides the other's half, and a real capture of a fogged piece reaches the other player as \"?\"", (t) => {
		const r = soak(SEEDS, {
			plies: 60,
			setup(s, seed) {
				fogUp(s, "w", ["fog-of-war", "fog-of-war-rare"][seed % 2], 40);
				fogUp(s, "b", ["fog-of-war-epic", "fog-of-war"][seed % 2], 40);
			},
			note(state, events, hit) {
				const fogs = ["w", "b"].filter((c) => boardFog(state, c));
				if (fogs.length === 2) hit("x:two-fogs");
				for (const e of events) if (e.type === "capture" && fogs.includes(e.c)) hit("x:fog-capture"); // checkEvents ASSERTED ITS t "?"
			},
		});
		clean(r, t);
		assert.ok(r.stats["x:two-fogs"] >= 200, "both fogs were up after only " + (r.stats["x:two-fogs"] || 0) + " actions");
		assert.ok(r.stats["x:fog-capture"] >= 20, "only " + (r.stats["x:fog-capture"] || 0) + " captures of a fogged piece");
	});
}
