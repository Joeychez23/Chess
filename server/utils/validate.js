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


module.exports = { validateMove, gameResult }
