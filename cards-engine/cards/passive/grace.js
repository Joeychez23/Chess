/*
 *  grace.js  --  chess cards engine
 *	Passive, once per game: a move that would checkmate you is taken back; the opponent must play a different move. Debuff: the opponent draws 2 active cards.
 *
 */

/**
 * @description The rollback needs the state from before the action, so it lives in index.js (applyAction, graceUndo); this unit only names the card. It answers an opponent's action that checkmates the owner: the move is barred whatever card plays it. Out of scope (ruling): a mate completed by the owner's own action (their duel pick or their answer to a choice) is not taken back.
 */
module.exports = {
	key: "grace", kind: "passive", name: "Grace", skulls: 2, rarity: "rare", oncePerGame: true,
	text: "Once per game, a move that would checkmate you is taken back; the opponent must play a different move. Debuff: the opponent draws 2 active cards.",
};
