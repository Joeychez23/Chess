/*
 *  env.js  --  data service tests
 *	Test Settings
 *  Every test file requires this first: config.js exits without its keys, and setting these here (over any data-service/.env)
 *  means a test can never reach real DynamoDB tables or use a real key (helpers/keys.js makes new ones each run).
 *
 */

Object.assign(process.env, require("./keys.js").settings); // SESSION_PRIVATE_KEY, SESSION_PUBLIC_KEY_OLD (A KEY CHANGE) & AUTH0_JWKS_FILE
process.env.AUTH0_ISSUER_BASE_URL_ORIGIN = "auth0.test"; // THE id_tokens IN helpers/keys.js ARE FOR THIS TENANT & CLIENT
process.env.AUTH0_CLIENT_ID = "test-client";
process.env.DATA_SERVICE_SECRET = "test-data-service-secret-0123456789abcdef";
process.env.DATA_SERVICE_SECRET_OLD = "test-old-data-service-secret-0123456789abcdef"; // signature.test.js: THE OLD SECRET STILL WORKS DURING A CHANGE
process.env.DATA_SERVICE_HOST = "127.0.0.1";
process.env.NODE_ENV = "test";
process.env.DYNAMODB_REGION = "us-west-2";
process.env.AWS_ACCESS_KEY_ID = "test"; // THE FAKE TABLES ANSWER EVERY CALL, THESE ONLY STOP THE SDK LOOKING FOR REAL ONES
process.env.AWS_SECRET_ACCESS_KEY = "test";
