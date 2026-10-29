# Server

<div align="center">

[Home](../README.md) · [Client](../client/README.md) · **Server** · [Data service](../data-service/README.md) · [Deploy](../deploy/README.md) · [Terraform](../terraform/README.md) · [Setup & fixes](../SETUP.md)

</div>

---

## Setup

`server/.env` (see `server/.env.example`):

| Variable | Purpose |
| --- | --- |
| `API_PORT` | Server port: `3001` on your Mac (`npm run dev` proxies to it), `8080` on the EC2 instance |
| `AUTH0_ISSUER_BASE_URL_ORIGIN` | Auth0 tenant domain |
| `AUTH0_CONNECTION` | Database connection players log in with (`auth0-default-connection`) |
| `AUTH0_CLIENT_ID` / `AUTH0_CLIENT_SECRET` | Auth0 app used for login and the Management API (`read:users`) |
| `SESSION_PUBLIC_KEY` | The public half of the data service's session key, multi-line in double quotes ([Session keys](../data-service/README.md#session-keys-252)). The server checks session and guest tokens with it but can't make one |
| `SESSION_PUBLIC_KEY_NEXT` | Optional. Only while the key is being changed: tokens signed with the new key are accepted too |
| `AUTH0_CALLBACK_URL` | Optional. Defaults to `http://localhost:API_PORT/api/auth/callback` |
| `CLIENT_URL` | Optional. Where the browser goes after login/logout. Defaults to `http://localhost:API_PORT/` |
| `ENGINE_URL` | Optional. The Stockfish engine API the AI asks for its moves. Defaults to `https://engine.aws-prac-route53.com/v1` (what your Mac uses). On the EC2 instance it's `http://127.0.0.1:3001/v1` |
| `DATA_SERVICE_URL` | Optional. Where the data service answers. Defaults to `http://127.0.0.1:8090` (`npm run dev` in `data-service`). On AWS it's the data service's private IP |
| `DATA_SERVICE_SECRET` | Signs every call to the data service. The same value as `DATA_SERVICE_SECRET` in `data-service/.env`, at least 32 characters (the command is in `.env.example`) |

In the Auth0 app's settings, add `AUTH0_CALLBACK_URL` to **Allowed Callback
URLs** and `CLIENT_URL` to **Allowed Logout URLs**.

The server doesn't touch DynamoDB. Every read and write of the games and players
goes through the data service ([Data service](../data-service/README.md)), which uses the AWS
credentials on its machine: `~/.aws` locally (`aws configure`), or its instance's
IAM role on AWS, with read/write access to `chess_db` and `user_db` in us-west-2
(`DYNAMODB_REGION` in `data-service/.env`).

## Tests

```bash
(cd data-service && npm ci)    # the server tests start the real data service
(cd server && npm ci && npm test)          # every server/test/*.test.js, Node's built-in test runner
(cd data-service && npm test)              # every data-service/test/*.test.js
```

The tests need no AWS account, Auth0 tenant or engine, and no `.env`:
`test/helpers/env.js` sets test values (with new session keys and a stand-in
Auth0 key each run, `data-service/test/helpers/keys.js`), and `test/helpers/server.js` starts the
real `/api` and page routes on a random port with the real data service next to
it, on its in-memory tables (`data-service/test/helpers/fakeDynamo.js`). So every
test goes server → data service → tables, like the live site. Auth0 and the
engine are answered from test data.

| File | What it covers |
| --- | --- |
| `validate.test.js` | Move rules, piece facing (knights, castling, captures, promotions) and the end-of-game checks, threefold repetition too. The client and the server pin the same `chess.js` version |
| `ai.test.js` | The AI levels, the engine call and the js-chess-engine fallback |
| `undo.test.js` | Taking back moves: captures, promotions, castling, en passant, knight and sideways moves, several moves, set positions, a random game, and the undos that are refused |
| `dataClient.test.js` | The data service down, too slow (3 seconds) or refusing the signature: 503 "Try again in a moment" and nothing half saved. Accepting an invite from an inviter who's in another game drops it without forfeiting the player's own game |
| `auth.test.js` | Signing in through the data service: the callback's cookies, a forged `id_token` getting no session, refresh and resume, logout signing out every device, Delete my data ending the session. Only tokens the data service signed: another key's, HS256, `none`, expired or changed ones are refused, the next key during a change is read, and a guest cookie from before #252 gets a new game |
| `games.test.js` | The `/api/chess` routes: guest and signed-in AI games, friend invites through rematch, and the sign-in checks |
| `rateLimit.test.js` | Guest games only answer the browser with their `guest_game` cookie, a guest whose game id is `CHESS_AI` or a player's id can't touch that player's AI game, and the new game limits (per session, IP and site) |
| `rating.test.js` | The Elo math, which games are rated, and the ratings Home and the game menu get (`rateGame` itself is in the data service's tests) |
| `startPosition.test.js` | Set positions: the FEN checks, the facing lists from a position, AI and friend games from one, and Restart and Rematch keeping it |
| `settings.test.js` | The settings page's Default start settings and Delete my data |
| `username.test.js` | Usernames: claiming one, taken in any capitals, two claims at once, renaming and changing capitals, the rules and reserved names, Delete my data freeing it, Home sending a player without one to `/settings`, and the names on invites and rematches |

GitHub Actions (`.github/workflows/ci.yml`) runs the server tests, the data
service tests and the client build on every pull request and every push to `main`.

## Auth

Auth0 only runs on the server. The browser never sees an Auth0 token or the
client secret.

| Route | What it does |
| --- | --- |
| `GET /api/auth/login` | Redirects to the Auth0 login page. `?returnTo=/play/:gameId` is saved in a cookie for the callback (only paths on this site) |
| `POST /api/auth/login` | JSON `{ email, password, returnTo? }` password login. Returns `200`, `400`, `401`, `403`, `429` or `503`; limited to 20 per IP per 30 seconds and 10 per email per minute. Requires the client `Origin` and `application/json` |
| `GET /api/auth/callback` | Auth0 redirects back here. Trades the code for Auth0's tokens, looks the player up through the Management API (`getAuth0User`, which replaced the `user` lambda), then the data service checks Auth0's `id_token` and signs the session (`POST /session/login`). Goes to `returnTo` or Home |
| `POST /api/auth/refresh` | Re-ups the session: the data service checks the refresh token and signs a new access + refresh token |
| `GET /api/auth/resume` | Where `/play/:gameId` sends a signed-out player (the page can't see the refresh token). A valid refresh token re-ups the session and goes back to `?returnTo=`, otherwise it logs in first |
| `GET /api/auth/logout` | Ends the session on every device (the data service clears the session id on the player's row), clears the cookies and logs out of Auth0 |
| `GET /api/user` | The signed-in user, and `username` from their `user_db` row (`null` until they pick one), or `401` |
| `PUT /api/user/settings` | `{ ai_level, ai_color, friend_color }`, the settings page's Default start settings. A level that isn't 1-8 gets the default and a color that isn't `w` or `b` is `random`. Returns `{ settings }` as saved. `GET /api/chess/user/:userId` returns them as `settings` |
| `PUT /api/user/username` | `{ username }`, the settings page's Username: 3 to 20 letters, numbers, `_` or `-` (spaces around it are dropped), not reserved, and nobody else's in any capitals. Returns `{ username }` as saved, `400` with the reason when it can't be used, or `409` "That username is taken" |
| `DELETE /api/user` | Delete my data: forfeits your open friend game (your friend wins and their board shows it) and your open AI game, cancels your sent invite, declines the invites you got, then deletes your `user_db` row and frees your username. Your games stay in `chess_db`, and your next sign-in starts a new row |

The session is two JWTs in httpOnly cookies: an access token (15 minutes)
checked on every request, and a refresh token (7 days) that's only sent to
`/api/auth`. When `/api/user` returns `401`, the client calls
`/api/auth/refresh` once and uses the user it returns. Checking a session is a
signature check on the server, so startup doesn't wait on Auth0.

Only the data service signs session and guest tokens (ES256, #252). The server
has the public key, so it checks them without a call but can't make one: someone
who took over the public instance couldn't sign in as a player who isn't using
the site. Both tokens carry the session id on the player's `user_db` row, and a
refresh fails once it's gone, so logout and Delete my data sign them out on every
device within 15 minutes.

## Chess API

Routes are under `/api/chess`, called from `client/src/js/gameplay/validate/index.js`.
Responses keep the old chess lambda's `{ status, ..., message }` body: a refused
move or missing game is HTTP 200 with `status: 500`.

- **Who's playing** comes from the session cookie, never from player ids the
  client sends. Nobody can move for the AI except `/ai-move`.
- **Guests** only play their own AI game (game id = player id), from the browser
  whose `guest_game` cookie the data service signed for that game. Any other id,
  including `CHESS_AI`, gets a new game. Guests have no `user_db` row.
- **Not your game:** `401` signed out (the client refreshes once and retries),
  `403` signed in.
- **New game limits** (`server/middleware/rateLimit.js`): `/game`, `/restart` and
  `/invite` answer `429` with `Retry-After` past 10 at once per session (then 1 a
  minute), 30 per IP or IPv6 /64 (then 1 every 20 s), or 60 site-wide (then 1 a
  second). Checked before anything is saved. Moves aren't limited. The counts are
  in memory and reset on restart.

| Route | Body / query | What it does |
| --- | --- | --- |
| `GET /api/chess/game/:gameId` | | The board, the player's color, whether the opponent is the AI, the AI's level (`ai_level`), the start settings (`start_params`), the friend's name (`opponent_name`), and the result (`state`, `winner`, `reason`) |
| `POST /api/chess/game` | `{ game_id, start_color, ai_level, start_fen, replace_current }` or `{ game_id, player_id_1, player_id_2, ai_level }` | New game vs. the AI at `ai_level` (1-8, anything else gets the default). `start_color` is your color, `random` (the default, anything else counts as it), `w` or `b`, and the server picks the sides (Home, the guest page, and the play page with `random` when a guest has no game yet). Without it, one side must be `CHESS_AI`, the other side is always you and `player_id_1` plays white (gameplay's fallback if that request failed, saved as Random). Leave out `game_id` to generate one. A guest's existing `game_id` is overwritten with a new board (their New game, the level is kept unless `ai_level` is sent). Signed-in players can't overwrite a game here, they restart with `/restart`. Signed-in players have one AI game open at a time: while one is open this returns `{ status: 409, game_id }` (the open game), unless `replace_current: true` forfeits it first. `start_fen` (optional) starts from a set position, saved in `start_params.fen`; one that can't be played returns `{ status: 400, message }` (HTTP 400) before anything is saved or forfeited |
| `PUT /api/chess/game/:gameId` | `{ move: [from, to], promotion }` | Your move. Validates it against the stored board and saves it. Closes the game on checkmate or a draw. Refused while the game is `PENDING` or once it's closed, and refused if the board changed first (two moves at once) |
| `POST /api/chess/game/:gameId/ai-move` | | AI games, on the AI's turn. The server picks the AI's move at the game's level, saves it, and returns the game with `ai_move: { from, to, promotion }`. After the AI moved, it returns that saved move instead of a new one |
| `POST /api/chess/game/:gameId/restart` | | AI games. Forfeits the game if it's still going, then starts a new game with a new id and the same start settings: the level, your color (Random draws again) and the set position, if any. Guests' one game is overwritten instead |
| `GET /api/chess/levels` | | The AI levels for Home's dropdown: `{ levels: [{ level, elo }], default_level }` |
| `POST /api/chess/game/:gameId/forfeit` | | Signed in, friend games. Closes the game, and the other side wins. Emits `game-over` |
| `POST /api/chess/game/:gameId/rematch` | | Signed in, finished friend games. The first press waits 1 minute (`{ waiting, expires_in }`). If the other player presses in time, a new game starts with the same start settings (`{ new_game_id }`, the inviter keeps their color pick, Random draws again), both players' sent invites are cancelled, and `rematch` is emitted. `{ status: 409 }` if either player is in another friend game |
| `POST /api/chess/invite` | `{ game_id, opponent_email, start_color, start_fen, replace_current }` | Signed in only. Invites a friend: finds their Auth0 account by email (`getAuth0User`) and creates a `PENDING` game with both names (`white_name`, `black_name`: each player's username, or their Auth0 screenname until they pick one), `inviter_id` and `start_params`. `start_color` is your color (`random`, `w` or `b`), and the sides are drawn now so the invite shows them. `start_fen` (optional) starts the game and its rematches from a set position, with the same `400` as `/game` when it can't be played. Your last sent invite is deleted. `game_id` must not exist yet. Refused for your own email, and for a friend who already invited you. While you have a friend game open this returns `{ status: 409, game_id }`, unless `replace_current: true` forfeits it first |
| `POST /api/chess/game/:gameId/accept` | `{ replace_current }` | Signed in, the invited player. `PENDING` → `OPEN`, the game moves from both players' `requested_games` to `open_games`, and your own sent invite is cancelled. Same `409` / `replace_current` rule as `/invite`. Refused if the inviter is in another friend game by then (the invite is deleted) |
| `POST /api/chess/game/:gameId/decline` | | Signed in, either player of a `PENDING` game. The invited player declines or the inviter cancels: the game is deleted and dropped from both players' `requested_games` |
| `GET /api/chess/user/:userId` | | Signed in only, your own id. Your game lists for Home, plus `ai_game_id` and `friend_game_id` (your open AI and friend games, or `null`), `open_game_list` (`[{ game_id, ai, ai_level, opponent_name, player_color, start_params }]`, newest last, for Your games), `sent_invite` (`{ game_id, name, player_color, start_params }` or `null`) and `received_invites` (`[{ game_id, name, player_color, start_params }]`, `player_color` is yours), `settings` (`{ ai_level, ai_color, friend_color }`, the defaults until you save some) and `games_finished`. Ids of games and invites TTL already deleted are pruned first, and `rating` (`{ rating, provisional, rated_games }`, the starting 1500 before your first game) |
| `GET /api/chess/game/:gameId/ratings` | | Signed in, a player in the game. Both players' ratings for the game menu: `{ rated, player_rating, opponent_rating, opponent_name, rating_change }`, the ratings are `{ rating, provisional, rated_games }` (`null` in AI games, which aren't rated) and `rating_change` is your `{ before, after }` once a rated game is over. `GET /game/:gameId` doesn't send ratings: it runs after every move, and this reads both user rows |

### Example: a guest game against the AI

With the server and data service running locally, this plays one move each
way, signed out. The cookie jar keeps the `guest_game` cookie, which is the
only thing that lets these requests touch the game:

```bash
API=http://localhost:3001/api/chess

# New game as white at level 3. The server generates the id and sets the cookie
GAME=$(curl -s -c jar -b jar -X POST $API/game -H "Content-Type: application/json" \
  -d '{"start_color":"w","ai_level":3}' | node -pe 'JSON.parse(fs.readFileSync(0)).game_id')

# Your move: e2 to e4 (add "promotion":"q" when a pawn reaches the last rank)
curl -s -c jar -b jar -X PUT $API/game/$GAME -H "Content-Type: application/json" \
  -d '{"move":["e2","e4"]}'

# The AI's reply: returns the game with ai_move { from, to, promotion }
curl -s -c jar -b jar -X POST $API/game/$GAME/ai-move

# The board and result (state, winner, reason)
curl -s -c jar -b jar $API/game/$GAME
```

A refused move still answers HTTP 200: check `status` and `message` in the
body.

## Socket.IO

`server/socket.js` runs Socket.IO on the same port as Express. Only signed-in
players can connect (the handshake reads the same access-token cookie).

| Event | Direction | Meaning |
| --- | --- | --- |
| `join-game` | client → server | `gameId`, answered with `{ status, message, state, winner, reason }`. Joins the game's room if you're a player in it. One game per socket |
| `move` | server → client | `{ game_id, player_id }`. Sent to the room after a move is saved. The client skips its own moves |
| `game-over` | server → client | `{ game_id, player_id, winner, reason }`. Sent when a player forfeits. The opponent's board opens the menu with Rematch |
| `rematch` | server → client | `{ game_id, new_game_id }`. Both players asked for a rematch. Both boards load the new game |
| `games` | server → client | `{ game_id }`. Sent to every tab of both players (each socket is also in a `player:<id>` room) when an invite is sent, accepted, declined or cancelled, and when a friend game moves, ends or rematches. Home redraws Play a friend, Invites and Your games |

## Result fields

Every game response has the result fields:

| Field | Values |
| --- | --- |
| `state` | `PENDING` (a friend invite nobody has answered yet), `OPEN` or `CLOSED` |
| `winner` | `w`, `b`, `draw`, or `null` while open |
| `reason` | `checkmate`, `stalemate`, `insufficient material`, `fifty-move rule`, `threefold repetition`, `forfeit`, or `null` |

The client, server, data service and engine all pin `chess.js` `1.4.0`, so they
agree on what's legal; a test fails if they differ.

## AI levels

The levels live in `server/utils/ai.js`. A new AI game saves its level as
`ai_level` on its `chess_db` item. The level can't change until you start a new
game from Home or the guest page (Restart keeps it). AI games made before levels existed get the
default, level 3.

| Level | Shown | Stockfish settings | Measured |
| --- | --- | --- | --- |
| 1 | ≈750 | Skill 0, and a random legal move 40% of the time | −619 vs. level 3, −301 vs. level 2 |
| 2 | ≈1100 | Skill 0, and a random legal move 15% of the time | −241 vs. level 3 |
| 3 | ≈1320 | `UCI_Elo` 1320, depth 1 | −305 vs. level 4 (Stockfish's ratings say −280) |
| 4 | ≈1600 | `UCI_Elo` 1600, depth 3 | −228 vs. level 5 (−300) |
| 5 | ≈1900 | `UCI_Elo` 1900, depth 4 | |
| 6 | ≈2200 | `UCI_Elo` 2200, depth 6 | −413 vs. level 7 (−400) |
| 7 | ≈2600 | `UCI_Elo` 2600, depth 8 | |
| 8 | ≈3300 | Full strength, depth 20, 2 seconds | +137 vs. `UCI_Elo` 3190 (+16 =23 −1), played at depth 17, about what EC2 reaches in 2 seconds |

- **The ratings are Stockfish's.** `UCI_Elo` is anchored to the CCRL engine
  rating list, not to chess.com or FIDE ratings, so the numbers are
  approximate. Levels 1, 2 and 8 have no Stockfish rating, so they were
  measured with games against the other levels.
- **How they were measured:** a local Stockfish 17.1 build played the levels
  against each other through `chess-engine-api`: 200 games per pair (40 for
  level 8), 20 openings, each played with both colors.
- **Stockfish 19:** the engine now runs Stockfish 19, and the table hasn't
  been re-measured with it yet. 19 keeps 17.1's `UCI_Elo` range (1320-3190)
  and picks skill-level moves at the same depth, so the settings work
  unchanged, but the Elo of each level may have moved.
- **Depth:** Stockfish picks a `UCI_Elo` / skill move at depth
  `1 + skill level`, so the search stops there instead of using the whole
  time limit. That saves CPU on the engine's EC2 instance. Only level 8
  searches to depth 20.
- **Before levels:** the old AI was full-strength Stockfish at depth 1. It
  measured about 1900, the same as level 5 (+166 vs. level 4, +38 vs. level 5,
  −147 vs. level 6).
- **Limits on EC2:** the instance runs 2 engines. A level 8 move takes about
  2.3 seconds, and with more than 2 of them at once the extras wait their turn
  (4 at once: two took 2.3 seconds, two took 4.4 seconds). Levels 1-7 answer in
  milliseconds. The engine runs on the same instance as this server, at a
  lower CPU priority (`Nice=10`), and the server calls it on `127.0.0.1`, so
  the engine's nginx rate limit doesn't apply to games.
- **If the engine is down**, js-chess-engine (level 1) plays the move on the
  server instead.

## Resetting a game for testing

Send a `POST` to `http://localhost:3001/api/chess/game` from Postman,
Insomnia, or curl. Signed out, this only works for a guest game, so
`game_id` and the player's id must match, and only for a new `game_id` or one whose `guest_game` cookie you have
(keep cookies between requests, `curl -c jar -b jar`). `player_id_1` plays white:

```json
{
	"game_id": "6518e28528f7c82a29ba7bbTest1",
	"player_id_1": "6518e28528f7c82a29ba7bbTest1",
	"player_id_2": "CHESS_AI"
}
```

With an existing `game_id`, that game is overwritten with a new board. If you
leave out `game_id`, the backend creates a new game and generates its id.

## Layout

```text
server/
  index.js                   Express: serves the client/dist bundles + the page and /api routes, starts Socket.IO
  socket.js                  Socket.IO: session check, game & player rooms, emitToGame() / emitToPlayer()
  config.js                  Reads server/.env
  dataClient.js              Every read and write through the data service: signed calls for the request's player, 503 when it's down
  routes/pageRoutes.js       /, /play, /play/:gameId, /settings
  routes/api/                /api/auth/*, /api/user, /api/chess/*
  controllers/
    pageController.js        Picks the page (home, guest, play, settings) from the session cookie, PENDING invites go Home, no username yet goes to settings
    authController.js        login, callback, logout, refresh, resume
    userController.js        getUser (with the username), saveSettings, saveUsername, deleteUserData (Delete my data)
    chessController.js       get game, new game, move, AI move, levels, restart, forfeit, rematch, invite, accept, decline, user games, ratings (was the chess lambda)
  middleware/auth.js         Session cookies (checked with the public key), requireAuth, optionalAuth, the guest_game cookie
  middleware/rateLimit.js    New game limits per session, IP and site (429)
  utils/auth0.js             Auth0 requests: login/logout urls, code exchange, getAuth0User
  utils/ai.js                AI levels, the AI's move from the Stockfish engine API (js-chess-engine if it's down)
  utils/validate.js          Move rules (was the lambda's validate/validate.js)
  utils/rating.js            Elo ratings: the math & which games are rated
  utils/username.js          Username rules (3 - 20 letters, numbers, _ or -, reserved names) & the username# key
  utils/signature.js         Signs each call to the data service (the same file as data-service/utils/signature.js)
  utils/sessionKeys.js       Reads the session keys & checks a token's ES256 signature (the same file as data-service/utils/sessionKeys.js)
  test/                      Server tests (npm test): validate, ai, undo, games, dataClient, auth, rateLimit, rating, startPosition, settings, username, plus helpers/ (test settings, the test server with the data service next to it)
```

---

<div align="center">

[Home](../README.md) · [Client](../client/README.md) · **Server** · [Data service](../data-service/README.md) · [Deploy](../deploy/README.md) · [Terraform](../terraform/README.md) · [Setup & fixes](../SETUP.md)

</div>
