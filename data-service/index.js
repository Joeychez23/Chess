/*
 *  index.js  --  data service
 *	Data Service (#245)
 *  The only code that reads & writes DynamoDB. It runs on a private instance only the chess server can reach, and each
 *  route is one named action, checked against the stored data before anything is saved
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const express = require("express");
const config = require("./config");
const { readPlayer } = require("./middleware/player.js");
const { refuse } = require("./utils/refuse.js");
const gameRoutes = require("./routes/gameRoutes.js");
const userRoutes = require("./routes/userRoutes.js");

const BODY_LIMIT = "16kb"; // THE BIGGEST REAL BODY IS A FEW HUNDRED BYTES

/* ---------------------------------------------------------------- */
// App
/* ---------------------------------------------------------------- */

const app = express();
app.disable("x-powered-by"); // DOESN'T SAY IT'S EXPRESS
app.get("/health", (req, res) => res.json({ status: 200, message: "OK" })); // NO DYNAMODB & NO PLAYER: Chess-Stockfish'S CHECK THAT IT'S UP
app.use((req, res, next) => hasBody(req) && !req.is("application/json") ? refuse(req, res, 415, "JSON only") : next()); // A BODY MUST BE JSON, A POST WITH NO BODY IS FINE
app.use(express.json({ limit: BODY_LIMIT }));
app.use(readPlayer); // req.player: THE SIGNED IN PLAYER OR GUEST THE CHESS SERVER FORWARDED
app.use("/games", gameRoutes);
app.use("/users", userRoutes);
app.use((req, res) => refuse(req, res, 404, "No such action"));

app.use((err, req, res, next) => {
	if (res.headersSent) { return next(err); }
	if (err.type == "entity.parse.failed") { return refuse(req, res, 400, "Body must be valid JSON"); }
	if (err.type == "entity.too.large") { return refuse(req, res, 413, "Body is too large"); }
	console.error(err);
	res.status(500).json({ status: 500, message: "Something went wrong in the data service" });
});

/**
 * @description True when the request carries a body (Content-Length over 0, or a chunked body)
 */
function hasBody(req) {
	return Number(req.get("Content-Length")) > 0 || req.get("Transfer-Encoding") != undefined;
}

/* ---------------------------------------------------------------- */
// Start
/* ---------------------------------------------------------------- */

if (require.main === module) { // node index.js, THE TESTS START THE APP THEMSELVES
	app.listen(config.port, config.host, () => console.log(`Data service on http://${config.host}:${config.port}`));
}

module.exports = app;
