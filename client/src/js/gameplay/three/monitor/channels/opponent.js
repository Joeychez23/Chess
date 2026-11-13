/*
 *  opponent.js  --  chess frontend
 *	The CRT Monitor's Opponent Channel
 *	The opponent's card: the test card, else their picture, else their name & status as text. On the desk the name & status strip over the picture is
 *	screen.js's own (it goes on after the scanlines so none cross the text); zoomed they sit on a plate inside the body. A friend's card reads
 *	WAITING FOR OPPONENT on their turn. No buttons
 *
 */

import { textWidth, fitText } from "../../pixelFont.js";
import { TEXT, DIM, drawText, drawBars, drawNamePlate, body } from "../kit.js";

/**
 * @description The card's status line: WAITING FOR OPPONENT on a friend's turn (the waiting channel may be off), else the screen's
 * @param  {[object]} data [the channels' data]
 * @return {[string]}
 */
export function status(data) {
	if (!data.ai && !data.yourTurn && !data.over) { return "WAITING FOR OPPONENT"; }
	return (data.screen && data.screen.status) || "";
}

/**
 * @description Draws the channel
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} data [the channels' data]
 */
export function draw(ctx, data) {
	const { screen } = data;
	const area = body(data);
	ctx.save();
	ctx.beginPath();
	ctx.rect(area.x, area.y, area.w, area.h); // NOTHING OVER THE TAB ROW OR UNDER THE BEZEL
	ctx.clip();
	if (screen.bars) { drawBars(ctx, area); }
	else if (screen.picture) {
		ctx.drawImage(screen.picture, 0, 0); // THE CLIP KEEPS IT IN THE BODY
		if (data.zoomed) { drawNamePlate(ctx, area, screen.name, status(data)); } // THE PAGE'S NAME IS HIDDEN WHILE THE MONITOR SHOWS IT
	} else {
		const mid = area.x + area.w / 2, room = area.w - 12;
		const big = textWidth(screen.name) * 2 <= room; // THE NAME, DOUBLE SIZE WHEN IT FITS
		const top = area.y + (data.zoomed ? 20 : 34); // ZOOMED: THE NAME & STATUS CENTRED IN THE SHORTER BODY
		drawText(ctx, big ? screen.name : fitText(screen.name, room), mid, big ? top : top + 6, TEXT, 0, big ? 2 : 1);
		const line = status(data);
		if (line) { drawText(ctx, fitText(line, room), mid, top + 28, DIM, 0); }
	}
	ctx.restore();
}

/**
 * @description The channel's buttons: none
 * @return {[object[]]} buttons
 */
export function buttons() {
	return [];
}

/**
 * @description Nothing to press
 */
export function press() {}

/**
 * @description What the screen reader says for the channel
 * @param  {[object]} data [the channels' data]
 * @return {[string]} "<name>, <status>", "" with no screen
 */
export function speak(data) {
	if (!data.screen) { return ""; }
	return [data.screen.name, status(data).toLowerCase()].filter(Boolean).join(", ");
}
