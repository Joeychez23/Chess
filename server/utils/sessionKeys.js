/*
 *  sessionKeys.js  --  chess server & data service (the same file in both, data-service/test/shared.test.js)
 *	Session Keys (#252)
 *  Every session & guest token is signed by the data service with its private key (ES256). The chess server only has the public key,
 *  so it can check a token but never make one. Each token names its key (kid), so a new key & the old one both work while the key is changed
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const ALGORITHM = "ES256"; // THE ONLY ONE ACCEPTED: AN HS256 TOKEN (MADE WITH ANY SECRET) OR A "none" TOKEN IS REFUSED
const CURVE = "prime256v1"; // P-256, THE CURVE ES256 SIGNS WITH (openssl ecparam -name prime256v1)

/* ---------------------------------------------------------------- */
// Read Keys
/* ---------------------------------------------------------------- */
/**
 * @description The data service's private key from its PEM (SESSION_PRIVATE_KEY)
 * @param  {[string]} pem [the key as openssl writes it, "-----BEGIN PRIVATE KEY-----" or "-----BEGIN EC PRIVATE KEY-----"]
 * @return {[object]} key [crypto KeyObject | null when it isn't a P-256 private key]
 */
function readPrivateKey(pem) {
	try {
		return p256(crypto.createPrivateKey(pem));
	} catch {
		return null;
	}
}

/**
 * @description A public key from its PEM (SESSION_PUBLIC_KEY & the extra key while it's being changed)
 * @param  {[string]} pem [the key as openssl writes it, "-----BEGIN PUBLIC KEY-----"]
 * @return {[object]} key [crypto KeyObject | null when it isn't a P-256 public key]
 */
function readPublicKey(pem) {
	try {
		if (typeof pem != "string" || !pem.includes("PUBLIC KEY")) { return null; } // createPublicKey ALSO TAKES A PRIVATE KEY, WHICH MUST NEVER BE ON THE CHESS SERVER
		return p256(crypto.createPublicKey(pem));
	} catch {
		return null;
	}
}

// THE KEY WHEN IT'S A P-256 EC KEY (THE ONLY KIND ES256 USES), OTHERWISE null
function p256(key) {
	return key.asymmetricKeyType == "ec" && key.asymmetricKeyDetails?.namedCurve == CURVE ? key : null;
}

/* ---------------------------------------------------------------- */
// Key Id
/* ---------------------------------------------------------------- */
/**
 * @description A key's id (kid), made from the public key itself, so there's no id setting to get wrong
 * @param  {[object]} publicKey [crypto KeyObject]
 * @return {[string]} kid [16 characters]
 */
function keyId(publicKey) {
	return crypto.createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("base64url").slice(0, 16);
}

/**
 * @description The public keys a token can be checked with, by kid
 * @param  {[array]} publicKeys [crypto KeyObjects, a missing one (null) is skipped]
 * @return {[object]} keys [Map: kid -> KeyObject]
 */
function keyRing(publicKeys) {
	const keys = new Map();
	for (let i = 0; i < publicKeys.length; i++) {
		if (publicKeys[i]) { keys.set(keyId(publicKeys[i]), publicKeys[i]); }
	}
	return keys;
}

/* ---------------------------------------------------------------- */
// Read Session Token
/* ---------------------------------------------------------------- */
/**
 * @description Checks a token the data service signed: the key its kid names, ES256 only, not expired & the right type
 * @param  {[string]} token [JWT from a cookie or a header]
 * @param  {[string]} type ["access", "refresh" or "guest"]
 * @param  {[object]} keys [keyRing() of the public keys]
 * @return {[object]} payload [{ type, ... } | null when there is no token | undefined when it's expired, changed, another type or another key's]
 */
function readSessionToken(token, type, keys) {
	if (!token) { return null; }
	if (typeof token != "string") { return undefined; }
	try {
		const kid = jwt.decode(token, { complete: true })?.header?.kid;
		const key = keys.get(kid);
		if (!key) { return undefined; } // NOT ONE OF OUR KEYS (OR AN OLD HS256 TOKEN, WHICH HAS NO kid)
		const payload = jwt.verify(token, key, { algorithms: [ALGORITHM] });
		if (payload.type != type) { return undefined; } // A REFRESH TOKEN CAN'T BE USED AS AN ACCESS TOKEN, NOR A GUEST'S TOKEN AS EITHER
		return payload;
	} catch {
		return undefined;
	}
}

/**
 * @description The kid a token names, for the log when a key is missing
 * @return {[string]} kid [null when it has none]
 */
function tokenKeyId(token) {
	try {
		return jwt.decode(token, { complete: true })?.header?.kid || null;
	} catch {
		return null;
	}
}


module.exports = { ALGORITHM, readPrivateKey, readPublicKey, keyId, keyRing, readSessionToken, tokenKeyId };
