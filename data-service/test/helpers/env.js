/*
 *  env.js  --  data service tests
 *	Test Settings
 *  Every test file requires this first: config.js exits without JWT_SECRET, and setting these here (over any data-service/.env)
 *  means a test can never reach real DynamoDB tables.
 *
 */

process.env.JWT_SECRET = "test-jwt-secret";
process.env.DATA_SERVICE_HOST = "127.0.0.1";
process.env.NODE_ENV = "test";
process.env.DYNAMODB_REGION = "us-west-2";
process.env.AWS_ACCESS_KEY_ID = "test"; // THE FAKE TABLES ANSWER EVERY CALL, THESE ONLY STOP THE SDK LOOKING FOR REAL ONES
process.env.AWS_SECRET_ACCESS_KEY = "test";
