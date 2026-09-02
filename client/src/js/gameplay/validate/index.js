/* ---------------------------------------------------------------- */
// CHESS
/* ---------------------------------------------------------------- */
/**
 * @description Conditionalize user request of GET Game or POST move which is validate by the sinclair chess lambda(s)
 * @param  {[object]} _id [player id]
 * @param  {[object]} move [move array]
 * @return {[object]} response.json() = backend server response object of request data
 */
export async function validate(gameUrl, gameId, _id, move, promotion, restart) {
	if (restart) { // RESTART GAME
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

			return await fetch(gameUrl, options).then(res => res.json())
		} catch (err) {
			return
		}
	} else if (move) { // MOVE UPDATE
		const options = {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				game_id: gameId,
				player_id: _id,
				move,
				promotion
			})
		};
		try {

			return await fetch(gameUrl, options).then(res => res.json())
		} catch (err) {
			return
		}
	} else { // GET GAME
		const options = {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				game_id: gameId,
				player_id: _id,
			})

		};
		try {
			return await fetch(gameUrl, options).then(res => res.json())
		} catch (err) {
			return;
		}
	}

}

export async function getUserGameData(gameUrl, userId) {
	const options = {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			user_id: userId
		})

	};
	try {
		return await fetch(gameUrl, options).then(res => res.json())
	} catch (err) {
		return;
	}
}

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
		return await fetch(gameUrl, options).then(res => res.json())
	} catch (err) {
		return
	}
}