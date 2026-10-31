/*
 *  socket/index.js  --  chess frontend
 *	Friend Game Socket
 *  The server pushes "move" when a friend game's board changes, "game-over" when the opponent forfeits
 *  & "rematch" when both players asked for one (server/socket.js).
 *  The socket is only open while a friend game is on screen. Guests & AI games never open one.
 *  Home opens its own (watchGames) & gets "games" when an invite or friend game changes.
 *
 */

import { io } from "socket.io-client";

let socket = null;
let homeSocket = null; // HOME'S SOCKET (watchGames)

/* ---------------------------------------------------------------- */
// Join Game
/* ---------------------------------------------------------------- */
/**
 * @description Opens the socket & joins a friend game's room. After a reconnect it joins again & catches up on anything missed
 * @param  {[string]} gameId [game id]
 * @param  {[string]} playerId [this player, their own moves & forfeits already came back from the request so they're skipped]
 * @param  {[object]} handlers [{ move() opponent moved, gameOver(result) opponent forfeited, rematch(newGameId) both asked for a rematch }]
 */
export function joinGame(gameId, playerId, handlers) {
	leaveGame();
	const gameSocket = io({ withCredentials: true }); // SAME ORIGIN, THE SESSION COOKIE SIGNS IN THE SOCKET
	let joined = false;
	let refreshed = false;
	socket = gameSocket;

	gameSocket.on("connect", () => {
		gameSocket.emit("join-game", `${gameId}`, (response) => { // GAME_ID CAN BE AN ObjectId, SEND IT AS A STRING
			if (response?.status == 401 && !refreshed) { return refreshAndReconnect(); } // THE HANDSHAKE'S ACCESS TOKEN RAN OUT (#278)
			if (response?.status != 200) { return console.log(`[SOCKET] ${response?.message}`); }
			refreshed = false;
			if (joined) { // RECONNECTED, THE OPPONENT MAY HAVE MOVED OR FORFEITED WHILE OFFLINE
				handlers.move();
				if (response.state == "CLOSED" && response.reason == "forfeit") { handlers.gameOver(response); }
			}
			joined = true;
		});
	});

	gameSocket.on("move", (data) => {
		if (data?.game_id == `${gameId}` && data.player_id != playerId) { handlers.move(); }
	});

	gameSocket.on("game-over", (data) => {
		if (data?.game_id == `${gameId}` && data.player_id != playerId) { handlers.gameOver(data); }
	});

	gameSocket.on("rematch", (data) => {
		if (data?.game_id == `${gameId}`) { handlers.rematch(data.new_game_id); }
	});

	/**
	 * @description Re-ups the session once & opens a new handshake with the new cookie
	 */
	async function refreshAndReconnect() {
		refreshed = true;
		const res = await fetch("/api/auth/refresh", { method: "POST" }).catch(() => null);
		if (!res?.ok || socket != gameSocket) { return; }
		if (gameSocket.connected) { gameSocket.disconnect(); }
		gameSocket.connect();
	}

	gameSocket.on("connect_error", () => {
		if (gameSocket.active || refreshed) { return; } // SOCKET.IO RETRIES NETWORK ERRORS BY ITSELF
		refreshAndReconnect(); // THE SERVER TURNED THE SOCKET AWAY: ACCESS TOKEN EXPIRED -> RE-UP ONCE & TRY AGAIN
	});
}

/* ---------------------------------------------------------------- */
// Leave Game
/* ---------------------------------------------------------------- */
/**
 * @description Closes the socket (going Home or opening another game)
 */
export function leaveGame() {
	if (socket) { socket.disconnect(); socket = null; }
}

/* ---------------------------------------------------------------- */
// Watch Games
/* ---------------------------------------------------------------- */
/**
 * @description Home's socket: the server sends "games" to every tab the player has open when an invite is sent, accepted, declined
 * or cancelled & when a friend game moves or ends (server/socket.js emitToPlayer). After a reconnect Home redraws too, it may have missed one
 * @param  {[function]} handler [redraws Home]
 */
export function watchGames(handler) {
	if (homeSocket) { homeSocket.disconnect(); }
	const gamesSocket = io({ withCredentials: true }); // SAME ORIGIN, THE SESSION COOKIE SIGNS IN THE SOCKET
	let connected = false;
	let refreshed = false;
	let redraw = null;
	homeSocket = gamesSocket;

	function redrawSoon() { // ONE REDRAW FOR A BURST (A FORFEIT, THEN THE INVITE)
		clearTimeout(redraw);
		redraw = setTimeout(handler, 200);
	}

	gamesSocket.on("connect", () => {
		refreshed = false;
		if (connected) { redrawSoon(); } // RECONNECTED, SOMETHING MAY HAVE CHANGED WHILE OFFLINE
		connected = true;
	});

	gamesSocket.on("games", redrawSoon);

	gamesSocket.on("connect_error", async () => {
		if (gamesSocket.active || refreshed) { return; } // SOCKET.IO RETRIES NETWORK ERRORS BY ITSELF
		refreshed = true; // THE SERVER TURNED THE SOCKET AWAY: ACCESS TOKEN EXPIRED -> RE-UP ONCE & TRY AGAIN
		const res = await fetch("/api/auth/refresh", { method: "POST" }).catch(() => null);
		if (res?.ok && homeSocket == gamesSocket) { gamesSocket.connect(); }
	});
}
