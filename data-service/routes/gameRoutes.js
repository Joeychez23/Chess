/*
 *  gameRoutes.js  --  data service
 *	Game Routes
 *	/games/*: making, reading & playing games, one named action per route (controllers/game/)
 *
 */

const router = require('express').Router()
const { requirePlayer } = require('../middleware/player.js')
const { onlyFields } = require('../middleware/fields.js')
const {
	getGame, moveGame, aiMoveGame, takebackGame, declineTakebackGame, openingGame, forfeitGame, drawGame, declineDrawGame, aiDrawGame,
	getRatings, newAiGame, newGuestGame, inviteGame, challengeGame, getChallenge, joinGame, acceptGame, declineGame,
	rematchGame, cancelRematchGame, newCardsGame, saveCardsGame,
} = require('../controllers/game/index.js')

// Every route acts for req.player (middleware/player.js) & names the body fields it takes, a body with anything else is refused (400)

// POST /games/ai -> a signed in player's new game vs the AI (a new id only)
router.route('/ai').post(requirePlayer, onlyFields(["color", "level", "start_fen"]), newAiGame);
// POST /games/guest -> a guest's game vs the AI, overwrites only their own (no player = a new guest)
router.route('/guest').post(onlyFields(["game_id", "color", "side", "level", "start_fen"]), newGuestGame);
// POST /games/cards -> a Chess Cards game vs the AI (signed in or a guest, a new id), the engine's state stored as sent
router.route('/cards').post(onlyFields(["color", "level", "state", "fen"]), newCardsGame);
// POST /games/invite -> a PENDING friend game, the requester is the inviter
router.route('/invite').post(
	requirePlayer,
	onlyFields(["opponent_id", "opponent_screenname", "color", "start_fen", "takebacks", "days_per_move"]),
	inviteGame,
);
// POST /games/challenge -> a challenge link's PENDING game, the other seat is empty
router.route('/challenge').post(requirePlayer, onlyFields(["color", "start_fen", "takebacks", "days_per_move"]), challengeGame);
// GET /games/:gameId -> the game, only for a player in it (a missing game says so to anyone, ?consistent=true sees a save that just
// happened)
router.route('/:gameId').get(onlyFields([]), getGame);
// POST /games/:gameId/move -> the requester's move on the stored board, closes the game on mate or a draw
router.route('/:gameId/move').post(requirePlayer, onlyFields(["from", "to", "promotion"]), moveGame);
// PUT /games/:gameId/cards -> card games: the new engine state, only on the stored cards_version (409), winner & reason close the game
router.route('/:gameId/cards').put(requirePlayer, onlyFields(["version", "state", "fen", "winner", "reason"]), saveCardsGame);
// POST /games/:gameId/ai-move -> AI games: the AI's move (from the engine), only on its turn
router.route('/:gameId/ai-move').post(requirePlayer, onlyFields(["from", "to", "promotion"]), aiMoveGame);
// POST /games/:gameId/takeback -> AI games: the requester's last move & the AI's reply, if it made one
router.route('/:gameId/takeback').post(requirePlayer, onlyFields([]), takebackGame);
// POST /games/:gameId/takeback/decline -> friend games: the asked player turns it down
router.route('/:gameId/takeback/decline').post(requirePlayer, onlyFields([]), declineTakebackGame);
// POST /games/:gameId/opening -> the opening the chess server found for the board a move saved, only while it's still the game's board
router.route('/:gameId/opening').post(requirePlayer, onlyFields(["board", "eco", "name"]), openingGame);
// POST /games/:gameId/forfeit -> the requester gives up an open game, the other side wins
router.route('/:gameId/forfeit').post(requirePlayer, onlyFields([]), forfeitGame);
// POST /games/:gameId/draw -> the requester's draw offer (one per player per move), or accepts the opponent's
router.route('/:gameId/draw').post(requirePlayer, onlyFields([]), drawGame);
// POST /games/:gameId/draw/decline -> friend games: the offered player turns it down
router.route('/:gameId/draw/decline').post(requirePlayer, onlyFields([]), declineDrawGame);
// POST /games/:gameId/draw/ai-answer -> AI games: the AI's answer (from the engine) to the requester's offer
router.route('/:gameId/draw/ai-answer').post(requirePlayer, onlyFields(["accept"]), aiDrawGame);
// POST /games/:gameId/accept -> the invited player starts the game (replace_current forfeits their open one), not while the inviter is in
// another friend game
router.route('/:gameId/accept').post(requirePlayer, onlyFields(["replace_current"]), acceptGame);
// GET /games/:gameId/challenge -> what the join screen shows, for any signed in player with the link
router.route('/:gameId/challenge').get(requirePlayer, onlyFields([]), getChallenge);
// POST /games/:gameId/join -> takes a challenge link's empty seat, only one player wins it (replace_current forfeits their open game)
router.route('/:gameId/join').post(requirePlayer, onlyFields(["replace_current"]), joinGame);
// POST /games/:gameId/decline -> either player deletes a PENDING invite
router.route('/:gameId/decline').post(requirePlayer, onlyFields([]), declineGame);
// POST /games/:gameId/rematch -> friend games that are over: the first press waits, the second makes the new game
router.route('/:gameId/rematch').post(requirePlayer, onlyFields([]), rematchGame);
// POST /games/:gameId/rematch/cancel -> the player who asked takes it back, until the other press claims it
router.route('/:gameId/rematch/cancel').post(requirePlayer, onlyFields([]), cancelRematchGame);
// GET /games/:gameId/ratings -> both players' ratings for the game menu
router.route('/:gameId/ratings').get(requirePlayer, onlyFields([]), getRatings);
module.exports = router
