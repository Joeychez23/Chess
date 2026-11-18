/*
 *  cardsRoutes.js  --  chess server
 *	Chess Cards Routes
 *	A card game vs Card Guy: new games, loading one, the player's actions & Card Guy's turns (controllers/cardsController.js). Mounted at /api/chess/cards (chessRoutes.js)
 *
 */

const router = require('express').Router()
const { optionalAuth } = require('../../middleware/auth.js')
const { limitNewGames, limitAiMoves, limitCardActions } = require('../../middleware/rateLimit.js')
const { newCardsGame, getCardsGame, playCardsAction, cardGuyCardsTurn, getCardGuy } = require('../../controllers/cardsController.js')

// THE PLAYER IS WHOEVER IS SIGNED IN (req.user) OR A GUEST WITH THE GAME'S guest_game COOKIE. A CARD GAME IS FORFEITED WITH /api/chess/game/:gameId/forfeit

router.route('/').post(optionalAuth, limitNewGames, newCardsGame);                     // /api/chess/cards                  -> NEW CARD GAME VS CARD GUY AT A LEVEL & COLOR. ONE OPEN AI OR CARD GAME AT A TIME: 409, OR replace_current FORFEITS IT

router.route('/card-guy').get(getCardGuy);                                             // /api/chess/cards/card-guy         -> CARD GUY (TASK 17). BEFORE /:gameId, OR "card-guy" IS READ AS A GAME ID

router.route('/:gameId').get(optionalAuth, getCardsGame);                              // /api/chess/cards/:gameId          -> THE GAME AS THE PLAYER MAY SEE IT, THEIR LEGAL ACTIONS & WHETHER CARD GUY OWES ONE

router.route('/:gameId/action').post(optionalAuth, limitCardActions, playCardsAction); // /api/chess/cards/:gameId/action   -> PLAYS ONE OF THE PLAYER'S LEGAL ACTIONS & SAVES IT, 409 WHEN IT ISN'T ONE OR ANOTHER SAVE LANDED FIRST

router.route('/:gameId/card-guy').post(optionalAuth, limitAiMoves, cardGuyCardsTurn);  // /api/chess/cards/:gameId/card-guy -> CARD GUY'S ACTION (TASK 17)


module.exports = router
