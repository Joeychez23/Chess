/*
 *  timing.js  --  chess frontend
 *	Animation Timing
 *	The slide speed, knight stop & hop arc & the restart slide's time & easing, shared by the 2D board (animate/index.js) & the
 *	3D board (three/index.js) so a move takes the same time on both. No imports: the 3D chunk pulls it in without the 2D code
 *
 */

export const SLIDE_MS_PER_SQUARE = 263; // HOW LONG A MOVE TAKES PER SQUARE
export const KNIGHT_PAUSE_MS = 100; // A KNIGHT STOPS THIS LONG BEFORE ITS HOP
export const RESTART_SLIDE_MS = 800; // HOW LONG THE PIECES TAKE TO SLIDE HOME AFTER RESTART & REMATCH

/**
 * @description How long a move's slide takes, after the knight's stop. A knight takes the time of one square (its long side goes
 * twice as fast, so both sides finish together)
 * @param  {[number]} squares [the most squares it goes across or up & down]
 * @param  {[boolean]} knight [true for a knight]
 * @return {[number]} ms
 */
export function slideDuration(squares, knight) {
	return (knight ? 1 : squares) * SLIDE_MS_PER_SQUARE;
}

/**
 * @description How long a piece waits before it moves (a knight stops before its hop)
 * @param  {[boolean]} knight [true for a knight]
 * @return {[number]} ms
 */
export function slideDelay(knight) {
	return knight ? KNIGHT_PAUSE_MS : 0;
}

/**
 * @description How high a hopping knight is: 0 as it leaves its square, 1 halfway & back to 0 as it lands
 * @param  {[number]} t [0 - 1 of the way there]
 * @return {[number]} 0 - 1
 */
export function hopArc(t) {
	const hop = Math.sin(Math.min(Math.max(t, 0), 1) * Math.PI);
	return hop < 0.001 ? 0 : hop; // BACK ON THE BOARD (sin(PI) ISN'T EXACTLY 0)
}

/**
 * @description The restart slide's slow start & landing
 * @param  {[number]} t [0 - 1 of the time]
 * @return {[number]} 0 - 1 of the way there
 */
export function easeInOut(t) {
	return 0.5 - Math.cos(t * Math.PI) / 2;
}
