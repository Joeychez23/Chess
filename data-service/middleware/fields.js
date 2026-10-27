/*
 *  fields.js  --  data service
 *	Body Fields
 *  Each route names the fields it takes. A body with anything else is refused, so a route can only ever change what it names
 *  (a move never takes a board, a FEN or a whole game)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { refuse } = require("../utils/refuse.js");

/* ---------------------------------------------------------------- */
// Only Fields
/* ---------------------------------------------------------------- */
/**
 * @description Refuses (400) a body that isn't a JSON object or has a field the route doesn't list. No body at all is fine
 * @param  {[array]} names [the fields the route takes, e.g. ["from", "to", "promotion"], [] = no body]
 * @return {[function]} middleware
 */
function onlyFields(names) {
	return function (req, res, next) {
		const body = req.body;
		if (body === undefined) { return next(); } // NO BODY
		if (body === null || typeof body != "object" || Array.isArray(body)) { return refuse(req, res, 400, "Body must be a JSON object"); }
		const extra = Object.keys(body).filter((name) => !names.includes(name));
		if (extra.length) { return refuse(req, res, 400, `Not allowed: ${extra.slice(0, 5).map((name) => name.slice(0, 30)).join(", ")}`); } // ONLY THE NAMES, NEVER THE VALUES
		next();
	};
}


module.exports = { onlyFields };
