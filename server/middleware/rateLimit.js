/*
 *  rateLimit.js  --  chess server
 *	New Game, Login & AI Move Limits
 *  Every new game is a chess_db item kept for 25 days, and the table is on-demand (it bills per request), so making games
 *  in a loop would run up the bill. Each browser session, each IP & the whole site get a token bucket:
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
	site: { burst: 60, refillMs: 1000 }, // EVERYONE: 60 AT ONCE, THEN 1 A SECOND (A CAP ON WHAT NEW GAMES COST)
};
const LOGIN_LIMITS = { // PASSWORD LOGINS, CHECKED BEFORE AUTH0 IS ASKED
	loginIp: { burst: 20, refillMs: 30 * 1000 }, // AN IP (IPv6: ITS /64): 20 AT ONCE, THEN 1 EVERY 30 SECONDS
	loginEmail: { burst: 10, refillMs: 60 * 1000 }, // AN EMAIL (LOWERCASED), FROM ANY ADDRESS: 10 AT ONCE, THEN 1 A MINUTE
};
const SIGNUP_LIMITS = { // NEW ACCOUNTS, CHECKED BEFORE AUTH0 IS ASKED
	signupIp: { burst: 5, refillMs: 5 * 60 * 1000 }, // AN IP (IPv6: ITS /64): 5 AT ONCE, THEN 1 EVERY 5 MINUTES
	signupEmail: { burst: 5, refillMs: 60 * 1000 }, // AN EMAIL (LOWERCASED), FROM ANY ADDRESS: 5 AT ONCE, THEN 1 A MINUTE
};
const FORGOT_LIMITS = { // PASSWORD RESET EMAILS, CHECKED BEFORE AUTH0 IS ASKED, SO THE FORM CAN'T FILL SOMEONE'S INBOX
	forgotIp: { burst: 5, refillMs: 5 * 60 * 1000 }, // AN IP (IPv6: ITS /64): 5 AT ONCE, THEN 1 EVERY 5 MINUTES
	forgotEmail: { burst: 3, refillMs: 5 * 60 * 1000 }, // AN EMAIL (LOWERCASED), FROM ANY ADDRESS: 3 AT ONCE, THEN 1 EVERY 5 MINUTES
};
const AI_MOVE_LIMITS = { // /ai-move ASKS THE ENGINE, A PLAYER NEEDS ONE PER MOVE (PLUS RELOADS)
	aiMoveSession: { burst: 20, refillMs: 1000 }, // A SIGNED IN PLAYER OR A GUEST: 20 AT ONCE, THEN 1 A SECOND
	aiMoveIp: { burst: 60, refillMs: 250 }, // AN IP (IPv6: ITS /64): 60 AT ONCE, THEN 4 A SECOND
};
const ANALYSIS_LIMITS = { // /analysis ASKS THE ENGINE, A HINT PER MOVE PLUS THE BAR'S TWO. ITS OWN COUNTS, SO HINTS NEVER STOP THE AI MOVING
	analysisSession: { burst: 20, refillMs: 1000 }, // A SIGNED IN PLAYER OR A GUEST: 20 AT ONCE, THEN 1 A SECOND
	analysisIp: { burst: 60, refillMs: 250 }, // AN IP (IPv6: ITS /64): 60 AT ONCE, THEN 4 A SECOND
};
const CLIENT_ERROR_LIMITS = { // BROWSER ERROR REPORTS BECOME LOG LINES, SO A LOOP CAN'T FILL THE LOGS (#194)
	clientErrorIp: { burst: 10, refillMs: 30 * 1000 }, // AN IP (IPv6: ITS /64): 10 AT ONCE, THEN 1 EVERY 30 SECONDS
	clientErrorSite: { burst: 60, refillMs: 2 * 1000 }, // EVERYONE: 60 AT ONCE, THEN 1 EVERY 2 SECONDS
};
const SEARCH_LIMITS = { // PLAYER SEARCH AS YOU TYPE, username-search IS ON-DEMAND (IT BILLS PER REQUEST), SO THESE CAP WHAT SEARCHES COST
	searchSession: { burst: 20, refillMs: 1000 }, // A SIGNED IN PLAYER: 20 AT ONCE, THEN 1 A SECOND
	searchIp: { burst: 60, refillMs: 250 }, // AN IP (IPv6: ITS /64): 60 AT ONCE, THEN 4 A SECOND
	searchSite: { burst: 50, refillMs: 200 }, // EVERYONE: 50 AT ONCE, THEN 5 A SECOND
};
const FRIEND_LIMITS = { // FRIEND ACTIONS ARE A TRANSACTION ON TWO ROWS, & A REQUEST SHOWS ON SOMEONE ELSE'S HOME
	friendSession: { burst: 10, refillMs: 6 * 1000 }, // A SIGNED IN PLAYER: 10 AT ONCE, THEN 1 EVERY 6 SECONDS
	friendIp: { burst: 30, refillMs: 2 * 1000 }, // AN IP (IPv6: ITS /64): 30 AT ONCE, THEN 1 EVERY 2 SECONDS
};
const MAX_KEYS = 100000; // BUCKETS KEPT PER LIMIT, FULL ONES ARE DROPPED FIRST
const LOG_EVERY = 60 * 1000; // A KEY THAT KEEPS HITTING ITS LIMIT IS LOGGED ONCE A MINUTE

let buckets = {}; // LIMIT NAME -> KEY -> { tokens, at (ms), loggedAt (ms) }

/* ---------------------------------------------------------------- */
// Limiter
/* ---------------------------------------------------------------- */
/**
 * @description Builds a limit's middleware, every 429 is answered here. It runs before the route, so a refused request does nothing
 * @param  {[object]} limits [the buckets to take from, e.g. LOGIN_LIMITS]
 * @param  {[string]} logLabel [starts the log line: "<logLabel> limit (...)"]
 * @param  {[string]} refused [ends the player's message: "Too many <refused>, try again in ..."]
 * @param  {[function]} keysFor [req -> { limit name: bucket key }, a limit without a key isn't checked]
 * @return {[function]} middleware
 */
function limiter(limits, logLabel, refused, keysFor) {
	return (req, res, next) => {
		const keys = keysFor(req);
		const result = takeTokens(keys, Date.now(), limits);
		if (result.ok) { return next(); }

		const seconds = Math.ceil(result.retryMs / 1000);
		if (result.log) { console.log(`${logLabel} limit (${result.limit}: ${logKey(keys[result.limit])}) ${req.method} ${req.originalUrl.split("?")[0]}, retry in ${seconds}s`); } // NO QUERY, A SEARCH'S TEXT STAYS OUT OF THE LOGS
		res.set("Retry-After", String(seconds));
		return res.status(429).json({ status: 429, message: `Too many ${refused}, try again in ${seconds} second${seconds == 1 ? "" : "s"}` });
	};
}

/**
 * @description A bucket key for a log line. Anything but plain ids & addresses (an email is free text) is escaped & quoted, so it can't add a fake line that sets off an alarm
 */
function logKey(key) {
	return /^[\w:./-]+$/.test(key) ? key : JSON.stringify(key);
}

/**
 * @description The bucket key for a signed in player or a guest. The same from game to game. A guest's first game (no cookie yet), or a bot that drops it, has none, so only the IP & site limits apply
 */
function sessionKey(req) {
	if (req.user) { return `user:${req.user.user_id}`; }
	const guest = readGuestCookie(req);
	return guest ? `guest:${guest.session}` : undefined;
}

/* ---------------------------------------------------------------- */
// Limits
/* ---------------------------------------------------------------- */
// THE ROUTES THAT MAKE A GAME (NEW GAME, RESTART, INVITE). AFTER optionalAuth / requireAuth
const limitNewGames = limiter(LIMITS, "New game", "new games", (req) => ({ session: sessionKey(req), ip: ipKey(req.ip), site: "all" }));

// POST /api/auth/login. AFTER checkLogin (SO THE EMAIL IS A STRING) & BEFORE AUTH0 IS ASKED
const limitLogins = limiter(LOGIN_LIMITS, "Login", "logins", (req) => ({ loginIp: ipKey(req.ip), loginEmail: req.body.email.toLowerCase() }));

// POST /api/auth/signup. AFTER checkSignup (SO THE EMAIL IS A STRING) & BEFORE AUTH0 IS ASKED
const limitSignups = limiter(SIGNUP_LIMITS, "Signup", "sign ups", (req) => ({ signupIp: ipKey(req.ip), signupEmail: req.body.email.trim().toLowerCase() }));

// POST /api/auth/forgot. AFTER checkForgot (SO THE EMAIL IS A STRING) & BEFORE AUTH0 IS ASKED. REFUSES ANY EMAIL THE SAME WAY, SO IT DOESN'T SAY WHETHER ONE HAS AN ACCOUNT
const limitForgot = limiter(FORGOT_LIMITS, "Password reset", "reset requests", (req) => ({ forgotIp: ipKey(req.ip), forgotEmail: req.body.email.trim().toLowerCase() }));

// POST /api/chess/game/:gameId/ai-move. AFTER optionalAuth & BEFORE THE ENGINE IS ASKED
const limitAiMoves = limiter(AI_MOVE_LIMITS, "AI move", "AI move requests", (req) => ({ aiMoveSession: sessionKey(req), aiMoveIp: ipKey(req.ip) }));

// POST /api/chess/game/:gameId/analysis. AFTER optionalAuth & BEFORE THE ENGINE IS ASKED
const limitAnalysis = limiter(ANALYSIS_LIMITS, "Analysis", "hint requests", (req) => ({ analysisSession: sessionKey(req), analysisIp: ipKey(req.ip) }));

// POST /api/client-errors
const limitClientErrors = limiter(CLIENT_ERROR_LIMITS, "Browser error report", "error reports", (req) => ({ clientErrorIp: ipKey(req.ip), clientErrorSite: "all" }));

// GET /api/user/search. AFTER requireAuth
const limitPlayerSearch = limiter(SEARCH_LIMITS, "Player search", "searches", (req) => ({ searchSession: `user:${req.user.user_id}`, searchIp: ipKey(req.ip), searchSite: "all" }));

// POST /api/user/friends/<action>. AFTER requireAuth
const limitFriends = limiter(FRIEND_LIMITS, "Friend action", "friend requests", (req) => ({ friendSession: `user:${req.user.user_id}`, friendIp: ipKey(req.ip) }));

/* ---------------------------------------------------------------- */
// Take Tokens
/* ---------------------------------------------------------------- */
/**
 * @description Takes one token from each key's bucket, or none if any of them is empty (so a refused request costs nothing)
 * @param  {[object]} keys [{ session (optional), ip, site } bucket keys, { loginIp, loginEmail }, { signupIp, signupEmail }, { forgotIp, forgotEmail }, { aiMoveSession (optional), aiMoveIp }, { analysisSession (optional), analysisIp }, { searchSession, searchIp, searchSite } or { friendSession, friendIp }]
 * @param  {[number]} now [epoch ms]
 * @param  {[object]} limits [LIMITS (new games, the default), LOGIN_LIMITS, SIGNUP_LIMITS, FORGOT_LIMITS, AI_MOVE_LIMITS, ANALYSIS_LIMITS, CLIENT_ERROR_LIMITS, SEARCH_LIMITS or FRIEND_LIMITS]
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
	for (const limits of [LIMITS, LOGIN_LIMITS, SIGNUP_LIMITS, FORGOT_LIMITS, AI_MOVE_LIMITS, ANALYSIS_LIMITS, CLIENT_ERROR_LIMITS, SEARCH_LIMITS, FRIEND_LIMITS]) {
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


module.exports = { limitNewGames, limitLogins, limitSignups, limitForgot, limitAiMoves, limitAnalysis, limitClientErrors, limitPlayerSearch, limitFriends, takeTokens, ipKey, resetLimits, LIMITS, LOGIN_LIMITS, SIGNUP_LIMITS, FORGOT_LIMITS, AI_MOVE_LIMITS, ANALYSIS_LIMITS, CLIENT_ERROR_LIMITS, SEARCH_LIMITS, FRIEND_LIMITS };
