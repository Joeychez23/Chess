/*
 *  rateLimit.js  --  chess server
 *	New Game, Login & AI Move Limits
 *  Every new game is a chess_db item kept for 25 days, and the table is on-demand (it bills per request), so making
 *  games in a loop would run up the bill. Each browser session, each IP and the whole site get a token bucket: a burst
 *  of new games at once, then one more every so often. There's one server process, so the buckets live in memory.
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { readGuestCookie } = require("./auth.js");

// Each limit is a bucket of `burst` tokens that earns one more every `refillMs`.
// An IP key covers a whole IPv6 /64 (see ipKey), and an email key is lowercased and counts from any address.

// New games
const NEW_GAME_LIMITS = {
	// A signed in player or a guest (by their cookie): 10 at once, then 1 a minute
	session: { burst: 10, refillMs: 60 * 1000 },
	// An IP, which a few players can share: 30 at once, then 1 every 20 seconds
	ip: { burst: 30, refillMs: 20 * 1000 },
	// Everyone: 60 at once, then 1 a second (a cap on what new games cost)
	site: { burst: 60, refillMs: 1000 },
};

// Password logins, checked before Auth0 is asked
const LOGIN_LIMITS = {
	// An IP: 20 at once, then 1 every 30 seconds
	loginIp: { burst: 20, refillMs: 30 * 1000 },
	// An email: 10 at once, then 1 a minute
	loginEmail: { burst: 10, refillMs: 60 * 1000 },
};

// New accounts, checked before Auth0 is asked
const SIGNUP_LIMITS = {
	// An IP: 5 at once, then 1 every 5 minutes
	signupIp: { burst: 5, refillMs: 5 * 60 * 1000 },
	// An email: 5 at once, then 1 a minute
	signupEmail: { burst: 5, refillMs: 60 * 1000 },
};

// Password reset emails, checked before Auth0 is asked, so the form can't fill someone's inbox
const FORGOT_LIMITS = {
	// An IP: 5 at once, then 1 every 5 minutes
	forgotIp: { burst: 5, refillMs: 5 * 60 * 1000 },
	// An email: 3 at once, then 1 every 5 minutes
	forgotEmail: { burst: 3, refillMs: 5 * 60 * 1000 },
};

// /ai-move asks the engine, and a player needs one per move (plus reloads)
const AI_MOVE_LIMITS = {
	// A signed in player or a guest: 20 at once, then 1 a second
	aiMoveSession: { burst: 20, refillMs: 1000 },
	// An IP: 60 at once, then 4 a second
	aiMoveIp: { burst: 60, refillMs: 250 },
};

// /analysis asks the engine: a hint per move plus the evaluation bar's two. It has its own counts, so hints never
// stop the AI moving
const ANALYSIS_LIMITS = {
	// A signed in player or a guest: 20 at once, then 1 a second
	analysisSession: { burst: 20, refillMs: 1000 },
	// An IP: 60 at once, then 4 a second
	analysisIp: { burst: 60, refillMs: 250 },
};

// Browser error reports become log lines, so a loop in the browser must not be able to fill the logs
const CLIENT_ERROR_LIMITS = {
	// An IP: 10 at once, then 1 every 30 seconds
	clientErrorIp: { burst: 10, refillMs: 30 * 1000 },
	// Everyone: 60 at once, then 1 every 2 seconds
	clientErrorSite: { burst: 60, refillMs: 2 * 1000 },
};

// Player search as you type. username-search is on-demand (it bills per request), so these cap what searches cost
const SEARCH_LIMITS = {
	// A signed in player: 20 at once, then 1 a second
	searchSession: { burst: 20, refillMs: 1000 },
	// An IP: 60 at once, then 4 a second
	searchIp: { burst: 60, refillMs: 250 },
	// Everyone: 50 at once, then 5 a second
	searchSite: { burst: 50, refillMs: 200 },
};

// Friend actions are a transaction on two rows, and a request shows on someone else's Home
const FRIEND_LIMITS = {
	// A signed in player: 10 at once, then 1 every 6 seconds
	friendSession: { burst: 10, refillMs: 6 * 1000 },
	// An IP: 30 at once, then 1 every 2 seconds
	friendIp: { burst: 30, refillMs: 2 * 1000 },
};

// Deleting an account asks Auth0's management API and writes every game the player has. A player needs one, plus a
// retry or two
const ACCOUNT_DELETE_LIMITS = {
	// A signed in player: 5 at once, then 1 a minute
	accountDeleteSession: { burst: 5, refillMs: 60 * 1000 },
	// An IP: 20 at once, then 1 every 30 seconds
	accountDeleteIp: { burst: 20, refillMs: 30 * 1000 },
};

// The status display setting is a user_db write, and the client sends one change at a time (cards/statusPref.js
// holds back the rest)
const STATUS_DISPLAY_LIMITS = {
	// A signed in player: 1, then 1 every 5 minutes
	statusDisplaySession: { burst: 1, refillMs: 5 * 60 * 1000 },
};

// Default start settings, a user_db write per save
const SETTINGS_LIMITS = {
	// A signed in player: 10 at once, then 1 every 6 seconds
	settingsSession: { burst: 10, refillMs: 6 * 1000 },
};

// Every limit above, for the sweep
const ALL_LIMITS = [
	NEW_GAME_LIMITS,
	LOGIN_LIMITS,
	SIGNUP_LIMITS,
	FORGOT_LIMITS,
	AI_MOVE_LIMITS,
	ANALYSIS_LIMITS,
	CLIENT_ERROR_LIMITS,
	SEARCH_LIMITS,
	FRIEND_LIMITS,
	ACCOUNT_DELETE_LIMITS,
	STATUS_DISPLAY_LIMITS,
	SETTINGS_LIMITS,
];

// Buckets kept per limit; full ones are dropped first
const MAX_KEYS = 100000;

// A key that keeps hitting its limit is logged once a minute
const LOG_EVERY = 60 * 1000;

// How often the sweep runs, to keep memory small
const SWEEP_EVERY = 10 * 60 * 1000;

// Limit name -> key -> { tokens, at (ms), loggedAt (ms) }
let buckets = {};

/* ---------------------------------------------------------------- */
// Limiter
/* ---------------------------------------------------------------- */
/**
 * @description Builds a limit's middleware; every 429 is answered here. It runs before the route, so a refused request
 * does nothing
 * @param  {[object]} limits [the buckets to take from, e.g. LOGIN_LIMITS]
 * @param  {[string]} logLabel [starts the log line: "<logLabel> limit (...)"]
 * @param  {[string]} refused [ends the player's message: "Too many <refused>, try again in ..."]
 * @param  {[function]} keysFor [req -> { limit name: bucket key }, a limit without a key isn't checked]
 * @return {[function]} middleware
 */
function limiter(limits, logLabel, refused, keysFor) {
	return function limitRequest(req, res, next) {
		const keys = keysFor(req);
		const result = takeTokens(keys, Date.now(), limits);
		if (result.ok) {
			return next();
		}

		const seconds = Math.ceil(result.retryMs / 1000);
		if (result.log) {
			// No query string, so a search's text stays out of the logs
			const path = req.originalUrl.split("?")[0];
			console.log(`${logLabel} limit (${result.limit}: ${logKey(keys[result.limit])}) ${req.method} ${path}, retry in ${seconds}s`);
		}
		res.set("Retry-After", String(seconds));
		const plural = seconds == 1 ? "" : "s";
		return res.status(429).json({ status: 429, message: `Too many ${refused}, try again in ${seconds} second${plural}` });
	};
}

/**
 * @description A bucket key for a log line. Anything but plain ids and addresses (an email is free text) is escaped
 * and quoted, so it can't add a fake line that sets off an alarm
 * @param  {[string]} key [bucket key]
 * @return {[string]} key [safe to log]
 */
function logKey(key) {
	return /^[\w:./-]+$/.test(key) ? key : JSON.stringify(key);
}

/**
 * @description The bucket key for a signed in player or a guest, the same from game to game. A guest's first game
 * (no cookie yet), or a bot that drops the cookie, has none, so only the IP and site limits apply
 * @param  {[object]} req [request]
 * @return {[string]} key [or undefined]
 */
function sessionKey(req) {
	if (req.user) {
		return `user:${req.user.user_id}`;
	}
	const guest = readGuestCookie(req);
	return guest ? `guest:${guest.session}` : undefined;
}

/* ---------------------------------------------------------------- */
// Limits
/* ---------------------------------------------------------------- */
// The routes that make a game (new game, restart, invite). After optionalAuth / requireAuth
const limitNewGames = limiter(NEW_GAME_LIMITS, "New game", "new games", (req) => ({
	session: sessionKey(req),
	ip: ipKey(req.ip),
	site: "all",
}));

// POST /api/auth/login. After checkLogin (so the email is a string) and before Auth0 is asked
const limitLogins = limiter(LOGIN_LIMITS, "Login", "logins", (req) => ({
	loginIp: ipKey(req.ip),
	loginEmail: req.body.email.toLowerCase(),
}));

// POST /api/auth/signup. After checkSignup (so the email is a string) and before Auth0 is asked
const limitSignups = limiter(SIGNUP_LIMITS, "Signup", "sign ups", (req) => ({
	signupIp: ipKey(req.ip),
	signupEmail: req.body.email.trim().toLowerCase(),
}));

// POST /api/auth/forgot. After checkForgot (so the email is a string) and before Auth0 is asked. It refuses every
// email the same way, so it doesn't tell whether one has an account
const limitForgot = limiter(FORGOT_LIMITS, "Password reset", "reset requests", (req) => ({
	forgotIp: ipKey(req.ip),
	forgotEmail: req.body.email.trim().toLowerCase(),
}));

// POST /api/chess/game/:gameId/ai-move. After optionalAuth and before the engine is asked
const limitAiMoves = limiter(AI_MOVE_LIMITS, "AI move", "AI move requests", (req) => ({
	aiMoveSession: sessionKey(req),
	aiMoveIp: ipKey(req.ip),
}));

// POST /api/chess/cards/:gameId/action. After optionalAuth. It uses the AI move buckets themselves: a card game's
// actions and Card Guy's turns (limitAiMoves) share one count
const limitCardActions = limiter(AI_MOVE_LIMITS, "Card action", "card actions", (req) => ({
	aiMoveSession: sessionKey(req),
	aiMoveIp: ipKey(req.ip),
}));

// POST /api/chess/game/:gameId/analysis. After optionalAuth and before the engine is asked
const limitAnalysis = limiter(ANALYSIS_LIMITS, "Analysis", "hint requests", (req) => ({
	analysisSession: sessionKey(req),
	analysisIp: ipKey(req.ip),
}));

// POST /api/client-errors
const limitClientErrors = limiter(CLIENT_ERROR_LIMITS, "Browser error report", "error reports", (req) => ({
	clientErrorIp: ipKey(req.ip),
	clientErrorSite: "all",
}));

// GET /api/user/search. After requireAuth
const limitPlayerSearch = limiter(SEARCH_LIMITS, "Player search", "searches", (req) => ({
	searchSession: `user:${req.user.user_id}`,
	searchIp: ipKey(req.ip),
	searchSite: "all",
}));

// POST /api/user/friends/<action>. After requireAuth
const limitFriends = limiter(FRIEND_LIMITS, "Friend action", "friend requests", (req) => ({
	friendSession: `user:${req.user.user_id}`,
	friendIp: ipKey(req.ip),
}));

// DELETE /api/user. After requireAuth and before Auth0 is asked
const limitAccountDeletes = limiter(ACCOUNT_DELETE_LIMITS, "Account delete", "delete requests", (req) => ({
	accountDeleteSession: `user:${req.user.user_id}`,
	accountDeleteIp: ipKey(req.ip),
}));

// PUT /api/user/settings/status-display. After requireAuth and checkStatusDisplay, so a 400 spends no token
const limitStatusDisplay = limiter(STATUS_DISPLAY_LIMITS, "Status display", "status display changes", (req) => ({
	statusDisplaySession: `user:${req.user.user_id}`,
}));

// PUT /api/user/settings. After requireAuth
const limitSettings = limiter(SETTINGS_LIMITS, "Settings", "settings saves", (req) => ({
	settingsSession: `user:${req.user.user_id}`,
}));

/* ---------------------------------------------------------------- */
// Take Tokens
/* ---------------------------------------------------------------- */
/**
 * @description Takes one token from each key's bucket, or none if any of them is empty (so a refused request costs
 * nothing)
 * @param  {[object]} keys [bucket keys by limit name: { session (optional), ip, site }, { loginIp, loginEmail },
 * { signupIp, signupEmail }, { forgotIp, forgotEmail }, { aiMoveSession (optional), aiMoveIp },
 * { analysisSession (optional), analysisIp }, { searchSession, searchIp, searchSite } or { friendSession, friendIp }]
 * @param  {[number]} now [epoch ms]
 * @param  {[object]} limits [NEW_GAME_LIMITS (new games, the default), LOGIN_LIMITS, SIGNUP_LIMITS, FORGOT_LIMITS,
 * AI_MOVE_LIMITS, ANALYSIS_LIMITS, CLIENT_ERROR_LIMITS, SEARCH_LIMITS, FRIEND_LIMITS, ACCOUNT_DELETE_LIMITS,
 * STATUS_DISPLAY_LIMITS or SETTINGS_LIMITS]
 * @return {[object]} result [{ ok: true } | { ok: false, limit (the empty one), retryMs (until it has a token),
 * log (first refusal this minute) }]
 */
function takeTokens(keys, now, limits = NEW_GAME_LIMITS) {
	const found = [];
	for (const limit of Object.keys(limits)) {
		if (!keys[limit]) {
			continue;
		}
		const bucket = refill(limit, keys[limit], now, limits);
		if (bucket.tokens < 1) {
			const log = now - (bucket.loggedAt || 0) >= LOG_EVERY;
			if (log) {
				bucket.loggedAt = now;
			}
			return { ok: false, limit, retryMs: (1 - bucket.tokens) * limits[limit].refillMs, log };
		}
		found.push(bucket);
	}
	for (const bucket of found) {
		bucket.tokens -= 1;
	}
	return { ok: true };
}

/**
 * @description A key's bucket with the tokens it earned since it was last used (one every refillMs, up to burst).
 * New keys start full
 * @param  {[string]} limit [limit name]
 * @param  {[string]} key [bucket key]
 * @param  {[number]} now [epoch ms]
 * @param  {[object]} limits [the limit's group, e.g. LOGIN_LIMITS]
 * @return {[object]} bucket [{ tokens, at, loggedAt }]
 */
function refill(limit, key, now, limits) {
	const { burst, refillMs } = limits[limit];
	const map = buckets[limit] ||= new Map();
	let bucket = map.get(key);
	if (!bucket) {
		if (map.size >= MAX_KEYS) {
			sweep(now);
		}
		bucket = { tokens: burst, at: now, loggedAt: 0 };
		map.set(key, bucket);
	}
	bucket.tokens = Math.min(burst, bucket.tokens + (now - bucket.at) / refillMs);
	bucket.at = now;
	return bucket;
}

/**
 * @description Drops the buckets that have filled up again (the same as a new one), then the oldest if a limit still
 * has too many
 * @param  {[number]} now [epoch ms]
 */
function sweep(now) {
	for (const limits of ALL_LIMITS) {
		for (const limit of Object.keys(limits)) {
			const map = buckets[limit];
			if (!map) {
				continue;
			}
			for (const [key, bucket] of map) {
				if (bucket.tokens + (now - bucket.at) / limits[limit].refillMs >= limits[limit].burst) {
					map.delete(key);
				}
			}
			// Maps keep the order keys were added in, so this drops the oldest first
			for (const key of map.keys()) {
				if (map.size < MAX_KEYS) {
					break;
				}
				map.delete(key);
			}
		}
	}
}

// unref: the timer doesn't keep the process (or the tests) running
setInterval(() => sweep(Date.now()), SWEEP_EVERY).unref();

/* ---------------------------------------------------------------- */
// IP Key
/* ---------------------------------------------------------------- */
/**
 * @description The bucket key for an address. One IPv6 connection usually gets a whole /64, so those share a bucket
 * @param  {[string]} ip [req.ip, nginx's X-Forwarded-For (index.js trusts the proxy on loopback)]
 * @return {[string]} key
 */
function ipKey(ip) {
	if (!ip) {
		return "unknown";
	}
	// IPv4 written as IPv6
	if (ip.startsWith("::ffff:") && ip.includes(".")) {
		return ip.slice(7);
	}
	// IPv4
	if (!ip.includes(":")) {
		return ip;
	}
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


module.exports = {
	limitNewGames,
	limitLogins,
	limitSignups,
	limitForgot,
	limitAiMoves,
	limitCardActions,
	limitAnalysis,
	limitClientErrors,
	limitPlayerSearch,
	limitFriends,
	limitAccountDeletes,
	limitStatusDisplay,
	limitSettings,
	takeTokens,
	ipKey,
	resetLimits,
	NEW_GAME_LIMITS,
	LOGIN_LIMITS,
	SIGNUP_LIMITS,
	FORGOT_LIMITS,
	AI_MOVE_LIMITS,
	ANALYSIS_LIMITS,
	CLIENT_ERROR_LIMITS,
	SEARCH_LIMITS,
	ACCOUNT_DELETE_LIMITS,
	FRIEND_LIMITS,
	STATUS_DISPLAY_LIMITS,
	SETTINGS_LIMITS,
};
