/*
 *  fakeDynamo.js  --  chess server tests
 *	In-memory DynamoDB
 *  Replaces the DynamoDB client's calls (getItem, putItem, updateItem, deleteItem, batchGetItem) with tables held in memory,
 *  so server/dynamoDB.js runs unchanged with no AWS account. It understands the update and condition expressions
 *  dynamoDB.js uses: SET / REMOVE, =, <>, <, <=, >, >=, AND, OR, parentheses, attribute_exists and attribute_not_exists.
 *  Reads are always up to date (strongly consistent).
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { DynamoDB } = require("@aws-sdk/client-dynamodb");

const tables = new Map(); // TABLE NAME -> Map(KEY -> ITEM)
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
}

/**
 * @description Empties every table (between tests)
 */
function reset() {
	tables.clear();
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

async function getItem({ TableName, Key }) {
	const item = table(TableName).get(keyOf(TableName, Key));
	return item ? { Item: structuredClone(item) } : {};
}

async function putItem({ TableName, Item, ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues }) {
	const key = Item[KEYS[TableName]].S;
	check(table(TableName).get(key), ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues);
	table(TableName).set(key, structuredClone(Item));
	return {};
}

async function updateItem({ TableName, Key, UpdateExpression, ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues }) {
	const key = keyOf(TableName, Key);
	const existing = table(TableName).get(key);
	check(existing, ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues);

	const item = existing ? structuredClone(existing) : structuredClone(Key); // LIKE DYNAMODB, AN UPDATE MAKES THE ITEM IF IT ISN'T THERE
	const [, setPart = "", removePart = ""] = UpdateExpression.match(/^\s*(?:SET\s+(.*?))?\s*(?:REMOVE\s+(.*))?\s*$/s);
	for (const assignment of setPart.split(",").map((part) => part.trim()).filter(Boolean)) {
		const [name, value] = assignment.split("=").map((part) => part.trim());
		item[attributeName(name, ExpressionAttributeNames)] = structuredClone(ExpressionAttributeValues[value]);
	}
	for (const name of removePart.split(",").map((part) => part.trim()).filter(Boolean)) {
		delete item[attributeName(name, ExpressionAttributeNames)];
	}
	table(TableName).set(key, item);
	return {};
}

async function deleteItem({ TableName, Key, ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues }) {
	const key = keyOf(TableName, Key);
	check(table(TableName).get(key), ConditionExpression, ExpressionAttributeNames, ExpressionAttributeValues);
	table(TableName).delete(key);
	return {};
}

async function batchGetItem({ RequestItems }) {
	const Responses = {};
	for (const [TableName, { Keys }] of Object.entries(RequestItems)) {
		Responses[TableName] = Keys.map((key) => table(TableName).get(keyOf(TableName, key))).filter(Boolean).map((item) => structuredClone(item));
	}
	return { Responses, UnprocessedKeys: {} };
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


module.exports = { install, reset, peek };
