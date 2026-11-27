/*
 *  plainBody.js  --  data service
 *	Plain Body
 *  The data service keeps DynamoDB's shapes inside ({ S: "..." }, { N: "12" }, ...). A response leaves it plain: index.js runs every
 *  response body through plainBody, so the chess server reads game_data.game_id, not game_data.game_id.S
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const READ = {
	S: (v) => v, // moves & prev_move HOLD PARSED ARRAYS (db/db.games.js gameItem), JSON TEXT FIELDS STAY TEXT
	N: Number,
	BOOL: (v) => v,
	NULL: () => null,
	L: (v) => v.map(plainBody),
	M: (v) => plainMap(v),
	SS: (v) => [...v],
	NS: (v) => v.map(Number)
};

/* ---------------------------------------------------------------- */
// Plain
/* ---------------------------------------------------------------- */
/**
 * @description A copy of a value with every DynamoDB attribute value inside it read out: { S: v } -> v, { N: "12" } -> 12,
 * { BOOL: b } -> b, { NULL: true } -> null, L, M, SS & NS -> arrays & objects all the way down. Anything else is copied as it is
 * @param  {[any]} value [a response body, or any part of one]
 * @return {[any]} plain
 */
function plainBody(value) {
	if (Array.isArray(value)) { return value.map(plainBody); }
	if (!value || typeof value != "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) { return value; } // A DATE OR A BUFFER GOES TO res.json AS IT IS
	const keys = Object.keys(value);
	if (keys.length == 1 && Object.hasOwn(READ, keys[0])) { return READ[keys[0]](value[keys[0]]); } // AN ATTRIBUTE VALUE IS AN OBJECT WITH ONE TYPE KEY. NO BODY FIELD OR ITEM ATTRIBUTE IS NAMED S, N, BOOL, ...
	return plainMap(value);
}

/**
 * @description plainBody on each value of an object
 */
function plainMap(object) {
	return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, plainBody(value)]));
}


module.exports = { plainBody };
