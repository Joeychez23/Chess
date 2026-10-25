/*
 *  rateLimit.js  --  chess server
 *	New Game Limits
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
const MAX_KEYS = 100000; // BUCKETS KEPT PER LIMIT, FULL ONES ARE DROPPED FIRST
const LOG_EVERY = 60 * 1000; // A KEY THAT KEEPS HITTING ITS LIMIT IS LOGGED ONCE A MINUTE

let buckets = { session: new Map(), ip: new Map(), site: new Map() }; // KEY -> { tokens, at (ms), loggedAt (ms) }

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
// Take Tokens
/* ---------------------------------------------------------------- */
/**
 * @description Takes one token from each key's bucket, or none if any of them is empty (so a refused request costs nothing)
 * @param  {[object]} keys [{ session (optional), ip, site } bucket keys]
 * @param  {[number]} now [epoch ms]
 * @return {[object]} result [{ ok: true } | { ok: false, limit (the empty one), retryMs (until it has a token), log (first refusal this minute) }]
 */
function takeTokens(keys, now) {
	const found = [];
	for (const limit of Object.keys(LIMITS)) {
		if (!keys[limit]) { continue; }
		const bucket = refill(limit, keys[limit], now);
		if (bucket.tokens < 1) {
			const log = now - (bucket.loggedAt || 0) >= LOG_EVERY;
			if (log) { bucket.loggedAt = now; }
			return { ok: false, limit, retryMs: (1 - bucket.tokens) * LIMITS[limit].refillMs, log };
		}
		found.push(bucket);
	}
	for (let i = 0; i < found.length; i++) { found[i].tokens -= 1; }
	return { ok: true };
}

/**
 * @description A key's bucket with the tokens it earned since it was last used (one every refillMs, up to burst). New keys start full
 */
function refill(limit, key, now) {
	const { burst, refillMs } = LIMITS[limit];
	const map = buckets[limit];
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
	for (const limit of Object.keys(LIMITS)) {
		const map = buckets[limit];
		for (const [key, bucket] of map) {
			if (bucket.tokens + (now - bucket.at) / LIMITS[limit].refillMs >= LIMITS[limit].burst) { map.delete(key); }
		}
		for (const key of map.keys()) { // MAPS KEEP THE ORDER KEYS WERE ADDED
			if (map.size < MAX_KEYS) { break; }
			map.delete(key);
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
	buckets = { session: new Map(), ip: new Map(), site: new Map() };
}


module.exports = { limitNewGames, takeTokens, ipKey, resetLimits, LIMITS };
