/*
 *  overlay.js  --  chess frontend
 *	Overlay
 *	What the flat 2D canvas draws over the board. On 3D (traysOnly) the room holds the taken pieces & the score, so the canvas is
 *	clear except for the flat promotion picker, until the room has its own promotion cards. Pure, no requires: the files that draw
 *	the canvas load while each other are still loading
 *
 */

/* ---------------------------------------------------------------- */
// Overlay
/* ---------------------------------------------------------------- */
/**
 * @description What the flat overlay draws
 * @param  {[object]} state [{ traysOnly: 3D IS ON, currPromotion: THE PROMOTION PICKER IS OPEN, cards3D: THE 3D ROOM SHOWS THE PICKER ITSELF }]
 * @return {[string]} ["all" (2D, as always), "picker" (3D, only the flat promotion picker) or "none" (3D)]
 */
function overlayShows({ traysOnly, currPromotion, cards3D }) {
	if (!traysOnly) { return "all"; }
	return currPromotion && !cards3D ? "picker" : "none";
}

module.exports = { overlayShows };
