const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable ${name}. See server/.env.example.`);
    process.exit(1);
  }
  return value;
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

  // JWT (OUR OWN SESSION TOKENS)
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",

  // STOCKFISH ENGINE API (chess-engine-api), THE SERVER ASKS IT FOR THE AI'S MOVES
  engineUrl: process.env.ENGINE_URL || "https://engine.aws-prac-route53.com/v1",
};

module.exports = config;
