const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
const { readPublicKey, keyRing } = require("./utils/sessionKeys.js");

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable ${name}. See server/.env.example.`);
    process.exit(1);
  }
  return value;
}

// A SIGNING SECRET MUST BE LONG ENOUGH THAT IT CAN'T BE GUESSED (THE COMMAND IN .env.example MAKES 96 CHARACTERS)
function longSecret(name) {
  const value = required(name);
  if (value.length < 32) {
    console.error(`${name} is too short (at least 32 characters). See server/.env.example.`);
    process.exit(1);
  }
  return value;
}

// A SESSION KEY MUST BE A P-256 PUBLIC KEY IN PEM (data-service/README.md -> Making the session keys). THE PRIVATE KEY NEVER GOES ON THIS SERVER
function publicKey(name, value) {
  if (!value) { return null; }
  const key = readPublicKey(value);
  if (!key) {
    console.error(`${name} isn't a P-256 public key in PEM. See data-service/README.md -> Making the session keys.`);
    process.exit(1);
  }
  return key;
}

// API_PORT wins so a PORT meant for the React dev server isn't picked up here.
const port = Number(process.env.API_PORT || process.env.PORT) || 8080;

const config = {
  port: port,
  isProduction: process.env.NODE_ENV === "production",

  // AUTH0 (LOGIN + MANAGEMENT API USER LOOKUP)
  auth0Domain: required("AUTH0_ISSUER_BASE_URL_ORIGIN"),
  auth0Connection: process.env.AUTH0_CONNECTION || "auth0-default-connection",
  auth0ClientId: required("AUTH0_CLIENT_ID"),
  auth0ClientSecret: required("AUTH0_CLIENT_SECRET"),
  auth0CallbackUrl: process.env.AUTH0_CALLBACK_URL || `http://localhost:${port}/api/auth/callback`, // MUST BE IN AUTH0 "ALLOWED CALLBACK URLS"
  clientUrl: process.env.CLIENT_URL || `http://localhost:${port}/`, // WHERE THE GAME IS SERVED, MUST BE IN AUTH0 "ALLOWED LOGOUT URLS"

  // SESSION KEYS (#252): THE DATA SERVICE SIGNS EVERY SESSION & GUEST TOKEN, THE SERVER ONLY CHECKS THEM, SO IT CAN'T MAKE ONE.
  // SESSION_PUBLIC_KEY_NEXT IS ALSO ACCEPTED WHILE THE KEY IS BEING CHANGED (data-service/README.md -> Changing the session key)
  sessionPublicKeys: keyRing([
    publicKey("SESSION_PUBLIC_KEY", required("SESSION_PUBLIC_KEY")),
    publicKey("SESSION_PUBLIC_KEY_NEXT", process.env.SESSION_PUBLIC_KEY_NEXT)
  ]),

  // STOCKFISH ENGINE API (chess-engine-api), THE SERVER ASKS IT FOR THE AI'S MOVES
  engineUrl: process.env.ENGINE_URL || "https://engine.aws-prac-route53.com/v1",

  // DATA SERVICE (data-service/), EVERY READ & WRITE OF THE GAMES & PLAYERS GOES THROUGH IT (dataClient.js)
  dataServiceUrl: process.env.DATA_SERVICE_URL || "http://127.0.0.1:8090", // ON AWS: THE DATA SERVICE'S PRIVATE IP
  dataServiceSecret: longSecret("DATA_SERVICE_SECRET"), // SIGNS EVERY CALL, THE SAME VALUE AS data-service/.env
};

module.exports = config;
