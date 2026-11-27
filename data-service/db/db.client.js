/*
 *  db.client.js  --  data service
 *	Chess Move Engine
 *  The one DynamoDB client every db/ file shares, the table names, the constants more than one file uses,
 *  and updateOrConflict for the conditional saves
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const config = require("../config");

// The region comes from DYNAMODB_REGION (us-west-2 by default). Credentials come from ~/.aws locally, or the data service's IAM role on AWS.
// Every db/ file uses this one client: the tests swap DynamoDB.prototype's methods, and two clients would mean two connection pools
const connection = new DynamoDB({ region: config.dynamoRegion });

// Table names match terraform/aws-enviroment/locals.tf (the folder really is spelled that way)
const CHESS_TABLE = "chess_db"; // Key: game_id (S)
const USER_TABLE = "user_db"; // Key: user_id (S). Players' rows, and the username#<name> items that hold each username (claimUsername)

const GAME_TTL = 60 * 60 * 24 * 25; // Games expire 25 days after the last move (seconds)
const LIST_SAVE_TRIES = 5; // A save that lost a race reads the row again and retries
const BATCH_READ_TRIES = 5; // A throttled batch get (UnprocessedKeys) asks again for the keys it didn't read
const BATCH_READ_DELAY = 50; // Milliseconds before the first retry, doubled each try

/* ---------------------------------------------------------------- */
// Expire Time
/* ---------------------------------------------------------------- */
/**
 * @description Builds the expireAt value DynamoDB TTL reads on chess_db
 * @return {[string]} expireAt [epoch SECONDS as a string, the SDK only takes strings for N]
 */
function expireTime() {
	return `${Math.floor(Date.now() / 1000) + GAME_TTL}`;
}

/* ---------------------------------------------------------------- */
// Check Tables
/* ---------------------------------------------------------------- */
/**
 * @description Reads a key that's never saved from each table (GET /health/tables), the cheapest call this role is allowed.
 * Throws when DynamoDB can't answer
 */
async function checkTables() {
	await Promise.all([
		connection.getItem({ TableName: CHESS_TABLE, Key: { game_id: { S: "health-check" } } }),
		connection.getItem({ TableName: USER_TABLE, Key: { user_id: { S: "health-check" } } })
	]);
}

/* ---------------------------------------------------------------- */
// Update or conflict
/* ---------------------------------------------------------------- */
/**
 * @description Runs a conditional update. When the condition fails (another request saved first, or the game moved on), the caller
 * gets its conflict reply instead of an error. Any other error is thrown
 * @param  {[object]} params [updateItem params with a ConditionExpression]
 * @param  {[string]} conflictMessage [the message when the condition failed]
 * @return {[object]} saved [{ status: 200, response (DynamoDB's answer) } | { status: 409, message: conflictMessage }]
 */
async function updateOrConflict(params, conflictMessage) {
	try {
		return { status: 200, response: await connection.updateItem(params) };
	} catch (err) {
		if (err.name == "ConditionalCheckFailedException") { return { status: 409, message: conflictMessage }; }
		throw err;
	}
}

module.exports = {
	connection,
	CHESS_TABLE,
	USER_TABLE,
	LIST_SAVE_TRIES,
	BATCH_READ_TRIES,
	BATCH_READ_DELAY,
	expireTime,
	checkTables,
	updateOrConflict
};
