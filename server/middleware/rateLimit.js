/*
 *  rateLimit.js  --  chess server
 *	New Game, Login & AI Move Limits
 *  Every new game is a chess_db item kept for 25 days, and the table is provisioned at 5 writes a second, so making games
 *  in a loop would throttle everyone's moves. Each browser session, each IP & the whole site get a token bucket:
 *  a burst of new games at once, then one more every so often. There's one server process, so the buckets live in memory
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { readGuestCookie } = require("./auth.js");

const LIMITS = {
	session: { burst: 10, refillMs: 60 * 1000 }, // A SIGNED IN PLAYER OR A GUEST (THEIR COOKIE): 10 AT ONCE, THEN 1 A MINUTE
	ip: { burst: 30, refillMs: 20 * 1000 }, // AN IP (IPv6: ITS /64), A FEW PLAYERS CAN SHARE ONE: 30 AT ONCE, THEN 1 EVERY 20 SECONDS
	site: { burst: 60, refillMs: 1000 }, // EVERYONE: 60 AT ONCE, THEN 1 A SECOND (A FIFTH OF chess_db'S WRITES)
};
const LOGIN_LIMITS = { // PASSWORD LOGINS, CHECKED BEFORE AUTH0 IS ASKED
	loginIp: { burst: 20, refillMs: 30 * 1000 }, // AN IP (IPv6: ITS /64): 20 AT ONCE, THEN 1 EVERY 30 SECONDS
	loginEmail: { burst: 10, refillMs: 60 * 1000 }, // AN EMAIL (LOWERCASED), FROM ANY ADDRESS: 10 AT ONCE, THEN 1 A MINUTE
};
const AI_MOVE_LIMITS = { // /ai-move ASKS THE ENGINE, A PLAYER NEEDS ONE PER MOVE (PLUS RELOADS)
	aiMoveSession: { burst: 20, refillMs: 1000 }, // A SIGNED IN PLAYER OR A GUEST: 20 AT ONCE, THEN 1 A SECOND
	aiMoveIp: { burst: 60, refillMs: 250 }, // AN IP (IPv6: ITS /64): 60 AT ONCE, THEN 4 A SECOND
};
const CLIENT_ERROR_LIMITS = { // BROWSER ERROR REPORTS BECOME LOG LINES, SO A LOOP CAN'T FILL THE LOGS (#194)
	clientErrorIp: { burst: 10, refillMs: 30 * 1000 }, // AN IP (IPv6: ITS /64): 10 AT ONCE, THEN 1 EVERY 30 SECONDS
	clientErrorSite: { burst: 60, refillMs: 2 * 1000 }, // EVERYONE: 60 AT ONCE, THEN 1 EVERY 2 SECONDS
};
const MAX_KEYS = 100000; // BUCKETS KEPT PER LIMIT, FULL ONES ARE DROPPED FIRST
const LOG_EVERY = 60 * 1000; // A KEY THAT KEEPS HITTING ITS LIMIT IS LOGGED ONCE A MINUTE

let buckets = {}; // LIMIT NAME -> KEY -> { tokens, at (ms), loggedAt (ms) }

/* ---------------------------------------------------------------- */
// Limit New Games
/* ---------------------------------------------------------------- */
/**
 * @description Middleware for the routes that make a game (new game, restart, invite). Runs after optionalAuth / requireAuth
 * & before the route, so a refused request never forfeits or saves anything. Answers 429 with Retry-After when a limit is hit
 */
function limitNewGames(req, res, next) {
	const guest = readGuestCookie(req);
	const keys = { ip: ipKey(req.ip), site: "all" };
	if (req.user) { keys.session = `user:${req.user.user_id}`; }
	else if (guest) { keys.session = `guest:${guest.session}`; } // THE SAME FROM GAME TO GAME. A GUEST'S FIRST GAME (NO COOKIE YET), OR A BOT THAT DROPS IT, ONLY HAS THE IP & SITE LIMITS

	const result = takeTokens(keys, Date.now());
	if (result.ok) { return next(); }

	const seconds = Math.ceil(result.retryMs / 1000);
	if (result.log) { console.log(`New game limit (${result.limit}: ${keys[result.limit]}) ${req.method} ${req.originalUrl}, retry in ${seconds}s`); }
	res.set("Retry-After", String(seconds));
	return res.status(429).json({ status: 429, message: `Too many new games, try again in ${seconds} second${seconds == 1 ? "" : "s"}` });
}

/* ---------------------------------------------------------------- */
// Limit Logins
/* ---------------------------------------------------------------- */
/**
 * @description Middleware for POST /api/auth/login. Runs after checkLogin (so the email is a string) & before Auth0 is asked,
 * with its own buckets so logins never use up new games. Answers 429 with Retry-After when a limit is hit
 */
function limitLogins(req, res, next) {
	const keys = { loginIp: ipKey(req.ip), loginEmail: req.body.email.toLowerCase() };
	const result = takeTokens(keys, Date.now(), LOGIN_LIMITS);
	if (result.ok) { return next(); }
	const seconds = Math.ceil(result.retryMs / 1000);
	if (result.log) { console.log(`Login limit (${result.limit}: ${keys[result.limit]}) ${req.method} ${req.originalUrl}, retry in ${seconds}s`); }
	res.set("Retry-After", String(seconds));
	return res.status(429).json({ status: 429, message: `Too many logins, try again in ${seconds} second${seconds == 1 ? "" : "s"}` });
}

/* ---------------------------------------------------------------- */
// Limit AI Moves
/* ---------------------------------------------------------------- */
/**
 * @description Middleware for POST /api/chess/game/:gameId/ai-move. Runs after optionalAuth & before the engine is asked,
 * with its own buckets so AI moves never use up new games. Answers 429 with Retry-After when a limit is hit
 */
function limitAiMoves(req, res, next) {
	const guest = readGuestCookie(req);
	const keys = { aiMoveIp: ipKey(req.ip) };
	if (req.user) { keys.aiMoveSession = `user:${req.user.user_id}`; }
	else if (guest) { keys.aiMoveSession = `guest:${guest.session}`; }

	const result = takeTokens(keys, Date.now(), AI_MOVE_LIMITS);
	if (result.ok) { return next(); }
	const seconds = Math.ceil(result.retryMs / 1000);
	if (result.log) { console.log(`AI move limit (${result.limit}: ${keys[result.limit]}) ${req.method} ${req.originalUrl}, retry in ${seconds}s`); }
	res.set("Retry-After", String(seconds));
	return res.status(429).json({ status: 429, message: `Too many AI move requests, try again in ${seconds} second${seconds == 1 ? "" : "s"}` });
}

/* ---------------------------------------------------------------- */
// Limit Browser Error Reports
/* ---------------------------------------------------------------- */
/**
 * @description Middleware for POST /api/client-errors, with its own buckets. Answers 429 with Retry-After when a limit is hit
 */
function limitClientErrors(req, res, next) {
	const keys = { clientErrorIp: ipKey(req.ip), clientErrorSite: "all" };
	const result = takeTokens(keys, Date.now(), CLIENT_ERROR_LIMITS);
	if (result.ok) { return next(); }
	const seconds = Math.ceil(result.retryMs / 1000);
	if (result.log) { console.log(`Browser error report limit (${result.limit}: ${keys[result.limit]}), retry in ${seconds}s`); }
	res.set("Retry-After", String(seconds));
	return res.status(429).json({ status: 429, message: `Too many error reports, try again in ${seconds} second${seconds == 1 ? "" : "s"}` });
}

/* ---------------------------------------------------------------- */
// Take Tokens
/* ---------------------------------------------------------------- */
/**
 * @description Takes one token from each key's bucket, or none if any of them is empty (so a refused request costs nothing)
 * @param  {[object]} keys [{ session (optional), ip, site } bucket keys, { loginIp, loginEmail } or { aiMoveSession (optional), aiMoveIp }]
 * @param  {[number]} now [epoch ms]
 * @param  {[object]} limits [LIMITS (new games, the default), LOGIN_LIMITS, AI_MOVE_LIMITS or CLIENT_ERROR_LIMITS]
 * @return {[object]} result [{ ok: true } | { ok: false, limit (the empty one), retryMs (until it has a token), log (first refusal this minute) }]
 */
function takeTokens(keys, now, limits = LIMITS) {
	const found = [];
	for (const limit of Object.keys(limits)) {
		if (!keys[limit]) { continue; }
		const bucket = refill(limit, keys[limit], now, limits);
		if (bucket.tokens < 1) {
			const log = now - (bucket.loggedAt || 0) >= LOG_EVERY;
			if (log) { bucket.loggedAt = now; }
			return { ok: false, limit, retryMs: (1 - bucket.tokens) * limits[limit].refillMs, log };
		}
		found.push(bucket);
	}
	for (let i = 0; i < found.length; i++) { found[i].tokens -= 1; }
	return { ok: true };
}

/**
 * @description A key's bucket with the tokens it earned since it was last used (one every refillMs, up to burst). New keys start full
 */
function refill(limit, key, now, limits) {
	const { burst, refillMs } = limits[limit];
	const map = buckets[limit] ||= new Map();
	let bucket = map.get(key);
	if (!bucket) {
		if (map.size >= MAX_KEYS) { sweep(now); }
		bucket = { tokens: burst, at: now, loggedAt: 0 };
		map.set(key, bucket);
	}
	bucket.tokens = Math.min(burst, bucket.tokens + (now - bucket.at) / refillMs);
	bucket.at = now;
	return bucket;
}

/**
 * @description Drops the buckets that have filled up again (the same as a new one), then the oldest if a limit still has too many
 */
function sweep(now) {
	for (const limits of [LIMITS, LOGIN_LIMITS, AI_MOVE_LIMITS, CLIENT_ERROR_LIMITS]) {
		for (const limit of Object.keys(limits)) {
			const map = buckets[limit];
			if (!map) { continue; }
			for (const [key, bucket] of map) {
				if (bucket.tokens + (now - bucket.at) / limits[limit].refillMs >= limits[limit].burst) { map.delete(key); }
			}
			for (const key of map.keys()) { // MAPS KEEP THE ORDER KEYS WERE ADDED
				if (map.size < MAX_KEYS) { break; }
				map.delete(key);
			}
		}
	}
}

setInterval(() => sweep(Date.now()), 10 * 60 * 1000).unref(); // KEEPS MEMORY SMALL, unref: DOESN'T KEEP THE PROCESS (OR THE TESTS) RUNNING

/* ---------------------------------------------------------------- */
// IP Key
/* ---------------------------------------------------------------- */
/**
 * @description The bucket key for an address. One IPv6 connection usually gets a whole /64, so those share a bucket
 * @param  {[string]} ip [req.ip, nginx's X-Forwarded-For (index.js trusts the proxy on loopback)]
 * @return {[string]} key
 */
function ipKey(ip) {
	if (!ip) { return "unknown"; }
	if (ip.startsWith("::ffff:") && ip.includes(".")) { return ip.slice(7); } // IPv4 WRITTEN AS IPv6
	if (!ip.includes(":")) { return ip; } // IPv4
	const [head, tail = ""] = ip.split("%")[0].split("::");
	const left = head ? head.split(":") : [];
	const right = tail ? tail.split(":") : [];
	const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
	return `${groups.slice(0, 4).map((group) => parseInt(group || "0", 16).toString(16)).join(":")}::/64`;
}

/**
 * @description Empties every bucket (between tests)
 */
function resetLimits() {
	buckets = {};
}


module.exports = { limitNewGames, limitLogins, limitAiMoves, limitClientErrors, takeTokens, ipKey, resetLimits, LIMITS, LOGIN_LIMITS, AI_MOVE_LIMITS, CLIENT_ERROR_LIMITS };
