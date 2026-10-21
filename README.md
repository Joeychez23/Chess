# Chess

**Live:** [chess.aws-prac-route53.com](https://chess.aws-prac-route53.com/)

A chess game drawn entirely on an HTML5 canvas: sprite pieces with shadows and
reflections on a wooden table, sliding move animations, and move sounds. Play
the computer or challenge a friend by email. The browser checks each move
first, then the Express server checks it again against the board stored in
DynamoDB before it counts. (This used to be the chess lambda in
[chess-validation](https://github.com/Joeychez23/Lambdas); see
[Chess API](#chess-api).)

Built with vanilla JavaScript, HTML5 Canvas, Webpack 5, Socket.IO,
[chess.js](https://github.com/jhlywa/chess.js) (rules, legal moves, check),
and [Stockfish](https://stockfishchess.org/) (the computer opponent, through
the [chess-engine-api](../chess-engine-api) service, with
[js-chess-engine](https://github.com/josefjadrny/js-chess-engine) as the
backup). Hosted on S3 + CloudFront, provisioned with Terraform.

## Features

| | |
| --- | --- |
| **Canvas rendering** | Board, table, and pieces are sprites drawn in layers (reflection, shadow, piece). Knights face the direction they last moved; the backend tracks each knight's last move so this survives a reload. |
| **Moving** | Drag and drop, or click a piece and then a square. Legal moves are highlighted, and a king in check is highlighted. Moves slide into place with a sound. |
| **Promotion** | When a pawn reaches the last rank, you pick the new piece by clicking one of your captured pieces beside the board. |
| **Play AI** | The computer opponent is Stockfish at the level picked in the dropdown next to Play AI on Home (8 levels, each shown with its approximate Elo, see [AI levels](#ai-levels)). The server picks and saves the AI's moves, so the level can't change mid game and the browser can't move for the AI. Your color is random. Restart flips your color and starts a new game at the same level. Restarting a game that's still going counts as a forfeit. |
| **Play Friends** | Enter your opponent's email. The backend looks up their Auth0 account and creates the game. While you're both in the game, each move is pushed to the other player over Socket.IO and animated when it arrives. Moves are saved either way, so you can move, leave, and your friend sees it when they open the game. The menu's Restart button is **Forfeit** here (it asks "Are you sure?" first). |
| **Game over** | The server ends a game on checkmate, stalemate, insufficient material, the fifty-move rule, or a forfeit, and saves who won and why. Both boards open the menu with the result. Finished games leave Home. |
| **Rematch** | After a friend game ends, both players get a Rematch button. If both press it within 1 minute, a new game starts with the sides picked at random and both boards load it. |
| **Home** | Signed-in players only: a list of their open games (finished games aren't listed). Hidden for guests. |
| **Login / Logout** | The menu's Exit button logs guests in and signed-in players out. Auth0 runs on the Express server (see [Auth](#auth)). |
| **Mobile** | Portrait and landscape layouts and touch input. iOS audio is unlocked on the first tap so the opponent's move sounds play. |
| **TV / remote mode** | Arrow keys move a cursor and Enter picks up and drops pieces and drives the menu. Turn it on with the `TV_DEV` flag in `client/src/js/main.js`. |

## How it works

1. **Startup.** If the page is opened directly (not in an iframe), it asks the
   server who is signed in (`GET /api/user`) while the page loads. A signed-in
   player opens their latest game (or a new one vs. the AI). A guest gets
   `PLAYER_ID` and `GAME_ID` from `client/.env`, which `dotenv-webpack`
   inlines at build time. Inside an
   iframe, it waits for the host page to send `userinfo` and `start` messages
   (see [Embedding](#embedding)).
2. **Load.** `renderCanvas()` preloads every sprite, then asks the server for
   the game (`GET /api/chess/game/:gameId?player_id=`). The server returns the board
   (FEN), your color, and whether the opponent is the AI. If `PLAYER_ID`
   equals `GAME_ID` and no game exists yet, a new game against the AI is
   created first (`POST /api/chess/game`).
3. **Render loop.** A ~33 fps loop redraws only when something changed: a
   hover, a drag, a slide in progress, or new data.
4. **Your move.** chess.js plays the move locally, which throws on an illegal
   move. If it's legal, the move is sent as `PUT /api/chess/game/:gameId`
   with `{ move: [from, to], promotion }`. If the server rejects
   it, the board reverts to the last state the server confirmed. If the move
   ends the game, the response has `state: "CLOSED"` with the `winner` and
   `reason`, and the menu opens with the result.
5. **AI move.** The client asks `POST /api/chess/game/:gameId/ai-move`. The
   server asks Stockfish for a move at the game's saved level, validates it
   like any other move, saves it, and returns it with the new board. The
   client only animates it. Asking again after the AI moved returns the same
   saved move, so a reload or a repeat request never makes a second move.
6. **Friend's move.** A friend game opens a Socket.IO connection and joins
   the game's room. When the server saves a move it emits `move` to the room,
   and the other player's client fetches the game and animates the server's
   `prev_move`. Going Home closes the socket. After a reconnect the client
   joins again and fetches the game once in case a move was missed (or the
   opponent forfeited).

## Setup

Requires Node 22+ (the server).

```bash
npm install
cd server && npm install
```

`server/.env` (see `server/.env.example`):

| Variable | Purpose |
| --- | --- |
| `API_PORT` | Server port, e.g. `3001` |
| `AUTH0_ISSUER_BASE_URL_ORIGIN` | Auth0 tenant domain |
| `AUTH0_CONNECTION` | Database connection players log in with (`auth0-default-connection`) |
| `AUTH0_CLIENT_ID` / `AUTH0_CLIENT_SECRET` | Auth0 app used for login and the Management API (`read:users`) |
| `JWT_SECRET` | Signs the session tokens |
| `AUTH0_CALLBACK_URL` | Optional. Defaults to `http://localhost:API_PORT/api/auth/callback` |
| `CLIENT_URL` | Optional. Where the browser goes after login/logout. Defaults to `http://localhost:API_PORT/` |
| `ENGINE_URL` | Optional. The Stockfish engine API the AI asks for its moves. Defaults to `https://engine.aws-prac-route53.com/v1` |

In the Auth0 app's settings, add `AUTH0_CALLBACK_URL` to **Allowed Callback
URLs** and `CLIENT_URL` to **Allowed Logout URLs**.

The server reads and writes the DynamoDB tables with the AWS credentials on the
machine: `~/.aws` locally (`aws configure`), or the instance's IAM role on AWS.
It needs read/write access to `chess_db` and `user_db` in us-east-1.

`client/.env`:

| Variable | Purpose |
| --- | --- |
| `PLAYER_ID` | Player id used when the page isn't embedded |
| `GAME_ID` | Game to open. Set it equal to `PLAYER_ID` to get a personal game vs. the AI that's created on first load. |

**Images and audio aren't in the repo.** `client/src/images` and
`client/src/audio` are git-ignored and uploaded to the S3 bucket separately
(the deploy job leaves `images/*` and `audio/*` in place when it clears the
bucket). To run locally, put them back in `client/src/` and un-comment the
`CopyWebpackPlugin` block in `client/webpack.config.js` so the dev server
serves them. The game waits for every sprite to load before it starts.

## Run

```bash
npm start       # builds client/dist and serves it + the auth routes on http://localhost:3001
npm run dev     # webpack-dev-server on http://localhost:3002, /api and /socket.io are proxied to :3001 (run the server too)
npm run build   # bundles into client/dist
```

With `npm run dev`, set `CLIENT_URL=http://localhost:3002/` so login returns
to the dev server.

## Auth

Auth0 only runs on the server. The browser never sees an Auth0 token or the
client secret.

| Route | What it does |
| --- | --- |
| `GET /api/auth/login` | Redirects to the Auth0 login page |
| `GET /api/auth/callback` | Auth0 redirects back here. Trades the code for the user, looks them up through the Management API (`getAuth0User`, which replaced the `user` lambda), and starts the session |
| `POST /api/auth/refresh` | Re-ups the session: a valid refresh token gets a new access + refresh token |
| `GET /api/auth/logout` | Clears the session and logs out of Auth0 |
| `GET /api/user` | The signed-in user, or `401` |

The session is two JWTs in httpOnly cookies: an access token (15 minutes)
checked on every request, and a refresh token (7 days) that's only sent to
`/api/auth`. When `/api/user` returns `401`, the client calls
`/api/auth/refresh` once and uses the user it returns. Checking a session is a
signature check on the server, so startup doesn't wait on Auth0.

## Chess API

The chess lambda now runs on the Express server. Each branch of the lambda's
handler is its own route under `/api/chess`. The client calls them from
`client/src/js/gameplay/validate/index.js`, with `GAME_URL` set to `/api/chess`
in `main.js`. Responses keep the lambda's body (`{ status, ..., message }`),
and a rejected move or missing game still comes back as HTTP 200 with
`status: 500` in the body, so the client checks them the same way as before.

The player is whoever is signed in. The server reads it from the session
cookie and ignores the player ids the client sends. Nobody can move for the AI:
its moves only come from `/ai-move`. Guests (no session) can only play an AI
game whose `game_id` equals their player id, which is what `client/.env` sets
up. A request for a game you're not in gets `401` when signed out (the client
then calls `/api/auth/refresh` once and retries, in case the access token
expired mid game) or `403` when signed in.

| Route | Body / query | What it does |
| --- | --- | --- |
| `GET /api/chess/game/:gameId` | | The board, the player's color, whether the opponent is the AI, the AI's level (`ai_level`), and the result (`state`, `winner`, `reason`) |
| `POST /api/chess/game` | `{ game_id, player_id_1, player_id_2, ai_level }` | New game vs. the AI at `ai_level` (1-8, anything else gets the default). One side must be `CHESS_AI`, and the other side is always you. `player_id_1` plays white. Leave out `game_id` to generate one. A guest's existing `game_id` is overwritten with a new board (restart, the level is kept unless `ai_level` is sent). Signed-in players can't overwrite a game here, they restart with `/restart` |
| `PUT /api/chess/game/:gameId` | `{ move: [from, to], promotion }` | Your move. Validates it against the stored board and saves it. Closes the game on checkmate or a draw. Refused once the game is closed, and refused if the board changed first (two moves at once) |
| `POST /api/chess/game/:gameId/ai-move` | | AI games, on the AI's turn. The server picks the AI's move at the game's level, saves it, and returns the game with `ai_move: { from, to, promotion }`. After the AI moved, it returns that saved move instead of a new one |
| `POST /api/chess/game/:gameId/restart` | `{ ai_color }` | AI games. Forfeits the game if it's still going, then starts a new game with a new id at the same level. `ai_color` is the AI's color in the new game. Guests' one game is overwritten instead |
| `GET /api/chess/levels` | | The AI levels for Home's dropdown: `{ levels: [{ level, elo }], default_level }` |
| `POST /api/chess/game/:gameId/forfeit` | | Signed in, friend games. Closes the game, and the other side wins. Emits `game-over` |
| `POST /api/chess/game/:gameId/rematch` | | Signed in, finished friend games. The first press waits 1 minute (`{ waiting, expires_in }`). If the other player presses in time, a new game starts with random sides (`{ new_game_id }`) and `rematch` is emitted |
| `POST /api/chess/invite` | `{ game_id, opponent_email }` | Signed in only. New game vs. a friend. Finds their Auth0 account by email (`getAuth0User`). You play white. `game_id` must not exist yet |
| `GET /api/chess/user/:userId` | | Signed in only, your own id. Your game lists for Home. Ids of games TTL already deleted are pruned first |

### Socket.IO

`server/socket.js` runs Socket.IO on the same port as Express. Only signed-in
players can connect (the handshake reads the same access-token cookie).

| Event | Direction | Meaning |
| --- | --- | --- |
| `join-game` | client → server | `gameId`, answered with `{ status, message, state, winner, reason }`. Joins the game's room if you're a player in it. One game per socket |
| `move` | server → client | `{ game_id, player_id }`. Sent to the room after a move is saved. The client skips its own moves |
| `game-over` | server → client | `{ game_id, player_id, winner, reason }`. Sent when a player forfeits. The opponent's board opens the menu with Rematch |
| `rematch` | server → client | `{ game_id, new_game_id }`. Both players asked for a rematch. Both boards load the new game |

The client side is `client/src/js/socket/index.js`. `renderCanvas()` calls
`joinGame()` for friend games (also when a rematch loads), and the Home button calls `leaveGame()`. If
the server turns the socket away because the access token expired, the client
re-ups the session once and reconnects.

Every game response has the result fields:

| Field | Values |
| --- | --- |
| `state` | `OPEN` or `CLOSED` |
| `winner` | `w`, `b`, `draw`, or `null` while open |
| `reason` | `checkmate`, `stalemate`, `insufficient material`, `fifty-move rule`, `forfeit`, or `null` |

Closing a game moves its id from `open_games` to `closed_games` on both
players' `user_db` rows. A finished friend game loses its `expireAt`, so TTL
never deletes it. AI games keep it and are deleted 25 days after the last
move. Threefold repetition isn't detected, because only the board (FEN) is
stored and the client works from the FEN too.

The move rules (`server/utils/validate.js`) are a copy of the lambda's
`validate/validate.js`. `chess.js` is pinned to the client's version
(`1.0.0-beta.6`) so the browser and the server agree on what's legal.

### AI levels

The levels live in `server/utils/ai.js`. A new AI game saves its level as
`ai_level` on its `chess_db` item. The level can't change until you start a new
game from Home (Restart keeps it). AI games made before levels existed get the
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
  milliseconds. All AI moves now come from the chess server's IP, so they share
  the engine's nginx limit of 5 requests per second per IP.
- **If the engine is down**, js-chess-engine (level 1) plays the move on the
  server instead.

## Deploy

`client/dist` is uploaded to an S3 static-website bucket. The Terraform in
`terraform/` puts CloudFront in front of it:

- ACM certificate for `chess.aws-prac-route53.com` (us-east-1, as CloudFront
  requires), validated through a Route 53 DNS record
- CloudFront distribution with the S3 website endpoint as origin, HTTP →
  HTTPS redirect, and TTL 0 so a new deploy shows up right away
- Route 53 `A` alias record pointing the subdomain at the distribution
- DynamoDB tables (us-east-1): `chess_db` (key `game_id`, TTL on `expireAt`:
  open games and finished AI games are deleted 25 days after the last move,
  finished friend games are kept) and `user_db` (key `user_id`)

```bash
cd terraform/aws-enviroment
terraform init
terraform apply
```

The Route 53 hosted zone for `aws-prac-route53.com` and the S3 bucket
(`aws-prac-chess-s3`, us-west-2) must already exist. Names are set in
`terraform/aws-enviroment/locals.tf`.

The two DynamoDB tables were created in the AWS console before they were added
to Terraform. Import them once, before the first `apply`; otherwise `apply`
tries to create them and fails with "table already exists":

```bash
terraform import module.dynamodb_module.aws_dynamodb_table.chess_table chess_db
terraform import module.dynamodb_module.aws_dynamodb_table.user_table user_db
```

`terraform plan` should then show no changes for either table. Both tables have
`prevent_destroy` set, so Terraform refuses any plan that would delete or
replace them.

## Embedding

The game was built to run in an iframe inside a host "game center" page and
communicates with it through `postMessage`.

| Direction | Action | Meaning |
| --- | --- | --- |
| host → game | `userinfo` | `{ chessUrl, gameId, userId }`: which API, game, and player to use |
| host → game | `start` | Load and render the game |
| host → game | `home` | `{ userInfo }`: show the signed-in player's open games |
| game → host | `ready` | Board is rendered |
| game → host | `exit` | Player chose Exit from the menu |

Inside an iframe, Exit is passed to the host instead of logging in or out.
The player id `LAKESIDE_GUEST_USER` is treated as a guest. Guests get a fresh
game against the AI on each load.

## Resetting a game for testing

Send a `POST` to `http://localhost:3001/api/chess/game` from Postman,
Insomnia, or curl. Signed out, this only works for a guest game, so
`game_id` and the player's id must match. `player_id_1` plays white:

```json
{
	"game_id": "6518e28528f7c82a29ba7bbTest1",
	"player_id_1": "6518e28528f7c82a29ba7bbTest1",
	"player_id_2": "CHESS_AI"
}
```

With an existing `game_id`, that game is overwritten with a new board. If you
leave out `game_id`, the backend creates a new game and generates its id.

## Project layout

```
client/
  index.html                 Menu markup (Resume, Restart / Forfeit / Rematch, Home, Play AI, Play Friends, Exit)
  webpack.config.js          Entry, HTML template, PWA manifest, dotenv, dev proxy (/api + /socket.io)
  src-sw.js                  Workbox service worker (not registered at the moment)
  src/css/style.css          Menu, game list, and layout styles
  src/js/main.js             Menu, postMessage handling, new solo/multiplayer games, AI level dropdown
  src/js/auth/clientSideAuth.js  login() / logout() / getUser() / refresh() → server auth routes
  src/js/socket/index.js     joinGame() / leaveGame(): friend game socket
  src/js/gameplay/
    index.js                 renderCanvas(): sprite loading, render loop, input, animation
    validate/index.js        Backend calls: get game, move, reset, AI move, levels, user games, invite
    ai/index.js              playAi(): asks the server for the AI's move (the server picks and saves it)
    user/index.js            Converts a dropped tile into a { from, to, promotion } move
    utils/index.js           Per-square tile state
server/
  index.js                   Express: serves client/dist + /api routes, starts Socket.IO
  socket.js                  Socket.IO: session check, game rooms, emitToGame()
  config.js                  Reads server/.env
  dynamoDB.js                chess_db / user_db reads and writes (was the lambda's database-controller.js)
  routes/api/                /api/auth/*, /api/user, /api/chess/*
  controllers/
    authController.js        login, callback, logout, refresh
    userController.js        getUser
    chessController.js       get game, new game, move, AI move, levels, restart, forfeit, rematch, invite, user games (was the chess lambda)
  middleware/auth.js         JWT session cookies, requireAuth, optionalAuth
  utils/auth0.js             Auth0 requests: login/logout urls, code exchange, getAuth0User
  utils/ai.js                AI levels, the AI's move from the Stockfish engine API (js-chess-engine if it's down)
  utils/validate.js          Move rules (was the lambda's validate/validate.js)
terraform/
  aws-enviroment/            Root module: bucket, domain names, table names
  modules/cloudfront/        ACM cert, DNS validation, CloudFront, Route 53 alias
  modules/dynamodb/          Chess (games) and user tables
```

## Stockfish license

The AI plays with [Stockfish](https://stockfishchess.org/), free software by
the Stockfish developers, distributed under the
[GNU General Public License version 3](https://github.com/official-stockfish/Stockfish/blob/sf_17.1/Copying.txt)
(GPL v3). Whenever Stockfish is distributed, the license and the full source
code (or a link to it) for that exact binary have to go with it, and any
changes to its source have to be released under GPL v3 too.

- **This repo doesn't include or ship Stockfish.** The chess server asks the
  [chess-engine-api](../chess-engine-api) service for moves, and the browser
  never downloads an engine. That service runs Stockfish built, unmodified,
  from the official
  [`sf_17.1` source](https://github.com/official-stockfish/Stockfish/tree/sf_17.1)
  (see the Stockfish license section in its README).
- **The local `stockfish/` folder** (the unmodified Stockfish 17.1 source and
  the build used to measure the [AI levels](#ai-levels)) is in `.gitignore`,
  so it's never committed. If you share it, or a binary built from it, keep
  its `Copying.txt` and source with it.
