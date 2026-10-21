/* ---------------------------------------------------------------- */
// CHESS
/* ---------------------------------------------------------------- */
/**
 * @description Conditionalize user request of GET Game, PUT move, or POST restart, validated by the chess routes on the express server (server/controllers/chessController.js)
 * @param  {[string]} gameUrl [chess api, "/api/chess"]
 * @param  {[string]} gameId [game id]
 * @param  {[object]} _id [player id, the server plays as the signed in session instead ("CHESS_AI" still marks the AI's move)]
 * @param  {[object]} move [move array]
 * @param  {[string]} promotion [promotion piece]
 * @param  {[string]} restart [AI color 'w' or 'b' to restart the game]
 * @return {[object]} response.json() = backend server response object of request data
 */
export async function validate(gameUrl, gameId, _id, move, promotion, restart) {
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
				player_id: _id,
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
 * @description New game vs a friend, the server finds their account by email (POST /invite)
 */
export async function initMultiplayerGame(gameUrl, gameId, _id, opponentEmail) {
	let options = {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			game_id: gameId,
			challenger_id: _id,
			opponent_email: opponentEmail
		})
	};
	try {
		return await request(`${gameUrl}/invite`, options)
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

export async function stockfishAPI(data = {}) {
	const response = await fetch("https://engine.aws-prac-route53.com/v1", {
		method: "POST",
		headers: {
			"Content-Type": "application/json"
		},
		body: JSON.stringify(data),
		signal: AbortSignal.timeout(2500), // ENGINE UNREACHABLE -> playAi() FALLS BACK TO js-chess-engine AFTER 2 SECONDS
	});
	return response.json();
}
// await stockfishAPI({ fen: `${chessInst.fen()}`, depth: 1 }).then((data) => { console.log(data); });