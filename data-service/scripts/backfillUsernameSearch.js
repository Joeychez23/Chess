/*
 *  backfillUsernameSearch.js  --  data service
 *	Username Search Backfill (#120)
 *  Names claimed before the username-search index have no search_group or search_name, so the sparse index skips them.
 *  Run once with an admin's AWS credentials after terraform apply: node scripts/backfillUsernameSearch.js (DYNAMODB_REGION, us-west-2 by default).
 *  Safe to run again. The data service's own role can't Scan, so this doesn't run on the instance
 *
 */

const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { searchFields } = require("../utils/username.js");

const USER_TABLE = "user_db";

/**
 * @description Adds the search attributes to every username#<name> item. A name freed since the scan is skipped, never made again
 * @param  {[object]} connection [a DynamoDB client]
 * @return {[object]} result [{ updated, skipped }]
 */
async function backfill(connection) {
	const result = { updated: 0, skipped: 0 };
	let ExclusiveStartKey;
	do {
		const page = await connection.scan({
			TableName: USER_TABLE,
			FilterExpression: "begins_with(user_id, :claim)",
			ProjectionExpression: "user_id, username",
			ExpressionAttributeValues: { ":claim": { S: "username#" } },
			ExclusiveStartKey
		});
		for (const item of page.Items || []) {
			const fields = searchFields(item.username.S);
			try {
				await connection.updateItem({
					TableName: USER_TABLE,
					Key: { user_id: item.user_id },
					UpdateExpression: "SET search_group = :search_group, search_name = :search_name",
					ConditionExpression: "attribute_exists(owner_id)",
					ExpressionAttributeValues: { ":search_group": fields.search_group, ":search_name": fields.search_name }
				});
				result.updated++;
			} catch (err) {
				if (err.name != "ConditionalCheckFailedException") { throw err; }
				result.skipped++;
			}
		}
		ExclusiveStartKey = page.LastEvaluatedKey;
	} while (ExclusiveStartKey);
	return result;
}

if (require.main === module) {
	backfill(new DynamoDB({ region: process.env.DYNAMODB_REGION || "us-west-2" })).then((result) => {
		console.log(`Username search backfill: ${result.updated} updated, ${result.skipped} skipped`);
	}).catch((err) => {
		console.error(err);
		process.exitCode = 1;
	});
}


module.exports = { backfill };
