/*
 *  turn.choice.js  --  chess cards engine
 *	Duel actions and choices: resolving them, and the check event an action that moved no piece itself still owes.
 *
 */

const { inCheck } = require("../rules.js");
const { CARDS } = require("../cards/index.js");
const duel = require("../duel.js");
const { other } = require("./turn.shared.js");
const { turnActions } = require("./turn.actions.js");
const { endTurn, noAction } = require("./turn.end.js");

/**
 * @description One check event for player's opponent when they are in check and no check event named them since event
 * index from: an active, a card-defined action or a choice that moved or removed a piece gives check as a move does.
 * The event says what holds when it is emitted: a choice resolved later, or the end of the turn (a status given then,
 * e.g. Heretical Subjection's Shaken), can still lift it; the client reads the standing check from the state at
 * turn-start.
 */
function checkAfter(ctx, player, from) {
	const opponent = other(player);
	if (ctx.state.result) return;
	if (ctx.events.slice(from).some((event) => event.type === "check" && event.player === opponent)) return;
	if (inCheck(ctx.state, opponent)) ctx.emit({ type: "check", player: opponent });
}

/**
 * @description Resolve a duel action (duel.act) by either player during the duel player's turn. A check event when it
 * put that player's opponent in check (an upgrade, or a lost piece opening a line) and no check stood before it
 * (checkAfter). When the duel is over, the duel player's turn ends (after a choice a trigger asked, if any).
 */
function duelAct(ctx, player, action) {
	const state = ctx.state, duelPlayer = state.duel.player, from = ctx.events.length;
	const checkStood = inCheck(state, other(duelPlayer));
	const over = duel.act(ctx, player, action);
	// Grace takes back one duel action: a later stop or pick is another one
	if (state.barred && JSON.parse(state.barred).type === "duel") state.barred = null;
	if (!checkStood) checkAfter(ctx, duelPlayer, from);
	if (!over || state.result) return;
	// The turn ends after the choice is answered
	if (state.pending) return void Object.assign(state.pending, { end: true, resetHalf: ctx.resetHalf });
	endTurn(ctx, duelPlayer);
}

/**
 * @description Resolve the current choice with option. The next queued choice (pending.next) becomes current first,
 * so a choice that resolve asks queues behind those asked before it. Then the card's choice.resolve runs (ctx.turn back
 * to the turn it was asked in), with a check event when it put the opponent in check (checkAfter).
 * While choices remain, the next current one carries what is left of the turn (end, resetHalf). After the last: the end
 * of the turn when pending.end; else, as the turn goes on, a capture made by resolve zeroes half now (as act does when
 * an active starts a two-move turn). It also ends a two-move turn the choice left with no move; in Mulligan's one-move
 * turn that is the automatic redraw instead (noAction; an open free discard doesn't keep the turn waiting).
 * (shortcut: that end adds no history entry and counts half + 1 instead of the move's value; fine while no choice card
 * resolves into a stuck two-move turn).
 */
function resolveChoice(ctx, option) {
	const state = ctx.state, asked = state.pending;
	const [head, ...rest] = asked.next || [];
	state.pending = head ? (rest.length ? { ...head, next: rest } : head) : null;
	ctx.turn = asked.turn;
	const from = ctx.events.length, checkStood = inCheck(state, other(asked.turn));
	CARDS[asked.card].choice.resolve(ctx, asked, option);
	// Only a check this resolve made: one that stood before it was already emitted
	if (!checkStood) checkAfter(ctx, asked.turn, from);
	const resetHalf = ctx.resetHalf || !!asked.resetHalf;
	if (state.pending && asked.end) return void Object.assign(state.pending, { end: true, resetHalf });
	if (state.result) return;
	// Mulligan's one move is gone: the automatic redraw, as right after Mulligan (act). Still none ended the game
	if (!state.pending && !asked.end && state.multi && state.multi.mulled && noAction(ctx, asked.turn)) return;
	if (!state.pending && (asked.end || (state.multi && !turnActions(state, asked.turn).length))) {
		ctx.resetHalf = resetHalf;
		return endTurn(ctx, asked.turn);
	}
	// The turn goes on (a two-move turn, or a choice asked at the start of the turn)
	if (ctx.resetHalf) state.board.half = 0;
}

module.exports = { checkAfter, duelAct, resolveChoice };
