/* ---------------------------------------------------------------- */
// CHESS
/* ---------------------------------------------------------------- */
/**
 * @description Conditionalize user request of GET Game, PUT move, or POST restart, validated by the chess routes on the express server (server/controllers/chessController.js)
 * @param  {[string]} gameUrl [chess api, "/api/chess"]
 * @param  {[string]} gameId [game id]
 * @param  {[object]} _id [player id, the server plays as the signed in session instead]
 * @param  {[object]} move [move array]
 * @param  {[string]} promotion [promotion piece]
 * @param  {[string]} restart [AI color 'w' or 'b' for a new game with these sides (gameplay's fallback for a guest's first game), Home, the guest page & the play page use newAiGame]
 * @param  {[number]} aiLevel [new games: the AI's level from Home's dropdown, left out = the server's default]
 * @param  {[boolean]} replaceCurrent [new games: true forfeits the player's open AI game first (one at a time), left out = the server answers 409 while one is open]
 * @return {[object]} response.json() = backend server response object of request data
 */
export async function validate(gameUrl, gameId, _id, move, promotion, restart, aiLevel, replaceCurrent) {
	if (restart) { // RESTART GAME (POST /game, OVERWRITES game_id WITH A NEW BOARD)
		let options;
		if (restart == 'w') {
			options = {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					game_id: gameId,
					player_id_1: "CHESS_AI",
					player_id_2: _id,
					ai_level: aiLevel,
					replace_current: replaceCurrent,
				})
			};
		} else if (restart == 'b') {
			options = {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					game_id: gameId,
					player_id_1: _id,
					player_id_2: "CHESS_AI",
					ai_level: aiLevel,
					replace_current: replaceCurrent,
				})
			};
		}
		try {

			return await request(`${gameUrl}/game`, options)
		} catch (err) {
			return
		}
	} else if (move) { // MOVE UPDATE (PUT /game/:gameId)
		const options = {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				move,
				promotion
			})
		};
		try {

			return await request(`${gameUrl}/game/${encodeURIComponent(gameId)}`, options)
		} catch (err) {
			return
		}
	} else { // GET GAME (GET /game/:gameId)
		const options = {
			method: "GET"
		};
		try {
			return await request(`${gameUrl}/game/${encodeURIComponent(gameId)}?player_id=${encodeURIComponent(_id)}`, options)
		} catch (err) {
			return;
		}
	}

}

/**
 * @description New game vs the AI with the start settings from the dropdowns, the server picks the sides (POST /game).
 * Home & the guest page use it, a guest's game_id is overwritten with the new game (their New game)
 * @param  {[string]} gameId [new game id, or the guest's saved one]
 * @param  {[string]} startColor [the player's color: "random" | "w" | "b", Restart keeps it]
 * @param  {[number]} aiLevel [the AI's level, Restart keeps it too]
 * @param  {[boolean]} replaceCurrent [signed in: true forfeits the player's open AI game first (one at a time), left out = the server answers 409 while one is open]
 * @return {[object]} response [{ status, game_id, ai, ai_level, game_board, ... } | { status: 409, game_id (the open one) }]
 */
export async function newAiGame(gameUrl, gameId, startColor, aiLevel, replaceCurrent) {
	const options = {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			game_id: gameId,
			start_color: startColor,
			ai_level: aiLevel,
			replace_current: replaceCurrent
		})
	};
	try {
		return await request(`${gameUrl}/game`, options)
	} catch (err) {
		return
	}
}

/**
 * @description Gets a user's game lists for Home (GET /user/:userId)
 */
export async function getUserGameData(gameUrl, userId) {
	const options = {
		method: "GET"
	};
	try {
		return await request(`${gameUrl}/user/${encodeURIComponent(userId)}`, options)
	} catch (err) {
		return;
	}
}

/**
 * @description Invites a friend, the server finds their account by email & the game waits (PENDING) until they accept (POST /invite)
 * @param  {[boolean]} replaceCurrent [true forfeits the player's open friend game first (one at a time), left out = the server answers 409 while one is open]
 * @param  {[string]} startColor [the inviter's color: "random" | "w" | "b", drawn now so the invite shows it, rematches keep it]
 * @return {[object]} response [{ status, game_id, state: "PENDING" } | { status: 409, game_id (the open one) }]
 */
export async function initMultiplayerGame(gameUrl, gameId, _id, opponentEmail, replaceCurrent, startColor) {
	let options = {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			game_id: gameId,
			challenger_id: _id,
			opponent_email: opponentEmail,
			replace_current: replaceCurrent,
			start_color: startColor
		})
	};
	try {
		return await request(`${gameUrl}/invite`, options)
	} catch (err) {
		return
	}
}

/**
 * @description Friend invites: the invited player starts the game (POST /game/:gameId/accept)
 * @param  {[boolean]} replaceCurrent [true forfeits the player's open friend game first, left out = the server answers 409 while one is open]
 * @return {[object]} response [the game: { status, game_id, game_board, ..., state: "OPEN" } | { status: 409, game_id (the open one) }]
 */
export async function acceptInvite(gameUrl, gameId, replaceCurrent) {
	const options = {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ replace_current: replaceCurrent })
	};
	try {
		return await request(`${gameUrl}/game/${encodeURIComponent(gameId)}/accept`, options)
	} catch (err) {
		return
	}
}

/**
 * @description Friend invites: the invited player declines, or the inviter cancels (POST /game/:gameId/decline)
 * @return {[object]} response [{ status, game_id, message }]
 */
export async function declineInvite(gameUrl, gameId) {
	const options = {
		method: "POST"
	};
	try {
		return await request(`${gameUrl}/game/${encodeURIComponent(gameId)}/decline`, options)
	} catch (err) {
		return
	}
}

/**
 * @description AI games: new board with a new game id & the same start settings (level & color), a game that's still going is forfeited first (POST /game/:gameId/restart)
 * @return {[object]} response [the new game: { status, game_id, ai, game_board, ..., state }]
 */
export async function restartGame(gameUrl, gameId) {
	const options = {
		method: "POST"
	};
	try {
		return await request(`${gameUrl}/game/${encodeURIComponent(gameId)}/restart`, options)
	} catch (err) {
		return
	}
}

/**
 * @description Friend games: forfeits, the other side wins (POST /game/:gameId/forfeit)
 * @return {[object]} response [{ status, state, winner, reason, ... }]
 */
export async function forfeitGame(gameUrl, gameId) {
	const options = {
		method: "POST"
	};
	try {
		return await request(`${gameUrl}/game/${encodeURIComponent(gameId)}/forfeit`, options)
	} catch (err) {
		return
	}
}

/**
 * @description Friend games that are over: asks for a rematch, it starts when both players ask within 1 minute (POST /game/:gameId/rematch)
 * @return {[object]} response [{ status, new_game_id } once it starts | { status, waiting, expires_in } until then]
 */
export async function rematchGame(gameUrl, gameId) {
	const options = {
		method: "POST"
	};
	try {
		return await request(`${gameUrl}/game/${encodeURIComponent(gameId)}/rematch`, options)
	} catch (err) {
		return
	}
}

/**
 * @description AI games: the server picks the AI's move at the game's level & saves it (POST /game/:gameId/ai-move)
 * @return {[object]} response [{ status, game_board, w_knight, b_knight, w_piece, b_piece, state, ..., ai_move: { from, to, promotion } }]
 */
export async function aiMove(gameUrl, gameId) {
	const options = {
		method: "POST"
	};
	try {
		return await request(`${gameUrl}/game/${encodeURIComponent(gameId)}/ai-move`, options)
	} catch (err) {
		return
	}
}

/**
 * @description AI levels & their approx Elo for Home's dropdown (GET /levels)
 * @return {[object]} response [{ status, levels: [{ level, elo }], default_level }]
 */
export async function getLevels(gameUrl) {
	const options = {
		method: "GET"
	};
	try {
		return await request(`${gameUrl}/levels`, options)
	} catch (err) {
		return
	}
}

/**
 * @description fetch() for the chess routes. The server takes the player from the session cookie,
 * so a 401 means the access token expired mid game: re-up the session once & try again
 */
async function request(url, options) {
	let res = await fetch(url, options);
	if (res.status == 401) {
		const refresh = await fetch("/api/auth/refresh", { method: "POST" });
		if (refresh.ok) { res = await fetch(url, options); }
	}
	return res.json();
}
