/*
 *  db.games.js  --  data service
 *	Chess Move Engine
 *  Games in chess_db: create, read, save a move, an opening or a card game's state, close, and rate
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { Chess } = require("chess.js");
const { startPieces } = require("../utils/validate.js");
const { newRating, scoreFor, isRated, readRating } = require("../utils/rating.js");
const { newGameId, moveDeadline, overdue, timeoutWinner, OPEN_SEAT } = require("../utils/games.js");
const dbClient = require("./db.client.js");
const dbInvites = require("./db.invites.js");
const dbUsers = require("./db.users.js");

// A draw offer: who offered, and which colors used their offer this move. A takeback request: who asked.
// A move, a card game save or the game closing removes them
const OFFER_ATTRIBUTES = ["draw_offer_player_id", "draw_offered_w", "draw_offered_b", "takeback_player_id"];

/* ---------------------------------------------------------------- */
// Initialize game (POST)
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
 * start_params: the start settings ({ color, fen }, Restart & Rematch reuse them, left out = Random from the standard position.
 * fen = a set position, checked by checkStartFen),
 * inviter_id: friend games, the player who sent the invite (their pick is start_params.color),
 * challenge: a challenge link's game, the other player is OPEN_SEAT until someone takes it (takeOpenSeat). It stays on the game,
 * so a link opened later can say it's taken,
 * reset_player: a guest's reset, their player id: the stored game is replaced only while it's still theirs (or it expired),
 * cards: a Chess Cards game, { state (the engine's state as a JSON string, never read here), fen (its board, game_board mirrors it) },
 * starts at cards_version 1 }]
 * @return {[object]} response [{ status, game_data, message } | { status: 409, message: "Game id already in use" }]
 * @throws when a player's game list couldn't be saved, so a game is only reported as created once it's on both lists
 * (the route answers 500, the chess server 503)
 */
async function initializeGame(existingGameId, playerId1, playerId2, aiLevel, options) {
	const { pending, reset_player } = options || {};
	const gameId = existingGameId || newGameId(); // A new id is random, so it can't be guessed
	let params = {
		TableName: dbClient.CHESS_TABLE,
		Item: newGameItem(gameId, playerId1, playerId2, aiLevel, options)
	};

	if (reset_player) { // A guest's reset: only while it's still their game, another create of this id may have saved since the read
		params.ConditionExpression = 'attribute_not_exists(game_id) OR white_player_id = :reset_player OR black_player_id = :reset_player';
		params.ExpressionAttributeValues = { ":reset_player": { S: reset_player } };
	}
	else { params.ConditionExpression = 'attribute_not_exists(game_id)'; } // A new game never replaces one (two creates of one id at once)

	try {
		await dbClient.connection.putItem(params);
	} catch (err) {
		// Lost the race, the other game stays
		if (err.name == "ConditionalCheckFailedException") { return { status: 409, message: "Game id already in use" }; }
		throw err;
	}

	// Both are tried, so one player's failed save doesn't leave the other's list stale too
	const results = await Promise.allSettled([addToGameList(playerId1, gameId, pending), addToGameList(playerId2, gameId, pending)]);
	const failed = results.find((result) => result.status == "rejected");
	if (failed) {
		// A retry makes a new invite, and one left only on the invited player's list would show them two.
		// pruneGameList drops any entry this can't remove
		if (pending) {
			await dbInvites.deleteInvite(params.Item).catch((err) => console.log(`Failed invite not deleted: ${gameId}: ${err.message}`));
		}
		throw failed.reason;
	}

	// putItem throws if it failed, so the game is saved as written (a read back could still miss it)
	return {
		status: 200,
		game_data: gameItem(params.Item),
		message: "Initalized game successfully"
	}
}

/**
 * @description The chess_db item for a new game, before it's saved
 * @param  {[string]} gameId [the game's id]
 * @param  {[string]} playerId1 [white player id]
 * @param  {[string]} playerId2 [black player id]
 * @param  {[number]} aiLevel [the AI's level, false for a friend game]
 * @param  {[object]} options [initializeGame's options]
 * @return {[object]} item [the item as DynamoDB stores it]
 */
function newGameItem(gameId, playerId1, playerId2, aiLevel, options) {
	const { names, pending, start_params, inviter_id, challenge, cards } = options || {};
	// The card engine's board, a set position (the start position box) or the standard one
	const board = cards?.fen || start_params?.fen || new Chess().fen();
	const pieces = startPieces(board); // Every knight, king, queen, bishop and rook on the board, none have moved

	const item = {
		game_id: { S: gameId },
		state: { S: pending ? "PENDING" : "OPEN" },
		game_board: { S: board },
		moves: { S: JSON.stringify([]) },
		prev_move: { S: JSON.stringify([]) },
		w_knight: { S: JSON.stringify(pieces.w_knight) }, // Standard: b1 and g1
		b_knight: { S: JSON.stringify(pieces.b_knight) },
		w_piece: { S: JSON.stringify(pieces.w_piece) }, // Kings, queens, bishops and rooks (which way they face). Standard: a1, c1, d1, e1, f1 and h1
		b_piece: { S: JSON.stringify(pieces.b_piece) },
		white_player_id: { S: playerId1 },
		black_player_id: { S: playerId2 },
		start_params: { S: JSON.stringify(start_params || { color: "random" }) }, // AI games: the player's pick. Friend games: the inviter's
		created_at: { S: new Date().toISOString() }, // The PGN's Date header, older games don't have one
		expireAt: { N: dbClient.expireTime() } // TTL, pushed back on every move in updateGame
	};
	if (aiLevel) { item.ai_level = { N: String(aiLevel) }; } // Friend games have no level
	if (names?.w) { item.white_name = { S: names.w }; } // Friend games: "vs Bob" on Home
	if (names?.b) { item.black_name = { S: names.b }; }
	if (inviter_id) { item.inviter_id = { S: inviter_id }; } // Friend games: sent or received, and whose color start_params holds (kept on a rematch)
	if (challenge) { item.challenge = { BOOL: true }; }
	if (cards) { // saveCardsState bumps the version on every save
		Object.assign(item, { mode: { S: "cards" }, cards_state: { S: cards.state }, cards_version: { N: "1" } });
	}

	const deadline = pending ? null : moveDeadline(item); // A rematch starts right away, an invite's clock starts when it's accepted
	if (deadline) { item.move_deadline = { N: deadline }; }
	return item;
}

/**
 * @description Adds a new game to a player's game list: open_games, or requested_games for an invite until it's accepted
 * @param  {[string]} userId [a player id]
 * @param  {[string]} gameId [the new game's id]
 * @param  {[boolean]} pending [true for an invite]
 * @throws when the list couldn't be saved
 */
async function addToGameList(userId, gameId, pending) {
	// Guests and an open seat have no game list, skip them like the AI (a guest's player id is their game id)
	if (userId == "CHESS_AI" || userId == "GUEST_USER" || userId == OPEN_SEAT || userId == gameId) { return; }

	const response = await dbUsers.changeUserGames(userId, function addGame(gameLists) {
		let gameList = pending ? gameLists.requested_games : gameLists.open_games;
		if (!gameList.includes(gameId)) { gameList[gameList.length] = gameId; } // Added once, a restart keeps the same game_id
	});
	if (response.status != 200) { throw new Error(response.message); }
}

/* ---------------------------------------------------------------- */
// Retrieve game (GET)
/* ---------------------------------------------------------------- */
/**
 * @description Gets a game by id, moves & prev_move come back parsed into arrays.
 * A game whose player to move ran out of time is closed first (closeOverdueGame)
 * @param  {[string]} gameId [game id from the client]
 * @param  {[boolean]} consistent [true = a strongly consistent read that sees every finished save (twice the read capacity),
 * for reading what another request just saved. Left out, a read can briefly return the game from before the last save]
 * @return {[object]} response [{ status, game_data, message }, timed_out: true when this read closed the game]
 */
async function retrieveGame(gameId, consistent) {
	const params = {
		TableName: dbClient.CHESS_TABLE,
		Key: {
			game_id: { S: gameId }
		},
		ConsistentRead: !!consistent
	}

	let response = await dbClient.connection.getItem(params);

	if (response.Item) {
		const gameData = gameItem(response.Item);
		if (overdue(gameData)) { return closeOverdueGame(gameData); }
		return {
			status: 200,
			game_data: gameData,
			message: `Retrieved game id: ${response.Item.game_id.S}`
		}
	} else {
		return {
			status: 404,
			message: "Game data not found"
		}
	}
}

/**
 * @description Closes a game on time. A move that saved since this read keeps the game going: closeGame only saves on the deadline that was read
 * @param  {[object]} gameData [overdue game item, it may be from before the last save]
 * @return {[object]} response [{ status, game_data, message, timed_out: true } when this closed it, otherwise the game as it is now]
 */
async function closeOverdueGame(gameData) {
	const gameId = gameData.game_id.S;
	try {
		const closed = await closeGame(gameData, timeoutWinner(gameData), "timeout");
		if (closed.status == 200) { return { ...closed, timed_out: true }; }
	} catch (err) {
		console.log(`Finishing timed out game failed: ${gameId}: ${err.message}`); // The result is saved, the read still answers
	}
	return retrieveGame(gameId, true);
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
 * @description Saves a validated move, only on a game that's still open (a forfeit can land after the move's read). A move that ends the game
 * saves its result in the same write, so the board & the result land together or not at all (run finishClosedGame after it).
 * Signed-in players' finished games are kept forever (expireAt is removed, keepsFinished).
 * Any move ends a draw offer & a takeback request, & gives both players their draw offer back (OFFER_ATTRIBUTES)
 * @param  {[object]} gameData [Validated server data, modified by a successful client request]
 * @param  {[string]} prevBoard [board the move was made on, the save fails if the board changed since (two requests at once)]
 * @param  {[object]} result [gameResult's { winner, reason } when the move ends the game]
 * @param  {[boolean]} clearOpening [true for an undo: the saved opening may be from a position that's gone,
 * the chess server saves the right one after]
 * @param  {[string]} takebackBy [an accepted friend game takeback: the player who asked, their request has to be standing.
 * It's counted & they can ask again from the earlier move]
 * @return {[object]} response [{ status, game_data (the game as saved), message }]
 */
async function updateGame(gameData, prevBoard, result, clearOpening, takebackBy) {
	const keepForever = result && keepsFinished(gameData); // DynamoDB refuses a SET and a REMOVE of expireAt in one write
	const deadline = result ? null : moveDeadline(gameData); // Every save is a new turn, the next player gets the game's full time
	const params = {
		TableName: dbClient.CHESS_TABLE,
		Key: {
			game_id: { S: gameData.game_id.S }
		},
		UpdateExpression: `SET moves = :moves, prev_move = :prev_move, game_board = :game_board, w_knight = :w_knight, b_knight = :b_knight, w_piece = :w_piece, b_piece = :b_piece${keepForever ? "" : ", expireAt = :expireAt"}${result ? ", #state = :closed, #winner = :winner, #reason = :reason" : ""}${takebackBy ? ", takeback_count = :takeback_count" : ""}${deadline ? ", move_deadline = :move_deadline" : ""} REMOVE ${OFFER_ATTRIBUTES.join(", ")}${takebackBy ? ", takeback_move" : ""}${clearOpening ? ", opening" : ""}${keepForever ? ", expireAt" : ""}`,
		ConditionExpression: '(attribute_not_exists(#state) OR #state = :open)', // Games from before state are open
		ExpressionAttributeNames: { "#state": "state" }, // "state" is a DynamoDB reserved word
		ExpressionAttributeValues: {
			":open": { S: "OPEN" },
			":moves": { S: JSON.stringify(gameData.moves.S) },
			":prev_move": { S: JSON.stringify(gameData.prev_move.S) },
			":game_board": { S: gameData.game_board.S }, // The board's FEN
			":w_knight": { S: gameData.w_knight.S },
			":b_knight": { S: gameData.b_knight.S },
			":w_piece": { S: gameData.w_piece.S }, // White's kings, queens, bishops and rooks
			":b_piece": { S: gameData.b_piece.S }
		},
		ReturnValues: "ALL_NEW" // The game as saved, no read back (an eventually consistent read can return the old board)
	}
	if (prevBoard) {
		params.ConditionExpression = `game_board = :prev_board AND ${params.ConditionExpression}`; // Only one move per board
		params.ExpressionAttributeValues[":prev_board"] = { S: prevBoard };
	}
	if (deadline) { params.ExpressionAttributeValues[":move_deadline"] = { N: deadline }; }
	if (takebackBy) {
		params.ConditionExpression = `takeback_player_id = :takeback_by AND ${params.ConditionExpression}`;
		Object.assign(params.ExpressionAttributeValues, {
			":takeback_by": { S: takebackBy },
			":takeback_count": { N: `${Number(gameData.takeback_count?.N || 0) + 1}` }
		});
	}
	addSaveEnding(params, keepForever, result);

	const saved = await dbClient.updateOrConflict(params, `Board changed before the move saved: ${gameData.game_id.S}`);
	if (saved.status != 200) { return saved; }

	return {
		status: 200,
		game_data: gameItem(saved.response.Attributes),
		message: `Updated game attributes: ${gameData.game_id.S}`
	}
}

/**
 * @description Whether a game is kept once it's finished, for Finished games on Home.
 * Only a guest's AI game isn't: they have no game list to find it in
 * @param  {[object]} gameData [game item]
 * @return {[boolean]} keep [false for a guest's game, their player id is the game id ("GUEST_USER" on older games)]
 */
function keepsFinished(gameData) {
	const players = [gameData.white_player_id.S, gameData.black_player_id.S];
	return !players.includes(gameData.game_id.S) && !players.includes("GUEST_USER");
}

/**
 * @description The values a save's ending needs, shared by updateGame & saveCardsState: the expiry pushed back (an active game never expires,
 * only an abandoned one), and the result when the save ends the game. Their UpdateExpression names :expireAt, :closed, :winner & :reason to match
 * @param  {[object]} params [the updateItem params, changed in place]
 * @param  {[boolean]} keepForever [true when the save ends a game that's kept forever: expireAt is removed, not pushed back]
 * @param  {[object]} result [{ winner, reason } when the save ends the game]
 */
function addSaveEnding(params, keepForever, result) {
	if (!keepForever) { params.ExpressionAttributeValues[":expireAt"] = { N: dbClient.expireTime() }; }
	if (result) {
		Object.assign(params.ExpressionAttributeNames, { "#winner": "winner", "#reason": "reason" });
		Object.assign(params.ExpressionAttributeValues, {
			":closed": { S: "CLOSED" },
			":winner": { S: result.winner },
			":reason": { S: result.reason }
		});
	}
}

/* ---------------------------------------------------------------- */
// Save opening (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Saves the game's opening, only while its board is the one the opening was found for. A closed game takes it too,
 * a move can end the game on a named position
 * @param  {[string]} gameId [game id]
 * @param  {[string]} board [the FEN the opening was found for]
 * @param  {[object]} opening [{ eco, name }]
 * @return {[object]} response [{ status, game_data (the game as saved), message }]
 */
async function saveOpening(gameId, board, opening) {
	const params = {
		TableName: dbClient.CHESS_TABLE,
		Key: { game_id: { S: gameId } },
		UpdateExpression: "SET opening = :opening",
		ConditionExpression: "game_board = :board",
		ExpressionAttributeValues: { ":opening": { S: JSON.stringify(opening) }, ":board": { S: board } },
		ReturnValues: "ALL_NEW"
	};

	const saved = await dbClient.updateOrConflict(params, `Board changed before the opening saved: ${gameId}`);
	if (saved.status != 200) { return saved; }

	return { status: 200, game_data: gameItem(saved.response.Attributes), message: `Saved opening: ${gameId}` };
}

/* ---------------------------------------------------------------- */
// Save card game (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Saves a Chess Cards game's new engine state, only on the version it was made from & while the game is open,
 * so only one save per version lands.
 * A save that ends the game saves its result in the same write (run finishClosedGame after it). Signed-in players' finished games are kept forever,
 * like updateGame. Any save ends a draw offer & a takeback request, like updateGame
 * @param  {[object]} gameData [the stored card game]
 * @param  {[number]} version [the cards_version the state was made from, saved as version + 1]
 * @param  {[string]} state [the engine's state as a JSON string]
 * @param  {[string]} fen [its board, game_board mirrors it for the game lists & the monitor]
 * @param  {[object]} result [{ winner, reason } when the save ends the game]
 * @return {[object]} response [{ status, game_data (the game as saved), message }, status 500 when the version moved on or the game closed]
 */
async function saveCardsState(gameData, version, state, fen, result) {
	const gameId = gameData.game_id.S;
	const keepForever = result && keepsFinished(gameData); // DynamoDB refuses a SET and a REMOVE of expireAt in one write
	const params = {
		TableName: dbClient.CHESS_TABLE,
		Key: { game_id: { S: gameId } },
		UpdateExpression: `SET cards_state = :cards_state, cards_version = :next, game_board = :game_board${keepForever ? "" : ", expireAt = :expireAt"}${result ? ", #state = :closed, #winner = :winner, #reason = :reason" : ""} REMOVE ${OFFER_ATTRIBUTES.join(", ")}${keepForever ? ", expireAt" : ""}`,
		ConditionExpression: "cards_version = :version AND #state = :open",
		ExpressionAttributeNames: { "#state": "state" }, // "state" is a DynamoDB reserved word
		ExpressionAttributeValues: {
			":open": { S: "OPEN" },
			":version": { N: String(version) },
			":next": { N: String(version + 1) },
			":cards_state": { S: state },
			":game_board": { S: fen }
		},
		ReturnValues: "ALL_NEW"
	};
	addSaveEnding(params, keepForever, result);

	// The condition fails when another save of this version landed first, or the game closed
	const saved = await dbClient.updateOrConflict(params, `Board changed before the move saved: ${gameId}`);
	if (saved.status != 200) { return saved; }

	return { status: 200, game_data: gameItem(saved.response.Attributes), message: `Saved card game: ${gameId}` };
}

/* ---------------------------------------------------------------- */
// Close game (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Ends a game without a move (a forfeit, a draw by agreement or running out of time): saves the result, then finishClosedGame.
 * A move that ends the game saves its result in updateGame.
 * Signed-in players' finished games are kept forever (expireAt is removed, keepsFinished), guests' still expire 25 days after the last move
 * @param  {[object]} gameData [game item from retrieveGame]
 * @param  {[string]} winner ["w", "b" or "draw"]
 * @param  {[string]} reason ["checkmate", "stalemate", "insufficient material", "fifty-move rule", "threefold repetition", "forfeit",
 * "agreement" or "timeout"]
 * @param  {[string]} offeredBy [a draw by agreement: the player whose offer was accepted,
 * the close only saves while that offer stands (a move ends it)]
 * @return {[object]} response [{ status, game_data, message }]
 */
async function closeGame(gameData, winner, reason, offeredBy) {
	const gameId = gameData.game_id.S;
	const keepForever = keepsFinished(gameData);
	const params = {
		TableName: dbClient.CHESS_TABLE,
		Key: {
			game_id: { S: gameId }
		},
		// No expireAt means TTL never deletes it
		UpdateExpression: `SET #state = :closed, #winner = :winner, #reason = :reason REMOVE ${OFFER_ATTRIBUTES.join(", ")}${keepForever ? ", expireAt" : ""}`,
		ConditionExpression: 'attribute_not_exists(#state) OR #state <> :closed', // Only one close wins (a forfeit and a checkmate at the same time)
		ExpressionAttributeNames: { "#state": "state", "#winner": "winner", "#reason": "reason" }, // "state" is a DynamoDB reserved word
		ExpressionAttributeValues: {
			":closed": { S: "CLOSED" },
			":winner": { S: winner },
			":reason": { S: reason }
		}
	}

	if (offeredBy) {
		params.ConditionExpression = `draw_offer_player_id = :offered_by AND (${params.ConditionExpression})`;
		params.ExpressionAttributeValues[":offered_by"] = { S: offeredBy };
	}
	if (reason == "timeout") { // A move saved since the read pushed the deadline back
		params.ConditionExpression = `move_deadline = :deadline AND (${params.ConditionExpression})`;
		params.ExpressionAttributeValues[":deadline"] = gameData.move_deadline;
	}

	const saved = await dbClient.updateOrConflict(params, `Game is already over: ${gameId}`);
	if (saved.status != 200) { return saved; }

	await finishClosedGame(gameData, winner);

	gameData.state = { S: "CLOSED" };
	gameData.winner = { S: winner };
	gameData.reason = { S: reason };
	for (const attribute of OFFER_ATTRIBUTES) { delete gameData[attribute]; }
	if (keepForever) { delete gameData.expireAt; }
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
	const listError = await dbInvites.movePlayersGame(gameData, gameId, "open_games", "closed_games");

	if (isRated(gameData)) {
		try {
			gameData.ratings = { S: JSON.stringify(await rateGame(gameData, winner)) };
		} catch (err) {
			// The game still closes, but the rating is lost and needs a look. Keep the message's start: rating.test.js pins it to alarm on
			console.log(`RATING FAILED ${gameId}: ${err.message}`);
		}
	}

	if (listError) { throw listError; }
}

/* ---------------------------------------------------------------- */
// Rate game (PUT)
/* ---------------------------------------------------------------- */
/**
 * @description Changes both players' ratings after a finished game (utils/rating.js) & saves what changed on the game, where it stays:
 * rated friend games are never deleted, so a player's closed_games are their rating history (profiles). All three writes land together or none do.
 * Two of a player's games can end at once, so each save needs rated_games to still be what was read, otherwise the rows are read again
 * & the ratings worked out again
 * @param  {[object]} gameData [the closed game item]
 * @param  {[string]} winner ["w", "b" or "draw"]
 * @return {[object]} ratings [{ w: { before, after }, b: { before, after }, at (epoch ms) }, null for a player without a row.
 * A game already rated keeps & returns its ratings]
 * @throws when the save still fails after LIST_SAVE_TRIES: neither rating changed
 */
async function rateGame(gameData, winner) {
	const gameId = gameData.game_id.S;
	const players = { w: gameData.white_player_id.S, b: gameData.black_player_id.S };
	let preGame; // Each side is rated against the other's rating from before the game, so a retry only updates their own

	for (let i = 0; i < dbClient.LIST_SAVE_TRIES; i++) {
		const users = {};
		for (const color of ["w", "b"]) { users[color] = (await dbUsers.retrieveUser(players[color], true)).user_data; }
		preGame ||= { w: readRating(users.w), b: readRating(users.b) };

		const ratings = { at: Date.now() };
		const transactItems = [];
		for (const color of ["w", "b"]) {
			if (!users[color]) { // They deleted their data, an update would make the row again
				ratings[color] = null;
				continue;
			}
			const rating = readRating(users[color]);
			const after = newRating(rating, preGame[color == "w" ? "b" : "w"], scoreFor(winner, color));
			ratings[color] = { before: rating.rating, after };
			transactItems.push({ Update: ratingUpdate(players[color], users[color], rating, after) });
		}
		transactItems.push({ Update: ratingsUpdate(gameId, ratings) });

		try {
			await dbClient.connection.transactWriteItems({ TransactItems: transactItems }); // All or none
			return ratings;
		} catch (err) {
			if (err.name != "TransactionCanceledException") { throw err; }
			// The game's own save failed: it's already rated, retrying can't help
			if (err.CancellationReasons?.at(-1)?.Code == "ConditionalCheckFailed") {
				return JSON.parse((await retrieveGame(gameId, true)).game_data.ratings.S);
			}
		}
	}
	throw new Error(`Rating save failed after ${dbClient.LIST_SAVE_TRIES} tries: ${gameId}`);
}

/**
 * @description The update that saves one player's new rating, only if no other game of theirs was rated since the read
 * @param  {[string]} userId [the player's id]
 * @param  {[object]} userData [their row as read]
 * @param  {[object]} rating [readRating's { rating, rated_games } from that row]
 * @param  {[number]} after [their new rating]
 * @return {[object]} update [a transaction Update]
 */
function ratingUpdate(userId, userData, rating, after) {
	const update = {
		TableName: dbClient.USER_TABLE,
		Key: {
			user_id: { S: userId }
		},
		UpdateExpression: 'SET rating = :rating, rated_games = :rated_games',
		// Their first rated game, or no other game was rated since the read
		ConditionExpression: userData.rated_games
			? 'rated_games = :old_rated_games'
			: 'attribute_exists(user_id) AND attribute_not_exists(rated_games)',
		ExpressionAttributeValues: {
			":rating": { N: `${after}` },
			":rated_games": { N: `${rating.rated_games + 1}` }
		}
	}
	if (userData.rated_games) { update.ExpressionAttributeValues[":old_rated_games"] = { N: userData.rated_games.N }; }
	return update;
}

/**
 * @description The update that saves the ratings on the game, only once
 * @param  {[string]} gameId [the closed game's id]
 * @param  {[object]} ratings [rateGame's ratings]
 * @return {[object]} update [a transaction Update]
 */
function ratingsUpdate(gameId, ratings) {
	return {
		TableName: dbClient.CHESS_TABLE,
		Key: {
			game_id: { S: gameId }
		},
		UpdateExpression: 'SET ratings = :ratings',
		ConditionExpression: 'attribute_not_exists(ratings)', // A game is never rated twice
		ExpressionAttributeValues: {
			":ratings": { S: JSON.stringify(ratings) }
		}
	};
}

module.exports = {
	initializeGame,
	retrieveGame,
	updateGame,
	saveOpening,
	saveCardsState,
	closeGame,
	finishClosedGame,
	rateGame
};
