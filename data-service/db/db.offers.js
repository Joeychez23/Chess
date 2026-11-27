/*
 *  db.offers.js  --  data service
 *	Chess Move Engine
 *  Draw offers, takeback requests and rematches: each is one conditional update on the game that answers true when it saved
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const dbClient = require("./db.client.js");

/* ---------------------------------------------------------------- */
// Draw offers (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description A player's draw offer: saves who offered & that their color used its offer for this move. Only on the board the offer was checked on
 * @param  {[object]} gameData [the open game, as read]
 * @param  {[string]} playerId [player offering]
 * @param  {[string]} color [their color from the stored game, "w" or "b"]
 * @return {[boolean]} saved [false when the game moved or closed, an offer is standing or this color already offered this move]
 */
async function offerDraw(gameData, playerId, color) {
	return saveOffer(gameData.game_id.S, {
		UpdateExpression: `SET draw_offer_player_id = :player_id, draw_offered_${color} = :used`,
		ConditionExpression: `game_board = :board AND (attribute_not_exists(#state) OR #state = :open) AND attribute_not_exists(draw_offer_player_id) AND attribute_not_exists(draw_offered_${color})`,
		ExpressionAttributeNames: { "#state": "state" }, // "state" is a DynamoDB reserved word
		ExpressionAttributeValues: {
			":player_id": { S: playerId },
			":used": { BOOL: true },
			":board": { S: gameData.game_board.S },
			":open": { S: "OPEN" }
		}
	});
}

/**
 * @description Takes a declined offer off the game. draw_offered_w / b stay, the player can't offer again until the next move
 * @param  {[string]} gameId [game id]
 * @param  {[string]} offeredBy [the player whose offer was declined]
 * @return {[boolean]} saved [false when that offer already ended]
 */
async function endDrawOffer(gameId, offeredBy) {
	return saveOffer(gameId, {
		UpdateExpression: 'REMOVE draw_offer_player_id',
		ConditionExpression: 'draw_offer_player_id = :offered_by',
		ExpressionAttributeValues: {
			":offered_by": { S: offeredBy }
		}
	});
}

/* ---------------------------------------------------------------- */
// Takeback Requests (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description A friend game takeback request: saves who asked & the move it was asked at. Only on the board it was checked on,
 * updateGame runs the undo when it's accepted
 * @param  {[object]} gameData [the open game, as read]
 * @param  {[string]} playerId [player asking]
 * @return {[boolean]} saved [false when the game moved or closed, a request is standing or one was already made at this move]
 */
async function requestTakeback(gameData, playerId) {
	return saveOffer(gameData.game_id.S, {
		UpdateExpression: 'SET takeback_player_id = :player_id, takeback_move = :move',
		ConditionExpression: 'game_board = :board AND (attribute_not_exists(#state) OR #state = :open) AND attribute_not_exists(takeback_player_id) AND (attribute_not_exists(takeback_move) OR takeback_move <> :move)',
		ExpressionAttributeNames: { "#state": "state" }, // "state" is a DynamoDB reserved word
		ExpressionAttributeValues: {
			":player_id": { S: playerId },
			":move": { N: `${gameData.moves.S.length}` },
			":board": { S: gameData.game_board.S },
			":open": { S: "OPEN" }
		}
	});
}

/**
 * @description Takes a declined request off the game. takeback_move stays, nobody can ask again until the next move
 * @param  {[string]} gameId [game id]
 * @param  {[string]} requestedBy [the player whose request was declined]
 * @return {[boolean]} saved [false when that request already ended]
 */
async function endTakeback(gameId, requestedBy) {
	return saveOffer(gameId, {
		UpdateExpression: 'REMOVE takeback_player_id',
		ConditionExpression: 'takeback_player_id = :requested_by',
		ExpressionAttributeValues: {
			":requested_by": { S: requestedBy }
		}
	});
}

/* ---------------------------------------------------------------- */
// Request rematch (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description First rematch press: saves who asked & when the request runs out
 * @param  {[string]} gameId [closed friend game]
 * @param  {[string]} playerId [player asking]
 * @param  {[number]} expires [epoch ms the request runs out]
 * @return {[boolean]} saved [false when the opponent is already waiting or the rematch already started]
 */
async function requestRematch(gameId, playerId, expires) {
	return saveOffer(gameId, {
		UpdateExpression: 'SET rematch_player_id = :player_id, rematch_expires = :expires',
		// Pressing again restarts your own wait
		ConditionExpression: 'attribute_not_exists(rematch_game_id) AND (attribute_not_exists(rematch_player_id) OR rematch_player_id = :player_id OR rematch_expires < :now)',
		ExpressionAttributeValues: {
			":player_id": { S: playerId },
			":expires": { N: `${expires}` },
			":now": { N: `${Date.now()}` }
		}
	});
}

/* ---------------------------------------------------------------- */
// Accept rematch (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Second rematch press: claims the rematch by saving the new game id, only one press can claim it
 * @param  {[string]} gameId [closed friend game]
 * @param  {[string]} playerId [player accepting]
 * @param  {[string]} newGameId [id the rematch will use]
 * @return {[boolean]} claimed [false when the opponent has no live request or the rematch already started]
 */
async function acceptRematch(gameId, playerId, newGameId) {
	return saveOffer(gameId, {
		UpdateExpression: 'SET rematch_game_id = :rematch_game_id',
		ConditionExpression: 'attribute_not_exists(rematch_game_id) AND rematch_player_id <> :player_id AND rematch_expires >= :now',
		ExpressionAttributeValues: {
			":rematch_game_id": { S: newGameId },
			":player_id": { S: playerId },
			":now": { N: `${Date.now()}` }
		}
	});
}

/* ---------------------------------------------------------------- */
// Cancel rematch (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Takes back a rematch request, only the player who asked can & only until the other press claims it
 * @param  {[string]} gameId [closed friend game]
 * @param  {[string]} playerId [player cancelling]
 * @return {[boolean]} cancelled [false when they have no request open or the rematch already started]
 */
async function cancelRematch(gameId, playerId) {
	return saveOffer(gameId, {
		UpdateExpression: 'REMOVE rematch_player_id, rematch_expires',
		ConditionExpression: 'attribute_not_exists(rematch_game_id) AND rematch_player_id = :player_id',
		ExpressionAttributeValues: {
			":player_id": { S: playerId }
		}
	});
}

/* ---------------------------------------------------------------- */
// Save offer
/* ---------------------------------------------------------------- */
/**
 * @description The body every offer function shares: one conditional update on the game. A failed condition is an answer here, not an error
 * @param  {[string]} gameId [game id]
 * @param  {[object]} update [{ UpdateExpression, ConditionExpression, ExpressionAttributeNames?, ExpressionAttributeValues }]
 * @return {[boolean]} saved [false when the condition failed]
 */
async function saveOffer(gameId, update) {
	const params = {
		TableName: dbClient.CHESS_TABLE,
		Key: {
			game_id: { S: gameId }
		},
		...update
	}

	try {
		await dbClient.connection.updateItem(params);
		return true;
	} catch (err) {
		if (err.name == "ConditionalCheckFailedException") { return false; }
		throw err;
	}
}

module.exports = {
	offerDraw,
	endDrawOffer,
	requestTakeback,
	endTakeback,
	requestRematch,
	acceptRematch,
	cancelRematch
};
