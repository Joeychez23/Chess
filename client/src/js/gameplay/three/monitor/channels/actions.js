/*
 *  actions.js  --  chess frontend
 *	The CRT Monitor's Actions Channel
 *	The game's actions as buttons: hint, takeback & offer draw while it is going, restart & download PGN after it. Offering a draw asks YES or NO first.
 *	An action that goes away while the channel is open stays in its slot greyed out (so the buttons don't jump); on the desk the labels are dim text & there are no buttons
 *
 */

import { TEXT, DIM, HOT, drawText, body } from "../kit.js";
import { fitText } from "../../pixelFont.js";

const GOING = ["hint", "takeback", "draw"];
const AFTER = ["restart", "pgn"];
const BTN = { w: 120, h: 15, step: 19, top: 14 }; // ONE BUTTON PER SLOT, STACKED, CENTRED, top PIXELS UNDER THE BODY'S TOP (ROOM FOR THE RESULT)
const ASK = { top: 40, w: 56, h: 15, gap: 8 }; // YES & NO SIDE BY SIDE, CENTRED, UNDER THE QUESTION
const ASK_TEXT = 28; // THE QUESTION, UNDER THE BODY'S TOP

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
	if (data.over) {
		drawText(ctx, fitText(data.result, area.w - 8), mid, y, HOT, 0);
		y += 12;
	}
	if (!data.zoomed) {
		ids.forEach(function (id, i) {
			const action = find(data, id);
			drawText(ctx, fitText(action.label, area.w - 8), mid, y + 4 + i * 12, action.enabled ? TEXT : DIM, 0);
		});
		return;
	}
	if (asking(data)) { drawText(ctx, "OFFER A DRAW?", mid, area.y + ASK_TEXT, TEXT, 0); }
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
	return slots(data.ui.slots, data.actions, data.over).map(function (id, i) {
		const action = find(data, id);
		return { id, x, y: area.y + BTN.top + i * BTN.step, w: BTN.w, h: BTN.h, label: action ? action.label : id, enabled: !!action && action.enabled };
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

export { GOING, AFTER };
