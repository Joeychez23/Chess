/*
 *  dynamoDB.js  --  data service
 *	Chess Move Engine
 *  DynamoDB Controller Functions (was chess-validation/lambdas/functions/chess/dynamoDB/database-controller.js)
 *  Moved from server/dynamoDB.js (#247, the server's copy went in #249). Only the data service's routes call these
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const crypto = require("crypto");
const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { Chess } = require("chess.js");
const { startPieces } = require("./utils/validate.js");
const { newRating, scoreFor, isRated, readRating } = require("./utils/rating.js");
const { usernameKey } = require("./utils/username.js");
const { newGameId } = require("./utils/games.js");
const config = require("./config");

const connection = new DynamoDB({ region: config.dynamoRegion }); // DYNAMODB_REGION, us-west-2 BY DEFAULT. CREDENTIALS COME FROM ~/.aws LOCALLY, OR THE DATA SERVICE'S IAM ROLE ON AWS

const CHESS_TABLE = "chess_db"; // KEY: game_id (S), NAMES MATCH terraform/aws-enviroment/locals.tf
const USER_TABLE = "user_db"; // KEY: user_id (S), PLAYERS' ROWS & THE username#<name> ITEMS THAT HOLD EACH USERNAME (claimUsername)

const GAME_TTL = 60 * 60 * 24 * 25; // GAMES EXPIRE 25 DAYS AFTER THE LAST MOVE (SECONDS)

const GAME_LISTS = ["requested_games", "open_games", "closed_games"]; // A user_db ROW'S GAME LISTS (JSON STRINGS)
const LIST_SAVE_TRIES = 5; // A GAME LIST SAVE THAT LOST A RACE READS THE ROW AGAIN & RETRIES
const BATCH_READ_TRIES = 5; // A THROTTLED BATCH GET (UnprocessedKeys) ASKS AGAIN FOR THE KEYS IT DIDN'T READ
const BATCH_READ_DELAY = 50; // MS BEFORE THE FIRST RETRY, DOUBLED EACH TRY

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
// Check Tables
/* ---------------------------------------------------------------- */
/**
 * @description Reads a key that's never saved from each table (GET /health/tables), the cheapest call this role is allowed. Throws when DynamoDB can't answer (#194)
 */
async function checkTables() {
	await Promise.all([
		connection.getItem({ TableName: CHESS_TABLE, Key: { game_id: { S: "health-check" } } }),
		connection.getItem({ TableName: USER_TABLE, Key: { user_id: { S: "health-check" } } })
	]);
}

/* ---------------------------------------------------------------- */
// Initalize game (POST)
/* ---------------------------------------------------------------- */
/**
 * @description Creates a new game only if its game_id is free, or a guest's reset: overwrites their own game with a new board (restart).
 * Both are conditional writes, so two creates of one id at once can't both save: the one that lost answers 409 & touches no game list
 * @param  {[string]} existingGameId [game id to use, false to generate one]
 * @param  {[string]} playerId1 [white player id]
 * @param  {[string]} playerId2 [black player id]
 * @param  {[number]} aiLevel [AI games: the AI's level, saved with the game so it can't change mid game]
 * @param  {[object]} options [{ names: friend games' { w, b } names (usernames, or Auth0 screennames) for Home's caption,
 * pending: friend invites, the game is PENDING & waits in requested_games until it's accepted (acceptInvite),
 * start_params: the start settings ({ color, fen }, Restart & Rematch reuse them, left out = Random from the standard position. fen = a set position, checked by checkStartFen),
 * inviter_id: friend games, the player who sent the invite (their pick is start_params.color),
 * reset_player: a guest's reset, their player id: the stored game is replaced only while it's still theirs (or it expired) }]
 * @return {[object]} response [{ status, game_data, message } | { status: 409, message: "Game id already in use" }]
 */
async function initalizeGame(existingGameId, playerId1, playerId2, aiLevel, options) {
	const { names, pending, start_params, inviter_id, reset_player } = options || {};
	const board = start_params?.fen || new Chess().fen(); // A SET POSITION (THE START POSITION BOX) OR THE STANDARD ONE
	const pieces = startPieces(board); // EVERY KNIGHT, KING, QUEEN, BISHOP & ROOK ON THE BOARD, NONE HAVE MOVED

	let gameId;
	if (existingGameId) { gameId = existingGameId; }
	else { gameId = newGameId(); } // CREATES UNIQUE GAME IDENTIFIER (RANDOM, NOT GUESSABLE)
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

	if (reset_player) { // A GUEST'S RESET: STILL THEIR GAME, ANOTHER CREATE OF THIS ID MAY HAVE SAVED SINCE THE READ
		params.ConditionExpression = 'attribute_not_exists(game_id) OR white_player_id = :reset_player OR black_player_id = :reset_player';
		params.ExpressionAttributeValues = { ":reset_player": { S: reset_player } };
	}
	else { params.ConditionExpression = 'attribute_not_exists(game_id)'; } // A NEW GAME NEVER REPLACES ONE (TWO CREATES OF ONE ID AT ONCE)

	try {
		await connection.putItem(params); // POST REQUEST FOR GAME CREATION TO DYNAMODB
	} catch (err) {
		if (err.name == "ConditionalCheckFailedException") { return { status: 409, message: "Game id already in use" }; } // LOST THE RACE, THE OTHER GAME STAYS
		throw err;
	}

	async function handleUser(userId) { // ADDS THE GAME TO A PLAYER'S GAME LIST (OPEN, OR REQUESTED FOR AN INVITE)
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
 * @description Saves a validated move, only on a game that's still open (a forfeit can land after the move's read). A move that ends the game saves its result in the same write, so the board & the result land together or
 * not at all (run finishClosedGame after it). Finished friend games are kept forever (expireAt is removed)
 * @param  {[object]} gameData [Validated server data, modified by a successful client request]
 * @param  {[string]} prevBoard [board the move was made on, the save fails if the board changed since (two requests at once)]
 * @param  {[object]} result [gameResult's { winner, reason } when the move ends the game]
 * @return {[object]} response [{ status, game_data (the game as saved), message }]
 */
async function updateGame(gameData, prevBoard, result) {
	const keepForever = result && gameData.white_player_id.S != "CHESS_AI" && gameData.black_player_id.S != "CHESS_AI"; // DYNAMODB REFUSES A SET & REMOVE OF expireAt IN ONE WRITE
	const params = {
		TableName: CHESS_TABLE,
		Key: {
			game_id: { S: gameData.game_id.S }
		},
		UpdateExpression: `SET moves = :moves, prev_move = :prev_move, game_board = :game_board, w_knight = :w_knight, b_knight = :b_knight, w_piece = :w_piece, b_piece = :b_piece${keepForever ? "" : ", expireAt = :expireAt"}${result ? ", #state = :closed, #winner = :winner, #reason = :reason" : ""}${keepForever ? " REMOVE expireAt" : ""}`, // WHAT IS BEING UPDATED, AND ASSOCIATED ATTRIBUTES TO WHAT THE DATA WILL BE
		ConditionExpression: '(attribute_not_exists(#state) OR #state = :open)', // GAMES FROM BEFORE state ARE OPEN
		ExpressionAttributeNames: { "#state": "state" }, // "state" IS A DYNAMODB RESERVED WORD
		ExpressionAttributeValues: { // ASSOCIATED ATTRIBUTES
			":open": { S: "OPEN" },
			":moves": { S: JSON.stringify(gameData.moves.S) }, // UPDATED MOVE ARRAY
			":prev_move": { S: JSON.stringify(gameData.prev_move.S) },
			":game_board": { S: gameData.game_board.S }, // UPDATED GAME FEN
			":w_knight": { S: gameData.w_knight.S }, // UPDATED WHITE KNIGHTS
			":b_knight": { S: gameData.b_knight.S }, // UPDATED BLACK KNIGHTS
			":w_piece": { S: gameData.w_piece.S }, // UPDATED WHITE KINGS, QUEENS, BISHOPS & ROOKS
			":b_piece": { S: gameData.b_piece.S } // UPDATED BLACK KINGS, QUEENS, BISHOPS & ROOKS
		},
		ReturnValues: "ALL_NEW" // THE GAME AS SAVED, NO READ BACK (AN EVENTUALLY CONSISTENT READ CAN RETURN THE OLD BOARD)
	}
	if (prevBoard) {
		params.ConditionExpression = `game_board = :prev_board AND ${params.ConditionExpression}`; // ONLY ONE MOVE PER BOARD
		params.ExpressionAttributeValues[":prev_board"] = { S: prevBoard };
	}
	if (!keepForever) { params.ExpressionAttributeValues[":expireAt"] = { N: expireTime() }; } // ACTIVE GAMES NEVER EXPIRE, ONLY ABANDONED ONES
	if (result) {
		Object.assign(params.ExpressionAttributeNames, { "#winner": "winner", "#reason": "reason" });
		Object.assign(params.ExpressionAttributeValues, { ":closed": { S: "CLOSED" }, ":winner": { S: result.winner }, ":reason": { S: result.reason } });
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
 * @description Ends a game without a move (a forfeit): saves the result, then finishClosedGame. A move that ends the game saves its result in updateGame.
 * Finished friend games are kept forever (expireAt is removed), AI games still expire 25 days after the last move
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

	await finishClosedGame(gameData, winner);

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
 * @description The work after the write that closed a game: moves it from open_games to closed_games for both players, then rates it (rateGame,
 * friend games once both sides moved) & adds ratings to gameData. Only the write that closed the game may call this, so a game is rated once
 * @param  {[object]} gameData [the closed game item]
 * @param  {[string]} winner ["w", "b" or "draw"]
 * @throws a failed list save, after the rating: the game is closed either way & pruneOpenGames ignores it in open_games
 */
async function finishClosedGame(gameData, winner) {
	const gameId = gameData.game_id.S;
	const listError = await movePlayersGame(gameData, gameId, "open_games", "closed_games");

	if (isRated(gameData)) {
		try {
			gameData.ratings = { S: JSON.stringify(await rateGame(gameData, winner)) };
		} catch (err) {
			console.log(`RATING FAILED ${gameId}: ${err.message}`); // THE GAME STILL CLOSES, BUT THE RATING IS LOST & NEEDS A LOOK. KEEP THE START: rating.test.js PINS IT TO ALARM ON
		}
	}

	if (listError) { throw listError; }
}

/* ---------------------------------------------------------------- */
// Rate game (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Changes both players' ratings after a finished game (utils/rating.js) & saves what changed on the game, where it stays:
 * rated friend games are never deleted, so a player's closed_games are their rating history (profiles, #81). All three writes land together or none do.
 * Two of a player's games can end at once, so each save needs rated_games to still be what was read, otherwise the rows are read again & the ratings worked out again
 * @param  {[object]} gameData [the closed game item]
 * @param  {[string]} winner ["w", "b" or "draw"]
 * @return {[object]} ratings [{ w: { before, after }, b: { before, after }, at (epoch ms) }, null for a player without a row. A game already rated keeps & returns its ratings]
 * @throws when the save still fails after LIST_SAVE_TRIES: neither rating changed
 */
async function rateGame(gameData, winner) {
	const gameId = gameData.game_id.S;
	const players = { w: gameData.white_player_id.S, b: gameData.black_player_id.S };
	let preGame; // EACH SIDE IS RATED AGAINST THE OTHER'S RATING FROM BEFORE THE GAME, SO A RETRY ONLY UPDATES THEIR OWN

	for (let i = 0; i < LIST_SAVE_TRIES; i++) {
		const users = {};
		for (const color of ["w", "b"]) { users[color] = (await retrieveUser(players[color], true)).user_data; }
		preGame ||= { w: readRating(users.w), b: readRating(users.b) };

		const ratings = { at: Date.now() };
		const transactItems = [];
		for (const color of ["w", "b"]) {
			if (!users[color]) { ratings[color] = null; continue; } // THEY DELETED THEIR DATA, AN UPDATE WOULD MAKE THE ROW AGAIN
			const rating = readRating(users[color]);
			const after = newRating(rating, preGame[color == "w" ? "b" : "w"], scoreFor(winner, color));
			ratings[color] = { before: rating.rating, after };

			const update = {
				TableName: USER_TABLE,
				Key: {
					user_id: { S: players[color] }
				},
				UpdateExpression: 'SET rating = :rating, rated_games = :rated_games',
				ConditionExpression: users[color].rated_games ? 'rated_games = :old_rated_games' : 'attribute_exists(user_id) AND attribute_not_exists(rated_games)', // THEIR FIRST RATED GAME, OR NO OTHER GAME WAS RATED SINCE THE READ
				ExpressionAttributeValues: {
					":rating": { N: `${after}` },
					":rated_games": { N: `${rating.rated_games + 1}` }
				}
			}
			if (users[color].rated_games) { update.ExpressionAttributeValues[":old_rated_games"] = { N: users[color].rated_games.N }; }
			transactItems.push({ Update: update });
		}
		transactItems.push({
			Update: {
				TableName: CHESS_TABLE,
				Key: {
					game_id: { S: gameId }
				},
				UpdateExpression: 'SET ratings = :ratings',
				ConditionExpression: 'attribute_not_exists(ratings)', // A GAME IS NEVER RATED TWICE
				ExpressionAttributeValues: {
					":ratings": { S: JSON.stringify(ratings) }
				}
			}
		});

		try {
			await connection.transactWriteItems({ TransactItems: transactItems }); // UPDATE REQUESTS TO DYNAMODB, ALL OR NONE
			return ratings;
		} catch (err) {
			if (err.name != "TransactionCanceledException") { throw err; }
			if (err.CancellationReasons?.at(-1)?.Code == "ConditionalCheckFailed") { return JSON.parse((await retrieveGame(gameId, true)).game_data.ratings.S); } // ALREADY RATED, RETRYING CAN'T HELP
		}
	}
	throw new Error(`Rating save failed after ${LIST_SAVE_TRIES} tries: ${gameId}`);
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

	const listError = await movePlayersGame(gameData, gameId, "requested_games", "open_games");
	if (listError) { throw listError; }

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

	const listError = await movePlayersGame(gameData, gameId, "requested_games", null);
	if (listError) { throw listError; }

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
 * @throws when the lists couldn't be saved (changeUserGames' 500 after LIST_SAVE_TRIES), so the route never answers 200 with stale lists
 */
async function moveUserGame(userId, gameId, fromList, toList) {
	if (userId == "CHESS_AI" || userId == "GUEST_USER" || userId == gameId) { return; } // A GUEST'S PLAYER ID IS THEIR GAME ID
	const response = await changeUserGames(userId, (gameLists) => {
		gameLists[fromList] = gameLists[fromList].filter((listGameId) => listGameId != gameId);
		if (toList && !gameLists[toList].includes(gameId)) { gameLists[toList][gameLists[toList].length] = gameId; }
	});
	if (response.status != 200) { throw new Error(response.message); }
}

/**
 * @description moveUserGame for both players. Both are tried even when the first fails, so one player's failed save doesn't leave the other's stale too
 * @param  {[object]} gameData [game item]
 * @param  {[string]} gameId [game id]
 * @param  {[string]} fromList [moveUserGame's fromList]
 * @param  {[string]} toList [moveUserGame's toList]
 * @return {[object]} error [the first failed save's error, for the caller to throw, null when both saved]
 */
async function movePlayersGame(gameData, gameId, fromList, toList) {
	const results = await Promise.allSettled([gameData.white_player_id.S, gameData.black_player_id.S].map((userId) => moveUserGame(userId, gameId, fromList, toList)));
	return results.find((result) => result.status == "rejected")?.reason || null;
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
		if (err.name == "ConditionalCheckFailedException" || err.name == "TransactionConflictException") { return { status: 500, message: `Game lists changed before the save: ${userId}` }; } // A CONFLICT: A RATING OR USERNAME TRANSACTION IS ON THIS ROW RIGHT NOW, THE SDK DOESN'T RETRY IT
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
 * saves never touch it. A player without a row (Delete my data since their last login) gets one from initalizeUser first, so the game lists are there too
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
 * A player without a row (Delete my data since their last login) gets one from initalizeUser first
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
 * The games stay in chess_db: a friend's finished games still show the result & the name, & their next login makes a new row
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
// Start session (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description The session id (sid) on a player's row, made at their first login. Every device they log in on shares it, & every refresh
 * token carries it, so clearing it (endSession, Delete my data) signs them out everywhere. A player's row is made here, at their first login
 * @param  {[string]} userId [auth0 user id without "auth0|"]
 * @return {[object]} response [{ status, sid, message }]
 */
async function startSession(userId) {
	const user = await initalizeUser(userId);
	if (user.user_data?.sid?.S) { return { status: 200, sid: user.user_data.sid.S, message: `user id: ${userId} session found` }; }

	const sid = crypto.randomBytes(16).toString("base64url");
	const params = {
		TableName: USER_TABLE,
		Key: {
			user_id: { S: userId }
		},
		UpdateExpression: 'SET sid = :sid',
		ConditionExpression: 'attribute_exists(user_id) AND attribute_not_exists(sid)', // NEVER MAKES A ROW WITHOUT ITS GAME LISTS, OR REPLACES ANOTHER LOGIN'S sid
		ExpressionAttributeValues: {
			':sid': { S: sid }
		}
	}

	try {
		await connection.updateItem(params); // PUT REQUEST TO DYANMODB
	} catch (err) {
		if (err.name != "ConditionalCheckFailedException") { throw err; }
		const again = await retrieveUser(userId, true); // ANOTHER LOGIN SET IT FIRST, USE THAT ONE
		if (!again.user_data?.sid?.S) { throw err; } // THE ROW WAS DELETED (Delete my data) IN BETWEEN
		return { status: 200, sid: again.user_data.sid.S, message: `user id: ${userId} session found` };
	}
	return { status: 200, sid, message: `user id: ${userId} session started` };
}

/* ---------------------------------------------------------------- */
// End session (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Clears a player's session id (logout), so every device's refresh token stops working. Only the session the request
 * belongs to is ended: an old refresh token from before the last logout doesn't end the session they logged in to since
 * @param  {[string]} userId [auth0 user id without "auth0|"]
 * @param  {[string]} sid [the session id in the refresh token]
 * @return {[object]} response [{ status, message }, status 200 either way]
 */
async function endSession(userId, sid) {
	const params = {
		TableName: USER_TABLE,
		Key: {
			user_id: { S: userId }
		},
		UpdateExpression: 'REMOVE sid',
		ConditionExpression: 'sid = :sid', // STILL THIS SESSION (& THE ROW IS STILL THERE)
		ExpressionAttributeValues: {
			':sid': { S: sid }
		}
	}

	try {
		await connection.updateItem(params); // PUT REQUEST TO DYANMODB
	} catch (err) {
		if (err.name == "ConditionalCheckFailedException") { return { status: 200, message: `user id: ${userId} session already ended` }; }
		throw err;
	}
	return { status: 200, message: `user id: ${userId} session ended` };
}

/* ---------------------------------------------------------------- */
// Prune open games
/* ---------------------------------------------------------------- */
/**
 * @description Drops games TTL already deleted (or that the user isn't in) from a user's open_games & saves the shorter list. Also finds the user's
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
 * @description Checks every game in one of a user's lists still exists (TTL deletes expired games) & has the user in it, & saves the shorter list
 * @param  {[object]} userData [user item from retrieveUser, userData[listName].S is updated to the pruned list]
 * @param  {[string]} listName ["open_games" or "requested_games"]
 * @return {[array]} games [the found games in list order (newest last): game_id, player ids, names, state, level & start settings]
 * @throws when the games can't all be read (batchReadGames), a missed game would look expired
 */
async function pruneGameList(userData, listName) {
	const gameIds = [...new Set(JSON.parse(userData[listName].S))]; // BATCH GET FAILS ON DUPLICATE KEYS
	if (gameIds.length == 0) { return []; }

	let foundItems = [];
	for (let i = 0; i < gameIds.length; i += 100) { // BATCH GET TAKES 100 KEYS MAX
		foundItems = foundItems.concat(await batchReadGames(gameIds.slice(i, i + 100), listName));
	}

	const userId = userData.user_id.S;
	const theirs = (game) => game.white_player_id?.S == userId || game.black_player_id?.S == userId; // A GAME THAT WAS REPLACED UNDER THEIR LIST ISN'T THEIRS
	const liveGames = gameIds.filter((gameId) => foundItems.some((game) => game.game_id.S == gameId && theirs(game))); // EVERY KEY WAS READ, A GAME THAT WASN'T FOUND EXPIRED
	const games = liveGames.map((gameId) => foundItems.find((game) => game.game_id.S == gameId)); // BATCH GET ISN'T IN ORDER
	if (liveGames.length == gameIds.length) { return games; } // NOTHING EXPIRED OR REPLACED

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

/**
 * @description Reads up to 100 games in one batch get. Keys DynamoDB didn't read (UnprocessedKeys, when it's throttled) are asked for again
 * with backoff, so a game is never missed: a game left out would let a check that it's open pass (Delete my data, one friend game at a time)
 * @param  {[array]} gameIds [game ids, no duplicates]
 * @param  {[string]} listName [the list they're from, for the error]
 * @return {[array]} games [the games that exist, in any order]
 * @throws when some keys are still unread after BATCH_READ_TRIES, or the batch get fails (the route answers 500, the chess server 503)
 */
async function batchReadGames(gameIds, listName) {
	let keys = gameIds.map((gameId) => ({ game_id: { S: gameId } }));
	let games = [];
	for (let i = 0; i < BATCH_READ_TRIES; i++) {
		if (i > 0) { await new Promise((resolve) => setTimeout(resolve, BATCH_READ_DELAY * 2 ** (i - 1))); }
		const params = {
			RequestItems: {
				[CHESS_TABLE]: {
					Keys: keys,
					ProjectionExpression: "game_id, white_player_id, black_player_id, white_name, black_name, #state, ai_level, start_params, inviter_id", // THE GAME EXISTS, WHO'S IN IT, WHETHER IT'S AN AI GAME & HOW IT STARTED (YOUR GAMES & INVITES)
					ExpressionAttributeNames: { "#state": "state" }
				}
			}
		};

		const response = await connection.batchGetItem(params); // GET REQUEST TO DYNAMODB
		games = games.concat(response.Responses?.[CHESS_TABLE] || []);
		keys = response.UnprocessedKeys?.[CHESS_TABLE]?.Keys || [];
		if (keys.length == 0) { return games; }
	}

	console.log(`Game list check throttled (${listName}): ${keys.length} games unread after ${BATCH_READ_TRIES} tries`);
	throw new Error(`Game list check throttled (${listName})`);
}


module.exports = { checkTables, initalizeGame, retrieveGame, updateGame, closeGame, finishClosedGame, rateGame, retrieveRatings, acceptInvite, deleteInvite, requestRematch, acceptRematch, initalizeUser, retrieveUser, updateUser, updateUserSettings, claimUsername, deleteUser, startSession, endSession, pruneOpenGames, pruneInvites }
