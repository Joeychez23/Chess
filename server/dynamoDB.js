/*
 *  dynamoDB.js  --  chess server
 *	Chess Move Engine
 *  DynamoDB Controller Functions (was chess-validation/lambdas/functions/chess/dynamoDB/database-controller.js)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { ObjectId } = require("bson");
const { Chess } = require("chess.js");
const { startFacing } = require("./utils/validate.js");

const connection = new DynamoDB({ region: "us-east-1" }); // CREDENTIALS COME FROM ~/.aws LOCALLY, OR THE SERVER'S IAM ROLE ON AWS

const CHESS_TABLE = "chess_db"; // KEY: game_id (S), NAMES MATCH terraform/aws-enviroment/locals.tf
const USER_TABLE = "user_db"; // KEY: user_id (S)

const GAME_TTL = 60 * 60 * 24 * 25; // GAMES EXPIRE 25 DAYS AFTER THE LAST MOVE (SECONDS)

/* ---------------------------------------------------------------- */
// Expire Time
/* ---------------------------------------------------------------- */
/**
 * @description Builds the expireAt value DynamoDB TTL reads on chess_db
 * @return {[string]} expireAt [epoch SECONDS as a string, the SDK only takes strings for N]
 */
function expireTime() {
	return `${Math.floor(Date.now() / 1000) + GAME_TTL}`;
}

/* ---------------------------------------------------------------- */
// Initalize game (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Creates a new game, or overwrites an existing game_id with a new board (restart)
 * @param  {[string]} existingGameId [game id to use, false to generate one]
 * @param  {[string]} playerId1 [white player id]
 * @param  {[string]} playerId2 [black player id]
 * @param  {[number]} aiLevel [AI games: the AI's level, saved with the game so it can't change mid game]
 * @return {[object]} response [{ status, game_data, message }]
 */
async function initalizeGame(existingGameId, playerId1, playerId2, aiLevel) {
	const board = new Chess().fen();
	const facing = startFacing(board); // EVERY KING, QUEEN, BISHOP & ROOK FACES THE OTHER SIDE

	let gameId;
	let response;
	if (existingGameId) { gameId = existingGameId; }
	else { gameId = `${new ObjectId()}`; } // CREATES UNIQUE GAME IDENTIFIER
	let params = {
		TableName: CHESS_TABLE,
		Item: {
			game_id: { S: gameId },
			state: { S: "OPEN" },
			game_board: { S: board },
			moves: { S: JSON.stringify([]) },
			prev_move: { S: JSON.stringify([]) },
			w_knight: { S: JSON.stringify([{ from: null, to: 'b1' }, { from: null, to: 'g1' }]) },
			b_knight: { S: JSON.stringify([{ from: null, to: 'b8' }, { from: null, to: 'g8' }]) },
			w_facing: { S: facing.w_facing }, // { square: RANK IT FACES } FOR WHITE'S KINGS, QUEENS, BISHOPS & ROOKS
			b_facing: { S: facing.b_facing }, // SAME FOR BLACK
			white_player_id: { S: playerId1 },
			black_player_id: { S: playerId2 },
			expireAt: { N: expireTime() } // TTL, PUSHED BACK ON EVERY MOVE IN updateGame
		}
	};
	if (aiLevel) { params.Item.ai_level = { N: String(aiLevel) }; } // FRIEND GAMES HAVE NO LEVEL

	await connection.putItem(params); // POST REQUEST FOR GAME CREATION TO DYNAMODB

	async function handleUser(userId) {
		if (userId != "CHESS_AI" && userId != "GUEST_USER" && userId != gameId) { // GUESTS HAVE NO GAME LIST, SKIP THEM LIKE THE AI (A GUEST'S PLAYER ID IS THEIR GAME ID)
			response = await retrieveUser(userId);
			if (response.status == 500) { response = await initalizeUser(userId); }

			let userData = response?.user_data;
			let openGames = JSON.parse(userData.open_games.S);
			if (!openGames.includes(gameId)) { openGames[openGames.length] = gameId; } // ADD TO OPEN GAMES ONCE, RESTARTS KEEP THE SAME game_id

			userData.open_games.S = openGames;

			//SET DATA
			userData.requested_games.S = JSON.parse(userData.requested_games.S);
			userData.closed_games.S = JSON.parse(userData.closed_games.S);

			//UPDATE DATA
			response = await updateUser(userData);
		}
	}

	await handleUser(playerId1);
	await handleUser(playerId2);

	// GET CREATED GAME
	response = await retrieveGame(params.Item.game_id.S); // CHECKS IF THE GAME WAS CREATED

	if (response.status == 200) { // RETURNS THE CREATED GAME IF FOUND
		response.message = "Initalized game successfully"
		return response; // RETURNS THE CREATED GAME
	} else {
		response.message = "Game initialization failed"
		return response;
	}
}

/* ---------------------------------------------------------------- */
// Retrieve game (GET)
/* ---------------------------------------------------------------- */
/**
 * @description Gets a game by id, moves & prev_move come back parsed into arrays
 * @param  {[string]} gameId [game id from the client]
 * @return {[object]} response [{ status, game_data, message }]
 */
async function retrieveGame(gameId) {
	const params = {
		TableName: CHESS_TABLE,
		Key: {
			game_id: { S: gameId } // SEARCH KEY
		}
	}

	let response = await connection.getItem(params); // GET REQUEST TO DYNAMODB

	if (response.Item) {
		response.Item.moves.S = JSON.parse(response.Item.moves.S);
		response.Item.prev_move.S = JSON.parse(response.Item.prev_move.S);
		return {
			status: 200,
			game_data: response.Item,
			message: `Retrieved game id: ${response.Item.game_id.S}`
		}
	} else {
		return {
			status: 500,
			message: "Game data not found"
		}
	}
}

/* ---------------------------------------------------------------- */
// Update game (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Saves a validated move, then reads the game back to check it saved
 * @param  {[object]} gameData [Validated server data, modified by a successful client request]
 * @param  {[string]} prevBoard [board the move was made on, the save fails if the board changed since (two requests at once)]
 * @return {[object]} response [{ status, game_data, message }]
 */
async function updateGame(gameData, prevBoard) {
	const params = {
		TableName: CHESS_TABLE,
		Key: {
			game_id: { S: gameData.game_id.S }
		},
		UpdateExpression: 'SET moves = :moves, prev_move = :prev_move, game_board = :game_board, w_knight = :w_knight, b_knight = :b_knight, w_facing = :w_facing, b_facing = :b_facing, expireAt = :expireAt', // WHAT IS BEING UPDATED, AND ASSOCIATED ATTRIBUTES TO WHAT THE DATA WILL BE
		ExpressionAttributeValues: { // ASSOCIATED ATTRIBUTES
			":moves": { S: JSON.stringify(gameData.moves.S) }, // UPDATED MOVE ARRAY
			":prev_move": { S: JSON.stringify(gameData.prev_move.S) },
			":game_board": { S: gameData.game_board.S }, // UPDATED GAME FEN
			":w_knight": { S: gameData.w_knight.S }, // UPDATED WHITE KNIGHTS
			":b_knight": { S: gameData.b_knight.S }, // UPDATED BLACK KNIGHTS
			":w_facing": { S: gameData.w_facing?.S || startFacing(gameData.game_board.S).w_facing }, // UPDATED WHITE FACING (validateMove ALWAYS SETS IT)
			":b_facing": { S: gameData.b_facing?.S || startFacing(gameData.game_board.S).b_facing }, // UPDATED BLACK FACING
			":expireAt": { N: expireTime() } // ACTIVE GAMES NEVER EXPIRE, ONLY ABANDONED ONES
		}
	}
	if (prevBoard) {
		params.ConditionExpression = 'game_board = :prev_board'; // ONLY ONE MOVE PER BOARD
		params.ExpressionAttributeValues[":prev_board"] = { S: prevBoard };
	}

	try {
		await connection.updateItem(params); // PUT REQUEST TO DYANMODB
	} catch (err) {
		if (err.name == "ConditionalCheckFailedException") { return { status: 500, message: `Board changed before the move saved: ${gameData.game_id.S}` }; }
		throw err;
	}

	let response = await retrieveGame(gameData.game_id.S); // GET GAME BY ID

	if (response.status == 200) {
		let { game_board, moves } = response.game_data;
		if (JSON.stringify(moves.S) == JSON.stringify(gameData.moves.S) && game_board.S == gameData.game_board.S) { // IF UPDATED SUCCESSFULLY
			return {
				status: 200,
				game_data: gameData,
				message: `Updated game attributes: ${response.game_data.game_id.S}`
			}
		} else {
			return {
				status: 500,
				message: `Game attributes failed to update: ${response.game_data.game_id.S}`
			}
		}
	} else {
		return {
			status: 500,
			message: `Game attributes failed to update: ${gameData.game_id.S}`
		}
	}
}

/* ---------------------------------------------------------------- */
// Close game (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Ends a game: saves the result & moves it from open_games to closed_games for both players.
 * Finished friend games are kept forever (expireAt is removed), AI games still expire 25 days after the last move
 * @param  {[object]} gameData [game item from retrieveGame]
 * @param  {[string]} winner ["w", "b" or "draw"]
 * @param  {[string]} reason ["checkmate", "stalemate", "insufficient material", "fifty-move rule" or "forfeit"]
 * @return {[object]} response [{ status, game_data, message }]
 */
async function closeGame(gameData, winner, reason) {
	const gameId = gameData.game_id.S;
	const aiGame = gameData.white_player_id.S == "CHESS_AI" || gameData.black_player_id.S == "CHESS_AI";
	const params = {
		TableName: CHESS_TABLE,
		Key: {
			game_id: { S: gameId }
		},
		UpdateExpression: `SET #state = :closed, #winner = :winner, #reason = :reason${aiGame ? "" : " REMOVE expireAt"}`, // NO expireAt = TTL NEVER DELETES IT
		ConditionExpression: 'attribute_not_exists(#state) OR #state <> :closed', // ONLY ONE CLOSE WINS (FORFEIT & CHECKMATE AT THE SAME TIME)
		ExpressionAttributeNames: { "#state": "state", "#winner": "winner", "#reason": "reason" }, // "state" IS A DYNAMODB RESERVED WORD
		ExpressionAttributeValues: {
			":closed": { S: "CLOSED" },
			":winner": { S: winner },
			":reason": { S: reason }
		}
	}

	try {
		await connection.updateItem(params); // PUT REQUEST TO DYANMODB
	} catch (err) {
		if (err.name == "ConditionalCheckFailedException") { return { status: 500, message: `Game is already over: ${gameId}` }; }
		throw err;
	}

	await closeUserGame(gameData.white_player_id.S, gameId);
	await closeUserGame(gameData.black_player_id.S, gameId);

	gameData.state = { S: "CLOSED" };
	gameData.winner = { S: winner };
	gameData.reason = { S: reason };
	if (!aiGame) { delete gameData.expireAt; }
	return {
		status: 200,
		game_data: gameData,
		message: `Closed game id: ${gameId}`
	}
}

/**
 * @description Moves a game id from a user's open_games to closed_games (Home only lists open games)
 * @param  {[string]} userId [auth0 user id without "auth0|"]
 * @param  {[string]} gameId [closed game]
 */
async function closeUserGame(userId, gameId) {
	if (userId == "CHESS_AI" || userId == "GUEST_USER" || userId == gameId) { return; } // A GUEST'S PLAYER ID IS THEIR GAME ID
	const response = await retrieveUser(userId);
	if (!response.user_data) { return; }

	let userData = response.user_data;
	let closedGames = JSON.parse(userData.closed_games.S);
	if (!closedGames.includes(gameId)) { closedGames[closedGames.length] = gameId; }

	//SET DATA
	userData.open_games.S = JSON.parse(userData.open_games.S).filter((openGameId) => openGameId != gameId);
	userData.closed_games.S = closedGames;
	userData.requested_games.S = JSON.parse(userData.requested_games.S);

	//UPDATE DATA
	await updateUser(userData);
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
	const params = {
		TableName: CHESS_TABLE,
		Key: {
			game_id: { S: gameId }
		},
		UpdateExpression: 'SET rematch_player_id = :player_id, rematch_expires = :expires',
		ConditionExpression: 'attribute_not_exists(rematch_game_id) AND (attribute_not_exists(rematch_player_id) OR rematch_player_id = :player_id OR rematch_expires < :now)', // PRESSING AGAIN RESTARTS YOUR OWN MINUTE
		ExpressionAttributeValues: {
			":player_id": { S: playerId },
			":expires": { N: `${expires}` },
			":now": { N: `${Date.now()}` }
		}
	}

	try {
		await connection.updateItem(params); // PUT REQUEST TO DYANMODB
		return true;
	} catch (err) {
		if (err.name == "ConditionalCheckFailedException") { return false; }
		throw err;
	}
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
	const params = {
		TableName: CHESS_TABLE,
		Key: {
			game_id: { S: gameId }
		},
		UpdateExpression: 'SET rematch_game_id = :rematch_game_id',
		ConditionExpression: 'attribute_not_exists(rematch_game_id) AND rematch_player_id <> :player_id AND rematch_expires >= :now',
		ExpressionAttributeValues: {
			":rematch_game_id": { S: newGameId },
			":player_id": { S: playerId },
			":now": { N: `${Date.now()}` }
		}
	}

	try {
		await connection.updateItem(params); // PUT REQUEST TO DYANMODB
		return true;
	} catch (err) {
		if (err.name == "ConditionalCheckFailedException") { return false; }
		throw err;
	}
}

/* ---------------------------------------------------------------- */
// Initalize user (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Creates a user row with empty game lists
 * @param  {[string]} userId [auth0 user id without "auth0|"]
 * @return {[object]} response [{ status, user_data, message }]
 */
async function initalizeUser(userId) {
	const params = {
		TableName: USER_TABLE,
		Item: {
			user_id: { S: userId },
			open_games: { S: JSON.stringify([]) },
			requested_games: { S: JSON.stringify([]) },
			closed_games: { S: JSON.stringify([]) },
		}
	}

	await connection.putItem(params); // POST REQUEST TO DYNAMODB

	let response = await retrieveUser(userId);

	if (response.status == 200) {
		return {
			status: 200,
			user_data: response.user_data,
			message: `user id: ${response.user_data.user_id.S} initalized inside db`
		}
	} else {
		return {
			status: 500,
			message: "User data not found"
		}
	}
}

/* ---------------------------------------------------------------- */
// Retrieve user (GET)
/* ---------------------------------------------------------------- */
/**
 * @description Gets a user row by id, the game lists stay JSON strings
 * @param  {[string]} userId [auth0 user id without "auth0|"]
 * @return {[object]} response [{ status, user_data, message }]
 */
async function retrieveUser(userId) {
	const params = {
		TableName: USER_TABLE,
		Key: {
			user_id: { S: userId } // SEARCH KEY
		}
	}

	let response = await connection.getItem(params); // GET REQUEST TO DYNAMODB

	if (response.Item) {
		return {
			status: 200,
			user_data: response.Item,
			message: `Retrieved user id: ${response.Item.user_id.S}`
		}
	} else {
		return {
			status: 500,
			message: "User data not found"
		}
	}
}

/* ---------------------------------------------------------------- */
// Update user (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Saves a user's game lists
 * @param  {[object]} userData [user row, the game list .S values are ARRAYS here (stringified on save)]
 * @return {[object]} response [{ status, user_data, message }]
 */
async function updateUser(userData) {
	const params = {
		TableName: USER_TABLE,
		Key: {
			user_id: { S: userData.user_id.S }
		},
		UpdateExpression: 'SET requested_games = :requested_games, open_games = :open_games, closed_games = :closed_games',
		ExpressionAttributeValues: { // ASSOCIATED ATTRIBUTES
			":requested_games": { S: JSON.stringify(userData.requested_games.S) },
			":open_games": { S: JSON.stringify(userData.open_games.S) },
			":closed_games": { S: JSON.stringify(userData.closed_games.S) },
		}
	}

	await connection.updateItem(params); // PUT REQUEST TO DYANMODB

	let response = await retrieveUser(userData.user_id.S); // GET USER BY ID

	if (response.status == 200) {
		return {
			status: 200,
			user_data: response.user_data,
			message: `user id: ${response.user_data.user_id.S} updated`
		}
	} else {
		return {
			status: 500,
			message: `User attributes failed to update: ${userData.user_id.S}`
		}
	}
}

/* ---------------------------------------------------------------- */
// Prune open games
/* ---------------------------------------------------------------- */
/**
 * @description Drops games TTL already deleted from a user's open_games & saves the shorter list
 * @param  {[object]} userData [user item from retrieveUser]
 * @return {[object]} userData [same item, open_games.S only lists games that still exist]
 */
async function pruneOpenGames(userData) {
	const openGames = [...new Set(JSON.parse(userData.open_games.S))]; // BATCH GET FAILS ON DUPLICATE KEYS
	if (openGames.length == 0) { return userData; }

	let liveGames = [];
	try {
		for (let i = 0; i < openGames.length; i += 100) { // BATCH GET TAKES 100 KEYS MAX
			const gameIds = openGames.slice(i, i + 100);
			const params = {
				RequestItems: {
					[CHESS_TABLE]: {
						Keys: gameIds.map((gameId) => ({ game_id: { S: gameId } })),
						ProjectionExpression: "game_id" // ONLY CHECKING THE GAME EXISTS
					}
				}
			};

			const response = await connection.batchGetItem(params);
			const foundGames = (response.Responses?.[CHESS_TABLE] || []).map((game) => game.game_id.S);
			const uncheckedGames = (response.UnprocessedKeys?.[CHESS_TABLE]?.Keys || []).map((key) => key.game_id.S);

			for (let j = 0; j < gameIds.length; j++) {
				if (foundGames.includes(gameIds[j]) || uncheckedGames.includes(gameIds[j])) { liveGames.push(gameIds[j]); } // UNCHECKED GAMES ARE KEPT, NEVER DROP A REAL GAME
			}
		}
	} catch (err) {
		console.log(`Open games check failed: ${err.message}`);
		return userData; // SHOW THE LIST AS IS RATHER THAN BREAKING HOME
	}

	if (liveGames.length == openGames.length) { return userData; } // NOTHING EXPIRED

	const prunedGames = JSON.stringify(liveGames);
	const params = {
		TableName: USER_TABLE,
		Key: {
			user_id: { S: userData.user_id.S }
		},
		UpdateExpression: 'SET open_games = :open_games',
		ConditionExpression: 'open_games = :old_open_games', // SKIPS THE SAVE IF A GAME WAS ADDED MEANWHILE, NEXT LOAD PRUNES AGAIN
		ExpressionAttributeValues: {
			":open_games": { S: prunedGames },
			":old_open_games": { S: userData.open_games.S }
		}
	}

	try {
		await connection.updateItem(params); // PUT REQUEST TO DYANMODB
	} catch (err) {
		if (err.name != "ConditionalCheckFailedException") { console.log(`Open games save failed: ${err.message}`); }
	}

	userData.open_games.S = prunedGames;
	return userData;
}


module.exports = { initalizeGame, retrieveGame, updateGame, closeGame, requestRematch, acceptRematch, initalizeUser, retrieveUser, updateUser, pruneOpenGames }
