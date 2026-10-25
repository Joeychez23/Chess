/*
 *  env.js  --  chess server tests
 *	Test Settings
 *  Every test file requires this first: config.js exits without these, and setting them here (over any server/.env)
 *  means a test can never reach the real Auth0 tenant or Stockfish engine.
 *
 */

process.env.AUTH0_ISSUER_BASE_URL_ORIGIN = "auth0.test";
process.env.AUTH0_CONNECTION = "auth0-default-connection";
process.env.AUTH0_CLIENT_ID = "test-client";
process.env.AUTH0_CLIENT_SECRET = "test-secret";
process.env.JWT_SECRET = "test-jwt-secret";
process.env.ENGINE_URL = "https://engine.test/v1";
process.env.NODE_ENV = "test";
process.env.AWS_REGION = "us-east-1";
process.env.AWS_ACCESS_KEY_ID = "test"; // THE FAKE TABLES ANSWER EVERY CALL, THESE ONLY STOP THE SDK LOOKING FOR REAL ONES
process.env.AWS_SECRET_ACCESS_KEY = "test";
