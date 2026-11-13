/*
 *  actions.js  --  chess frontend
 *	The CRT Monitor's Actions Channel
 *	The game's actions as buttons: hint, takeback & offer draw while it is going, the result (on two lines when it is long), restart & download PGN after it.
 *	Offering (or accepting) a draw asks SURE? YES or NO first.
 *	An action that goes away while the channel is open stays in its slot greyed out (so the buttons don't jump); on the desk the labels are dim text & there are no buttons
 *
 */

import { TEXT, DIM, HOT, drawText, sentence, body } from "../kit.js";
import { textWidth, fitText } from "../../pixelFont.js";

const GOING = ["hint", "takeback", "draw"];
const AFTER = ["restart", "pgn"];
const BTN = { w: 120, h: 15, step: 19, top: 14 }; // ONE BUTTON PER SLOT, STACKED, CENTRED, top PIXELS UNDER THE BODY'S TOP (ROOM FOR THE RESULT)
const ASK = { top: 40, w: 56, h: 15, gap: 8 }; // YES & NO SIDE BY SIDE, CENTRED, UNDER THE QUESTION
const ASK_TEXT = 28; // THE QUESTION, UNDER THE BODY'S TOP
const LINE = 9; // ONE LINE OF THE RESULT

/* ---------------------------------------------------------------- */
// Slots
/* ---------------------------------------------------------------- */

/**
 * @description The actions to draw, in a fixed order: each one shown now or already in the channel
 * @param  {[string[]|undefined]} prev [the slots from the last draw, undefined when there were none]
 * @param  {[object[]]} actions [data.actions]
 * @param  {[boolean]} over [whether the game is over]
 * @return {[string[]]} ids
 */
export function slots(prev, actions, over) {
	return (over ? AFTER : GOING).filter(function (id) {
		const action = actions.find((a) => a.id === id);
		return (action && action.shown) || (prev && prev.includes(id));
	});
}

/**
 * @description The result on one line, or on two split at a space when it is wider than the room
 * @param  {[string]} text ["WHITE WINS! BY CHECKMATE"]
 * @param  {[number]} width [grid pixels]
 * @return {[string[]]} lines [["WHITE WINS!", "BY CHECKMATE"]]
 */
export function resultLines(text, width) {
	const words = String(text || "").split(" ");
	if (textWidth(text) <= width || words.length < 2) { return [fitText(text, width)]; }
	const split = (n) => [words.slice(0, n).join(" "), words.slice(n).join(" ")];
	let best = 1;
	for (let n = 1; n < words.length; n++) { // THE MOST EVEN SPLIT, SO "BY CHECKMATE" STAYS TOGETHER
		if (Math.max(...split(n).map(textWidth)) < Math.max(...split(best).map(textWidth))) { best = n; }
	}
	return split(best).map((line) => fitText(line, width));
}

// THE RESULT'S LINES IN THE CHANNEL, NONE WHILE THE GAME IS GOING
function results(data) {
	return data.over ? resultLines(data.result, body(data).w - 8) : [];
}

// THE ACTION WITH THIS ID, IF THERE IS ONE
function find(data, id) {
	return data.actions.find((a) => a.id === id);
}

// WHETHER THE OFFER DRAW PROMPT IS UP: ASKED FOR, & THE DRAW STILL CAN BE OFFERED
function asking(data) {
	const action = find(data, "draw");
	return data.ui.confirm === "draw" && !!action && action.enabled;
}

/* ---------------------------------------------------------------- */
// Channel
/* ---------------------------------------------------------------- */

/**
 * @description Draws the channel: the result, then the prompt or (on the desk) the actions' labels
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} data [the channels' data]
 */
export function draw(ctx, data) {
	const area = body(data);
	const mid = area.x + area.w / 2;
	const ids = slots(data.ui.slots, data.actions, data.over);
	let y = area.y + 4;
	const lines = results(data);
	lines.forEach((line, i) => drawText(ctx, line, mid, y + i * LINE, HOT, 0));
	if (lines.length) { y += lines.length * LINE + 3; }
	if (!data.zoomed) {
		ids.forEach(function (id, i) {
			const action = find(data, id);
			drawText(ctx, fitText(action.label, area.w - 8), mid, y + 4 + i * 12, action.enabled ? TEXT : DIM, 0);
		});
		return;
	}
	if (asking(data)) { drawText(ctx, "SURE?", mid, area.y + ASK_TEXT, TEXT, 0); } // THE SPEC'S WORD, FOR OFFER DRAW & ACCEPT DRAW ALIKE
	else if (!ids.length) { drawText(ctx, "NOTHING TO DO", mid, area.y + 40, DIM, 0); }
}

/**
 * @description The channel's buttons when zoomed: YES & NO while asking about a draw, else one per slot; none on the desk
 * @param  {[object]} data [the channels' data]
 * @return {[object[]]} buttons
 */
export function buttons(data) {
	if (!data.zoomed) { return []; }
	const area = body(data);
	if (asking(data)) {
		const x = area.x + Math.floor((area.w - 2 * ASK.w - ASK.gap) / 2);
		return [["yes", "YES"], ["no", "NO"]].map(([id, label], i) => ({ id, x: x + i * (ASK.w + ASK.gap), y: area.y + ASK.top, w: ASK.w, h: ASK.h, label, enabled: true }));
	}
	const x = area.x + Math.floor((area.w - BTN.w) / 2);
	const top = BTN.top + Math.max(0, results(data).length - 1) * LINE; // A TWO LINE RESULT PUSHES THEM DOWN A LINE
	return slots(data.ui.slots, data.actions, data.over).map(function (id, i) {
		const action = find(data, id);
		return { id, x, y: area.y + top + i * BTN.step, w: BTN.w, h: BTN.h, label: action ? action.label : id, enabled: !!action && action.enabled };
	});
}

/**
 * @description Runs an action, asks about a draw, or answers that question
 * @param  {[string]} id [an action's id, or yes or no]
 * @param  {[object]} handlers [hint(), takeback(), draw(), restart(), pgn(), ui(patch)]
 * @param  {[object]} data [the channels' data]
 */
export function press(id, handlers, data) {
	if (id === "yes" || id === "no") {
		if (!asking(data)) {
			if (data.ui.confirm) { handlers.ui({ confirm: null }); } // CLEAR A STALE PROMPT SO IT DOESN'T REAPPEAR UNASKED
			return;
		}
		if (id === "yes") { handlers.draw(); }
		handlers.ui({ confirm: null });
		return;
	}
	const action = find(data, id);
	if (!action || !action.enabled) { return; }
	if (id === "draw") { handlers.ui({ confirm: "draw" }); }
	else if (typeof handlers[id] === "function") { handlers[id](); }
}

/**
 * @description What the screen reader says for the channel: the result once the game is over, the question while asking, then the buttons it can press
 * @param  {[object]} data [the channels' data, zoomed]
 * @return {[string]} e.g. "White wins! By checkmate. Restart, Download pgn"
 */
export function speak(data) {
	const parts = data.over ? [sentence(data.result)] : [];
	if (asking(data)) { parts.push("Sure?"); }
	const labels = buttons({ ...data, zoomed: true }).filter((b) => b.enabled).map((b) => sentence(b.label));
	parts.push(labels.length ? labels.join(", ") : "Nothing to do");
	return parts.filter(Boolean).join(". ");
}

export { GOING, AFTER };
