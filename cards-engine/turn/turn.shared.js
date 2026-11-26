/*
 *  turn.shared.js  --  chess cards engine
 *	Small helpers the turn's files share: the other colour, action keys, a trial copy and the sides in check.
 *
 */

const { inCheck } = require("../rules.js");
const { makeCtx } = require("../ctx.js");

function other(color) {
	return color === "w" ? "b" : "w";
}

/**
 * @description A stable string for an action: its JSON with every object's keys sorted.
 */
function actionKey(action) {
	return JSON.stringify(action, sortObjectKeys);
}

/**
 * @description actionKey's JSON.stringify replacer: a plain object comes back with its keys sorted, anything else as it is.
 */
function sortObjectKeys(_key, value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	return Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
}

/**
 * @description What state.barred holds for an action Grace takes back. For a move, the move's shape { type, from, to,
 * promotion }, whatever card plays it (a move card, the King card, cardless or routed); for anything else its actionKey.
 */
function barKey(action) {
	if (action.type !== "move") return actionKey(action);
	return actionKey({ type: "move", from: action.from, to: action.to, promotion: action.promotion });
}

/**
 * @description A ctx over a copy of state for a legality trial: hidden effects (Trapdoor) don't fire on it, so the
 * offered actions can't reveal them.
 */
function trialCtx(state) {
	const ctx = makeCtx(JSON.parse(JSON.stringify(state)));
	ctx.trial = true;
	return ctx;
}

/**
 * @description The sides in check on state.
 */
function sidesInCheck(state) {
	return ["w", "b"].filter((color) => inCheck(state, color));
}

module.exports = { other, actionKey, barKey, trialCtx, sidesInCheck };
