/*
 *  socket.js  --  chess server
 *	Socket.IO
 *  Friend games get the opponent's move pushed to them instead of asking the server every 2 seconds.
 *  Each game is a room ("game:<game_id>"). moveGame() emits "move" to the room after a move is saved,
 *  then the client loads the new board with GET /api/chess/game/:gameId.
 *  forfeitGame() emits "game-over" and rematchGame() emits "rematch" (the new game id) to the same room.
 *  Every socket is also in its player's room ("player:<player_id>"): Home gets "games" when an invite or friend game changes
 *  The access token is only read in the handshake, so a socket is closed when that token runs out, & every socket of a player
 *  is closed when they log out or delete their data (#298). The client re-ups the session & connects again (client/src/js/socket)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { Server } = require("socket.io");
const cookieParser = require("cookie-parser");
const config = require("./config");
const { readSession } = require("./middleware/auth.js");
const { retrieveGame, withRequest } = require("./dataClient.js");

const JOIN_LIMIT = { burst: 5, refillMs: 2000 }; // join-game READS THE GAME FROM THE DATA SERVICE: 5 AT ONCE, THEN 1 EVERY 2 SECONDS PER SOCKET
const MAX_TIMER = 2 ** 31 - 1; // setTimeout'S LONGEST WAIT (ms)

let io = null;

/* ---------------------------------------------------------------- */
// Init Socket
/* ---------------------------------------------------------------- */
/**
 * @description Starts Socket.IO on the same http server as express
 * @param  {[object]} server [http server]
 * @return {[object]} io [Socket.IO server]
 */
function initSocket(server) {
	io = new Server(server, { allowRequest: (req, callback) => callback(null, fromOurPage(req)) }); // SAME ORIGIN AS THE GAME, NO CORS NEEDED
	io.engine.use(cookieParser()); // SESSION TOKENS ARE READ FROM COOKIES (socket.request.cookies)

	io.use((socket, next) => { // SIGNED IN USERS ONLY, GUESTS ONLY PLAY THE AI
		const session = readSession(socket.request);
		if (!session) { return next(new Error("NOT SIGNED IN")); }
		socket.data.playerId = session.user.user_id.split("auth0|")[1]; // PLAYER IDS DROP THE "auth0|", SAME AS THE CLIENT
		socket.data.expiresAt = session.expiresAt;
		next();
	});

	io.on("connection", (socket) => {
		const expiry = setTimeout(() => socket.disconnect(true), Math.min(Math.max(socket.data.expiresAt - Date.now(), 0), MAX_TIMER)).unref(); // THE ACCESS TOKEN RAN OUT (unref: AN OPEN SOCKET'S TIMER NEVER KEEPS THE PROCESS UP)
		socket.on("disconnect", () => clearTimeout(expiry));
		socket.data.joins = { tokens: JOIN_LIMIT.burst, at: Date.now() };
		socket.join(`player:${socket.data.playerId}`); // HOME'S "games" (emitToPlayer)
		socket.on("join-game", (gameId, ack) => joinGame(socket, gameId, ack));
	});

	return io;
}

/**
 * @description Every handshake request (polling & websocket): only our own page can open a socket. A browser sends Origin on the
 * websocket upgrade & on another origin's requests (a same-site subdomain included, which SameSite=Lax lets the cookies through for).
 * A same-origin polling GET has no Origin, its Sec-Fetch-Site (when sent) says same-origin. Clients with neither still need the session cookie
 * @param  {[object]} req [http request]
 * @return {[boolean]} allowed
 */
function fromOurPage(req) {
	const origin = req.headers.origin;
	const site = req.headers["sec-fetch-site"];
	if (origin && origin !== new URL(config.clientUrl).origin) { return false; }
	return !site || site === "same-origin";
}

/**
 * @description Takes one join from the socket's bucket (each join is a data service read)
 * @param  {[object]} socket [player's socket]
 * @return {[number]} retryMs [0 when the join can go ahead]
 */
function takeJoin(socket) {
	const now = Date.now();
	const joins = socket.data.joins;
	joins.tokens = Math.min(JOIN_LIMIT.burst, joins.tokens + (now - joins.at) / JOIN_LIMIT.refillMs);
	joins.at = now;
	if (joins.tokens < 1) { return Math.ceil((1 - joins.tokens) * JOIN_LIMIT.refillMs); }
	joins.tokens -= 1;
	return 0;
}

/* ---------------------------------------------------------------- */
// Join Game
/* ---------------------------------------------------------------- */
/**
 * @description Puts the socket in a game's room, only if the player is in that game
 * @param  {[object]} socket [player's socket]
 * @param  {[string]} gameId [game id]
 * @param  {[function]} ack [answers the client: { status, message, state, winner, reason }, the result lets a reconnecting client see a forfeit it missed]
 */
async function joinGame(socket, gameId, ack) {
	if (typeof ack != "function") { return; }
	if (typeof gameId != "string" || !gameId) { return ack({ status: 400, message: "Invalid game id" }); }
	const retryMs = takeJoin(socket);
	if (retryMs) { return ack({ status: 429, message: `Too many joins, try again in ${Math.ceil(retryMs / 1000)} seconds` }); }
	if (Date.now() >= socket.data.expiresAt) { return ack({ status: 401, message: "SESSION EXPIRED" }); } // THE HANDSHAKE'S COOKIES CAN'T READ THE GAME ANY MORE

	try {
		const response = await withRequest(socket.request, () => retrieveGame(gameId)); // AS THE SOCKET'S PLAYER (ITS HANDSHAKE HAS THEIR COOKIES)
		if (response.status == 401 || response.status == 403) { return ack({ status: 403, message: "Player is not in this game" }); }
		if (!response.game_data) { return ack({ status: response.status, message: response.message }); } // GAME NOT FOUND

		const { white_player_id, black_player_id, state, winner, reason } = response.game_data;
		if (socket.data.playerId != white_player_id.S && socket.data.playerId != black_player_id.S) {
			return ack({ status: 403, message: "Player is not in this game" });
		}

		for (const room of socket.rooms) { if (room.startsWith("game:")) { socket.leave(room); } } // ONE GAME AT A TIME PER TAB
		socket.join(`game:${gameId}`);
		return ack({ status: 200, message: `Joined game id: ${gameId}`, state: state?.S || "OPEN", winner: winner?.S || null, reason: reason?.S || null });
	} catch (err) {
		if (err.name == "SessionExpired") { return ack({ status: 401, message: "SESSION EXPIRED" }); }
		if (err.name == "DataServiceDown") { console.error(err.message); return ack({ status: 503, message: "Try again in a moment" }); }
		console.log(err);
		return ack({ status: 500, message: "Join failed" });
	}
}

/* ---------------------------------------------------------------- */
// Emit To Game
/* ---------------------------------------------------------------- */
/**
 * @description Sends an event to everyone watching a game
 * @param  {[string]} gameId [game id]
 * @param  {[string]} event [event name, "move"]
 * @param  {[object]} data [event data]
 */
function emitToGame(gameId, event, data) {
	if (io) { io.to(`game:${gameId}`).emit(event, data); }
}

/* ---------------------------------------------------------------- */
// Emit To Player
/* ---------------------------------------------------------------- */
/**
 * @description Sends an event to every tab a player has open (Home redraws on "games")
 * @param  {[string]} playerId [auth0 user id without "auth0|"]
 * @param  {[string]} event [event name, "games"]
 * @param  {[object]} data [event data]
 */
function emitToPlayer(playerId, event, data) {
	if (io && playerId != "CHESS_AI") { io.to(`player:${playerId}`).emit(event, data); }
}

/* ---------------------------------------------------------------- */
// Disconnect Player
/* ---------------------------------------------------------------- */
/**
 * @description Closes every socket a player has open, on every device (logout & Delete my data end their session, #298)
 * @param  {[string]} playerId [auth0 user id without "auth0|"]
 */
function disconnectPlayer(playerId) {
	if (io && playerId) { io.in(`player:${playerId}`).disconnectSockets(true); }
}


module.exports = { initSocket, emitToGame, emitToPlayer, disconnectPlayer };
