/*
 *  fakeDynamo.js  --  data service tests
 *	In-memory DynamoDB
 *  Replaces the DynamoDB client's calls (getItem, putItem, updateItem, deleteItem, batchGetItem, transactWriteItems) with tables held in memory,
 *  so data-service/dynamoDB.js runs unchanged with no AWS account. It understands the update and condition expressions
 *  dynamoDB.js uses: SET / REMOVE, =, <>, <, <=, >, >=, AND, OR, parentheses, attribute_exists and attribute_not_exists.
 *  Reads are up to date (strongly consistent) unless a test turns on staleReads(), see below.
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { DynamoDB } = require("@aws-sdk/client-dynamodb");

const tables = new Map(); // TABLE NAME -> Map(KEY -> ITEM)
const previous = new Map(); // TABLE NAME -> Map(KEY -> THE ITEM BEFORE ITS LAST WRITE, null = IT DIDN'T EXIST)
let lagging = false; // staleReads()
let throttledReads = 0; // throttleBatchReads()
let failingReads = false; // failBatchReads()
const failingWrites = new Set(); // failTransactionWrite()
const KEYS = { chess_db: "game_id", user_db: "user_id" }; // HASH KEYS, MATCH terraform/modules/dynamodb

/* ---------------------------------------------------------------- */
// Install
/* ---------------------------------------------------------------- */
/**
 * @description Points every DynamoDB client at the in-memory tables. The client in dynamoDB.js looks its methods up
 * on the prototype when it calls them, so this works even after dynamoDB.js is loaded
 */
function install() {
	DynamoDB.prototype.getItem = async (params) => getItem(params);
	DynamoDB.prototype.putItem = async (params) => putItem(params);
	DynamoDB.prototype.updateItem = async (params) => updateItem(params);
	DynamoDB.prototype.deleteItem = async (params) => deleteItem(params);
	DynamoDB.prototype.batchGetItem = async (params) => batchGetItem(params);
	DynamoDB.prototype.transactWriteItems = async (params) => transactWriteItems(params);
}

/**
 * @description Empties every table (between tests)
 */
function reset() {
	tables.clear();
	previous.clear();
	lagging = false;
	throttledReads = 0;
	failingReads = false;
	failingWrites.clear();
}

/**
 * @description Makes reads behave like DynamoDB's default eventually consistent reads at their worst: a read without
 * ConsistentRead returns each item as it was before its last write (a new item isn't found yet). ConsistentRead: true still sees every write
 * @param  {[boolean]} on [true until reset()]
 */
function staleReads(on) {
	lagging = on;
}

/**
 * @description Makes the next batch gets act throttled, like DynamoDB under load: each table's last key isn't read,
 * it comes back in UnprocessedKeys
 * @param  {[number]} calls [how many batch gets, Infinity = every one until reset()]
 */
function throttleBatchReads(calls) {
	throttledReads = calls;
}

/**
 * @description Makes every batch get throw, like DynamoDB when it can't answer
 * @param  {[boolean]} on [true until reset()]
 */
function failBatchReads(on) {
	failingReads = on;
}

/**
 * @description Makes every transaction that writes this item cancel, like DynamoDB when another request holds it, until reset()
 * @param  {[string]} key [game_id or user_id]
 */
function failTransactionWrite(key) {
	failingWrites.add(key);
}

/**
 * @description An item as stored, for checking what a route saved
 * @param  {[string]} tableName ["chess_db" or "user_db"]
 * @param  {[string]} key [game_id or user_id]
 * @return {[object]} item [a copy, undefined when it doesn't exist]
 */
function peek(tableName, key) {
	const item = table(tableName).get(key);
	return item ? structuredClone(item) : undefined;
}

/**
 * @description Signs a player in like a login does (startSession in dynamoDB.js): their row with empty game lists if they have none,
 * & the session id their test access tokens carry (helpers/keys.js, "test-sid"). A row that already has a session id keeps it
 * @param  {[string]} userId [user_id without "auth0|"]
 * @param  {[string]} sid [the session id, default "test-sid"]
 */
function signIn(userId, sid = "test-sid") {
	const row = table("user_db").get(userId);
	if (row?.sid) { return; }
	const lists = { open_games: { S: "[]" }, requested_games: { S: "[]" }, closed_games: { S: "[]" } };
	writeItem("user_db", userId, { ...(row || { user_id: { S: userId }, ...lists }), sid: { S: sid } });
}

/* ---------------------------------------------------------------- */
// Calls
/* ---------------------------------------------------------------- */

function table(name) {
	if (!tables.has(name)) { tables.set(name, new Map()); }
	return tables.get(name);
}

function keyOf(tableName, key) {
	return key[KEYS[tableName]].S;
}

/**
 * @description The item a read gets: the stored one, or with staleReads() on & no ConsistentRead, the one from before its last write
 */
function readItem(tableName, key, consistent) {
	const before = previous.get(tableName);
	if (lagging && !consistent && before?.has(key)) { return before.get(key) || undefined; }
	return table(tableName).get(key);
}

/**
 * @description Saves an item (undefined deletes it) & keeps the one it replaces for staleReads()
 */
function writeItem(tableName, key, item) {
	if (!previous.has(tableName)) { previous.set(tableName, new Map()); }
	previous.get(tableName).set(key, table(tableName).get(key) || null);
	if (item) { table(tableName).set(key, item); }
	else { table(tableName).delete(key); }
}

async function getItem({ TableName, Key, ConsistentRead }) {
	const item = readItem(TableName, keyOf(TableName, Key), ConsistentRead);
	return item ? { Item: structuredClone(item) } : {};
}

async function putItem({ TableName, Item, ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues }) {
	const key = Item[KEYS[TableName]].S;
	check(table(TableName).get(key), ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues);
	writeItem(TableName, key, structuredClone(Item));
	return {};
}

async function updateItem({ TableName, Key, UpdateExpression, ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues, ReturnValues }) {
	const key = keyOf(TableName, Key);
	const existing = table(TableName).get(key);
	check(existing, ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues);

	const item = existing ? structuredClone(existing) : structuredClone(Key); // LIKE DYNAMODB, AN UPDATE MAKES THE ITEM IF IT ISN'T THERE
	const [, setPart = "", removePart = ""] = UpdateExpression.match(/^\s*(?:SET\s+(.*?))?\s*(?:REMOVE\s+(.*))?\s*$/s);
	const removed = removePart.split(",").map((part) => part.trim()).filter(Boolean);
	const usedValues = `${UpdateExpression} ${ConditionExpression || ""}`.match(/:\w+/g) || [];
	if (Object.keys(ExpressionAttributeValues || {}).some((value) => !usedValues.includes(value))) { throw Object.assign(new Error("Value provided in ExpressionAttributeValues unused in expressions"), { name: "ValidationException" }); }
	for (const assignment of setPart.split(",").map((part) => part.trim()).filter(Boolean)) {
		const [name, value] = assignment.split("=").map((part) => part.trim());
		if (removed.includes(name)) { throw Object.assign(new Error("Two document paths overlap with each other"), { name: "ValidationException" }); } // LIKE DYNAMODB
		item[attributeName(name, ExpressionAttributeNames)] = structuredClone(ExpressionAttributeValues[value]);
	}
	for (const name of removed) {
		delete item[attributeName(name, ExpressionAttributeNames)];
	}
	writeItem(TableName, key, item);
	return ReturnValues == "ALL_NEW" ? { Attributes: structuredClone(item) } : {};
}

async function deleteItem({ TableName, Key, ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues }) {
	const key = keyOf(TableName, Key);
	check(table(TableName).get(key), ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues);
	writeItem(TableName, key, undefined);
	return {};
}

async function batchGetItem({ RequestItems }) {
	if (failingReads) { throw Object.assign(new Error("Throughput exceeds the current capacity of your table"), { name: "ProvisionedThroughputExceededException" }); }
	const throttled = throttledReads > 0;
	if (throttled) { throttledReads--; }
	const Responses = {};
	const UnprocessedKeys = {};
	for (const [TableName, request] of Object.entries(RequestItems)) {
		const keys = throttled ? request.Keys.slice(0, -1) : request.Keys;
		if (throttled) { UnprocessedKeys[TableName] = { ...request, Keys: request.Keys.slice(-1) }; }
		Responses[TableName] = keys.map((key) => readItem(TableName, keyOf(TableName, key), request.ConsistentRead)).filter(Boolean).map((item) => structuredClone(item));
	}
	return { Responses, UnprocessedKeys };
}

/**
 * @description All or nothing, like DynamoDB: every condition is checked first, & if any is false nothing is written & it throws
 * TransactionCanceledException with a CancellationReasons code for each item, in order ("None", "ConditionalCheckFailed" or "TransactionConflict")
 */
async function transactWriteItems({ TransactItems }) {
	const writes = TransactItems.map((transactItem) => {
		const [type, params] = Object.entries(transactItem)[0]; // Put, Update OR Delete
		const key = type == "Put" ? params.Item[KEYS[params.TableName]].S : keyOf(params.TableName, params.Key);
		return { type, params, key };
	});
	if (new Set(writes.map((write) => `${write.params.TableName}/${write.key}`)).size != writes.length) { // DYNAMODB REFUSES TWO WRITES TO ONE ITEM
		const err = new Error("Transaction request cannot include multiple operations on one item");
		err.name = "ValidationException";
		throw err;
	}

	const reasons = writes.map(({ params, key }) => {
		if (failingWrites.has(key)) { return { Code: "TransactionConflict", Message: "Transaction is ongoing for the item" }; }
		try {
			check(table(params.TableName).get(key), params.ConditionExpression, params.ExpressionAttributeNames, params.ExpressionAttributeValues);
			return { Code: "None" };
		} catch {
			return { Code: "ConditionalCheckFailed", Message: "The conditional request failed" };
		}
	});
	if (reasons.some((reason) => reason.Code != "None")) {
		const err = new Error(`Transaction cancelled, please refer cancellation reasons for specific reasons [${reasons.map((reason) => reason.Code).join(", ")}]`);
		err.name = "TransactionCanceledException";
		err.CancellationReasons = reasons;
		throw err;
	}

	for (const { type, params } of writes) { // EVERY CONDITION HOLDS, SO EACH WRITE GOES THROUGH. NO AWAIT: THEY ALL LAND BEFORE ANOTHER REQUEST RUNS
		if (type == "Put") { putItem(params); }
		if (type == "Update") { updateItem(params); }
		if (type == "Delete") { deleteItem(params); }
	}
	return {};
}

/* ---------------------------------------------------------------- */
// Condition Expressions
/* ---------------------------------------------------------------- */
/**
 * @description Throws DynamoDB's ConditionalCheckFailedException when the condition is false for the stored item
 */
function check(item, expression, names, values) {
	if (!expression) { return; }
	const tokens = expression.match(/\(|\)|<>|<=|>=|=|<|>|,|[#:]?[A-Za-z_][A-Za-z0-9_]*/g);
	let position = 0;
	const peekToken = () => tokens[position];
	const next = () => tokens[position++];

	function operand(token) {
		if (token.startsWith(":")) { return values[token]; }
		return item?.[attributeName(token, names)]; // A MISSING ATTRIBUTE IS undefined
	}

	function factor() {
		const token = next();
		if (token == "(") { const result = orExpression(); next(); return result; }
		if (token == "NOT") { return !factor(); }
		if (token == "attribute_exists" || token == "attribute_not_exists") {
			next(); // (
			const exists = item?.[attributeName(next(), names)] !== undefined;
			next(); // )
			return token == "attribute_exists" ? exists : !exists;
		}
		const left = operand(token);
		const operator = next();
		const right = operand(next());
		return compare(left, operator, right);
	}

	function andExpression() {
		let result = factor();
		while (peekToken() == "AND") { next(); result = factor() && result; }
		return result;
	}

	function orExpression() {
		let result = andExpression();
		while (peekToken() == "OR") { next(); result = andExpression() || result; }
		return result;
	}

	if (!orExpression()) {
		const err = new Error("The conditional request failed");
		err.name = "ConditionalCheckFailedException";
		throw err;
	}
}

/**
 * @description Compares two attribute values. Like DynamoDB, any comparison with a missing attribute is false
 */
function compare(left, operator, right) {
	if (left === undefined || right === undefined) { return false; }
	const a = left.N !== undefined ? Number(left.N) : left.S;
	const b = right.N !== undefined ? Number(right.N) : right.S;
	switch (operator) {
		case "=": return a === b;
		case "<>": return a !== b;
		case "<": return a < b;
		case "<=": return a <= b;
		case ">": return a > b;
		case ">=": return a >= b;
		default: throw new Error(`fakeDynamo: unknown operator ${operator}`);
	}
}

function attributeName(name, names) {
	return name.startsWith("#") ? names[name] : name;
}


module.exports = { install, reset, staleReads, throttleBatchReads, failBatchReads, failTransactionWrite, peek, signIn };
