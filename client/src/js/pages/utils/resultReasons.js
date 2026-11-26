// How a game ended, as a line under its result: the play page's menu (gameplay/menu/endGame.js) & Home's finished games. Pure, no imports

/**
 * @description The server's reason -> the line under the result. The chess server's words, then the card engine's (cards-engine/turn/). A forfeit is already in the title
 */
export const RESULT_REASONS = {
	"checkmate": "by Checkmate",
	"stalemate": "by Stalemate",
	"insufficient material": "by insufficient material",
	"fifty-move rule": "by the fifty-move rule",
	"threefold repetition": "by threefold repetition",
	"agreement": "by agreement",
	"timeout": "on time",
	"king": "by taking the King", // CHESS CARDS
	"repetition": "by threefold repetition",
	"fifty": "by the fifty-move rule",
	"material": "by insufficient material",
};

/**
 * @description The line for a reason
 * @param  {[string]} reason [the game's result reason]
 * @return {[string]} [the line, "" when there's none (a forfeit, null, an unknown word)]
 */
export function reasonLine(reason) {
	return Object.hasOwn(RESULT_REASONS, reason) ? RESULT_REASONS[reason] : ""; // NOT "toString" & THE LIKE FROM THE PROTOTYPE
}
