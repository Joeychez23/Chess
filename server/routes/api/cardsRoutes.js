/*
 *  cardsRoutes.js  --  chess server
 *	Chess Cards Routes
 *	A card game vs Vesper: new games, loading one, the player's actions & Vesper's turns (controllers/cardsController.js). Mounted at /api/chess/cards (chessRoutes.js)
 *
 */

const router = require('express').Router()
const { optionalAuth } = require('../../middleware/auth.js')
const { limitNewGames, limitAiMoves, limitCardActions } = require('../../middleware/rateLimit.js')
const { newCardsGame, getCardsGame, playCardsAction, vesperCardsTurn, getVesper } = require('../../controllers/cardsController.js')

// THE PLAYER IS WHOEVER IS SIGNED IN (req.user) OR A GUEST WITH THE GAME'S guest_game COOKIE. A CARD GAME IS FORFEITED WITH /api/chess/game/:gameId/forfeit

router.route('/').post(optionalAuth, limitNewGames, newCardsGame);                    // /api/chess/cards                  -> NEW CARD GAME VS VESPER AT A LEVEL & COLOR. ONE OPEN AI OR CARD GAME AT A TIME: 409, OR replace_current FORFEITS IT

router.route('/vesper').get(getVesper);                                              // /api/chess/cards/vesper           -> VESPER (TASK 17). BEFORE /:gameId, OR "vesper" IS READ AS A GAME ID

router.route('/:gameId').get(optionalAuth, getCardsGame);                            // /api/chess/cards/:gameId          -> THE GAME AS THE PLAYER MAY SEE IT, THEIR LEGAL ACTIONS & WHETHER VESPER OWES ONE

router.route('/:gameId/action').post(optionalAuth, limitCardActions, playCardsAction); // /api/chess/cards/:gameId/action   -> PLAYS ONE OF THE PLAYER'S LEGAL ACTIONS & SAVES IT, 409 WHEN IT ISN'T ONE OR ANOTHER SAVE LANDED FIRST

router.route('/:gameId/vesper').post(optionalAuth, limitAiMoves, vesperCardsTurn);   // /api/chess/cards/:gameId/vesper   -> VESPER'S ACTION (TASK 17)


module.exports = router
