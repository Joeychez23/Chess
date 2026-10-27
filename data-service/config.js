const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });

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

const config = {
  // ONLY THE PRIVATE IP ON AWS (NEVER 0.0.0.0), SO ONLY THE VPC CAN REACH IT. 127.0.0.1 ON YOUR MAC
  host: process.env.DATA_SERVICE_HOST || "127.0.0.1",
  port: Number(process.env.DATA_SERVICE_PORT) || 8090,
  isProduction: process.env.NODE_ENV === "production",

  // CHECKS THE PLAYER THE CHESS SERVER FORWARDS: THEIR ACCESS TOKEN, OR A GUEST'S guest_game COOKIE. THE SAME SECRET AS server/.env (UNTIL #252)
  jwtSecret: required("JWT_SECRET"),

  // SIGNED REQUESTS: ONLY THE CHESS SERVER HAS THIS SECRET (middleware/signature.js). THE OLD ONE IS ALSO ACCEPTED WHILE IT'S BEING CHANGED
  dataServiceSecret: secret("DATA_SERVICE_SECRET", required("DATA_SERVICE_SECRET")),
  dataServiceSecretOld: secret("DATA_SERVICE_SECRET_OLD", process.env.DATA_SERVICE_SECRET_OLD),

  // DYNAMODB, THE REGION chess_db AND user_db ARE IN
  dynamoRegion: process.env.DYNAMODB_REGION || "us-west-2",
};

module.exports = config;
