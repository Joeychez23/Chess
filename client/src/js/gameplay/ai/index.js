const { aiMove } = require("../validate/index.js")

const AI_TRIES = 3; // SERVER / ENGINE BUSY -> ASK AGAIN

/* ---------------------------------------------------------------- */
// Play Ai
/* ---------------------------------------------------------------- */
/**
 * @description Asks the server for the AI's move. The server picks it with Stockfish at the game's level & saves it,
 * so the move only needs to be animated (no PUT). Asking again after the AI moved returns the same move
 * @param  {[string]} gameUrl [chess api, "/api/chess"]
 * @param  {[string]} gameId [game id]
 * @return {[object]} An object of move params [{ from, to, promotion, response }], response is the saved game
 */
export async function playAi(gameUrl, gameId) {
	for (let i = 0; i < AI_TRIES; i++) {
		const response = await aiMove(gameUrl, gameId);
		if (response?.status == 200 && response.ai_move) {
			const { from, to, promotion } = response.ai_move;
			if (promotion) { return { from, to, promotion, response }; } // THE SERVER ALREADY PICKED THE PROMOTION PIECE
			return { from, to, response };
		}
		console.log(response?.message);
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	throw new Error("AI move failed");
}
