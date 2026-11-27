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
const { checkSignature, keepRawBody } = require("./middleware/signature.js");
const { refuse } = require("./utils/refuse.js");
const { plainBody } = require("./utils/plainBody.js");
const { checkTables } = require("./db/index.js");
const gameRoutes = require("./routes/gameRoutes.js");
const userRoutes = require("./routes/userRoutes.js");
const sessionRoutes = require("./routes/sessionRoutes.js");

const BODY_LIMIT = "16kb"; // THE BIGGEST REAL BODY IS A FEW HUNDRED BYTES
const CARDS_BODY_LIMIT = "640kb"; // A CARD GAME'S ENGINE STATE, UP TO 300 000 BYTES (controllers/game/game.shared.js CARDS_STATE_BYTES). IT TRAVELS AS A JSON STRING INSIDE THE BODY, SO EVERY " IN IT COSTS 2 BYTES: TWICE THE CAP, PLUS THE OTHER FIELDS

/* ---------------------------------------------------------------- */
// App
/* ---------------------------------------------------------------- */

const app = express();
app.disable("x-powered-by"); // DOESN'T SAY IT'S EXPRESS
app.use((req, res, next) => { // EVERY RESPONSE LEAVES PLAIN, THE CODE ABOVE IT KEEPS DynamoDB'S SHAPES (utils/plainBody.js)
	const json = res.json.bind(res);
	res.json = (body) => {
		if (Number.isInteger(body?.status)) { res.status(body.status); } // THE HTTP STATUS IS ALWAYS THE BODY'S: A 404 OR 409 db/ ANSWERED GOES OUT AS ONE
		return json(plainBody(body));
	};
	next();
});
app.get("/health", (req, res) => res.json({ status: 200, message: "OK" })); // NO DYNAMODB & NO PLAYER: Chess-Stockfish'S CHECK THAT IT'S UP
app.use((req, res, next) => hasBody(req) && !req.is("application/json") ? refuse(req, res, 415, "JSON only") : next()); // A BODY MUST BE JSON, A POST WITH NO BODY IS FINE
const cardsJson = express.json({ limit: CARDS_BODY_LIMIT, verify: keepRawBody });
app.post("/games/cards", cardsJson); // ONLY THE TWO CARD GAME ROUTES TAKE A BIG BODY, THE PARSER BELOW SKIPS A BODY ALREADY READ. LIKE THE 16kb ONE IT PARSES BEFORE THE SIGNATURE IS CHECKED (THE SIGNATURE NEEDS THE BODY), ONLY THE CHESS SERVER REACHES THIS SERVICE
app.put("/games/:gameId/cards", cardsJson);
app.use(express.json({ limit: BODY_LIMIT, verify: keepRawBody })); // req.rawBody: THE BODY AS SENT, FOR THE SIGNATURE
app.use(checkSignature); // EVERYTHING BELOW /health COMES SIGNED FROM THE CHESS SERVER, OR IT'S REFUSED (401)
app.get("/health/tables", async (req, res) => { // SIGNED, NO PLAYER: THE CHESS SERVER'S GET /api/health (#194)
	try {
		await checkTables();
		res.json({ status: 200, message: "OK" });
	} catch (err) {
		console.error(`HEALTH tables: ${err.name}: ${err.message}`);
		res.status(503).json({ status: 503, message: err.name });
	}
});
app.use(readPlayer); // req.player: THE SIGNED IN PLAYER OR GUEST THE CHESS SERVER FORWARDED
app.use("/games", gameRoutes);
app.use("/users", userRoutes);
app.use("/session", sessionRoutes); // SIGNING IN, REFRESHING & SIGNING OUT: ONLY THIS SERVICE CAN MAKE A SESSION TOKEN (#252)
app.use((req, res) => refuse(req, res, 404, "No such action"));

app.use((err, req, res, next) => {
	if (res.headersSent) { return next(err); }
	if (err.type == "entity.parse.failed") { return refuse(req, res, 400, "Body must be valid JSON"); }
	if (err.type == "entity.too.large") { return refuse(req, res, 413, "Body is too large"); }
	console.error(err);
	res.status(500).json({ status: 500, crashed: true, message: "Something went wrong in the data service" }); // crashed: THE CHESS SERVER TREATS IT AS DOWN (503), NOT AS AN ANSWER
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
	const server = app.listen(config.port, config.host, () => console.log(`Data service on http://${config.host}:${config.port}`));
	process.on("SIGTERM", () => server.close(() => process.exit(0))); // A RESTART TAKES NO NEW REQUESTS & LETS THE RUNNING ONES FINISH THEIR WRITES (#358)
}

module.exports = app;
