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
| `AUTH0_CLIENT_ID` / `AUTH0_CLIENT_SECRET` | Auth0 app used for login and the Management API (`read:users`, `delete:users`) |
| `SESSION_PUBLIC_KEY` | The public half of the data service's session key, multi-line in double quotes ([Session keys](../data-service/README.md#session-keys-252)). The server checks session and guest tokens with it but can't make one |
| `SESSION_PUBLIC_KEY_NEXT` | Optional. Only while the key is being changed: tokens signed with the new key are accepted too |
| `CLIENT_URL` | Optional. Where the game is served, the only origin API writes and sockets accept. Defaults to `http://localhost:API_PORT/` |
| `ENGINE_URL` | Optional. The Stockfish engine API the AI asks for its moves. Defaults to `https://engine.aws-prac-route53.com/v1` (what your Mac uses). On the EC2 instance it's `http://127.0.0.1:3001/v1` |
| `DATA_SERVICE_URL` | Optional. Where the data service answers. Defaults to `http://127.0.0.1:8090` (`npm run dev` in `data-service`). On AWS it's the data service's private IP |
| `DATA_SERVICE_SECRET` | Signs every call to the data service. The same value as `DATA_SERVICE_SECRET` in `data-service/.env`, at least 32 characters (the command is in `.env.example`) |

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
| `ai.test.js` | The 27 AI levels and their settings, the 8 old levels mapping to them, the low levels overlooking moves (only seen moves are searched, always a legal move), the engine call, mixed depths and the js-chess-engine fallback |
| `analysis.test.js` | The analysis route: the engine's move and evaluation, AI and finished games only, the cache by FEN, one request at a time per game, finished boards without the engine, the engine failing, and the limit |
| `draw.test.js` | Draw offers: a friend accepting or declining, one per player per move, a move ending the offer, the socket's events, and the AI answering from either side, with the engine down too |
| `openings.test.js` | Opening names (`utils/openings.js`, the data in `data/openings/`): the lookup, other move orders, the name getting more specific and staying once the game leaves the book, player and AI moves, a move that ends the game, a failed save, a new game, and Home's rows |
| `takeback.test.js` | The takeback route: two moves or one, guests, set positions, the opening going back, and each refusal changing nothing. Friend games: request, accept and decline, once per move, a move cancelling, the limit and the invite's setting |
| `undo.test.js` | Taking back moves: captures, promotions, castling, en passant, knight and sideways moves, several moves, set positions, a random game, and the undos that are refused |
| `dataClient.test.js` | The data service down, too slow (3 seconds for a read, 10 for a write) or refusing the signature: 503 "Try again in a moment". A move, forfeit, accept or rematch that saved but answered too late is read back: the player gets what was saved and the other player is told. Accepting an invite from an inviter who's in another game drops it without forfeiting the player's own game |
| `auth.test.js` | Signing in through the data service: `GET /api/auth/login` going to the login page, the login's cookies, a forged `id_token` getting no session, refresh and resume, logout signing out every device, Delete my data ending the session. Only tokens the data service signed: another key's, HS256, `none`, expired or changed ones are refused, the next key during a change is read, and a guest cookie from before #252 gets a new game |
| `games.test.js` | The `/api/chess` routes: guest and signed-in AI games, friend invites through rematch, an email invite answering the same with or without an account, and the sign-in checks |
| `rateLimit.test.js` | Guest games only answer the browser with their `guest_game` cookie, a guest whose game id is `CHESS_AI` or a player's id can't touch that player's AI game, and the new game limits (per session, IP and site) |
| `rating.test.js` | The Elo math, which games are rated, and the ratings Home and the game menu get (`rateGame` itself is in the data service's tests) |
| `startPosition.test.js` | Set positions: the FEN checks, the facing lists from a position, AI and friend games from one, and Restart and Rematch keeping it |
| `settings.test.js` | The settings page's Default start settings and Delete my data |
| `monitoring.test.js` | `GET /api/health` (a slow engine counts as down in time, the answer is kept, it never says why), the log lines the alarms match, and browser error reports from `reportErrors.js` to the log line: limited, cut short, and unable to set off an alarm |
| `moveSuggestions.test.js` | The client's type move box suggestions (`client/src/js/gameplay/movebox/suggestions.js`): the legal moves that start with what was typed, each promotion piece, when the player can't move, and where the arrow keys go |
| `boardHelpers.test.js` | The client's board helpers (`client/src/js/gameplay/user/index.js`, `utils/index.js`): the move a drop sends for each player and view color, promotions, each side's last move, the material count, screen position to square, and adding and removing marks and arrows. The board drawing isn't covered, it needs a canvas |
| `shutdown.test.js` | `SIGTERM` on the real `index.js`: a running request finishes before the exit, a new one is refused, and an open socket reconnects to the next start |
| `friends.test.js` | Friends: requests saved on both rows and pushed to both players, every refusal, full lists, the rate limit, names only with who's online, a rename, and Delete my data leaving nothing on a friend's row |
| `username.test.js` | Usernames: claiming one, taken in any capitals, two claims at once, renaming and changing capitals, the rules and reserved names, Delete my data freeing it, Home sending a player without one to `/settings`, and the names on invites and rematches |

GitHub Actions (`.github/workflows/ci.yml`) runs the server tests, the data
service tests and the client build on every pull request and every push to `main`.

## Auth

Auth0 only runs on the server. The browser never sees an Auth0 token or the
client secret. Players sign in on our `/login` page with Auth0's password grant,
which doesn't start an Auth0 session, so there's no Auth0 login page or logout.

| Route | What it does |
| --- | --- |
| `GET /api/auth/login` | Redirects to `/login` for old links and the game menu's Exit, keeping `?returnTo=/play/:gameId` (only paths on this site) |
| `POST /api/auth/login` | JSON `{ email, password, returnTo? }` password login: looks the player up through the Management API (`getAuth0User`, which replaced the `user` lambda), then the data service checks Auth0's `id_token` and signs the session (`POST /session/login`). Returns `200`, `400`, `401`, `403`, `429` or `503`; limited to 20 per IP per 30 seconds and 10 per email per minute. Requires the client `Origin` and `application/json` |
| `POST /api/auth/signup` | JSON `{ email, password, screenname, first_name, last_name, returnTo? }` from the signup page. Makes the Auth0 account (Auth0 sends the verification email), signs in like a password login and claims `screenname` as the username; a username someone has is left for the settings page. Returns `200`, `202` (account made, sign in to play), `400`, `403`, `429` or `503`; limited to 5 per IP (then 1 every 5 minutes) and 5 per email per minute. Same `Origin` and `application/json` checks as login |
| `POST /api/auth/forgot` | JSON `{ email }` from the login page. Asks Auth0's `/dbconnections/change_password` to email a reset link, which opens Auth0's reset page. Answers `200` "If there's an account for that email, we've sent a reset link" with or without an account, or `400`, `403`, `429`, `500` or `503`; limited to 5 at once per IP and 3 at once per email, then 1 every 5 minutes for each. Requires the client `Origin` and `application/json`. In Auth0, style the reset page under Branding and set the Change Password email template's Redirect To to `/login` |
| `POST /api/auth/refresh` | Re-ups the session: the data service checks the refresh token and signs a new access + refresh token |
| `GET /api/auth/resume` | Where `/play/:gameId` sends a signed-out player (the page can't see the refresh token). A valid refresh token re-ups the session and goes back to `?returnTo=`, otherwise it goes to `/login?returnTo=` |
| `POST /api/auth/logout` | Ends the session on every device (the data service clears the session id on the player's row), clears the cookies and answers `200`, and the page goes Home. Only from our own page (`Origin` / `Sec-Fetch-Site`, #297); a `GET` is `404` |
| `GET /api/user` | The signed-in user, and `username` from their `user_db` row (`null` until they pick one), or `401` |
| `PUT /api/user/settings` | `{ ai_level, ai_color, friend_color }`, the settings page's Default start settings. A level that isn't one of the [AI levels](#ai-levels) gets the default (1-8, the levels from before, become the closest of today's) and a color that isn't `w`, `b`, `random` or `alternate` is `alternate`. Returns `{ settings }` as saved. `GET /api/chess/user/:userId` returns them as `settings` |
| `PUT /api/user/username` | `{ username }`, the settings page's Username: 3 to 20 letters, numbers, `_` or `-` (spaces around it are dropped), not reserved, and nobody else's in any capitals. Returns `{ username }` as saved, `400` with the reason when it can't be used, or `409` "That username is taken" |
| `GET /api/user/search?q=` | Home's player search: up to 10 usernames starting with `q` (2 or more characters), in any capitals, as `{ usernames }`. Never an email or Auth0 id. `429` with `Retry-After` when a limit is hit (`SEARCH_LIMITS` in `middleware/rateLimit.js`) |
| `GET /api/user/friends` | Home's Friends box: `{ friends: [{ username, online }], sent: [{ username }], received: [{ username }] }`, sorted by name. Names only, never an email or Auth0 id. `online` means a socket is open now (on Home or in a friend game), read when this is asked |
| `POST /api/user/friends/request`, `/accept`, `/decline`, `/cancel`, `/remove` | `{ username }`, in any capitals. Saved on both players' `user_db` rows in one transaction, and both get the socket's `friends`. `400` for your own name, `404` for a name nobody holds or a request that's gone, `409` with the reason (already friends, already asked, a full list: 50 friends, 25 requests each way), `429` with `Retry-After` when a limit is hit (`FRIEND_LIMITS` in `middleware/rateLimit.js`) |
| `DELETE /api/user` | Delete my account: deletes your Auth0 login, forfeits your open friend game (your friend wins and their board shows it) and your open AI game, cancels your sent invite, declines the invites you got, takes you off everyone's friend lists and requests, then deletes your `user_db` row and frees your username. Your friend games stay in `chess_db` with your name replaced by `Deleted player`, and your finished AI games are deleted 25 days later. Auth0 goes first: if it refuses, nothing changes, and a failure later on can be retried. `429` with `Retry-After` when a limit is hit (`ACCOUNT_DELETE_LIMITS` in `middleware/rateLimit.js`) |

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
Responses keep the old chess lambda's `{ status, ..., message }` body, and the
HTTP status is the real one: 400 bad input, 403 not allowed, 404 not found, 409
conflict, not your turn or game over, 422 illegal move. A refusal's body can still
say `status: 500` under a 4xx, so `message` and the HTTP status are what tell them
apart. A real 5xx is the server breaking.

- **Who's playing** comes from the session cookie, never from player ids the
  client sends. Nobody can move for the AI except `/ai-move`.
- **Guests** only play their own AI game (game id = player id), from the browser
  whose `guest_game` cookie the data service signed for that game. Any other id,
  including `CHESS_AI`, gets a new game. Guests have no `user_db` row.
- **Not your game:** `401` signed out (the client refreshes once and retries),
  `403` signed in.
- **New game limits** (`server/middleware/rateLimit.js`): `/game`, `/restart` and
  `/invite` answer `429` with `Retry-After` past 10 at once per session (an invite counts before its username is looked up) (then 1 a
  minute), 30 per IP or IPv6 /64 (then 1 every 20 s), or 60 site-wide (then 1 a
  second). Checked before anything is saved. Moves aren't limited. The counts are
  in memory and reset on restart.
- **AI move limits:** `/ai-move` answers `429` with `Retry-After` past 20 at once
  per session (then 1 a second) or 60 per IP or IPv6 /64 (then 4 a second), with
  its own counts. Requests for one game while its AI move is being picked wait for
  that move instead of asking the engine again.
- **Analysis limits:** `/analysis` answers `429` with `Retry-After` past 20 at once
  per session (then 1 a second) or 60 per IP or IPv6 /64 (then 4 a second), with
  its own counts, so hints can't stop the AI moving.

| Route | Body / query | What it does |
| --- | --- | --- |
| `GET /api/chess/game/:gameId` | | The board, the player's color, whether the opponent is the AI, the AI's level (`ai_level`), the start settings (`start_params`), the friend's name (`opponent_name`), the opening (`opening`: `{ eco, name }`, `null` until a named position), and the result (`state`, `winner`, `reason`) |
| `GET /api/chess/game/:gameId/pgn` | | A player in the game (guests: their own game). The game as a PGN file: `{ status, pgn, filename }`, `filename` is `<white>-vs-<black>.pgn`. Replays `moves` from the set position if there is one. Headers: `Event`, `Site` (`CLIENT_URL`), `Date` (`created_at`, `????.??.??` for older games), `White`, `Black` (friend games: the saved names, AI games: `Stockfish level N` & your screenname, or `Guest`), `Result` and `Termination` (`reason`, `unterminated` while it's going) |
| `POST /api/chess/game` | `{ game_id, start_color, ai_level, start_fen, replace_current }` or `{ game_id, player_id_1, player_id_2, ai_level }` | New game vs. the AI at `ai_level` (600-3200 in steps of 100, see [AI levels](#ai-levels); anything else gets the default). `start_color` is your color, `alternate` (random at first, then the opposite of your last AI game), `random` (the API's default, anything else counts as it), `w` or `b`, and the server picks the sides (Home, the guest page, and the play page with `random` when a guest has no game yet). Without it, one side must be `CHESS_AI`, the other side is always you and `player_id_1` plays white (gameplay's fallback if that request failed, saved as Random). `game_id` is only for guests (their saved id): the data service makes every new id (random, not guessable) and the response has it. A guest's existing `game_id` is overwritten with a new board (their New game, the level is kept unless `ai_level` is sent). Signed-in players can't name or overwrite a game here, they restart with `/restart`. Signed-in players have one AI game open at a time: while one is open this returns `{ status: 409, game_id }` (the open game), unless `replace_current: true` forfeits it first. `start_fen` (optional) starts from a set position, saved in `start_params.fen`; one that can't be played returns `{ status: 400, message }` (HTTP 400) before anything is saved or forfeited |
| `PUT /api/chess/game/:gameId` | `{ move: [from, to], promotion }` | Your move. Validates it against the stored board and saves it. Closes the game on checkmate or a draw. Refused while the game is `PENDING` or once it's closed, and refused if the board changed first (two moves at once). A position in the opening data set saves `opening` |
| `POST /api/chess/game/:gameId/ai-move` | | AI games, on the AI's turn. The server picks the AI's move at the game's level, saves it, and returns the game with `ai_move: { from, to, promotion }`. After the AI moved, it returns that saved move instead of a new one. Saves `opening` like a player's move |
| `POST /api/chess/game/:gameId/analysis` | | AI games and finished games, guests too. The engine's best move and evaluation of the saved board, for the Hint button and the evaluation bar: `{ status, game_board, from, to, eval, mate, winChance }`, `eval`, `mate` and `winChance` from White's side. Searches at depth 12 for at most 800 ms, cached by FEN (the last 5000 positions). `from` and `to` are `null` on a checkmate or stalemate, which don't ask the engine. `{ status: 403 }` in a friend game that's going or pending, `{ status: 409 }` while another board of this game is being analyzed (the same board shares the answer), `{ status: 503 }` when the engine doesn't answer, `429` past the analysis limits. Saves nothing |
| `POST /api/chess/game/:gameId/takeback` | | AI games, guests too. Takes back your last move and the AI's reply, or only your move if the AI hasn't replied. No request step and no limit per game (AI games aren't rated). Returns the whole game like `GET /game/:gameId`, with the board, moves, piece facing and `opening` as they were. `{ status: 409 }` while the AI's move is being picked, or with no move of yours to take back. Friend games, signed in: the first press saves the request and emits `takeback` (`{ requested, opponent_name }`), once per move (`409` after that) and the next move ends it. The opponent's press accepts: one move goes back if the player who asked just moved, two if the opponent already replied, up to 3 per game (`409` when off or used up, set by the invite's `takebacks`). Returns the whole game and emits `takeback` |
| `POST /api/chess/game/:gameId/takeback/decline` | | Signed in, friend games. Turns down the opponent's request (`{ declined: true }`) and emits `takeback`. `409` when it already ended |
| `POST /api/chess/game/:gameId/restart` | | AI games. Forfeits the game if it's still going, then starts a new game with a new id and the same start settings: the level, your color (Random draws again, Alternate switches) and the set position, if any. Guests' one game is overwritten instead |
| `GET /api/chess/levels` | | The AI levels for Home's dropdown: `{ levels: [{ level, elo }], default_level }` |
| `POST /api/chess/game/:gameId/forfeit` | | A player in an open game (guests too, in their AI game). Closes the game, and the other side wins. Emits `game-over` |
| `POST /api/chess/game/:gameId/draw` | | A player in an open game (guests too). The first press saves the offer and emits `draw-offer` (`{ offered, opponent_name }`), one per player per move (`409` after that); the next move ends it. The opponent's press accepts: `state: "CLOSED"`, `winner: "draw"`, `reason: "agreement"`, and emits `game-over`. AI games answer right away: always accepted until both sides have made their first move (fewer than two moves played, the engine isn't asked). After that the engine answers at full strength: accepted when the AI's win chance is 50% or less, otherwise (or with the engine down) `{ declined: true }`. `429` past the AI move limits. Game responses include `draw_offer`, the color with a standing offer or `null` |
| `POST /api/chess/game/:gameId/draw/decline` | | Signed in, friend games. Turns down the opponent's offer (`{ declined: true }`) and emits `draw-offer`. `409` when it already ended |
| `POST /api/chess/game/:gameId/rematch` | | Signed in, finished friend games. The first press waits 5 minutes (`{ waiting, expires_in, opponent_name, opponent_here }`, `opponent_here`: they have the game page open). If the other player presses in time, a new game starts with the same start settings (`{ new_game_id }`, the inviter keeps their color pick, Random draws again, Alternate switches), both players' sent invites are cancelled, and `rematch` is emitted. `{ status: 409 }` if either player is in another friend game, or the rematch game expired |
| `POST /api/chess/game/:gameId/rematch/cancel` | | Signed in. Takes back the player's rematch request (`{ cancelled: true }`). `{ cancelled: false }` when the other player's press already started it, `rematch` is on its way |
| `POST /api/chess/invite` | `{ opponent_username, start_color, start_fen, takebacks, days_per_move, replace_current }` | Signed in only. Invites a friend: finds them by username (data service, any capitals) and creates a `PENDING` game with both names (`white_name`, `black_name`: each player's username, or the inviter's Auth0 screenname until they pick one). Email addresses aren't accepted, so inviting can't reveal which ones have accounts, `inviter_id` and `start_params`. `start_color` is your color (`alternate`: random at first, then the opposite of your last friend game; `random`, `w` or `b`), and the sides are drawn now so the invite shows them. `start_fen` (optional) starts the game and its rematches from a set position, with the same `400` as `/game` when it can't be played. `days_per_move` (optional: 1, 3 or 7, saved in `start_params` so rematches keep it) gives each move a deadline; `move_deadline` (epoch seconds) is on every game response and Home's game rows while the game is open, and the first read after it passes closes the game as `timeout`. Your last sent invite is deleted. The data service makes the game id. Refused for your own username, and for a friend who already invited you. While you have a friend game open this returns `{ status: 409, game_id }`, unless `replace_current: true` forfeits it first |
| `POST /api/chess/challenge` | `{ start_color, start_fen, takebacks, replace_current }` | Signed in only. A challenge link: a `PENDING` game with the other seat empty (`OPEN_SEAT`), only on your `requested_games`. It's your one sent invite (`sent_invite.open_seat`), and has the same `409` / `replace_current` rule as an invite. The link is `/play/:gameId` |
| `GET /api/chess/game/:gameId/challenge` | | Signed in only. What the join screen shows: `{ open, name, player_color, start_params }`, `open: false` once the seat is taken. `404` when it isn't a challenge link (cancelled or expired too) |
| `POST /api/chess/game/:gameId/join` | `{ replace_current }` | Signed in, not the link's creator (`403`). A conditional write takes the seat, so only one player wins it (`409` "Game is taken"): `PENDING` → `OPEN`, the game moves to both players' `open_games`, and your own sent invite is cancelled. Same `409` / `replace_current` rule. Emits `games` to both Homes |
| `POST /api/chess/game/:gameId/accept` | `{ replace_current }` | Signed in, the invited player. `PENDING` → `OPEN`, the game moves from both players' `requested_games` to `open_games`, and your own sent invite is cancelled. Same `409` / `replace_current` rule as `/invite`. Refused if the inviter is in another friend game by then (the invite is deleted) |
| `POST /api/chess/game/:gameId/decline` | | Signed in, either player of a `PENDING` game. The invited player declines or the inviter cancels: the game is deleted and dropped from both players' `requested_games` |
| `GET /api/chess/user/:userId` | | Signed in only, your own id. Your game lists for Home, plus `ai_game_id` and `friend_game_id` (your open AI and friend games, or `null`), `open_game_list` (`[{ game_id, ai, ai_level, opponent_name, player_color, start_params }]`, newest last, for Your games), `closed_game_list` (the same plus `winner` and `reason`, your last 20 finished games, newest first, for Finished games), `sent_invite` (`{ game_id, name, player_color, start_params }` or `null`) and `received_invites` (`[{ game_id, name, player_color, start_params }]`, `player_color` is yours), `settings` (`{ ai_level, ai_color, friend_color }`, the defaults until you save some) and `games_finished`. Ids of games and invites TTL already deleted are pruned first, and `rating` (`{ rating, provisional, rated_games }`, the starting 1500 before your first game) |
| `GET /api/chess/game/:gameId/ratings` | | Signed in, a player in the game. Both players' ratings for the game menu: `{ rated, player_rating, opponent_rating, opponent_name, rating_change }`, the ratings are `{ rating, provisional, rated_games }` (`null` in AI games, which aren't rated) and `rating_change` is your `{ before, after }` once a rated game is over. `GET /game/:gameId` doesn't send ratings: it runs after every move, and this reads both user rows |

### Example: a guest game against the AI

With the server and data service running locally, this plays one move each
way, signed out. The cookie jar keeps the `guest_game` cookie, which is the
only thing that lets these requests touch the game:

```bash
API=http://localhost:3001/api/chess

# New game as white at level 1300. The server generates the id and sets the cookie
GAME=$(curl -s -c jar -b jar -X POST $API/game -H "Content-Type: application/json" \
  -d '{"start_color":"w","ai_level":1300}' | node -pe 'JSON.parse(fs.readFileSync(0)).game_id')

# Your move: e2 to e4 (add "promotion":"q" when a pawn reaches the last rank)
curl -s -c jar -b jar -X PUT $API/game/$GAME -H "Content-Type: application/json" \
  -d '{"move":["e2","e4"]}'

# The AI's reply: returns the game with ai_move { from, to, promotion }
curl -s -c jar -b jar -X POST $API/game/$GAME/ai-move

# The board and result (state, winner, reason)
curl -s -c jar -b jar $API/game/$GAME
```

A refused move answers a 4xx (`422` illegal, `409` not your turn or game over),
with `status` and `message` in the body.

## CSRF

`middleware/csrf.js` refuses every `POST`, `PUT`, `PATCH` and `DELETE` under `/api`
(`403`) unless its `Origin` is `CLIENT_URL`'s and its `Sec-Fetch-Site`, when sent, is
`same-origin`. `SameSite=Lax` cookies alone would still let a same-site subdomain through.

## Socket.IO

`server/socket.js` runs Socket.IO on the same port as Express. Only signed-in
players can connect (the handshake reads the same access-token cookie), and only
from the game's own page: a handshake whose `Origin` isn't `CLIENT_URL`'s, or whose
`Sec-Fetch-Site` isn't `same-origin`, is refused.

The token is only read in the handshake, so the server closes a socket when its
access token runs out, and closes every socket a player has open when they log out
or use Delete my data. The client re-ups the session with `/api/auth/refresh` and
connects again; after a logout the re-up fails and the socket stays closed.
`join-game` is limited to 5 at once, then 1 every 2 seconds per socket (`429`).

| Event | Direction | Meaning |
| --- | --- | --- |
| `join-game` | client → server | `gameId`, answered with `{ status, message, state, winner, reason }`. Joins the game's room if you're a player in it. One game per socket. `401` when the socket's access token ran out, `429` when it joins too often |
| `move` | server → client | `{ game_id, player_id }`. Sent to the room after a move is saved. The client skips its own moves |
| `game-over` | server → client | `{ game_id, player_id, winner, reason }`. Sent when a player forfeits or accepts a draw. The opponent's board opens the menu with Rematch |
| `takeback` | server → client | `{ game_id, player_id, state, game_board }`. `state: "requested"` when a player asks (the opponent sees Accept / Decline), `"declined"` when it's turned down, `"accepted"` with the earlier `game_board`: both boards load it |
| `draw-offer` | server → client | `{ game_id, player_id, state }`. `state: "offered"` when a player offers a draw (the opponent sees Accept / Decline), `"declined"` when one is turned down |
| `rematch` | server → client | `{ game_id, new_game_id }`. Both players asked for a rematch. Both boards load the new game |
| `player-left` | server → client | `{ game_id, player_id }`. A player's last tab left the game page. A player waiting on a rematch is told |
| `player-back` | server → client | `{ game_id, player_id }`. A player came back to the game page |
| `games` | server → client | `{ game_id }`. Sent to every tab of both players (each socket is also in a `player:<id>` room) when an invite is sent, accepted, declined or cancelled, and when a friend game moves, ends or rematches. Home redraws Play a friend, Invites and Your games |
| `friends` | server → client | `{}`. Sent to every tab of both players when a friend request is sent or answered or a friend is removed, and to a leaving player's friends on Delete my data. Home redraws |

## Result fields

Every game response has the result fields:

| Field | Values |
| --- | --- |
| `state` | `PENDING` (a friend invite nobody has answered yet), `OPEN` or `CLOSED` |
| `winner` | `w`, `b`, `draw`, or `null` while open |
| `reason` | `checkmate`, `stalemate`, `insufficient material`, `fifty-move rule`, `threefold repetition`, `forfeit`, `agreement`, `timeout` (the player to move ran out of time, `winner` is `draw` when the other side can't checkmate), or `null` |

The client, server, data service and engine all pin `chess.js` `1.4.0`, so they
agree on what's legal; a test fails if they differ.

## AI levels

There are 27 levels, one every 100 Elo from 600 to 3200. A level *is* its Elo:
`ai_level: 1300`. They live in `server/utils/ai.js`. A new AI game saves its
level as `ai_level` on its `chess_db` item, and it can't change until you start
a new game from Home or the guest page (Restart keeps it). Left out, the level
is 1300.

| Levels | Shown | How they play |
| --- | --- | --- |
| 600 to 1200 | ≈600 … ≈1200 | **Overlooking moves.** Each legal move is seen with the level's `notice` chance (0.112 at 600 up to 0.263 at 1200; captures, checks and promotions are 3 times as likely to be seen), and Stockfish plays the best of the moves that were seen, at depth 1. One move seen is played without asking the engine. |
| 1300 to 3100 | ≈1300 … ≈3100 | **Stockfish's `UCI_Elo`**, the one that measured at the level (`ENGINE_ELO`), searched to about its skill level + 0.5 plies. 1 second, 2 seconds from level 2400 up. |
| 3200 | 3200+ | Full strength, depth 20, 2 seconds. |

**Measured on Stockfish 19** (`scripts/measureLevels.js`, below), with level 1300
fixed at 1320, Stockfish's lowest `UCI_Elo`:

| Level | 600 | 700 | 800 | 900 | 1000 | 1100 | 1200 | 1300 | 1400 | 1500 | 1600 | 1700 | 1800 | 1900 | 2000 | 2100 | 2200 | 2300 | 2400 | 2500 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Measured | 570 | 673 | 741 | 891 | 1011 | 1073 | 1209 | 1320 | 1398 | 1506 | 1602 | 1744 | 1838 | 1962 | 2032 | 2115 | 2200 | 2372 | 2489 | 2588 |

- **How far to trust them.** Each level played the one above it (200 games)
  and the one two above (100 games), 20 openings with both colors, and all the
  results were rated together. One run moves a level by about ±40, more the
  further it is from 1300, so the steps come out between 60 and 190 with 100
  as the average. 600 to 1200 and 1200 to 2500 were two runs; the second had 90
  engine timeouts among the 2200 to 2500 games, so those four are the least sure.
  2600 to 3100 weren't played: they follow the measured line (next point), and
  the top levels take too long to play hundreds of games.
- **Why the upper levels don't use their own `UCI_Elo`.** Stockfish's ratings
  are anchored to the CCRL engine list, and at these search depths they aren't
  100 apart in games. Measured on 19: `UCI_Elo` 1400 plays like 1320, 100
  points of `UCI_Elo` are worth about 65 from 1600 to 2600, and about 130 past
  it. So each level takes the `UCI_Elo` on that measured line (`ENGINE_ELO`:
  level 2000 asks for 2115, level 3100 for 3190, Stockfish's highest).
- **Depth.** Stockfish picks a `UCI_Elo` move at depth `1 + skill level`, a
  whole number, so settings 100 apart often share a depth and then jump one.
  The server asks for skill level + 0.5 with the fraction kept: 2.4 is depth 3
  for 40% of the moves and depth 2 for the rest (a search stopped before
  Stockfish's own depth picks there). That evens the steps, and the search
  stops there instead of using the whole time limit.
- **Why the low levels overlook moves.** Stockfish can't go under 1320. The
  old levels 1 and 2 got there with a random legal move 40% or 15% of the
  time, which hangs a queen for no reason. Now a weak level misses moves the
  way a learner does (the capture it didn't look at, the retreat it didn't
  see) and plays sensibly among what it saw (#243).
- **The 8 levels from before** are still read: a game or saved setting with
  1 to 8 plays as 800, 1100, 1300, 1600, 1900, 2200, 2600 or 3200, the closest
  of today's. The data service still takes them, so either side can deploy first.
- **Measuring again** (after a new Stockfish release, or a change to the
  settings). Run `chess-engine-api` locally on that Stockfish build, then:

  ```bash
  cd server
  ENGINE_URL=http://127.0.0.1:3999/v1 node scripts/measureLevels.js verify 600 2200   # the levels as they are
  ENGINE_URL=http://127.0.0.1:3999/v1 node scripts/measureLevels.js calibrate         # notice chances for 600 to 1200
  ENGINE_URL=http://127.0.0.1:3999/v1 node scripts/measureLevels.js engine 2000,2150,2300,2450,2600   # how far apart UCI_Elo settings play
  ```

  `GAMES` (200) and `AT_ONCE` (8, the engine API's `ENGINES`) can be set. Games
  past 300 plies are judged by the engine. A run that prints moves from
  js-chess-engine had engine timeouts: lower `AT_ONCE`.
- **Limits on EC2:** the instance runs 2 engines. A 2 second level (2400 and
  up) takes about 2.3 seconds a move, and with more than 2 of them at once the
  extras wait their turn. The levels under 2400 answer in well under a second.
  The engine runs on the same instance as this server, at a lower CPU priority
  (`Nice=10`), and the server calls it on `127.0.0.1`, so the engine's nginx
  rate limit doesn't apply to games.
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

## Monitoring

Neither route needs a session. [SETUP.md → Alerts](../SETUP.md#alerts) says what to do about each alert.

- **`GET /api/health`** answers `200` when both work, otherwise `503`, with
  `{ status, checks: { dynamodb, engine } }`, each `"ok"` or `"down"`. The reason only goes in the log
  (`HEALTH engine down: ...`). DynamoDB is checked through the data service's `GET /health/tables`.
  The engine has to finish a real search, so a running API with a broken Stockfish
  fails. Each check gets 1.5 seconds, because Route 53 only waits 2. The answer is kept for 15 seconds.
- **`POST /api/client-errors`** takes `{ kind: "error" | "rejection" | "request", message, page, source, line, column, status }`
  from `client/src/js/pages/utils/reportErrors.js` and logs one `CLIENT ERROR {...}` line. Answers `204`, `400`
  for a bad report, `429` past 10 at once per IP then 1 every 30 seconds (60 at once then 1 every 2 seconds for the whole site).
- **Log lines the alarms match:** `STOCKFISH FAILED...` (`utils/ai.js`) and `HTTP 5xx METHOD /path`
  (`middleware/logServerErrors.js`, every 5xx except `/api/health`'s). The alarms only match the start of a line, so
  changing how these lines start breaks them. `monitoring.test.js` pins both.

## Layout

```text
server/
  index.js                   Express: serves the client/dist bundles + the page and /api routes, starts Socket.IO
  socket.js                  Socket.IO: session check, game & player rooms, emitToGame() / emitToPlayer()
  config.js                  Reads server/.env
  dataClient.js              Every read and write through the data service: signed calls for the request's player, 503 when it's down (a write that timed out is read back first)
  routes/pageRoutes.js       /, /play, /play/:gameId, /settings
  routes/api/                /api/auth/*, /api/user, /api/chess/*, /api/health, /api/client-errors
  controllers/
    pageController.js        Picks the page (home, guest, play, settings) from the session cookie, PENDING invites go Home, no username yet goes to settings
    authController.js        login, callback, logout, refresh, resume
    userController.js        getUser (with the username), saveSettings, saveUsername, deleteUserData (Delete my data)
    chessController.js       get game, new game, move, AI move, levels, restart, forfeit, rematch, invite, accept, decline, user games, ratings (was the chess lambda)
    monitorController.js     The health route & browser error reports
  middleware/auth.js         Session cookies (checked with the public key), requireAuth, optionalAuth, the guest_game cookie
  middleware/rateLimit.js    New game limits per session, IP and site (429)
  middleware/logServerErrors.js  A log line for each 5xx answer, an alarm counts them
  utils/auth0.js             Auth0 requests: login/logout urls, code exchange, getAuth0User
  utils/health.js            Checks DynamoDB & the engine for GET /api/health, keeps the answer for 15 seconds
  utils/ai.js                AI levels, the AI's move from the Stockfish engine API (js-chess-engine if it's down), hints & evaluations
  utils/validate.js          Move rules (was the lambda's validate/validate.js)
  utils/rating.js            Elo ratings: the math & which games are rated
  utils/games.js             Game checks: game state, who's in a game & start settings (the same file as data-service/utils/games.js)
  utils/username.js          Username rules (3 - 20 letters, numbers, _ or -, reserved names) & the username# key
  utils/signature.js         Signs each call to the data service (the same file as data-service/utils/signature.js)
  utils/sessionKeys.js       Reads the session keys & checks a token's ES256 signature (the same file as data-service/utils/sessionKeys.js)
  test/                      Server tests (npm test): validate, ai, undo, games, dataClient, auth, rateLimit, rating, startPosition, settings, username, monitoring, plus helpers/ (test settings, the test server with the data service next to it)
```

---

<div align="center">

[Home](../README.md) · [Client](../client/README.md) · **Server** · [Data service](../data-service/README.md) · [Deploy](../deploy/README.md) · [Terraform](../terraform/README.md) · [Setup & fixes](../SETUP.md)

</div>
