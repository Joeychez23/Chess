const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
const { readPrivateKey, readPublicKey, keyId, keyRing } = require("./utils/sessionKeys.js");

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable ${name}. See data-service/.env.example.`);
    process.exit(1);
  }
  return value;
}

// A SIGNING SECRET MUST BE LONG ENOUGH THAT IT CAN'T BE GUESSED (THE COMMAND IN .env.example MAKES 96 CHARACTERS)
function secret(name, value) {
  if (value && value.length < 32) {
    console.error(`${name} is too short (at least 32 characters). See data-service/.env.example.`);
    process.exit(1);
  }
  return value || null;
}

// A SESSION KEY MUST BE A P-256 KEY IN PEM, THE KIND ES256 SIGNS WITH (README -> Making the session keys)
function sessionKey(name, value, read) {
  if (!value) { return null; }
  const key = read(value);
  if (!key) {
    console.error(`${name} isn't a P-256 key in PEM. See README -> Making the session keys.`);
    process.exit(1);
  }
  return key;
}

// AUTH0'S PUBLIC KEYS (/.well-known/jwks.json), SAVED HERE BECAUSE THIS INSTANCE HAS NO INTERNET (README -> Saving Auth0's keys)
function auth0Keys(file) {
  try {
    const keys = new Map();
    const jwks = JSON.parse(fs.readFileSync(file, "utf8")).keys;
    for (let i = 0; i < jwks.length; i++) {
      if (jwks[i].kty == "RSA" && jwks[i].kid && jwks[i].use != "enc") { keys.set(jwks[i].kid, crypto.createPublicKey({ key: jwks[i], format: "jwk" })); }
    }
    if (keys.size == 0) { throw new Error("no RSA signing keys in it"); }
    return keys;
  } catch (err) {
    console.error(`Can't read Auth0's keys from ${file} (${err.message}). See README -> Saving Auth0's keys.`);
    process.exit(1);
  }
}

const sessionPrivateKey = sessionKey("SESSION_PRIVATE_KEY", required("SESSION_PRIVATE_KEY"), readPrivateKey);
const sessionPublicKey = crypto.createPublicKey(sessionPrivateKey);

const config = {
  // ONLY THE PRIVATE IP ON AWS (NEVER 0.0.0.0), SO ONLY THE VPC CAN REACH IT. 127.0.0.1 ON YOUR MAC
  host: process.env.DATA_SERVICE_HOST || "127.0.0.1",
  port: Number(process.env.DATA_SERVICE_PORT) || 8090,
  isProduction: process.env.NODE_ENV === "production",

  // SESSION KEYS (#252): ONLY THE DATA SERVICE HAS THE PRIVATE KEY, IT SIGNS EVERY ACCESS, REFRESH & GUEST TOKEN (utils/tokens.js).
  // THE CHESS SERVER ONLY HAS THE PUBLIC KEY. SESSION_PUBLIC_KEY_OLD IS STILL ACCEPTED WHILE THE KEY IS BEING CHANGED
  sessionPrivateKey: sessionPrivateKey,
  sessionKeyId: keyId(sessionPublicKey),
  sessionPublicKeys: keyRing([sessionPublicKey, sessionKey("SESSION_PUBLIC_KEY_OLD", process.env.SESSION_PUBLIC_KEY_OLD, readPublicKey)]),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",

  // AUTH0, ONLY TO CHECK THE id_token A LOGIN SENDS (THE SAME VALUES AS server/.env)
  auth0Domain: required("AUTH0_ISSUER_BASE_URL_ORIGIN"),
  auth0ClientId: required("AUTH0_CLIENT_ID"),
  auth0Keys: auth0Keys(process.env.AUTH0_JWKS_FILE || path.join(__dirname, "auth0-jwks.json")),

  // SIGNED REQUESTS: ONLY THE CHESS SERVER HAS THIS SECRET (middleware/signature.js). THE OLD ONE IS ALSO ACCEPTED WHILE IT'S BEING CHANGED
  dataServiceSecret: secret("DATA_SERVICE_SECRET", required("DATA_SERVICE_SECRET")),
  dataServiceSecretOld: secret("DATA_SERVICE_SECRET_OLD", process.env.DATA_SERVICE_SECRET_OLD),

  // DYNAMODB, THE REGION chess_db AND user_db ARE IN
  dynamoRegion: process.env.DYNAMODB_REGION || "us-west-2",
};

module.exports = config;
