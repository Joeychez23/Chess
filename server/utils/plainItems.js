/*
 *  plainItems.js  --  chess server
 *	Shared Checks On Plain Items
 *  The data service hands the server plain items ({ state: "OPEN" }), but games.js & rating.js are the same file as the
 *  data service's copy, which reads DynamoDB items ({ state: { S: "OPEN" } }). These are the checks the server runs on
 *  items, each given the item back in the shape the shared file reads, so the rules stay in one place
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const games = require("./games.js");
const rating = require("./rating.js");

/* ---------------------------------------------------------------- */
// Item Shape
/* ---------------------------------------------------------------- */
/**
 * @description A plain item in the DynamoDB shape, top level only (the shared files read no nested attribute)
 * @param  {[object]} item [plain item from the data service, or null]
 * @return {[object]} item [numbers as N, booleans as BOOL, null as NULL, everything else (text, the moves arrays) as S]
 */
function toItem(item) {
	if (!item) { return item; }
	const attributes = {};
	for (const [key, value] of Object.entries(item)) {
		if (typeof value == "number") { attributes[key] = { N: String(value) }; }
		else if (typeof value == "boolean") { attributes[key] = { BOOL: value }; }
		else if (value === null) { attributes[key] = { NULL: true }; }
		else { attributes[key] = { S: value }; } // moves & prev_move hold arrays in S, as the data service keeps them. NO ITEM HAS A MAP OR LIST ATTRIBUTE: ONE WOULD NEED ITS OWN CASE HERE
	}
	return attributes;
}

/**
 * @description A shared check that takes an item as its first argument, taking a plain item instead
 * @param  {[function]} check
 * @return {[function]} check [same arguments, the first a plain item]
 */
function onPlain(check) {
	return (item, ...rest) => check(toItem(item), ...rest);
}

module.exports = {
	gameOpen: onPlain(games.gameOpen),
	gamePending: onPlain(games.gamePending),
	isAiGame: onPlain(games.isAiGame),
	playerName: onPlain(games.playerName),
	inviterId: onPlain(games.inviterId),
	startParams: onPlain(games.startParams),
	takebacksLeft: onPlain(games.takebacksLeft),
	readRating: onPlain(rating.readRating),
	toItem
};
