/*
 *  timeLeft.js  --  chess frontend
 *	Time Left
 *	How long a player has for their move in a game with a time limit, on Home's game rows & the play page
 *
 */

/**
 * @description How long until a move is due, in its two largest units
 * @param  {[number]} deadline [epoch seconds]
 * @param  {[number]} now [epoch ms, left out = now]
 * @return {[string]} text ["2d 3h left", "5h 10m left", "12m left", "Under a minute left" or "Out of time"]
 */
function timeLeftText(deadline, now = Date.now()) {
	const seconds = deadline - now / 1000;
	if (seconds <= 0) { return "Out of time"; }
	const minutes = Math.floor(seconds / 60);
	if (minutes < 1) { return "Under a minute left"; }
	const days = Math.floor(minutes / 1440);
	const hours = Math.floor(minutes / 60) % 24;
	if (days) { return `${days}d ${hours}h left`; }
	return hours ? `${hours}h ${minutes % 60}m left` : `${minutes}m left`;
}

module.exports = { timeLeftText };
