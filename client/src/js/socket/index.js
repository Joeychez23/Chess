/*
 *  socket/index.js  --  chess frontend
 *	Friend Game Socket
 *  The server pushes "move" when a friend game's board changes, "game-over" when the opponent forfeits or accepts a draw,
 *  "draw-offer" when a draw is offered or declined, "takeback" when a takeback is asked for, declined or accepted,
 *  "rematch" when both players asked for one & "player-left" / "player-back" when the opponent leaves or returns to the
 *  game page (server/socket.js).
 *  The socket is only open while a friend game is on screen. Guests & AI games never open one.
 *  Home opens its own (watchGames) & gets "games" when an invite or friend game changes, "friends" when a friend request or friend does.
 *
 */

import { io } from "socket.io-client";

let socket = null;
let homeSocket = null; // Home's socket (watchGames)

/* ---------------------------------------------------------------- */
// Join Game
/* ---------------------------------------------------------------- */
/**
 * @description Opens the socket & joins a friend game's room. After a reconnect it joins again & catches up on anything missed
 * @param  {[string]} gameId [game id]
 * @param  {[string]} playerId [this player, their own moves & forfeits already came back from the request so they're skipped]
 * @param  {[object]} handlers [{ move() opponent moved, gameOver(result) opponent forfeited or accepted a draw,
 * drawOffer({ state, mine }) a draw was offered or declined, takeback({ state, mine, board }) a takeback was asked for, declined
 * or accepted, rematch(newGameId) both asked for a rematch, opponentLeft() the opponent left the game page, opponentBack() they
 * returned, connectionLost() trying to reconnect, reconnected() back in the room, connectionFailed() it won't come back without a reload }]
 */
export function joinGame(gameId, playerId, handlers) {
	leaveGame();
	const gameSocket = io({ withCredentials: true }); // Same origin, the session cookie signs in the socket
	let joined = false;
	let refreshed = false;
	let lost = false; // The player was told the connection is lost
	socket = gameSocket;

	function connectionLost() {
		lost = true;
		handlers.connectionLost();
	}

	gameSocket.on("connect", function () {
		gameSocket.emit("join-game", `${gameId}`, function (response) { // The game id goes as a string
			if (response?.status == 401 && !refreshed) { return refreshAndReconnect(); } // The handshake's access token ran out
			if (response?.status != 200) { // Still not in the room, no moves will arrive
				console.log(`[SOCKET] ${response?.message}`);
				return handlers.connectionFailed();
			}
			refreshed = false;
			if (lost) {
				lost = false;
				handlers.reconnected();
			}
			if (joined) { // Reconnected: the opponent may have moved or forfeited while this page was offline
				handlers.move();
				// The ends that come without a move
				const endedWithoutMove = response.reason == "forfeit" || response.reason == "agreement" || response.reason == "timeout";
				if (response.state == "CLOSED" && endedWithoutMove) { handlers.gameOver(response); }
			}
			joined = true;
		});
	});

	gameSocket.on("move", function (data) {
		if (data?.game_id == `${gameId}` && data.player_id != playerId) { handlers.move(); }
	});

	gameSocket.on("game-over", function (data) {
		if (data?.game_id == `${gameId}` && data.player_id != playerId) { handlers.gameOver(data); }
	});

	gameSocket.on("draw-offer", function (data) { // Another of this player's tabs stays in step
		if (data?.game_id == `${gameId}`) { handlers.drawOffer({ state: data.state, mine: data.player_id == playerId }); }
	});

	gameSocket.on("takeback", function (data) { // Another of this player's tabs stays in step
		if (data?.game_id == `${gameId}`) {
			handlers.takeback({ state: data.state, mine: data.player_id == playerId, board: data.game_board });
		}
	});

	gameSocket.on("rematch", function (data) {
		if (data?.game_id == `${gameId}`) { handlers.rematch(data.new_game_id); }
	});

	gameSocket.on("player-left", function (data) {
		if (data?.game_id == `${gameId}` && data.player_id != playerId) { handlers.opponentLeft(); }
	});

	gameSocket.on("player-back", function (data) {
		if (data?.game_id == `${gameId}` && data.player_id != playerId) { handlers.opponentBack(); }
	});

	/**
	 * @description Re-ups the session once & opens a new handshake with the new cookie
	 */
	async function refreshAndReconnect() {
		refreshed = true;
		const res = await fetch("/api/auth/refresh", { method: "POST" }).catch(() => null);
		if (socket != gameSocket) { return; }
		if (!res?.ok) { return handlers.connectionFailed(); } // The session ended
		if (gameSocket.connected) { gameSocket.disconnect(); }
		gameSocket.connect();
	}

	gameSocket.on("connect_error", function () {
		connectionLost();
		if (gameSocket.active) { return; } // Socket.IO retries network errors by itself
		if (refreshed) { return handlers.connectionFailed(); } // Turned away again with the new cookie
		refreshAndReconnect(); // The server turned the socket away, its access token ran out: re-up once & try again
	});

	// The server closed it: its access token ran out, or the session ended (then the re-up fails & it stays closed)
	gameSocket.on("disconnect", function (reason) {
		if (reason == "io client disconnect") { return; } // This page closed it (leaveGame, refreshAndReconnect)
		connectionLost();
		if (reason != "io server disconnect" || socket != gameSocket) { return; } // Socket.IO reconnects by itself
		if (refreshed) { return handlers.connectionFailed(); } // Closed again with the new cookie
		refreshAndReconnect();
	});
}

/* ---------------------------------------------------------------- */
// Leave Game
/* ---------------------------------------------------------------- */
/**
 * @description Closes the socket (going Home or opening another game)
 */
export function leaveGame() {
	if (socket) {
		socket.disconnect();
		socket = null;
	}
}

/* ---------------------------------------------------------------- */
// Watch Games
/* ---------------------------------------------------------------- */
/**
 * @description Home's socket: the server sends "games" to every tab the player has open when an invite is sent, accepted, declined
 * or cancelled & when a friend game moves or ends, & "friends" when a friend request or friend changes (server/socket.js emitToPlayer).
 * After a reconnect Home redraws too, it may have missed one
 * @param  {[function]} handler [redraws Home]
 */
export function watchGames(handler) {
	if (homeSocket) { homeSocket.disconnect(); }
	const gamesSocket = io({ withCredentials: true }); // Same origin, the session cookie signs in the socket
	let connected = false;
	let refreshed = false;
	let redraw = null;
	homeSocket = gamesSocket;

	function redrawSoon() { // One redraw for a burst (a forfeit, then the invite)
		clearTimeout(redraw);
		redraw = setTimeout(handler, 200);
	}

	gamesSocket.on("connect", function () {
		refreshed = false;
		if (connected) { redrawSoon(); } // Reconnected, something may have changed while offline
		connected = true;
	});

	gamesSocket.on("games", redrawSoon);
	gamesSocket.on("friends", redrawSoon);

	async function refreshAndReconnect() { // Re-up once & try again
		refreshed = true;
		const res = await fetch("/api/auth/refresh", { method: "POST" }).catch(() => null);
		if (res?.ok && homeSocket == gamesSocket) { gamesSocket.connect(); }
	}

	gamesSocket.on("connect_error", function () {
		if (gamesSocket.active || refreshed) { return; } // Socket.IO retries network errors by itself
		refreshAndReconnect(); // The server turned the socket away: its access token ran out
	});

	// The server closed it: its access token ran out, or the session ended (then the re-up fails & it stays closed)
	gamesSocket.on("disconnect", function (reason) {
		if (reason == "io server disconnect" && !refreshed && homeSocket == gamesSocket) { refreshAndReconnect(); }
	});
}
