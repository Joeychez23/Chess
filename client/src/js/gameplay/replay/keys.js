/*
 *  keys.js  --  chess frontend
 *	Replay Keys
 *	What a key does on the replay viewer: Left & Right step back & forward (A & D too, pages/utils/nav.js arrowKey), Home & End go to
 *	the start & the last move. Nothing while something else on the page owns the key. No page state, the server tests run it
 *
 */

const ACTIONS = { ArrowLeft: "back", ArrowRight: "forward", Home: "first", End: "last" };

/**
 * @description The replay step for a key
 * @param  {[string]} key [the key, from arrowKey(e)]
 * @param  {[object]} ctx [{ menuOpen, inMoveList (its Up, Down, Home & End move between the rows), inTextBox, monitorBusy (the 3D room's
 * monitor is zoomed in or has the focus), modifier (Alt, Ctrl, Cmd or Shift is down, the browser's shortcuts) }]
 * @return {[string|null]} action ["first" | "back" | "forward" | "last", null: the key isn't the replay's]
 */
function replayKeyAction(key, ctx) {
	if (ctx.menuOpen || ctx.inMoveList || ctx.inTextBox || ctx.monitorBusy || ctx.modifier) { return null; }
	return ACTIONS[key] || null;
}


module.exports = { replayKeyAction };
