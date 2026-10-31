/*
 *  keys.js  --  data service tests (the chess server's tests use it too)
 *	Test Keys
 *  New keys for every test run, so no real key is ever in the repo: the session key pair (SESSION_PRIVATE_KEY & SESSION_PUBLIC_KEY),
 *  the keys on either side of a key change, a key nobody set up, and a stand-in for Auth0's signing key with its saved keys file (AUTH0_JWKS_FILE).
 *  env.js sets the variables, the tests sign their tokens here
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const jwt = require("jsonwebtoken");

const AUTH0_KID = "test-auth0-key";

const ecPair = () => crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pem = (key, type) => key.export({ type, format: "pem" });

const pairs = {
	session: ecPair(), // THE DATA SERVICE'S KEY
	old: ecPair(),     // THE KEY BEFORE A CHANGE: SESSION_PUBLIC_KEY_OLD ON THE DATA SERVICE
	next: ecPair(),    // THE KEY AFTER A CHANGE: SESSION_PUBLIC_KEY_NEXT ON THE CHESS SERVER
	stranger: ecPair() // NOBODY'S KEY
};
const auth0 = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }); // STANDS IN FOR THE AUTH0 TENANT'S SIGNING KEY
let forger = null; // ANOTHER RSA KEY, ONLY MADE WHEN A TEST NEEDS ONE

const jwksFolder = fs.mkdtempSync(path.join(os.tmpdir(), "chess-jwks-"));
const jwksFile = path.join(jwksFolder, "auth0-jwks.json");
fs.writeFileSync(jwksFile, JSON.stringify({ keys: [{ ...auth0.publicKey.export({ format: "jwk" }), kid: AUTH0_KID, use: "sig", alg: "RS256" }] })); // LIKE https://<tenant>/.well-known/jwks.json
process.on("exit", () => fs.rmSync(jwksFolder, { recursive: true, force: true }));

/**
 * @description The settings env.js puts in process.env
 */
const settings = {
	SESSION_PRIVATE_KEY: pem(pairs.session.privateKey, "pkcs8"),
	SESSION_PUBLIC_KEY: pem(pairs.session.publicKey, "spki"),
	SESSION_PUBLIC_KEY_OLD: pem(pairs.old.publicKey, "spki"),
	SESSION_PUBLIC_KEY_NEXT: pem(pairs.next.publicKey, "spki"),
	AUTH0_JWKS_FILE: jwksFile
};

/* ---------------------------------------------------------------- */
// Session & Guest Tokens
/* ---------------------------------------------------------------- */
/**
 * @description Signs a token like the data service does (utils/tokens.js), or one it would never make
 * @param  {[object]} payload [{ type, ... }]
 * @param  {[object]} options [{ key: "session" (default), "old", "next" or "stranger", expired: true, expiresIn (default 15m, or a number of seconds),
 * algorithm: "HS256" (signed with secret, default the real public key's PEM, & the real kid) or "none" }]
 * @return {[string]} token
 */
function signToken(payload, options = {}) {
	const pair = pairs[options.key || "session"];
	const kid = keyId(pair.publicKey);
	if (options.algorithm == "HS256") {
		const secret = options.secret || settings.SESSION_PUBLIC_KEY;
		return rawToken({ alg: "HS256", typ: "JWT", kid }, timed(payload, options), (text) => crypto.createHmac("sha256", secret).update(text).digest("base64url"));
	}
	if (options.algorithm == "none") { return rawToken({ alg: "none", typ: "JWT", kid }, timed(payload, options)); }
	return jwt.sign(timed(payload, options), pair.privateKey, { algorithm: "ES256", keyid: kid });
}

/**
 * @description A signed in player's session token
 * @param  {[object]} user [session user]
 * @param  {[object]} options [{ type: "access" (default) or "refresh", sid (default "test-sid"), plus signToken's options }]
 */
function sessionToken(user, options = {}) {
	return signToken({ type: options.type || "access", user, sid: options.sid || "test-sid" }, options);
}

/**
 * @description A guest's guest_game token
 * @param  {[string]} gameId [the guest's game id, also their player id]
 * @param  {[object]} options [{ session (default "testsession"), plus signToken's options }]
 */
function guestToken(gameId, options = {}) {
	return signToken({ type: "guest", game_id: gameId, session: options.session || "testsession" }, { expiresIn: "365d", ...options });
}

/**
 * @description The same token with its payload changed & its signature kept, which must never check out
 * @param  {[string]} token [a signed JWT]
 * @param  {[object]} changes [fields to set in the payload]
 */
function tamper(token, changes) {
	const [header, payload, signature] = token.split(".");
	const changed = { ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")), ...changes };
	return `${header}.${Buffer.from(JSON.stringify(changed)).toString("base64url")}.${signature}`;
}

/* ---------------------------------------------------------------- */
// Auth0's id_token
/* ---------------------------------------------------------------- */
/**
 * @description An id_token like Auth0 gives the chess server's code exchange
 * @param  {[object]} claims [{ sub, email, ... }, over the defaults: our tenant (iss), our client (aud), issued now, 10 hours, a new nonce]
 * @param  {[object]} options [{ forged: true (another RSA key, the same kid), kid: another key id }]
 * @return {[string]} idToken
 */
function idToken(claims, options = {}) {
	const now = Math.floor(Date.now() / 1000);
	const payload = { iss: `https://${process.env.AUTH0_ISSUER_BASE_URL_ORIGIN}/`, aud: process.env.AUTH0_CLIENT_ID, iat: now, exp: now + 10 * 60 * 60, email_verified: true, nonce: crypto.randomBytes(8).toString("hex"), ...claims }; // A NEW nonce: EACH LOGIN'S id_token IS DIFFERENT, LIKE AUTH0'S
	if (options.forged && !forger) { forger = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }); }
	return jwt.sign(payload, options.forged ? forger.privateKey : auth0.privateKey, { algorithm: "RS256", keyid: options.kid || AUTH0_KID });
}

/* ---------------------------------------------------------------- */
// Helpers
/* ---------------------------------------------------------------- */

function keyId(publicKey) { // THE SAME AS utils/sessionKeys.js, WORKED OUT HERE SO A TEST CAN'T PASS JUST BECAUSE BOTH SIDES SHARE A BUG
	return crypto.createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("base64url").slice(0, 16);
}

function timed(payload, options) {
	const now = Math.floor(Date.now() / 1000);
	if (options.expired) { return { ...payload, iat: now - 3600, exp: now - 60 }; }
	const seconds = typeof options.expiresIn == "number" ? options.expiresIn : { "15m": 15 * 60, "7d": 7 * 24 * 60 * 60, "365d": 365 * 24 * 60 * 60 }[options.expiresIn || "15m"];
	return { ...payload, iat: now, exp: now + seconds };
}

function rawToken(header, payload, sign) {
	const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
	const text = `${part(header)}.${part(payload)}`;
	return `${text}.${sign ? sign(text) : ""}`;
}


module.exports = { settings, signToken, sessionToken, guestToken, tamper, idToken, AUTH0_KID };
