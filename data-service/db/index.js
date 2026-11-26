/*
 *  index.js  --  data service
 *	Chess Move Engine
 *  The database: every DynamoDB read and write the data service's routes make, split by concern into the db.*.js files beside this one.
 *  Callers outside db/ import from here only
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const dbClient = require("./db.client.js");
const dbGames = require("./db.games.js");
const dbInvites = require("./db.invites.js");
const dbOffers = require("./db.offers.js");
const dbUsers = require("./db.users.js");
const dbSessions = require("./db.sessions.js");
const dbPrune = require("./db.prune.js");
const dbFriends = require("./db.friends.js");

module.exports = {
	// Health
	checkTables: dbClient.checkTables,

	// Games
	initializeGame: dbGames.initializeGame,
	retrieveGame: dbGames.retrieveGame,
	updateGame: dbGames.updateGame,
	saveOpening: dbGames.saveOpening,
	saveCardsState: dbGames.saveCardsState,
	closeGame: dbGames.closeGame,
	finishClosedGame: dbGames.finishClosedGame,
	rateGame: dbGames.rateGame,

	// Invites and challenge links
	acceptInvite: dbInvites.acceptInvite,
	takeOpenSeat: dbInvites.takeOpenSeat,
	deleteInvite: dbInvites.deleteInvite,
	movePlayersGame: dbInvites.movePlayersGame,

	// Draw offers, takebacks and rematches
	offerDraw: dbOffers.offerDraw,
	endDrawOffer: dbOffers.endDrawOffer,
	requestTakeback: dbOffers.requestTakeback,
	endTakeback: dbOffers.endTakeback,
	requestRematch: dbOffers.requestRematch,
	acceptRematch: dbOffers.acceptRematch,
	cancelRematch: dbOffers.cancelRematch,

	// Users
	initializeUser: dbUsers.initializeUser,
	retrieveUser: dbUsers.retrieveUser,
	retrieveRatings: dbUsers.retrieveRatings,
	updateUser: dbUsers.updateUser,
	updateUserSettings: dbUsers.updateUserSettings,
	saveLastColor: dbUsers.saveLastColor,
	claimUsername: dbUsers.claimUsername,
	deleteUser: dbUsers.deleteUser,

	// Sessions
	startSession: dbSessions.startSession,
	endSession: dbSessions.endSession,

	// A player's game lists, read for Home and for Delete my data
	pruneOpenGames: dbPrune.pruneOpenGames,
	pruneClosedGames: dbPrune.pruneClosedGames,
	pruneInvites: dbPrune.pruneInvites,
	expireFinishedAiGames: dbPrune.expireFinishedAiGames,
	anonymizeFriendGames: dbPrune.anonymizeFriendGames,

	// Usernames and friends
	findUsername: dbFriends.findUsername,
	searchUsernames: dbFriends.searchUsernames,
	changeFriends: dbFriends.changeFriends,
	retrieveFriends: dbFriends.retrieveFriends,
	leaveFriends: dbFriends.leaveFriends
};
