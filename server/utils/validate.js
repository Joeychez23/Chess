/*
 *  validate.js  --  chess server
 *	Chess Move Engine
 *  Validation Functions (was chess-validation/lambdas/functions/chess/validate/validate.js)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { Chess } = require("chess.js");

/* ---------------------------------------------------------------- */
// Validates client move request
/* ---------------------------------------------------------------- */
/**
 * [Validates requested move by checking previous move, and piece movement]
 * @param  {[object]} playerData [Contains request data]
 * @param  {[object]} gameData [Contains server data]
 * @return {[object]} response [Returns the results of the processed move internally]
 */
async function validateMove(playerData, gameData) {
	try {
		const Module_chess = new Chess(gameData.game_board.S);
		try {
			if (gameData.white_player_id.S == playerData.player_id && Module_chess.turn() == "w" && Module_chess.get(playerData.move[0]).color == 'w') { // WHITE PLAYER MOVE CONDITIONS
				const takenPiece = Module_chess.get(playerData.move[1]); // CHECKED BEFORE THE MOVE SO A PROMOTION THAT TAKES A KNIGHT CLEARS IT TOO
				if (takenPiece.type == 'n' && takenPiece.color == 'b') {
					for (let n = 0; n < JSON.parse(gameData.b_knight.S).length; n++) {
						if (JSON.parse(gameData.b_knight.S)[n].to == playerData.move[1]) {
							let b_knight = JSON.parse(gameData.b_knight.S);
							b_knight[n] = { from: null, to: null };
							gameData.b_knight.S = JSON.stringify(b_knight);
						}
					}
				}
				moveFacing(Module_chess, gameData, playerData.move, playerData.promotion); // WHICH WAY THE PIECES FACE AFTER THIS MOVE

				//IF WHITE PAWN AT END OF BOARD
				if (playerData.promotion) { // SET Knight promotion
					if(playerData.promotion == 'n') {
						let w_knight = JSON.parse(gameData.w_knight.S);
						w_knight[w_knight.length] = { from: playerData.move[0], to: playerData.move[1] };
						gameData.w_knight.S = JSON.stringify(w_knight);
					}
					Module_chess.move({ from: playerData.move[0], to: playerData.move[1], promotion: playerData.promotion }); // MOVES THE PIECE
				} else {
					if (Module_chess.get(playerData.move[0]).type == 'n') {
						for (let n = 0; n < JSON.parse(gameData.w_knight.S).length; n++) {
							if (JSON.parse(gameData.w_knight.S)[n].to == playerData.move[0]) {
								let w_knight = JSON.parse(gameData.w_knight.S);
								w_knight[n] = { from: playerData.move[0], to: playerData.move[1] };
								gameData.w_knight.S = JSON.stringify(w_knight);
							}
						}
					}
					Module_chess.move({ from: playerData.move[0], to: playerData.move[1] }); // MOVES THE PIECE
				}

				gameData.game_board.S = Module_chess.fen(); // UPDATES GAME BOARD LOCALLY
				gameData.moves.S[gameData.moves.S.length] = Module_chess.history()[0]; // ADDS UPDATED MOVE
				gameData.prev_move.S = playerData.move
				return {
					status: 200,
					game_data: gameData,
					message: "Validated piece movement"
				}

			} else if (gameData.black_player_id.S == playerData.player_id && Module_chess.turn() == "b" && Module_chess.get(playerData.move[0]).color == 'b') { // BLACK PLAYER MOVE CONDITIONS
				const takenPiece = Module_chess.get(playerData.move[1]); // CHECKED BEFORE THE MOVE SO A PROMOTION THAT TAKES A KNIGHT CLEARS IT TOO
				if (takenPiece.type == 'n' && takenPiece.color == 'w') {
					for (let n = 0; n < JSON.parse(gameData.w_knight.S).length; n++) {
						if (JSON.parse(gameData.w_knight.S)[n].to == playerData.move[1]) {
							let w_knight = JSON.parse(gameData.w_knight.S);
							w_knight[n] = { from: null, to: null };
							gameData.w_knight.S = JSON.stringify(w_knight);
						}
					}
				}
				moveFacing(Module_chess, gameData, playerData.move, playerData.promotion); // WHICH WAY THE PIECES FACE AFTER THIS MOVE

				//IF BLACK PAWN AT END OF BOARD
				if (playerData.promotion) { // SET Knight promotion
					if(playerData.promotion == 'n') {
						let b_knight = JSON.parse(gameData.b_knight.S);
						b_knight[b_knight.length] = { from: playerData.move[0], to: playerData.move[1] };
						gameData.b_knight.S = JSON.stringify(b_knight);
					}
					Module_chess.move({ from: playerData.move[0], to: playerData.move[1], promotion: playerData.promotion }); // MOVES THE PIECE
				} else {
					if (Module_chess.get(playerData.move[0]).type == 'n') {
						for (let n = 0; n < JSON.parse(gameData.b_knight.S).length; n++) {
							if (JSON.parse(gameData.b_knight.S)[n].to == playerData.move[0]) {
								let b_knight = JSON.parse(gameData.b_knight.S);
								b_knight[n] = { from: playerData.move[0], to: playerData.move[1] };
								gameData.b_knight.S = JSON.stringify(b_knight);
							}
						}
					}
					Module_chess.move({ from: playerData.move[0], to: playerData.move[1] }); // MOVES THE PIECE
				}

				gameData.game_board.S = Module_chess.fen(); // UPDATES GAME BOARD LOCALLY
				gameData.moves.S[gameData.moves.S.length] = Module_chess.history()[0]; // ADDS UPDATED MOVE
				gameData.prev_move.S = playerData.move
				return {
					status: 200,
					game_data: gameData,
					message: "Validated piece movement"
				}
			} else {
				return {
					status: 500,
					message: "Invalid piece movement"
				}
			}
		} catch (err) {
			return {
				status: 500,
				message: "Invalid piece movement"
			}
		}
	} catch (err) {
		return {
			status: 500,
			message: "Invalid board, corrupted data"
		}
	}
}


/* ---------------------------------------------------------------- */
// Game Result
/* ---------------------------------------------------------------- */
/**
 * @description Checks a board for the end of the game. Only the board (FEN) is stored, so threefold repetition
 * isn't seen, same as the client (it also loads the FEN)
 * @param  {[string]} fen [game board]
 * @return {[object]} result [{ winner: "w" | "b" | "draw", reason } | null while the game is still going]
 */
function gameResult(fen) {
	const Module_chess = new Chess(fen);
	if (Module_chess.isCheckmate()) { return { winner: Module_chess.turn() == "w" ? "b" : "w", reason: "checkmate" }; } // THE SIDE TO MOVE IS MATED
	if (Module_chess.isStalemate()) { return { winner: "draw", reason: "stalemate" }; }
	if (Module_chess.isInsufficientMaterial()) { return { winner: "draw", reason: "insufficient material" }; }
	if (Module_chess.isDraw()) { return { winner: "draw", reason: "fifty-move rule" }; }
	return null;
}


/* ---------------------------------------------------------------- */
// Start Facing
/* ---------------------------------------------------------------- */
/**
 * @description Which way each king, queen, bishop & rook faces when a game starts: toward the other side (white faces rank 8,
 * black faces rank 1). Games made before facing was saved get this for the pieces on their board.
 * Knights have their own lists (w_knight / b_knight) & pawns always face forward
 * @param  {[string]} fen [game board]
 * @return {[object]} facing [{ w_facing, b_facing }, JSON strings of { square: the rank it faces (8 | 1) }]
 */
function startFacing(fen) {
	const Module_chess = new Chess(fen);
	const board = Module_chess.board();
	let w_facing = {};
	let b_facing = {};
	for (let i = 0; i < board.length; i++) {
		for (let j = 0; j < board[i].length; j++) {
			const piece = board[i][j];
			if (piece && piece.type.match(/[kqbr]/)) {
				if (piece.color == 'w') { w_facing[piece.square] = 8; } // WHITE FACES BLACK'S SIDE
				else if (piece.color == 'b') { b_facing[piece.square] = 1; } // BLACK FACES WHITE'S SIDE
			}
		}
	}
	return { w_facing: JSON.stringify(w_facing), b_facing: JSON.stringify(b_facing) };
}


/* ---------------------------------------------------------------- */
// Move Facing
/* ---------------------------------------------------------------- */
/**
 * @description Updates which way the pieces face for a move, before it's made on the board. A king, queen, bishop or rook
 * faces the way it moved up or down the board (a sideways move keeps its facing), castling takes the rook's facing with it,
 * a taken piece is removed & a pawn promoted to a queen, rook or bishop faces the other side.
 * The client does the same to keep its board in step (client/src/js/gameplay/utils/index.js)
 * @param  {[object]} Module_chess [board before the move]
 * @param  {[object]} gameData [game item, w_facing & b_facing are updated]
 * @param  {[array]} move [from, to]
 * @param  {[string]} promotion [promotion piece, false when there isn't one]
 */
function moveFacing(Module_chess, gameData, move, promotion) {
	if (!gameData.w_facing?.S || !gameData.b_facing?.S) { // GAMES MADE BEFORE FACING WAS SAVED START FROM THEIR BOARD
		const facing = startFacing(Module_chess.fen());
		gameData.w_facing = { S: facing.w_facing };
		gameData.b_facing = { S: facing.b_facing };
	}
	const piece = Module_chess.get(move[0]);
	const takenPiece = Module_chess.get(move[1]);
	if (!piece) { return; } // NO PIECE, THE MOVE FAILS ANYWAY

	let w_facing = JSON.parse(gameData.w_facing.S);
	let b_facing = JSON.parse(gameData.b_facing.S);
	let facing = piece.color == 'w' ? w_facing : b_facing; // THE SIDE THAT'S MOVING
	const forward = piece.color == 'w' ? 8 : 1; // THE OTHER SIDE'S BACK RANK

	if (takenPiece && takenPiece.color == 'w') { delete w_facing[move[1]]; } // TAKEN PIECE
	else if (takenPiece && takenPiece.color == 'b') { delete b_facing[move[1]]; }

	if (piece.type.match(/[kqbr]/)) {
		const fromRank = Number(move[0][1]);
		const toRank = Number(move[1][1]);
		let faces = facing[move[0]] || forward;
		if (toRank > fromRank) { faces = 8; } // MOVED TOWARD RANK 8
		else if (toRank < fromRank) { faces = 1; } // MOVED TOWARD RANK 1
		delete facing[move[0]];
		facing[move[1]] = faces;

		if (piece.type == 'k' && Math.abs(move[1].charCodeAt(0) - move[0].charCodeAt(0)) == 2) { // CASTLING: THE ROOK MOVES SIDEWAYS TOO, SAME FACING
			const rookFrom = `${move[1][0] == 'g' ? 'h' : 'a'}${fromRank}`;
			const rookTo = `${move[1][0] == 'g' ? 'f' : 'd'}${fromRank}`;
			facing[rookTo] = facing[rookFrom] || forward;
			delete facing[rookFrom];
		}
	} else if (piece.type == 'p' && promotion && promotion.match(/[qbr]/)) { // PROMOTED: FACES THE OTHER SIDE (KNIGHTS GO IN THE KNIGHT LIST)
		facing[move[1]] = forward;
	}

	gameData.w_facing.S = JSON.stringify(w_facing);
	gameData.b_facing.S = JSON.stringify(b_facing);
}


module.exports = { validateMove, gameResult, startFacing }
