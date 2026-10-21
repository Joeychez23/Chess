/*
 *  socket/index.js  --  chess frontend
 *	Friend Game Socket
 *  The server pushes "move" when a friend game's board changes (server/socket.js).
 *  The socket is only open while a friend game is on screen. Guests & AI games never open one.
 *
 */

import { io } from "socket.io-client";

let socket = null;

/* ---------------------------------------------------------------- */
// Join Game
/* ---------------------------------------------------------------- */
/**
 * @description Opens the socket & joins a friend game's room. After a reconnect it joins again & catches up on missed moves
 * @param  {[string]} gameId [game id]
 * @param  {[string]} playerId [this player, their own moves already came back from the PUT so they're skipped]
 * @param  {[function]} onMove [called when the opponent moves]
 */
export function joinGame(gameId, playerId, onMove) {
	leaveGame();
	const gameSocket = io({ withCredentials: true }); // SAME ORIGIN, THE SESSION COOKIE SIGNS IN THE SOCKET
	let joined = false;
	let refreshed = false;
	socket = gameSocket;

	gameSocket.on("connect", () => {
		gameSocket.emit("join-game", `${gameId}`, (response) => { // GAME_ID CAN BE AN ObjectId, SEND IT AS A STRING
			if (response?.status != 200) { return console.log(`[SOCKET] ${response?.message}`); }
			refreshed = false;
			if (joined) { onMove(); } // RECONNECTED, THE OPPONENT MAY HAVE MOVED WHILE OFFLINE
			joined = true;
		});
	});

	gameSocket.on("move", (data) => {
		if (data?.game_id == `${gameId}` && data.player_id != playerId) { onMove(); }
	});

	gameSocket.on("connect_error", async () => {
		if (gameSocket.active || refreshed) { return; } // SOCKET.IO RETRIES NETWORK ERRORS BY ITSELF
		refreshed = true; // THE SERVER TURNED THE SOCKET AWAY: ACCESS TOKEN EXPIRED -> RE-UP ONCE & TRY AGAIN
		const res = await fetch("/api/auth/refresh", { method: "POST" }).catch(() => null);
		if (res?.ok && socket == gameSocket) { gameSocket.connect(); }
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
