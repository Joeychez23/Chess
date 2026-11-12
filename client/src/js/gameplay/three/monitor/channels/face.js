/*
 *  face.js  --  chess frontend
 *	The CRT Monitor's Face Channel
 *	The test card, the opponent's picture during its intro, else the AI's pixel face (three/faces.js) at 4 px a cell. No buttons
 *
 */

import { fillCells, drawBars, body } from "../kit.js";

const FACE_PX = 4; // ONE FACE PIXEL ON THE GRID

/**
 * @description Draws the channel
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} data [the channels' data]
 */
export function draw(ctx, data) {
	const { screen, zoomed } = data;
	const area = body(data);
	ctx.save();
	ctx.beginPath();
	ctx.rect(area.x, area.y, area.w, area.h); // NOTHING OVER THE TAB ROW OR UNDER THE BEZEL
	ctx.clip();
	if (screen.bars) { drawBars(ctx, area); }
	else if (screen.picture) { ctx.drawImage(screen.picture, 0, 0); } // THE CLIP KEEPS IT IN THE BODY
	else {
		const top = zoomed ? FACE_PX : 0; // ZOOMED: ONE ROW OF CELLS LOWER
		const inBody = ([cx, cy]) => cx * FACE_PX >= area.x && (cx + 1) * FACE_PX <= area.x + area.w && top + cy * FACE_PX >= area.y && top + (cy + 1) * FACE_PX <= area.y + area.h; // THE CLIP, FOR CONTEXTS THAT IGNORE IT
		fillCells(ctx, screen.face.cells.filter(inBody), 0, top, FACE_PX, screen.face.colour);
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
