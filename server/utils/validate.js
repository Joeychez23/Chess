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
				} else if ((takenPiece.type == 'q' || takenPiece.type == 'b' || takenPiece.type == 'r') && takenPiece.color == 'b') { // TAKEN QUEEN, BISHOP OR ROOK
					for (let n = 0; n < JSON.parse(gameData.b_piece.S).length; n++) {
						if (JSON.parse(gameData.b_piece.S)[n].to == playerData.move[1]) {
							let b_piece = JSON.parse(gameData.b_piece.S);
							b_piece[n] = { from: null, to: null };
							gameData.b_piece.S = JSON.stringify(b_piece);
						}
					}
				}

				//IF WHITE PAWN AT END OF BOARD
				if (playerData.promotion) { // SET Knight promotion
					if(playerData.promotion == 'n') {
						let w_knight = JSON.parse(gameData.w_knight.S);
						w_knight[w_knight.length] = { from: playerData.move[0], to: playerData.move[1] };
						gameData.w_knight.S = JSON.stringify(w_knight);
					} else { // SET QUEEN, BISHOP OR ROOK PROMOTION (FACES BLACK'S SIDE, IT CAME FROM RANK 7)
						let w_piece = JSON.parse(gameData.w_piece.S);
						w_piece[w_piece.length] = { from: playerData.move[0], to: playerData.move[1] };
						gameData.w_piece.S = JSON.stringify(w_piece);
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
					} else if (Module_chess.get(playerData.move[0]).type.match(/[kqbr]/)) { // KINGS, QUEENS, BISHOPS & ROOKS FACE THE WAY THEY LAST MOVED UP OR DOWN
						for (let n = 0; n < JSON.parse(gameData.w_piece.S).length; n++) {
							if (JSON.parse(gameData.w_piece.S)[n].to == playerData.move[0]) {
								let w_piece = JSON.parse(gameData.w_piece.S);
								if (playerData.move[0].split("")[1] != playerData.move[1].split("")[1]) { w_piece[n] = { from: playerData.move[0], to: playerData.move[1] }; } // MOVED UP OR DOWN
								else { w_piece[n].to = playerData.move[1]; } // MOVED SIDEWAYS: KEEPS ITS from SO IT FACES THE SAME WAY
								gameData.w_piece.S = JSON.stringify(w_piece);
							}
						}
						if (Module_chess.get(playerData.move[0]).type == 'k' && playerData.move[0] == 'e1' && (playerData.move[1] == 'g1' || playerData.move[1] == 'c1')) { // CASTLING: THE ROOK MOVES SIDEWAYS TOO
							for (let n = 0; n < JSON.parse(gameData.w_piece.S).length; n++) {
								let w_piece = JSON.parse(gameData.w_piece.S);
								if (playerData.move[1] == 'g1' && w_piece[n].to == 'h1') { w_piece[n].to = 'f1'; gameData.w_piece.S = JSON.stringify(w_piece); } // KING SIDE
								else if (playerData.move[1] == 'c1' && w_piece[n].to == 'a1') { w_piece[n].to = 'd1'; gameData.w_piece.S = JSON.stringify(w_piece); } // QUEEN SIDE
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
				} else if ((takenPiece.type == 'q' || takenPiece.type == 'b' || takenPiece.type == 'r') && takenPiece.color == 'w') { // TAKEN QUEEN, BISHOP OR ROOK
					for (let n = 0; n < JSON.parse(gameData.w_piece.S).length; n++) {
						if (JSON.parse(gameData.w_piece.S)[n].to == playerData.move[1]) {
							let w_piece = JSON.parse(gameData.w_piece.S);
							w_piece[n] = { from: null, to: null };
							gameData.w_piece.S = JSON.stringify(w_piece);
						}
					}
				}

				//IF BLACK PAWN AT END OF BOARD
				if (playerData.promotion) { // SET Knight promotion
					if(playerData.promotion == 'n') {
						let b_knight = JSON.parse(gameData.b_knight.S);
						b_knight[b_knight.length] = { from: playerData.move[0], to: playerData.move[1] };
						gameData.b_knight.S = JSON.stringify(b_knight);
					} else { // SET QUEEN, BISHOP OR ROOK PROMOTION (FACES WHITE'S SIDE, IT CAME FROM RANK 2)
						let b_piece = JSON.parse(gameData.b_piece.S);
						b_piece[b_piece.length] = { from: playerData.move[0], to: playerData.move[1] };
						gameData.b_piece.S = JSON.stringify(b_piece);
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
					} else if (Module_chess.get(playerData.move[0]).type.match(/[kqbr]/)) { // KINGS, QUEENS, BISHOPS & ROOKS FACE THE WAY THEY LAST MOVED UP OR DOWN
						for (let n = 0; n < JSON.parse(gameData.b_piece.S).length; n++) {
							if (JSON.parse(gameData.b_piece.S)[n].to == playerData.move[0]) {
								let b_piece = JSON.parse(gameData.b_piece.S);
								if (playerData.move[0].split("")[1] != playerData.move[1].split("")[1]) { b_piece[n] = { from: playerData.move[0], to: playerData.move[1] }; } // MOVED UP OR DOWN
								else { b_piece[n].to = playerData.move[1]; } // MOVED SIDEWAYS: KEEPS ITS from SO IT FACES THE SAME WAY
								gameData.b_piece.S = JSON.stringify(b_piece);
							}
						}
						if (Module_chess.get(playerData.move[0]).type == 'k' && playerData.move[0] == 'e8' && (playerData.move[1] == 'g8' || playerData.move[1] == 'c8')) { // CASTLING: THE ROOK MOVES SIDEWAYS TOO
							for (let n = 0; n < JSON.parse(gameData.b_piece.S).length; n++) {
								let b_piece = JSON.parse(gameData.b_piece.S);
								if (playerData.move[1] == 'g8' && b_piece[n].to == 'h8') { b_piece[n].to = 'f8'; gameData.b_piece.S = JSON.stringify(b_piece); } // KING SIDE
								else if (playerData.move[1] == 'c8' && b_piece[n].to == 'a8') { b_piece[n].to = 'd8'; gameData.b_piece.S = JSON.stringify(b_piece); } // QUEEN SIDE
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
