/*
 *  socket.js  --  chess server
 *	Socket.IO
 *  Friend games get the opponent's move pushed to them instead of asking the server every 2 seconds.
 *  Each game is a room ("game:<game_id>"). moveGame() emits "move" to the room after a move is saved,
 *  then the client loads the new board with GET /api/chess/game/:gameId.
 *  forfeitGame() emits "game-over" and rematchGame() emits "rematch" (the new game id) to the same room.
 *  Every socket is also in its player's room ("player:<player_id>"): Home gets "games" when an invite or friend game changes
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { Server } = require("socket.io");
const cookieParser = require("cookie-parser");
const { readSessionUser } = require("./middleware/auth.js");
const { retrieveGame, withRequest } = require("./dataClient.js");

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
	io = new Server(server); // SAME ORIGIN AS THE GAME, NO CORS NEEDED
	io.engine.use(cookieParser()); // SESSION TOKENS ARE READ FROM COOKIES (socket.request.cookies)

	io.use((socket, next) => { // SIGNED IN USERS ONLY, GUESTS ONLY PLAY THE AI
		const user = readSessionUser(socket.request);
		if (!user) { return next(new Error("NOT SIGNED IN")); }
		socket.data.playerId = user.user_id.split("auth0|")[1]; // PLAYER IDS DROP THE "auth0|", SAME AS THE CLIENT
		next();
	});

	io.on("connection", (socket) => {
		socket.join(`player:${socket.data.playerId}`); // HOME'S "games" (emitToPlayer)
		socket.on("join-game", (gameId, ack) => joinGame(socket, gameId, ack));
	});

	return io;
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


module.exports = { initSocket, emitToGame, emitToPlayer };
