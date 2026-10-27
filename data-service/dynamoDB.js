/*
 *  dynamoDB.js  --  data service
 *	Chess Move Engine
 *  DynamoDB Controller Functions (was chess-validation/lambdas/functions/chess/dynamoDB/database-controller.js)
 *  Copied from server/dynamoDB.js (#247), which goes once the chess server calls the data service (#249). Only the data service's routes call these
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { ObjectId } = require("bson");
const { Chess } = require("chess.js");
const { startPieces } = require("./utils/validate.js");
const { newRating, scoreFor, isRated, readRating } = require("./utils/rating.js");
const { usernameKey } = require("./utils/username.js");
const config = require("./config");

const connection = new DynamoDB({ region: config.dynamoRegion }); // DYNAMODB_REGION, us-west-2 BY DEFAULT. CREDENTIALS COME FROM ~/.aws LOCALLY, OR THE DATA SERVICE'S IAM ROLE ON AWS

const CHESS_TABLE = "chess_db"; // KEY: game_id (S), NAMES MATCH terraform/aws-enviroment/locals.tf
const USER_TABLE = "user_db"; // KEY: user_id (S), PLAYERS' ROWS & THE username#<name> ITEMS THAT HOLD EACH USERNAME (claimUsername)

const GAME_TTL = 60 * 60 * 24 * 25; // GAMES EXPIRE 25 DAYS AFTER THE LAST MOVE (SECONDS)

const GAME_LISTS = ["requested_games", "open_games", "closed_games"]; // A user_db ROW'S GAME LISTS (JSON STRINGS)
const LIST_SAVE_TRIES = 5; // A GAME LIST SAVE THAT LOST A RACE READS THE ROW AGAIN & RETRIES

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
 * @param  {[object]} options [{ names: friend games' { w, b } names (usernames, or Auth0 screennames) for Home's caption,
 * pending: friend invites, the game is PENDING & waits in requested_games until it's accepted (acceptInvite),
 * start_params: the start settings ({ color, fen }, Restart & Rematch reuse them, left out = Random from the standard position. fen = a set position, checked by checkStartFen),
 * inviter_id: friend games, the player who sent the invite (their pick is start_params.color) }]
 * @return {[object]} response [{ status, game_data, message }]
 */
async function initalizeGame(existingGameId, playerId1, playerId2, aiLevel, options) {
	const { names, pending, start_params, inviter_id } = options || {};
	const board = start_params?.fen || new Chess().fen(); // A SET POSITION (THE START POSITION BOX) OR THE STANDARD ONE
	const pieces = startPieces(board); // EVERY KNIGHT, KING, QUEEN, BISHOP & ROOK ON THE BOARD, NONE HAVE MOVED

	let gameId;
	if (existingGameId) { gameId = existingGameId; }
	else { gameId = `${new ObjectId()}`; } // CREATES UNIQUE GAME IDENTIFIER
	let params = {
		TableName: CHESS_TABLE,
		Item: {
			game_id: { S: gameId },
			state: { S: pending ? "PENDING" : "OPEN" },
			game_board: { S: board },
			moves: { S: JSON.stringify([]) },
			prev_move: { S: JSON.stringify([]) },
			w_knight: { S: JSON.stringify(pieces.w_knight) }, // STANDARD: b1 & g1
			b_knight: { S: JSON.stringify(pieces.b_knight) },
			w_piece: { S: JSON.stringify(pieces.w_piece) }, // KINGS, QUEENS, BISHOPS & ROOKS (WHICH WAY THEY FACE), STANDARD: a1, c1, d1, e1, f1 & h1
			b_piece: { S: JSON.stringify(pieces.b_piece) },
			white_player_id: { S: playerId1 },
			black_player_id: { S: playerId2 },
			start_params: { S: JSON.stringify(start_params || { color: "random" }) }, // START SETTINGS, AI GAMES: THE PLAYER'S PICK, FRIEND GAMES: THE INVITER'S
			expireAt: { N: expireTime() } // TTL, PUSHED BACK ON EVERY MOVE IN updateGame
		}
	};
	if (aiLevel) { params.Item.ai_level = { N: String(aiLevel) }; } // FRIEND GAMES HAVE NO LEVEL
	if (names?.w) { params.Item.white_name = { S: names.w }; } // FRIEND GAMES: "vs Bob" ON HOME
	if (names?.b) { params.Item.black_name = { S: names.b }; }
	if (inviter_id) { params.Item.inviter_id = { S: inviter_id }; } // FRIEND GAMES: SENT OR RECEIVED, & WHOSE COLOR start_params HOLDS (CARRIED OVER ON A REMATCH)

	await connection.putItem(params); // POST REQUEST FOR GAME CREATION TO DYNAMODB

	async function handleUser(userId) {
		if (userId != "CHESS_AI" && userId != "GUEST_USER" && userId != gameId) { // GUESTS HAVE NO GAME LIST, SKIP THEM LIKE THE AI (A GUEST'S PLAYER ID IS THEIR GAME ID)
			await changeUserGames(userId, (gameLists) => {
				let gameList = pending ? gameLists.requested_games : gameLists.open_games; // INVITES WAIT IN requested_games UNTIL THEY'RE ACCEPTED
				if (!gameList.includes(gameId)) { gameList[gameList.length] = gameId; } // ADD ONCE, RESTARTS KEEP THE SAME game_id
			});
		}
	}

	await handleUser(playerId1);
	await handleUser(playerId2);

	return { // putItem THROWS IF IT FAILED, SO THE GAME IS SAVED AS WRITTEN (A READ BACK CAN STILL MISS IT)
		status: 200,
		game_data: gameItem(params.Item),
		message: "Initalized game successfully"
	}
}

/* ---------------------------------------------------------------- */
// Retrieve game (GET)
/* ---------------------------------------------------------------- */
/**
 * @description Gets a game by id, moves & prev_move come back parsed into arrays
 * @param  {[string]} gameId [game id from the client]
 * @param  {[boolean]} consistent [true = a strongly consistent read that sees every finished save (twice the read capacity),
 * for reading what another request just saved. Left out, a read can briefly return the game from before the last save]
 * @return {[object]} response [{ status, game_data, message }]
 */
async function retrieveGame(gameId, consistent) {
	const params = {
		TableName: CHESS_TABLE,
		Key: {
			game_id: { S: gameId } // SEARCH KEY
		},
		ConsistentRead: !!consistent
	}

	let response = await connection.getItem(params); // GET REQUEST TO DYNAMODB

	if (response.Item) {
		return {
			status: 200,
			game_data: gameItem(response.Item),
			message: `Retrieved game id: ${response.Item.game_id.S}`
		}
	} else {
		return {
			status: 500,
			message: "Game data not found"
		}
	}
}

/**
 * @description A chess_db item the way the routes use it
 * @param  {[object]} item [item as DynamoDB stores it]
 * @return {[object]} gameData [a copy with moves & prev_move parsed into arrays]
 */
function gameItem(item) {
	return { ...item, moves: { S: JSON.parse(item.moves.S) }, prev_move: { S: JSON.parse(item.prev_move.S) } };
}

/* ---------------------------------------------------------------- */
// Update game (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Saves a validated move
 * @param  {[object]} gameData [Validated server data, modified by a successful client request]
 * @param  {[string]} prevBoard [board the move was made on, the save fails if the board changed since (two requests at once)]
 * @return {[object]} response [{ status, game_data (the game as saved), message }]
 */
async function updateGame(gameData, prevBoard) {
	const params = {
		TableName: CHESS_TABLE,
		Key: {
			game_id: { S: gameData.game_id.S }
		},
		UpdateExpression: 'SET moves = :moves, prev_move = :prev_move, game_board = :game_board, w_knight = :w_knight, b_knight = :b_knight, w_piece = :w_piece, b_piece = :b_piece, expireAt = :expireAt', // WHAT IS BEING UPDATED, AND ASSOCIATED ATTRIBUTES TO WHAT THE DATA WILL BE
		ExpressionAttributeValues: { // ASSOCIATED ATTRIBUTES
			":moves": { S: JSON.stringify(gameData.moves.S) }, // UPDATED MOVE ARRAY
			":prev_move": { S: JSON.stringify(gameData.prev_move.S) },
			":game_board": { S: gameData.game_board.S }, // UPDATED GAME FEN
			":w_knight": { S: gameData.w_knight.S }, // UPDATED WHITE KNIGHTS
			":b_knight": { S: gameData.b_knight.S }, // UPDATED BLACK KNIGHTS
			":w_piece": { S: gameData.w_piece.S }, // UPDATED WHITE KINGS, QUEENS, BISHOPS & ROOKS
			":b_piece": { S: gameData.b_piece.S }, // UPDATED BLACK KINGS, QUEENS, BISHOPS & ROOKS
			":expireAt": { N: expireTime() } // ACTIVE GAMES NEVER EXPIRE, ONLY ABANDONED ONES
		},
		ReturnValues: "ALL_NEW" // THE GAME AS SAVED, NO READ BACK (AN EVENTUALLY CONSISTENT READ CAN RETURN THE OLD BOARD)
	}
	if (prevBoard) {
		params.ConditionExpression = 'game_board = :prev_board'; // ONLY ONE MOVE PER BOARD
		params.ExpressionAttributeValues[":prev_board"] = { S: prevBoard };
	}

	let response;
	try {
		response = await connection.updateItem(params); // PUT REQUEST TO DYANMODB
	} catch (err) {
		if (err.name == "ConditionalCheckFailedException") { return { status: 500, message: `Board changed before the move saved: ${gameData.game_id.S}` }; }
		throw err;
	}

	return {
		status: 200,
		game_data: gameItem(response.Attributes),
		message: `Updated game attributes: ${gameData.game_id.S}`
	}
}

/* ---------------------------------------------------------------- */
// Close game (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Ends a game: saves the result & moves it from open_games to closed_games for both players, then rates it (rateGame,
 * friend games once both sides moved). Finished friend games are kept forever (expireAt is removed), AI games still expire 25 days after the last move
 * @param  {[object]} gameData [game item from retrieveGame]
 * @param  {[string]} winner ["w", "b" or "draw"]
 * @param  {[string]} reason ["checkmate", "stalemate", "insufficient material", "fifty-move rule", "threefold repetition" or "forfeit"]
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

	await moveUserGame(gameData.white_player_id.S, gameId, "open_games", "closed_games");
	await moveUserGame(gameData.black_player_id.S, gameId, "open_games", "closed_games");

	if (isRated(gameData)) { // ONLY ONE CLOSE GETS HERE, SO A GAME IS RATED ONCE
		try {
			gameData.ratings = { S: JSON.stringify(await rateGame(gameData, winner)) };
		} catch (err) {
			console.log(`Rating failed: ${gameId}: ${err.message}`); // THE GAME STILL CLOSES
		}
	}

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

/* ---------------------------------------------------------------- */
// Rate game (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Changes both players' ratings after a finished game (utils/rating.js) & saves what changed on the game, where it stays:
 * rated friend games are never deleted, so a player's closed_games are their rating history (profiles, #81)
 * @param  {[object]} gameData [the closed game item]
 * @param  {[string]} winner ["w", "b" or "draw"]
 * @return {[object]} ratings [{ w: { before, after }, b: { before, after }, at (epoch ms) }, null for a player without a row]
 */
async function rateGame(gameData, winner) {
	const players = { w: gameData.white_player_id.S, b: gameData.black_player_id.S };
	let before = {};
	for (const color of ["w", "b"]) { before[color] = readRating((await retrieveUser(players[color], true)).user_data); } // EACH SIDE IS RATED AGAINST THE OTHER'S RATING FROM BEFORE THE GAME

	let ratings = { at: Date.now() };
	for (const color of ["w", "b"]) {
		const opponent = before[color == "w" ? "b" : "w"];
		ratings[color] = await saveRating(players[color], (rating) => newRating(rating, opponent, scoreFor(winner, color)));
	}

	const params = {
		TableName: CHESS_TABLE,
		Key: {
			game_id: { S: gameData.game_id.S }
		},
		UpdateExpression: 'SET ratings = :ratings',
		ExpressionAttributeValues: {
			":ratings": { S: JSON.stringify(ratings) }
		}
	}
	await connection.updateItem(params); // PUT REQUEST TO DYANMODB
	return ratings;
}

/**
 * @description Saves a player's new rating. Two of their games can end at once, so it only saves if rated_games is still what was read,
 * otherwise it reads the row again & works the rating out again
 * @param  {[string]} userId [auth0 user id without "auth0|"]
 * @param  {[function]} compute [({ rating, rated_games }) => the new rating]
 * @return {[object]} change [{ before, after }, null when the player has no row (they deleted their data)]
 */
async function saveRating(userId, compute) {
	for (let i = 0; i < LIST_SAVE_TRIES; i++) {
		const user = await retrieveUser(userId, true);
		if (!user.user_data) { return null; }
		const rating = readRating(user.user_data);
		const after = compute(rating);

		const params = {
			TableName: USER_TABLE,
			Key: {
				user_id: { S: userId }
			},
			UpdateExpression: 'SET rating = :rating, rated_games = :rated_games',
			ConditionExpression: user.user_data.rated_games ? 'rated_games = :old_rated_games' : 'attribute_exists(user_id) AND attribute_not_exists(rated_games)', // THEIR FIRST RATED GAME, OR NO OTHER GAME WAS RATED SINCE THE READ
			ExpressionAttributeValues: {
				":rating": { N: `${after}` },
				":rated_games": { N: `${rating.rated_games + 1}` }
			}
		}
		if (user.user_data.rated_games) { params.ExpressionAttributeValues[":old_rated_games"] = { N: user.user_data.rated_games.N }; }

		try {
			await connection.updateItem(params); // PUT REQUEST TO DYANMODB
			return { before: rating.rating, after };
		} catch (err) {
			if (err.name != "ConditionalCheckFailedException") { throw err; }
		}
	}
	throw new Error(`Rating save failed after ${LIST_SAVE_TRIES} tries: ${userId}`);
}

/* ---------------------------------------------------------------- */
// Accept invite (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description The invited player accepted: PENDING -> OPEN & the game moves from requested_games to open_games for both players
 * @param  {[object]} gameData [PENDING game item from retrieveGame]
 * @return {[object]} response [{ status, game_data, message }]
 */
async function acceptInvite(gameData) {
	const gameId = gameData.game_id.S;
	const params = {
		TableName: CHESS_TABLE,
		Key: {
			game_id: { S: gameId }
		},
		UpdateExpression: 'SET #state = :open, expireAt = :expireAt', // THE 25 DAYS START FROM THE ACCEPT
		ConditionExpression: '#state = :pending', // ONLY ONE ACCEPT WINS, A DECLINE MAY HAVE GOTTEN THERE FIRST
		ExpressionAttributeNames: { "#state": "state" }, // "state" IS A DYNAMODB RESERVED WORD
		ExpressionAttributeValues: {
			":open": { S: "OPEN" },
			":pending": { S: "PENDING" },
			":expireAt": { N: expireTime() }
		}
	}

	try {
		await connection.updateItem(params); // PUT REQUEST TO DYANMODB
	} catch (err) {
		if (err.name == "ConditionalCheckFailedException") { return { status: 500, message: `Invite was already answered: ${gameId}` }; }
		throw err;
	}

	await moveUserGame(gameData.white_player_id.S, gameId, "requested_games", "open_games");
	await moveUserGame(gameData.black_player_id.S, gameId, "requested_games", "open_games");

	gameData.state = { S: "OPEN" };
	return {
		status: 200,
		game_data: gameData,
		message: `Accepted game id: ${gameId}`
	}
}

/* ---------------------------------------------------------------- */
// Delete invite (DELETE)
/* ---------------------------------------------------------------- */
/**
 * @description A declined or cancelled invite: the PENDING game is deleted & dropped from both players' requested_games
 * @param  {[object]} gameData [PENDING game item from retrieveGame]
 * @return {[object]} response [{ status, message }]
 */
async function deleteInvite(gameData) {
	const gameId = gameData.game_id.S;
	const params = {
		TableName: CHESS_TABLE,
		Key: {
			game_id: { S: gameId }
		},
		ConditionExpression: '#state = :pending', // AN ACCEPTED GAME IS NEVER DELETED
		ExpressionAttributeNames: { "#state": "state" },
		ExpressionAttributeValues: {
			":pending": { S: "PENDING" }
		}
	}

	try {
		await connection.deleteItem(params); // DELETE REQUEST TO DYANMODB
	} catch (err) {
		if (err.name == "ConditionalCheckFailedException") { return { status: 500, message: `Invite was already answered: ${gameId}` }; }
		throw err;
	}

	await moveUserGame(gameData.white_player_id.S, gameId, "requested_games", null);
	await moveUserGame(gameData.black_player_id.S, gameId, "requested_games", null);

	return {
		status: 200,
		message: `Deleted invite id: ${gameId}`
	}
}

/**
 * @description Moves a game id between a user's game lists: open_games -> closed_games (closed), requested_games -> open_games (accepted),
 * requested_games -> nowhere (declined or cancelled). Home only lists open games & invites
 * @param  {[string]} userId [auth0 user id without "auth0|"]
 * @param  {[string]} gameId [game id]
 * @param  {[string]} fromList ["requested_games" or "open_games"]
 * @param  {[string]} toList ["open_games" or "closed_games", null just drops it]
 */
async function moveUserGame(userId, gameId, fromList, toList) {
	if (userId == "CHESS_AI" || userId == "GUEST_USER" || userId == gameId) { return; } // A GUEST'S PLAYER ID IS THEIR GAME ID
	await changeUserGames(userId, (gameLists) => {
		gameLists[fromList] = gameLists[fromList].filter((listGameId) => listGameId != gameId);
		if (toList && !gameLists[toList].includes(gameId)) { gameLists[toList][gameLists[toList].length] = gameId; }
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
 * @description Creates a user row with empty game lists, unless another request already made it
 * @param  {[string]} userId [auth0 user id without "auth0|"]
 * @return {[object]} response [{ status, user_data (the new row, or the one already there), message }]
 */
async function initalizeUser(userId) {
	const params = {
		TableName: USER_TABLE,
		Item: {
			user_id: { S: userId },
			open_games: { S: JSON.stringify([]) },
			requested_games: { S: JSON.stringify([]) },
			closed_games: { S: JSON.stringify([]) },
		},
		ConditionExpression: 'attribute_not_exists(user_id)' // NEVER WIPES A ROW'S GAME LISTS (A READ CAN MISS A ROW THAT WAS JUST MADE)
	}

	try {
		await connection.putItem(params); // POST REQUEST TO DYNAMODB
	} catch (err) {
		if (err.name == "ConditionalCheckFailedException") { return await retrieveUser(userId, true); } // ALREADY THERE, USE IT
		throw err;
	}

	return {
		status: 200,
		user_data: params.Item,
		message: `user id: ${userId} initalized inside db`
	}
}

/* ---------------------------------------------------------------- */
// Retrieve user (GET)
/* ---------------------------------------------------------------- */
/**
 * @description Gets a user row by id, the game lists stay JSON strings
 * @param  {[string]} userId [auth0 user id without "auth0|"]
 * @param  {[boolean]} consistent [true = a strongly consistent read (twice the read capacity), see retrieveGame]
 * @return {[object]} response [{ status, user_data, message }]
 */
async function retrieveUser(userId, consistent) {
	const params = {
		TableName: USER_TABLE,
		Key: {
			user_id: { S: userId } // SEARCH KEY
		},
		ConsistentRead: !!consistent
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
// Retrieve ratings (GET)
/* ---------------------------------------------------------------- */
/**
 * @description Gets players' ratings, for the game menu (GET /api/chess/game/:gameId/ratings)
 * @param  {[array]} userIds [auth0 user ids without "auth0|"]
 * @return {[object]} ratings [{ userId: { rating, rated_games } }, players without a row get the starting rating]
 */
async function retrieveRatings(userIds) {
	const ids = [...new Set(userIds)];
	const params = {
		RequestItems: {
			[USER_TABLE]: {
				Keys: ids.map((userId) => ({ user_id: { S: userId } })),
				ProjectionExpression: "user_id, rating, rated_games"
			}
		}
	};
	const response = await connection.batchGetItem(params); // GET REQUEST TO DYNAMODB
	const items = response.Responses?.[USER_TABLE] || [];
	let ratings = {};
	for (let i = 0; i < ids.length; i++) { ratings[ids[i]] = readRating(items.find((item) => item.user_id.S == ids[i])); }
	return ratings;
}

/* ---------------------------------------------------------------- */
// Update user (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Saves the game lists that changed, only if none of the lists changed since they were read
 * @param  {[object]} userData [user row from retrieveUser, its game lists are the JSON strings that were read]
 * @param  {[object]} gameLists [{ requested_games, open_games, closed_games } arrays to save]
 * @return {[object]} response [{ status, user_data, message }, status 500 when another request changed the lists first]
 */
async function updateUser(userData, gameLists) {
	const userId = userData.user_id.S;
	const changed = GAME_LISTS.filter((listName) => JSON.stringify(gameLists[listName]) != userData[listName].S);
	if (changed.length == 0) { return { status: 200, user_data: userData, message: `user id: ${userId} unchanged` }; } // NOTHING TO SAVE

	const params = {
		TableName: USER_TABLE,
		Key: {
			user_id: { S: userId }
		},
		UpdateExpression: `SET ${changed.map((listName) => `${listName} = :${listName}`).join(", ")}`,
		ConditionExpression: GAME_LISTS.map((listName) => `${listName} = :old_${listName}`).join(" AND "), // EVERY LIST, AN UNCHANGED ONE CAN BE STALE TOO (A MOVE THAT DIDN'T FIND THE GAME)
		ExpressionAttributeValues: {}, // ASSOCIATED ATTRIBUTES
		ReturnValues: "ALL_NEW" // THE ROW AS SAVED, NO READ BACK
	}
	for (let i = 0; i < changed.length; i++) { params.ExpressionAttributeValues[`:${changed[i]}`] = { S: JSON.stringify(gameLists[changed[i]]) }; }
	for (let i = 0; i < GAME_LISTS.length; i++) { params.ExpressionAttributeValues[`:old_${GAME_LISTS[i]}`] = { S: userData[GAME_LISTS[i]].S }; }

	let response;
	try {
		response = await connection.updateItem(params); // PUT REQUEST TO DYANMODB
	} catch (err) {
		if (err.name == "ConditionalCheckFailedException") { return { status: 500, message: `Game lists changed before the save: ${userId}` }; }
		throw err;
	}

	return {
		status: 200,
		user_data: response.Attributes,
		message: `user id: ${userId} updated`
	}
}

/**
 * @description Changes a user's game lists without losing a change another request makes at the same time (an AI game ends
 * while an invite is accepted): when updateUser finds the lists changed since they were read, the row is read again & the change made again
 * @param  {[string]} userId [auth0 user id without "auth0|", the row is made if there isn't one]
 * @param  {[function]} change [(gameLists) => edits the { requested_games, open_games, closed_games } arrays, it can run more than once]
 * @return {[object]} response [{ status, user_data, message }]
 */
async function changeUserGames(userId, change) {
	for (let i = 0; i < LIST_SAVE_TRIES; i++) {
		let response = await retrieveUser(userId, true); // CONSISTENT: A READ THAT LAGS CAN MISS THE GAME, & A CHANGE THAT FINDS NOTHING TO MOVE SAVES NOTHING
		if (!response.user_data) { response = await initalizeUser(userId); }
		if (!response.user_data) { return response; }

		const gameLists = {};
		for (let j = 0; j < GAME_LISTS.length; j++) { gameLists[GAME_LISTS[j]] = JSON.parse(response.user_data[GAME_LISTS[j]].S); }
		change(gameLists);

		response = await updateUser(response.user_data, gameLists);
		if (response.status == 200) { return response; }
	}

	console.log(`Game list save failed after ${LIST_SAVE_TRIES} tries: ${userId}`);
	return { status: 500, message: `User attributes failed to update: ${userId}` };
}

/* ---------------------------------------------------------------- */
// Update user settings (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Saves a player's Default start settings (the settings page) on their user_db row. It's its own attribute, so the game list
 * saves never touch it. A player who hasn't played yet has no row, initalizeUser makes it first so the game lists are there too
 * @param  {[string]} userId [auth0 user id without "auth0|"]
 * @param  {[object]} settings [{ ai_level, ai_color, friend_color }, from readSettings in chessController.js]
 * @return {[object]} response [{ status, user_data (the row as saved), message }]
 */
async function updateUserSettings(userId, settings) {
	const user = await retrieveUser(userId, true);
	if (!user.user_data) { await initalizeUser(userId); }

	const params = {
		TableName: USER_TABLE,
		Key: {
			user_id: { S: userId }
		},
		UpdateExpression: 'SET settings = :settings',
		ConditionExpression: 'attribute_exists(user_id)', // NEVER MAKES A ROW WITHOUT ITS GAME LISTS
		ExpressionAttributeValues: {
			':settings': { S: JSON.stringify(settings) }
		},
		ReturnValues: "ALL_NEW"
	}
	const response = await connection.updateItem(params); // PUT REQUEST TO DYANMODB

	return {
		status: 200,
		user_data: response.Attributes,
		message: `user id: ${userId} settings saved`
	}
}

/* ---------------------------------------------------------------- */
// Claim username (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Saves a player's username (the settings page) in one transaction, so it's all or nothing: the username#<name> item is made
 * only if nobody has it, the player's row gets the name, & the name they had before is freed. "joe" -> "Joe" keeps the same item.
 * A player who hasn't played yet has no row, initalizeUser makes it first
 * @param  {[string]} userId [auth0 user id without "auth0|"]
 * @param  {[string]} username [checked by checkUsername in utils/username.js]
 * @return {[object]} response [{ status, username, message }, status 409 when another player has it]
 */
async function claimUsername(userId, username) {
	const claimKey = usernameKey(username);
	for (let i = 0; i < LIST_SAVE_TRIES; i++) {
		let user = await retrieveUser(userId, true);
		if (!user.user_data) { user = await initalizeUser(userId); }
		if (!user.user_data) { return user; }
		const oldUsername = user.user_data.username?.S || null;
		if (oldUsername == username) { return { status: 200, username, message: `user id: ${userId} username unchanged` }; }
		const sameName = oldUsername && usernameKey(oldUsername) == claimKey; // ONLY THE CAPITALS CHANGED, THE PLAYER ALREADY HOLDS IT

		const saveName = {
			Update: {
				TableName: USER_TABLE,
				Key: {
					user_id: { S: userId }
				},
				UpdateExpression: 'SET username = :username',
				ConditionExpression: oldUsername ? 'username = :old_username' : 'attribute_exists(user_id) AND attribute_not_exists(username)', // NOT RENAMED SINCE THE READ (TWO SAVES AT ONCE)
				ExpressionAttributeValues: {
					":username": { S: username }
				}
			}
		}
		if (oldUsername) { saveName.Update.ExpressionAttributeValues[":old_username"] = { S: oldUsername }; }

		const claim = sameName ? {
			Update: {
				TableName: USER_TABLE,
				Key: {
					user_id: { S: claimKey }
				},
				UpdateExpression: 'SET username = :username',
				ConditionExpression: 'owner_id = :owner_id',
				ExpressionAttributeValues: {
					":username": { S: username },
					":owner_id": { S: userId }
				}
			}
		} : {
			Put: {
				TableName: USER_TABLE,
				Item: {
					user_id: { S: claimKey },
					owner_id: { S: userId }, // WHO HOLDS IT
					username: { S: username } // AS THEY WROTE IT
				},
				ConditionExpression: 'attribute_not_exists(user_id)' // NOBODY HAS IT
			}
		}

		let transactItems = [claim, saveName];
		if (oldUsername && !sameName) {
			transactItems.push({
				Delete: { // FREES THE OLD NAME
					TableName: USER_TABLE,
					Key: {
						user_id: { S: usernameKey(oldUsername) }
					},
					ConditionExpression: 'owner_id = :owner_id',
					ExpressionAttributeValues: {
						":owner_id": { S: userId }
					}
				}
			});
		}

		try {
			await connection.transactWriteItems({ TransactItems: transactItems }); // PUT, UPDATE & DELETE REQUESTS TO DYNAMODB, ALL OR NONE
			return { status: 200, username, message: `user id: ${userId} username saved` };
		} catch (err) {
			if (err.name != "TransactionCanceledException") { throw err; }
			const reasons = (err.CancellationReasons || []).map((reason) => reason.Code);
			if (!sameName && reasons[0] == "ConditionalCheckFailed" && reasons[1] != "ConditionalCheckFailed") { return { status: 409, message: "That username is taken" }; } // THE ROW HASN'T CHANGED, SO SOMEONE ELSE HOLDS THE NAME
		} // THE ROW CHANGED SINCE THE READ, READ IT AGAIN
	}
	return { status: 500, message: `Username save failed after ${LIST_SAVE_TRIES} tries: ${userId}` };
}

/* ---------------------------------------------------------------- */
// Delete user (DELETE)
/* ---------------------------------------------------------------- */
/**
 * @description Deletes a player's user_db row, their game lists, settings & rating (Delete my data, after leaveAllGames), & frees their username.
 * The games stay in chess_db: a friend's finished games still show the result & the name, & the player's next game makes a new row
 * @param  {[string]} userId [auth0 user id without "auth0|"]
 * @return {[object]} response [{ status, message }]
 */
async function deleteUser(userId) {
	for (let i = 0; i < LIST_SAVE_TRIES; i++) {
		const user = await retrieveUser(userId, true);
		const username = user.user_data?.username?.S;
		try {
			if (!username) {
				const params = {
					TableName: USER_TABLE,
					Key: {
						user_id: { S: userId }
					},
					ConditionExpression: 'attribute_not_exists(username)' // NO NAME WAS SAVED SINCE THE READ
				}
				await connection.deleteItem(params); // DELETE REQUEST TO DYANMODB
			} else {
				const transactItems = [
					{ Delete: { TableName: USER_TABLE, Key: { user_id: { S: userId } }, ConditionExpression: 'username = :username', ExpressionAttributeValues: { ":username": { S: username } } } },
					{ Delete: { TableName: USER_TABLE, Key: { user_id: { S: usernameKey(username) } }, ConditionExpression: 'owner_id = :owner_id', ExpressionAttributeValues: { ":owner_id": { S: userId } } } } // FREES THE NAME
				];
				await connection.transactWriteItems({ TransactItems: transactItems }); // DELETE REQUESTS TO DYNAMODB, BOTH OR NEITHER
			}
			return { status: 200, message: `user id: ${userId} deleted` };
		} catch (err) {
			if (err.name != "ConditionalCheckFailedException" && err.name != "TransactionCanceledException") { throw err; }
		} // RENAMED SINCE THE READ, READ IT AGAIN
	}
	return { status: 500, message: `User delete failed after ${LIST_SAVE_TRIES} tries: ${userId}` };
}

/* ---------------------------------------------------------------- */
// Prune open games
/* ---------------------------------------------------------------- */
/**
 * @description Drops games TTL already deleted from a user's open_games & saves the shorter list. Also finds the user's
 * AI game & friend game (a player has one of each open at a time, chessController.js newGame & inviteGame)
 * @param  {[object]} userData [user item from retrieveUser]
 * @return {[object]} userData [same item, open_games.S only lists games that still exist,
 * ai_game_id / friend_game_id = the newest open AI / friend game or null, open_game_list = the open game items (newest last) for Your games]
 */
async function pruneOpenGames(userData) {
	userData.ai_game_id = null;
	userData.friend_game_id = null;

	const games = await pruneGameList(userData, "open_games");
	const openGames = games.filter((game) => (game.state?.S || "OPEN") == "OPEN"); // A FINISHED GAME LEFT IN open_games IS NEVER THE OPEN ONE
	userData.open_game_list = openGames;
	for (let i = 0; i < openGames.length; i++) { // NEWEST IS LAST IN open_games
		if (openGames[i].white_player_id?.S == "CHESS_AI" || openGames[i].black_player_id?.S == "CHESS_AI") { userData.ai_game_id = openGames[i].game_id.S; }
		else { userData.friend_game_id = openGames[i].game_id.S; }
	}
	return userData;
}

/* ---------------------------------------------------------------- */
// Prune invites
/* ---------------------------------------------------------------- */
/**
 * @description Drops invites TTL already deleted from a user's requested_games & splits the rest into sent & received
 * by inviter_id (chessController.js inviteGame, games from before inviter_id: the inviter played white)
 * @param  {[object]} userData [user item from retrieveUser]
 * @return {[object]} userData [same item, sent_invite = { game_id, name, player_id, player_color, start_params } or null (one at a time),
 * received_invites = [{ game_id, name, player_id, player_color, start_params }], name & player_id are the other player's, player_color is the user's]
 */
async function pruneInvites(userData) {
	const userId = userData.user_id.S;
	userData.sent_invite = null;
	userData.received_invites = [];

	const games = await pruneGameList(userData, "requested_games");
	for (let i = 0; i < games.length; i++) {
		if (games[i].state?.S != "PENDING") { continue; } // ACCEPTED WHILE THIS WAS LOADING
		const sent = (games[i].inviter_id?.S || games[i].white_player_id.S) == userId;
		const white = games[i].white_player_id.S == userId; // THE USER'S SIDE, THE OTHER PLAYER HAS THE OTHER ONE
		const invite = {
			game_id: games[i].game_id.S,
			name: (white ? games[i].black_name?.S : games[i].white_name?.S) || null,
			player_id: white ? games[i].black_player_id.S : games[i].white_player_id.S,
			player_color: white ? "w" : "b",
			start_params: JSON.parse(games[i].start_params?.S || '{ "color": "random" }') // "YOU PLAY BLACK (RANDOM)"
		};
		if (sent) { userData.sent_invite = invite; }
		else { userData.received_invites.push(invite); }
	}
	return userData;
}

/**
 * @description Checks every game in one of a user's lists still exists (TTL deletes expired games) & saves the shorter list
 * @param  {[object]} userData [user item from retrieveUser, userData[listName].S is updated to the pruned list]
 * @param  {[string]} listName ["open_games" or "requested_games"]
 * @return {[array]} games [the found games in list order (newest last): game_id, player ids, names, state, level & start settings]
 */
async function pruneGameList(userData, listName) {
	const gameIds = [...new Set(JSON.parse(userData[listName].S))]; // BATCH GET FAILS ON DUPLICATE KEYS
	if (gameIds.length == 0) { return []; }

	let liveGames = [];
	let foundItems = [];
	try {
		for (let i = 0; i < gameIds.length; i += 100) { // BATCH GET TAKES 100 KEYS MAX
			const batchIds = gameIds.slice(i, i + 100);
			const params = {
				RequestItems: {
					[CHESS_TABLE]: {
						Keys: batchIds.map((gameId) => ({ game_id: { S: gameId } })),
						ProjectionExpression: "game_id, white_player_id, black_player_id, white_name, black_name, #state, ai_level, start_params, inviter_id", // THE GAME EXISTS, WHO'S IN IT, WHETHER IT'S AN AI GAME & HOW IT STARTED (YOUR GAMES & INVITES)
						ExpressionAttributeNames: { "#state": "state" }
					}
				}
			};

			const response = await connection.batchGetItem(params);
			const batchItems = response.Responses?.[CHESS_TABLE] || [];
			const foundGames = batchItems.map((game) => game.game_id.S);
			const uncheckedGames = (response.UnprocessedKeys?.[CHESS_TABLE]?.Keys || []).map((key) => key.game_id.S);
			foundItems = foundItems.concat(batchItems);

			for (let j = 0; j < batchIds.length; j++) {
				if (foundGames.includes(batchIds[j]) || uncheckedGames.includes(batchIds[j])) { liveGames.push(batchIds[j]); } // UNCHECKED GAMES ARE KEPT, NEVER DROP A REAL GAME
			}
		}
	} catch (err) {
		console.log(`Game list check failed (${listName}): ${err.message}`);
		return []; // SHOW THE LIST AS IS RATHER THAN BREAKING HOME
	}

	const games = liveGames.map((gameId) => foundItems.find((game) => game.game_id.S == gameId)).filter(Boolean); // BATCH GET ISN'T IN ORDER
	if (liveGames.length == gameIds.length) { return games; } // NOTHING EXPIRED

	const prunedGames = JSON.stringify(liveGames);
	const params = {
		TableName: USER_TABLE,
		Key: {
			user_id: { S: userData.user_id.S }
		},
		UpdateExpression: `SET ${listName} = :game_list`,
		ConditionExpression: `${listName} = :old_game_list`, // SKIPS THE SAVE IF A GAME WAS ADDED MEANWHILE, NEXT LOAD PRUNES AGAIN
		ExpressionAttributeValues: {
			":game_list": { S: prunedGames },
			":old_game_list": { S: userData[listName].S }
		}
	}

	try {
		await connection.updateItem(params); // PUT REQUEST TO DYANMODB
	} catch (err) {
		if (err.name != "ConditionalCheckFailedException") { console.log(`Game list save failed (${listName}): ${err.message}`); }
	}

	userData[listName].S = prunedGames;
	return games;
}


module.exports = { initalizeGame, retrieveGame, updateGame, closeGame, rateGame, retrieveRatings, acceptInvite, deleteInvite, requestRematch, acceptRematch, initalizeUser, retrieveUser, updateUser, updateUserSettings, claimUsername, deleteUser, pruneOpenGames, pruneInvites }
