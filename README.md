# Chess

**Live:** [chess.aws-prac-route53.com](https://chess.aws-prac-route53.com/)

A chess game drawn on an HTML5 canvas: sprite pieces with shadows and
reflections on a wooden table, sliding moves and move sounds. Play Stockfish at
8 levels or a friend by email.

Every move is checked three times: by chess.js in the browser, by the Express
server, and by the private **data service**, the only code that can touch
DynamoDB, which plays the move on the stored board itself.

**Built with:** vanilla JavaScript, HTML5 Canvas, Webpack 5, Express 5,
Socket.IO, [chess.js](https://github.com/jhlywa/chess.js), and
[Stockfish](https://stockfishchess.org/) through
[chess-engine-api](../chess-engine-api) (with
[js-chess-engine](https://github.com/josefjadrny/js-chess-engine) as backup).
AWS: two EC2 instances, DynamoDB, S3 + CloudFront, all in Terraform
([Deploy](#deploy)). Deploy commands and fixes: [SETUP.md](SETUP.md).

## Features

| | |
| --- | --- |
| **Canvas** | Board, table and pieces are layered sprites (reflection, shadow, piece). Pieces face the way they last moved, and knights hop. |
| **Moving** | Drag and drop or click to move, with legal moves and check highlighted. Promote by clicking one of your captured pieces. Touch and a TV remote mode (`TV_DEV` in `client/src/js/pages/play/index.js`) work too. |
| **Play the AI** | 8 levels with approximate Elo ([AI levels](#ai-levels)) and a color (Random, White, Black). The server picks and saves the AI's moves. Restart reuses the level and color; restarting an unfinished game is a forfeit. One open AI game per player. |
| **Play a friend** | Invite by email with your color. They Accept or Decline on Home, and moves arrive live over Socket.IO. One sent invite and one open friend game at a time; starting another forfeits after a second press. Forfeit asks first. |
| **Set positions** | An optional FEN in **Start position**. The server refuses broken or finished positions with the reason, and Restart and Rematch keep it. |
| **Game over** | Checkmate, stalemate, insufficient material, the fifty-move rule, threefold repetition or a forfeit. Both boards show the result. |
| **Rematch** | Both players press within 1 minute and a new game loads on both boards. "Can't rematch" when either is in another friend game. |
| **Ratings** | Elo from 1500. Only finished friend games (both sides moved, not from a set position) count. Shown on Home and in a friend game's menu. |
| **Usernames** | 3 to 20 letters, numbers, `_` or `-`, unique in any capitals, some reserved. Picked on Settings after the first sign-in. |
| **Settings** | `/settings`: username, account, default start settings, and Delete my data (forfeits your games, deletes your row and frees your username). |
| **Guests** | Play the AI without an account: one game, kept to the browser that made it. |
| **Mobile** | Portrait and landscape layouts, and iOS audio unlocks on the first tap. |

## How it works

1. **Page.** The server picks the page from the session cookie ([Pages](#pages)).
   A guest's game id lives in localStorage (`GUEST_GAME_ID`) and is also their
   player id; a signed `guest_game` cookie keeps it to that browser.
2. **Load.** `renderCanvas()` loads every sprite, then `GET /api/chess/game/:gameId`
   (board, your color, the opponent). A guest without a game gets one first.
3. **Render loop.** About 33 fps, drawing only when something changed.
4. **Your move.** chess.js checks it, then `PUT /api/chess/game/:gameId`
   `{ move: [from, to], promotion }`. A refusal puts the board back. A move that
   ends the game returns `state: "CLOSED"`, `winner` and `reason`.
5. **AI move.** `POST /api/chess/game/:gameId/ai-move`: the server asks Stockfish
   at the saved level, checks and saves the move, and returns it. Asking again
   returns the same move.
6. **Friend's move.** The server emits `move` to the game's Socket.IO room, and
   the other client fetches the game and animates `prev_move`. After a
   reconnect it fetches once in case it missed something.

## Setup

Requires Node 22+ (the server).

```bash
npm ci
cd server && npm ci
```

`npm ci` installs the versions in the committed `package-lock.json`; add a
package with `npm install` in its folder and commit the lock file with it.

`server/.env` (see `server/.env.example`):

| Variable | Purpose |
| --- | --- |
| `API_PORT` | Server port: `3001` on your Mac (`npm run dev` proxies to it), `8080` on the EC2 instance |
| `AUTH0_ISSUER_BASE_URL_ORIGIN` | Auth0 tenant domain |
| `AUTH0_CONNECTION` | Database connection players log in with (`auth0-default-connection`) |
| `AUTH0_CLIENT_ID` / `AUTH0_CLIENT_SECRET` | Auth0 app used for login and the Management API (`read:users`) |
| `SESSION_PUBLIC_KEY` | The public half of the data service's session key, multi-line in double quotes ([Session keys](#session-keys-252)). The server checks session and guest tokens with it but can't make one |
| `SESSION_PUBLIC_KEY_NEXT` | Optional. Only while the key is being changed: tokens signed with the new key are accepted too |
| `AUTH0_CALLBACK_URL` | Optional. Defaults to `http://localhost:API_PORT/api/auth/callback` |
| `CLIENT_URL` | Optional. Where the browser goes after login/logout. Defaults to `http://localhost:API_PORT/` |
| `ENGINE_URL` | Optional. The Stockfish engine API the AI asks for its moves. Defaults to `https://engine.aws-prac-route53.com/v1` (what your Mac uses). On the EC2 instance it's `http://127.0.0.1:3001/v1` |
| `DATA_SERVICE_URL` | Optional. Where the data service answers. Defaults to `http://127.0.0.1:8090` (`npm run dev` in `data-service`). On AWS it's the data service's private IP |
| `DATA_SERVICE_SECRET` | Signs every call to the data service. The same value as `DATA_SERVICE_SECRET` in `data-service/.env`, at least 32 characters (the command is in `.env.example`) |

In the Auth0 app's settings, add `AUTH0_CALLBACK_URL` to **Allowed Callback
URLs** and `CLIENT_URL` to **Allowed Logout URLs**.

The server doesn't touch DynamoDB. Every read and write of the games and players
goes through the data service ([Data service](#data-service)), which uses the AWS
credentials on its machine: `~/.aws` locally (`aws configure`), or its instance's
IAM role on AWS, with read/write access to `chess_db` and `user_db` in us-west-2
(`DYNAMODB_REGION` in `data-service/.env`).

`client/.env`:

| Variable | Purpose |
| --- | --- |
| `CHESS_ASSESTS_URL` | Where the images and audio load from, with `https://` and no trailing slash: `https://assets.chess.aws-prac-route53.com` (CloudFront), or `.` to use local copies. It's built into the bundle, so rebuild after changing it. |

**Images and audio aren't in the repo** (`client/src/images` and `client/src/audio`
are git-ignored). They're in the `aws-prac-chess-s3` bucket and CloudFront serves
them; every asset url starts with `CHESS_ASSESTS_URL`. To work offline, copy them
back into `client/src/`, set `CHESS_ASSESTS_URL=.` and turn on the
`CopyWebpackPlugin` block in `client/webpack.config.js`. To upload changes
(CloudFront's TTL is 0, so they show at once):

```bash
aws s3 sync client/src/images s3://aws-prac-chess-s3/images --exclude "*.DS_Store"
```

## Run

```bash
npm start       # builds client/dist and serves it + the auth routes on http://localhost:3001
npm run dev     # webpack-dev-server on http://localhost:3002, /api, /socket.io and the pages (/, /play) are proxied to :3001 (run the server too)
npm run build   # bundles into client/dist
cd data-service && npm run dev   # the data service on http://127.0.0.1:8090, the server calls it for every game and player
```

Run the data service too, or every page that needs a game or a player answers
503 "Try again in a moment".

With `npm run dev`, set `CLIENT_URL=http://localhost:3002/` so login returns
to the dev server. The dev server writes the `.html` pages to `client/dist`
so the server can pick between them, and keeps the bundles in memory.

## Tests

```bash
cd server && npm test   # every server/test/*.test.js, with Node's built-in test runner
```

The tests need no AWS account, Auth0 tenant or engine, and no `.env`:
`test/helpers/env.js` sets test values (with new session keys and a stand-in
Auth0 key each run, `data-service/test/helpers/keys.js`), and `test/helpers/server.js` starts the
real `/api` and page routes on a random port with the real data service next to
it, on its in-memory tables (`data-service/test/helpers/fakeDynamo.js`). So every
test goes server → data service → tables, like the live site. Auth0 and the
engine are answered from test data. Install the data service's packages first
(`npm ci` in `data-service`).

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

The data service has its own tests, the same way (`data-service/test/`):

```bash
cd data-service && npm test
```

| File | What it covers |
| --- | --- |
| `signature.test.js` | Signed requests: unsigned, another secret, a changed body, path, query or method, a timestamp over 30 seconds either way, a replayed request, and the old secret during a change. Behind a good signature, another player's token still gets nothing, and a `user_id` in a body is refused |
| `session.test.js` | Logins: only Auth0's `id_token` (not forged, our client and tenant, not expired, at most 5 minutes old, used once) for the user it names. Refresh while the session id is unchanged, and not after logout (on any device) or Delete my data. The old key during a change. Guest tokens only for the game just made, with the same guest session from game to game |
| `users.test.js` | A player's own row: reading it with their games (expired ones pruned), settings, usernames (taken in any capitals, the rules), and Delete my data only once every game and invite is answered. Guests have no row |
| `lifecycle.test.js` | New AI games, guest games (only a guest's own game is reset), invites, accepts and declines, and rematches. Each refusal makes or changes nothing |
| `games.test.js` | The game routes: only the player in the request, only in their own game (a guest only in their one game), only the body fields the route names. Illegal moves, moves out of turn, moves in someone else's game, a board sent in place of a move, a refresh or changed token, another key's, an HS256 or a `none` token: each refused with the stored game unchanged, and logged without the body or token |
| `dynamoDB.test.js` | The conditional writes: two moves at once, an undo and a move at once, one close per game, invite answers, rematch presses, game list changes at once. Saves that don't depend on reading back what they wrote |
| `rating.test.js` | The Elo math, which games are rated, and two of a player's games ending at once |
| `shared.test.js` | `utils/validate.js`, `rating.js`, `username.js`, `signature.js` and `sessionKeys.js` are the same files as the server's, and both pin the same `chess.js` |

GitHub Actions (`.github/workflows/ci.yml`) runs the server tests, the data
service tests and the client build on every pull request and every push to `main`.

## Pages

The server sends the page (`server/routes/pageRoutes.js`). It checks the same
access-token cookie as the API, so the client never works out which page it
should be on. Each page is its own `.html` and bundle (`client/src/js/pages/`).

| Url | Page |
| --- | --- |
| `/` | Signed in: `home.html`, the Play the AI, Play a friend, Invites and Your games boxes. Play the AI and Play a friend show their open game's board (`pages/utils/boardPicture.js`) and Continue current game, and Invites lists the invites. Signed out: `guest.html`, the homepage with Sign in and Play the AI (level, color, Play AI / New game), and the guest's game board while it's open. The access cookie lives as long as the token (15 minutes), so the guest page re-ups the session first and goes Home if it can |
| `/play/:gameId` | A signed-in player's game. Signed out, it goes through `/api/auth/resume` and comes back. A `PENDING` invite goes to `/` (it's answered on Home). Restart and Rematch swap the url to the new game's id |
| `/play` | The guest's game. Signed-in players are sent Home |
| `/settings` | Signed in: `settings.html`, the Username, Account, Default start settings, Friends, Closed games and Delete my data boxes. A player without a username lands here from `/` and goes back Home once it's saved. Signed out, it goes through `/api/auth/resume` and comes back |

Anything else goes to `/`, and an unknown `/api` route gets a JSON `404`.
The `.html` files are only sent through these routes, never as static files.
Home and the guest page call `preloadImages()` (`client/src/js/gameplay/images/index.js`)
as soon as they open, so the game's sprites are already in the browser cache
when a game opens, and each one is logged to the console. That only sticks once the S3
objects have a `Cache-Control` header: CloudFront's TTL is 0 and nothing sets
one yet.

## Auth

Auth0 only runs on the server. The browser never sees an Auth0 token or the
client secret.

| Route | What it does |
| --- | --- |
| `GET /api/auth/login` | Redirects to the Auth0 login page. `?returnTo=/play/:gameId` is saved in a cookie for the callback (only paths on this site) |
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

### Socket.IO

`server/socket.js` runs Socket.IO on the same port as Express. Only signed-in
players can connect (the handshake reads the same access-token cookie).

| Event | Direction | Meaning |
| --- | --- | --- |
| `join-game` | client → server | `gameId`, answered with `{ status, message, state, winner, reason }`. Joins the game's room if you're a player in it. One game per socket |
| `move` | server → client | `{ game_id, player_id }`. Sent to the room after a move is saved. The client skips its own moves |
| `game-over` | server → client | `{ game_id, player_id, winner, reason }`. Sent when a player forfeits. The opponent's board opens the menu with Rematch |
| `rematch` | server → client | `{ game_id, new_game_id }`. Both players asked for a rematch. Both boards load the new game |
| `games` | server → client | `{ game_id }`. Sent to every tab of both players (each socket is also in a `player:<id>` room) when an invite is sent, accepted, declined or cancelled, and when a friend game moves, ends or rematches. Home redraws Play a friend, Invites and Your games |

The client side is `client/src/js/socket/index.js`. `renderCanvas()` calls
`joinGame()` for friend games (also when a rematch loads), and the Home button calls `leaveGame()`. Home opens its own socket
with `watchGames()`. If
the server turns the socket away because the access token expired, the client
re-ups the session once and reconnects.

Every game response has the result fields:

| Field | Values |
| --- | --- |
| `state` | `PENDING` (a friend invite nobody has answered yet), `OPEN` or `CLOSED` |
| `winner` | `w`, `b`, `draw`, or `null` while open |
| `reason` | `checkmate`, `stalemate`, `insufficient material`, `fifty-move rule`, `threefold repetition`, `forfeit`, or `null` |

**Stored data** (details in `data-service/dynamoDB.js`):

- **`start_params`** (JSON `{ color, fen }`) is what Restart and Rematch reuse. `moves`
  only has the moves played, so anything that replays them (threefold
  repetition, PGN, takebacks) starts from `start_params.fen` when it's there.
- **Facing lists** (`w_knight`, `b_knight`, `w_piece`, `b_piece`) start from the
  position (`startPieces`) and hold where each piece faces now. `undoMoves`
  replays the remaining moves through `faceMove` and saves with `updateGame`, so
  an undo and a move on the same board can't both land.
- **Friend games** save `inviter_id`. An invite is a `PENDING` game in both
  players' `requested_games`; accepting makes it `OPEN` and moves it to
  `open_games`; declining deletes it; closing moves it to `closed_games`. List
  saves retry when the row changed, so two changes at once both stay.
- **Expiry:** finished friend games lose `expireAt` and are kept. AI games are
  deleted 25 days after the last move.
- **`user_db` rows** are made at first login (`startSession`) and hold the game
  lists, `settings`, `rating`, `rated_games`, `username` and `sid`.
- **Usernames:** the row's `username`, plus a `username#<lowercase>` item that
  holds the name. `claimUsername` saves all three changes in one transaction, and
  `deleteUser` removes the row and the item together.
- **Ratings** (`utils/rating.js`): Elo from 1500, `K × (score − expected)`, K = 40
  for the first 10 rated games (shown with `?`), then 20, never below 100. Only
  friend games from the standard position where both sides moved are rated.
  Saves are conditional on `rated_games`, so two games ending at once both count.
  Each rated game keeps `ratings` (`{ w, b: { before, after }, at }`), the rating
  history for a future profile chart (#81).
- **Threefold repetition:** the server replays the saved moves, but only once 8
  half moves have passed without a capture or pawn move.

The client, server, data service and engine all pin `chess.js` `1.4.0`, so they
agree on what's legal; a test fails if they differ.

### AI levels

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

## Data service

`data-service/` is the only code that reads and writes DynamoDB (#245). The
chess server calls it for every read and write of the games and players
(`server/dataClient.js`). On AWS it runs on a private instance that only the
chess server can reach ([Data service instance](#data-service-instance),
[10. The data service](#10-the-data-service)). Each route is one named action, checked
against the stored data before anything is saved.

```bash
cd data-service
cp .env.example .env   # DATA_SERVICE_SECRET: a new one (the command is in .env.example). SESSION_PRIVATE_KEY & auth0-jwks.json: Session keys below
npm run dev            # http://127.0.0.1:8090, uses the DynamoDB tables in DYNAMODB_REGION
```

The chess server says who it's acting for with the player it already checked:
`X-Player-Token` (the signed-in player's access token) or `X-Guest-Game` (a
guest's `guest_game` token). The data service signed both, and checks them again
with its own key, and a player id in a body is never used. A guest's player id is
their game's id, so a guest is only ever in that one game.

Only the chess server can call it. Every request except `/health` is signed
with `DATA_SERVICE_SECRET`, which only the two `.env` files have
(`utils/signature.js`). The signature is HMAC-SHA256 over the method, the path
with its query, `X-Data-Timestamp`, `X-Data-Request-Id` and the body exactly as
sent, and it goes in `X-Data-Signature`. `middleware/signature.js` refuses a
request with a 401 before the player is read or any route runs (only the JSON checks, 415, 400 and 413, come first) when:

- it isn't signed, or is signed with another secret;
- its method, path, query or body changed after it was signed;
- its timestamp is more than 30 seconds from now, either way;
- its request id was already used in the last 30 seconds (a replay).

To change the secret without refusing any requests:

1. In the data service's `.env`, set the new one as `DATA_SERVICE_SECRET` and
   the current one as `DATA_SERVICE_SECRET_OLD`, then restart it. It accepts both.
2. Put the new one in `server/.env` and restart the chess server.
3. Remove `DATA_SERVICE_SECRET_OLD` and restart the data service.

The signature only proves a request came from the chess server. Who the
request is for comes from a token only the data service can sign
([Session keys](#session-keys-252)).

| Route | What it checks before saving |
| --- | --- |
| `GET /health` | Nothing: answers without a player or the tables |
| `GET /games/:gameId` | The requester is in the game (`?consistent=true` for a strongly consistent read) |
| `POST /games/:gameId/move` `{ from, to, promotion }` | In the game, open, their turn, a legal move on the stored board. Checkmate or a draw closes the game and rates a friend game |
| `POST /games/:gameId/ai-move` `{ from, to, promotion }` | AI games: the requester is in it, it's the AI's turn, and the move is legal |
| `POST /games/:gameId/forfeit` | In the game and it's open. The other side wins |
| `GET /games/:gameId/ratings` | In the game. Both players' ratings |
| `POST /games/ai` `{ color, level, start_fen, game_id }` | A signed-in player vs `CHESS_AI`, at a level from 1 to 8 (3 if left out), from a playable position. A `game_id` must be new |
| `POST /games/guest` `{ game_id, color, side, level, start_fen }` | Needs no player. `side` fixes this game's side while `color` is what Restart uses (the play page's first guest game). The guest's own game (their cookie) is reset and keeps its level; any other id (another browser's game, a player's game, `CHESS_AI`) gets a new game and that game isn't touched. Answers with `guest_token`, the guest's cookie for the game it saved |
| `POST /games/invite` `{ opponent_id, opponent_screenname, color, start_fen, game_id }` | A signed-in inviter, not to themselves or the AI. A `PENDING` game; the names are each player's username, or their screenname (the inviter's comes from their token) |
| `POST /games/:gameId/accept` `{ replace_current }` | Pending, only the invited player. In this order: their own open friend game answers `{ status: 409, game_id }` unless `replace_current`; the inviter in another friend game is refused; then their friend game is forfeited (`forfeited`), their sent invite cancelled (`dropped_invites`) and the invite accepted |
| `POST /games/:gameId/decline` | Pending, either player. The answer includes the invite, so the chess server can tell both Homes |
| `POST /games/:gameId/rematch` | A friend game that's over and the requester is in it. Neither player can be in another friend game. The first press waits a minute; the second makes the game with the inviter's pick and cancels both players' sent invites (`dropped_invites`) |
| `GET /users/me` | A signed-in player's own row as stored (`?consistent=true`). `?games=true` also prunes expired games and invites and adds the open AI and friend game, the open games, the sent invite and the received invites. Guests have no row (403) |
| `POST /users/me/settings` `{ ai_level, ai_color, friend_color }` | A level from 1 to 8 and `w`, `b` or `random` for each color, all three |
| `POST /users/me/username` `{ username }` | The username rules again (`utils/username.js`), then `claimUsername`: someone else's name, in any capitals, answers `{ status: 409 }` |
| `POST /users/me/delete` | Refused (409) while the player has an open game or an invite: the chess server forfeits, cancels and declines them first. Then the row and the username claim are deleted |
| `POST /session/login` `{ id_token, user }` | Needs no player. Auth0's `id_token` checked against Auth0's saved keys (RS256, our tenant and client, not expired, at most 5 minutes old, used once), and `user` (the chess server's `getAuth0User`, which only looks on `AUTH0_CONNECTION`) must be the one it names, with an `auth0|` id. Then the access and refresh tokens, with the session id on the player's row (made at their first login) |
| `POST /session/refresh` `{ refresh_token }` | A refresh token it signed, whose session id is still the one on the row. A new pair |
| `POST /session/logout` `{ refresh_token }` | A refresh token it signed. Clears the session id, so no device can refresh. A token from a session that already ended changes nothing |

The rules about a player's other games ("one AI game and one friend game at a
time", `replace_current`, one sent invite) stay on the chess server: it makes
the forfeits and cancels first, and each of those is an action the player can
take here too.

Each route lists the body fields it takes, and anything else is refused with
a 400. Bodies must be JSON and 16kb at most. A request the data service
handles answers 200 with `dynamoDB.js`'s `{ status, game_data, message }`. A
refused one answers with its own status (400, 401, 403, 404, 409, 413 or 415)
and logs one line, `REFUSED <method> <path> <status> <why>`, without the body
or the token.

`server/dataClient.js` sends each call signed, with the player of the request it's
answering (an `AsyncLocalStorage` context, so the controllers don't pass it
around): their access token when it's still good, otherwise a guest's
`guest_game` cookie when it's still good. A call that gets no answer in 3 seconds, a 5xx, or a
signature refusal (a wrong `DATA_SERVICE_SECRET`) answers the player 503 "Try
again in a moment". Each action is one call, so nothing is half saved. The rules
about a player's other games still run on the chess server first, and accepting
an invite with `replace_current` is one call, so the inviter is checked before
the player's own game is forfeited.

`utils/validate.js`, `rating.js`, `username.js`, `signature.js` and `sessionKeys.js` are copies of
the server's, and `test/shared.test.js` fails if they differ, so change both.

### Session keys (#252)

The data service signs every access, refresh and guest token with its private
key (`SESSION_PRIVATE_KEY`, ES256). The chess server only has the public key
(`SESSION_PUBLIC_KEY`). Each token names its key in its header (`kid`, made from
the key itself), and only ES256 tokens signed with a key they have are
accepted: an HS256 token, a `none` token or another key's is refused by both.

#### Making the session keys

On AWS, run this on the data service, so the private key never leaves it. Use a
different key on your Mac than on the live site, so a session made locally
can't be used there.

```bash
openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out session-key.pem   # SESSION_PRIVATE_KEY
openssl pkey -in session-key.pem -pubout                                                              # SESSION_PUBLIC_KEY
```

Each goes in its `.env` as a multi-line value in double quotes, the private key
in `data-service/.env` and the public key in `server/.env`:

```
SESSION_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----"
```

Then delete `session-key.pem`. Both services check the key when they start and
exit if it isn't a P-256 key (the chess server also refuses a private key).

#### Saving Auth0's keys

A login's `id_token` is checked against Auth0's public keys. The data service
has no internet, so they're saved next to it as `auth0-jwks.json`
(`AUTH0_JWKS_FILE`, not committed). The data service won't start without it.

```bash
# on your Mac, in this folder (the domain is AUTH0_ISSUER_BASE_URL_ORIGIN)
curl -s https://<tenant domain>/.well-known/jwks.json -o data-service/auth0-jwks.json

# on AWS, then on the data service
scp -J ubuntu@52.11.177.148 data-service/auth0-jwks.json ubuntu@172.31.64.10:/tmp/
sudo install -o dataservice -g dataservice -m 644 /tmp/auth0-jwks.json /opt/data-service/auth0-jwks.json && sudo systemctl restart data-service
```

Auth0 rarely changes its signing key. When it does, logins fail and the data
service logs `REFUSED POST /session/login 401 Bad id token: unknown key`: save
the keys again.

#### Changing the session key

To change it without signing anyone out:

1. Make a new pair. Put the new public key in `server/.env` as
   `SESSION_PUBLIC_KEY_NEXT` and restart the chess server. It accepts both.
2. In the data service's `.env`, set the new private key as
   `SESSION_PRIVATE_KEY` and the old public key as `SESSION_PUBLIC_KEY_OLD`,
   then restart it. New tokens use the new key, and old ones still refresh.
3. After 25 days (refresh tokens last 7 days, guest games 25 days after their
   last move), set `SESSION_PUBLIC_KEY` in `server/.env` to the new key, remove
   `SESSION_PUBLIC_KEY_NEXT` and `SESSION_PUBLIC_KEY_OLD`, and restart both.

In the wrong order (step 2 before step 1), the chess server can't read the new
tokens: it answers 503 and logs `its tokens are signed with key <kid>, which
SESSION_PUBLIC_KEY / SESSION_PUBLIC_KEY_NEXT isn't`. Do step 1.

If the private key leaks, change both at once without the overlap. Everyone is
signed out, and guests start a new game.

## Deploy

```
browser ──HTTPS──> nginx ──> chess server :8080 ──http://127.0.0.1:3001──> chess-engine-api ──> Stockfish 19
   │                         (Express + Socket.IO,
   │                          serves client/dist)
   └──HTTPS──> CloudFront (assets.chess.aws-prac-route53.com) ──> S3: images/, audio/
```

One EC2 instance runs the chess server and
[chess-engine-api](../chess-engine-api). The browser loads the page and calls
`/api` and `/socket.io` on `chess.aws-prac-route53.com`. The session cookies
only work on that domain, so the same Express server serves the client (not
S3). CloudFront only serves the images and audio.

In order:

1. [Terraform](#terraform): the IAM role, the DNS records, CloudFront for the
   assets, and the DynamoDB tables.
2. chess-engine-api's
   [Deploy to EC2](../chess-engine-api/README.md#deploy-to-ec2): launches the
   instance, moves the Elastic IP, builds Stockfish 19, and starts the engine.
3. [The chess server](#1-before-you-start) on the same instance.

### Terraform

`terraform/aws-enviroment` sets up:

- **Server** (`modules/server`): the `EC2_Chess_DynamoDB` IAM role and
  instance profile (made in the console, imported below). Since #250 the role
  has no DynamoDB permissions: the chess server calls the data service, and
  only the data service's role can use the tables. The role and profile stay
  attached, so nothing changes on the instance. The module also makes the Route 53 `A` records for `chess` and `engine` pointing at the instance's Elastic IP
  (`server_ip` in `locals.tf`). The `engine` record was made in the console;
  `allow_overwrite` lets Terraform take it over.
- **Assets** (`modules/cloudfront`): ACM certificate for
  `assets.chess.aws-prac-route53.com` (us-east-1, as CloudFront requires),
  validated through a Route 53 DNS record, a CloudFront distribution in front
  of the `aws-prac-chess-s3` bucket's website endpoint (HTTP → HTTPS redirect,
  TTL 0 so new files show up right away), and the Route 53 alias record.
- **DynamoDB** (`modules/dynamodb`, us-west-2, next to the instance; moved from
  us-east-1, see [Moving the tables](#moving-the-tables-to-us-west-2)): `chess_db` (key `game_id`,
  TTL on `expireAt`: open games and finished AI games are deleted 25 days
  after the last move, finished friend games are kept) and `user_db` (key
  `user_id`). Both have point-in-time recovery on, so either can be put back
  the way it was at any second in the last 35 days
  ([Restoring a table](#restoring-a-table)).
- **Data service** (`modules/data_service`, us-west-2): the private instance the
  data service runs on (#245), in its own subnet next to `Chess-Stockfish`
  (`usw2-az2`, `us-west-2a` in this account), with no public IP and no route
  to the internet. A free DynamoDB gateway endpoint on its route table is its
  only way out, limited to the two tables. Its security group lets in only
  `Chess-Stockfish`'s group, on 8090 and SSH. Its role, `EC2_Chess_DataService`,
  is the only one allowed to use the tables: `GetItem`, `PutItem`, `UpdateItem`,
  `BatchGetItem` and `DeleteItem` on the two tables, only through that endpoint
  (`aws:SourceVpce`), so its keys don't work anywhere else. Usernames are saved
  with `TransactWriteItems`, which has no IAM action of its own: each write in it
  is checked as the `PutItem`, `UpdateItem` or `DeleteItem` it is
  ([Using IAM with DynamoDB transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis-iam.html))
  ([Data service instance](#data-service-instance)).

```bash
cd terraform/aws-enviroment
terraform init
terraform plan
terraform apply
```

Run `terraform init` again whenever a module is added. The apply prints
`instance_profile_name` (`EC2_Chess_DynamoDB`), which you pick when launching
the instance.

The Route 53 hosted zone for `aws-prac-route53.com`, the S3 bucket
(`aws-prac-chess-s3`, us-west-2) and the Elastic IP must already exist. Names
and the IP are set in `terraform/aws-enviroment/locals.tf`.

The IAM role was created in the AWS console before it was added to Terraform.
Import each part that isn't in the state yet (`terraform state list` shows
what is) before the next `apply`; otherwise `apply` fails with
`EntityAlreadyExists`. Importing one that's already there only fails with
"Resource already managed by Terraform":

```bash
terraform import module.server_module.aws_iam_role.server_role EC2_Chess_DynamoDB
terraform import module.server_module.aws_iam_instance_profile.server_profile EC2_Chess_DynamoDB
```

The DynamoDB tables are made by Terraform
([Moving the tables](#moving-the-tables-to-us-west-2)). Both have
`prevent_destroy` set, so Terraform refuses any plan that would delete or
replace them.

#### Restoring a table

`prevent_destroy` only stops Terraform. A bad deploy or a mistaken script can
still delete or overwrite items, and point-in-time recovery is how you get
them back. A restore always makes a new table, so you restore into a new name,
then copy that back under the old name. The server, the tests and Terraform
all keep using `chess_db` and `user_db`.

These steps are for `chess_db`. For `user_db`, swap the names. If both tables
were hit, restore both to the same time, so the players' game lists match the
games.

1. On the instance, stop the server so nothing writes while you work:

   ```bash
   sudo systemctl stop chess
   ```

2. From your Mac, restore into a new table. Pick a time from before the
   mistake, in UTC:

   ```bash
   aws dynamodb restore-table-to-point-in-time --region us-west-2 \
     --source-table-name chess_db --target-table-name chess_db_restore \
     --restore-date-time 2026-10-25T18:00:00Z
   aws dynamodb wait table-exists --region us-west-2 --table-name chess_db_restore
   ```

   Restoring can take a while. If the `wait` gives up, run it again. Then check
   the items in the console (**DynamoDB → Tables → chess_db_restore → Explore
   table items**).

3. Back up the restored table. Note the `BackupArn` it prints, and wait until
   `describe-backup` shows `AVAILABLE`:

   ```bash
   aws dynamodb create-backup --region us-west-2 --table-name chess_db_restore --backup-name chess_db_restore
   aws dynamodb describe-backup --region us-west-2 --backup-arn <BackupArn> --query BackupDescription.BackupDetails.BackupStatus
   ```

4. Delete the original table. With point-in-time recovery on, DynamoDB keeps
   a system backup of it for 35 days, so this can still be undone:

   ```bash
   aws dynamodb delete-table --region us-west-2 --table-name chess_db
   aws dynamodb wait table-not-exists --region us-west-2 --table-name chess_db
   ```

5. Restore the backup under the original name:

   ```bash
   aws dynamodb restore-table-from-backup --region us-west-2 --target-table-name chess_db --backup-arn <BackupArn>
   aws dynamodb wait table-exists --region us-west-2 --table-name chess_db
   ```

6. Run `terraform apply` in `terraform/aws-enviroment`. A restore doesn't copy
   the TTL or point-in-time recovery settings, so the plan shows both being
   turned back on. The table's ARN doesn't change, so the IAM policy still
   covers it.

7. Start the server, then delete the copy and the backup:

   ```bash
   sudo systemctl start chess
   aws dynamodb delete-table --region us-west-2 --table-name chess_db_restore
   aws dynamodb delete-backup --region us-west-2 --backup-arn <BackupArn>
   ```

#### Moving the tables to us-west-2

Done in October 2026 (#246): Terraform made new, empty tables in us-west-2, next
to `Chess-Stockfish`, after `terraform state rm` of the us-east-1 ones. Games,
settings, ratings and usernames started over; Auth0 accounts didn't change.
Delete the old us-east-1 tables once nothing is needed from them
(`aws dynamodb delete-table --region us-east-1 --table-name chess_db`, then `user_db`).

#### Data service instance

`modules/data_service` makes the data service's instance and network (#246).
The values (`Chess-Stockfish`'s security group, its zone, the key pair, the
subnet range and the fixed private IP `172.31.64.10`) are in `locals.tf`.

The tables must be in us-west-2: a gateway endpoint only reaches its own region.

1. Check that `172.31.64.0/28` is free in the default VPC (its default
   subnets are the `/20`s from `172.31.0.0`), then apply:

   ```bash
   aws ec2 describe-subnets --region us-west-2 --query 'Subnets[].CidrBlock'
   cd terraform/aws-enviroment
   terraform init    # a new module
   terraform plan
   terraform apply
   ```

   The plan should only add things: the subnet, its route table, the
   endpoint, `data_service_sg` and its rules, the role and the instance. It
   prints `data_service_private_ip`.

2. SSH in through `Chess-Stockfish`. The key goes in your agent, so both hops
   can use it:

   ```bash
   ssh-add ~/path/to/key.pem
   ssh -J ubuntu@52.11.177.148 ubuntu@172.31.64.10
   ```

3. Check that only `Chess-Stockfish` reaches port 8090. Until the data service
   is deployed (step 10), use a stand-in on the instance:

   ```bash
   python3 -m http.server 8090              # on the data service instance
   curl -s -o /dev/null -w "%{http_code}\n" http://172.31.64.10:8090/   # on Chess-Stockfish: 200
   ```

   From your Mac the address can't be reached at all: it's private and the
   instance has no public IP.

4. Check DynamoDB through the endpoint. Install the AWS CLI during an upkeep
   window (below), then with the window closed:

   ```bash
   aws dynamodb get-item --region us-west-2 --table-name user_db --key '{"user_id":{"S":"none"}}'
   ```

   It answers `{}` (no such row) through the endpoint, with no internet.
   `terraform plan` should now show no changes.

**Upkeep windows.** The instance has no internet, so installing or updating
anything (apt, Node, `npm ci`) needs a short window:

```bash
terraform apply -var maintenance=true   # a NAT gateway & a 0.0.0.0/0 route, plus HTTP/HTTPS out
# ... sudo apt update && sudo apt upgrade, installs, npm ci ...
terraform apply                         # removes them again
```

**Costs:** about $7.60 a month for the `t3.micro`, plus about $0.65 for its
8 GB gp3 disk. The DynamoDB endpoint is free. An upkeep window costs about
5 cents an hour (the NAT gateway and its public IP), plus 4.5 cents per GB
downloaded.

### 1. Before you start

- The engine is running on the instance (chess-engine-api's steps 1–7).
- The instance has the `EC2_Chess_DynamoDB` instance profile. To add it to an
  instance that's already running: **EC2 → Actions → Security → Modify IAM
  role**.
- `dig +short chess.aws-prac-route53.com` prints the Elastic IP. certbot checks
  it in step 7.

### 2. Auth0

In the Auth0 app's settings, add
`https://chess.aws-prac-route53.com/api/auth/callback` to **Allowed Callback
URLs** and `https://chess.aws-prac-route53.com/` to **Allowed Logout URLs**.
Both fields take comma-separated lists, so keep the `localhost` entries for
development.

### 3. Copy the code

From your Mac, in this folder:

```bash
ssh -i ~/path/to/key.pem ubuntu@<elastic-ip> 'sudo mkdir -p /opt/chess-frontend && sudo chown ubuntu: /opt/chess-frontend'
rsync -av --exclude node_modules --exclude .env --exclude dist --exclude .DS_Store \
  --exclude /.git --exclude /stockfish --exclude /terraform --exclude /data-service \
  --exclude /client/src/images --exclude /client/src/audio \
  -e "ssh -i ~/path/to/key.pem" ./ ubuntu@<elastic-ip>:/opt/chess-frontend/
```

That leaves out your `.env` files (the instance gets its own in step 4), the
local Stockfish build, the Terraform state, and the images and audio
(CloudFront serves them). Both `package-lock.json` files are committed, so
`npm ci` installs the same versions on the instance as everywhere else.

### 4. `.env` files

Copy both from your Mac, then change what's different on the instance:

```bash
scp -i ~/path/to/key.pem client/.env ubuntu@<elastic-ip>:/opt/chess-frontend/client/.env
scp -i ~/path/to/key.pem server/.env ubuntu@<elastic-ip>:/opt/chess-frontend/server/.env
```

`client/.env` is read when the client is built. Check that
`CHESS_ASSESTS_URL` is `https://assets.chess.aws-prac-route53.com`, not `.`:
every sprite, sound, and the favicon load from it.

`server/.env`, on the instance (`nano /opt/chess-frontend/server/.env`):

| Variable | On the instance |
| --- | --- |
| `API_PORT` | `8080`. chess-engine-api has 3001, and `deploy/nginx.conf` forwards to 8080 |
| `AUTH0_CALLBACK_URL` | `https://chess.aws-prac-route53.com/api/auth/callback` |
| `CLIENT_URL` | `https://chess.aws-prac-route53.com/` |
| `ENGINE_URL` | `http://127.0.0.1:3001/v1` |
| `SESSION_PUBLIC_KEY` | The public half of the live data service's key ([Making the session keys](#making-the-session-keys)), not your Mac's, so a session made on your Mac can't be used on the live site |
| `DATA_SERVICE_URL` | `http://172.31.64.10:8090`, the data service's private IP ([Data service instance](#data-service-instance)) |
| `DATA_SERVICE_SECRET` | A new one (the command is in `server/.env.example`). The same value goes in the data service's `.env` in step 10 |

The server won't start without `SESSION_PUBLIC_KEY` and `DATA_SERVICE_SECRET`.
On a new setup, make the session key on the data service first (step 10, with
its instance from [Data service instance](#data-service-instance)), or fill
these in before step 6.

The Auth0 values stay the same. Then lock the file to your user:
`chmod 600 /opt/chess-frontend/server/.env`.

### 5. Install and build

On the instance:

```bash
cd /opt/chess-frontend
npm ci
npm run build
cd server && npm ci --omit=dev
```

`npm run build` bundles the client into `client/dist`. The service only runs
the server (not `npm start`), so restarting it doesn't rebuild the client:
build again after copying new client code.

### 6. Start the server

```bash
cd /opt/chess-frontend
sudo cp deploy/chess.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now chess
curl -s localhost:8080/api/chess/levels
```

`/api/chess/levels` answers without DynamoDB or Auth0, so it only checks that
the server is up. The service runs as `ubuntu` with `NODE_ENV=production`,
which makes the session cookies HTTPS-only: logging in only works through
`https://`, after step 7.

### 7. nginx and HTTPS

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/chess
sudo ln -s /etc/nginx/sites-available/chess /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d chess.aws-prac-route53.com
```

`deploy/nginx.conf` forwards everything to the server on 8080, passes
Socket.IO's WebSocket upgrade through, and allows 10 requests per second per
IP (bursts of 40). The server also limits making games itself (see [Chess API](#chess-api) above). Its upgrade variable is named `$chess_connection_upgrade`
because chess-engine-api's site on the same instance already defines
`$connection_upgrade`, and nginx won't start with two.

### 8. Check it

- Open `https://chess.aws-prac-route53.com`, log in, and play a level 8 game.
  `journalctl -u chess -f` should show no `STOCKFISH FAILED` line. If it
  does, check `curl -s localhost:3001/health`.
- Play a friend game in two browsers (or one private window) to check that
  moves arrive over Socket.IO.
- `sudo systemctl status chess chess-engine-api nginx` shows all three running.

### 9. Make an AMI

Once everything works: **EC2 → Instances**, select it, **Actions → Image and
templates → Create image**. If the instance is ever lost, launch from that AMI
with the `EC2_Chess_DynamoDB` instance profile and move the Elastic IP
(chess-engine-api's step 2). Both services start on boot. Keep the AMI private:
it has your `.env` secrets and a Stockfish binary in it (see
[Stockfish license](#stockfish-license)).

The data service's instance needs no AMI: Terraform makes it again
([Data service instance](#data-service-instance)) and step 10 installs it.

### 10. The data service

The data service runs on its own private instance (`172.31.64.10`, made by
Terraform in [Data service instance](#data-service-instance)), as its own user
`dataservice`. It has no internet, so the installs happen in an upkeep window.
Everything is copied from your Mac through `Chess-Stockfish`, and SSH goes
through it too. Put the key in your agent first: `ssh-add ~/path/to/key.pem`.

1. **Open an upkeep window**, then on the data service
   (`ssh -J ubuntu@52.11.177.148 ubuntu@172.31.64.10`), update it and install
   Node 24 where its user can run it. nvm goes in `/opt/nvm`, not a home
   folder, because the service can't read home folders:

   ```bash
   # terraform/aws-enviroment, on your Mac
   terraform apply -var maintenance=true

   # on the data service
   sudo apt update && sudo apt upgrade -y
   sudo useradd --system --no-create-home --shell /usr/sbin/nologin dataservice
   sudo mkdir -p /opt/nvm /opt/data-service && sudo chown ubuntu: /opt/nvm /opt/data-service
   export NVM_DIR=/opt/nvm
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
   . /opt/nvm/nvm.sh && nvm install 24
   sudo ln -sf "$(nvm which 24)" /usr/local/bin/node24   # deploy/data-service.service runs this path
   ```

2. **Copy the code and the unit** from your Mac, then install the packages
   while the window is still open:

   ```bash
   # on your Mac, in this folder
   rsync -av --delete --exclude node_modules --exclude .env --exclude auth0-jwks.json --exclude test --exclude .DS_Store --exclude '* 2*' \
     -e "ssh -J ubuntu@52.11.177.148" data-service/ ubuntu@172.31.64.10:/opt/data-service/
   scp -J ubuntu@52.11.177.148 deploy/data-service.service ubuntu@172.31.64.10:/tmp/

   # on the data service
   cd /opt/data-service && . /opt/nvm/nvm.sh && npm ci --omit=dev
   ```

   `--exclude '* 2*'` leaves out macOS's duplicate copies ("index 2.js"), and
   `--delete` doesn't touch the excluded `.env`, `auth0-jwks.json` and `node_modules`.

3. **Close the window**:

   ```bash
   terraform apply   # terraform/aws-enviroment, on your Mac
   ```

4. **The `.env`**, only readable by `dataservice`:

   | Variable | On the data service |
   | --- | --- |
   | `DATA_SERVICE_HOST` | `172.31.64.10`, its private IP (it never listens on `0.0.0.0`) |
   | `DATA_SERVICE_PORT` | `8090` |
   | `SESSION_PRIVATE_KEY` | A new key made on this instance ([Making the session keys](#making-the-session-keys)). Its public half goes in the server's `.env` as `SESSION_PUBLIC_KEY` |
   | `AUTH0_ISSUER_BASE_URL_ORIGIN` / `AUTH0_CLIENT_ID` | The same values as the server's `.env` |
   | `DATA_SERVICE_SECRET` | The same value as the server's `.env` (step 4). If it doesn't have one yet, make it with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and put it in both |
   | `DYNAMODB_REGION` | `us-west-2` |

   ```bash
   nano /tmp/data-service.env                                   # on the data service
   sudo install -o dataservice -g dataservice -m 600 /tmp/data-service.env /opt/data-service/.env
   rm /tmp/data-service.env
   ```

   No AWS keys go anywhere. It uses its instance's role, `EC2_Chess_DataService`.
   Then save Auth0's keys next to it ([Saving Auth0's keys](#saving-auth0s-keys)).

5. **Start it and check it from `Chess-Stockfish`**:

   ```bash
   # on the data service
   sudo cp /tmp/data-service.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now data-service
   journalctl -u data-service -n 5                              # "Data service on http://172.31.64.10:8090"

   # on Chess-Stockfish
   curl -s http://172.31.64.10:8090/health                     # {"status":200,"message":"OK"}
   ```

   `/health` doesn't touch DynamoDB. The first real check is step 11.

6. **The session key** ([Making the session keys](#making-the-session-keys)):
   make it here and put its public half in the server's `.env` as
   `SESSION_PUBLIC_KEY`. [SETUP.md](SETUP.md#make-the-session-key) has the commands.

### 11. Check the whole site

1. Restart `chess` with `DATA_SERVICE_URL`, `DATA_SERVICE_SECRET` and
   `SESSION_PUBLIC_KEY` in `server/.env`.
2. Play an AI game (with Restart), a friend game in two browsers (a move, a
   forfeit, a rematch), a guest game, an invite you decline, and change a
   username. Sign in, log out, and check a second browser is signed out within
   15 minutes. Then:

   ```bash
   journalctl -u data-service --since "15 min ago" | grep REFUSED   # on the data service: nothing
   journalctl -u chess --since "15 min ago" | grep "Data service"   # on Chess-Stockfish: nothing
   ```

3. Check only the data service can use the tables (#250). A `put-item` whose
   condition can't be met writes nothing, but shows whether the call was allowed:

   ```bash
   # on Chess-Stockfish: both fail with AccessDeniedException
   aws dynamodb get-item --region us-west-2 --table-name user_db --key '{"user_id":{"S":"iam-check"}}'
   aws dynamodb put-item --region us-west-2 --table-name user_db --item '{"user_id":{"S":"iam-check"}}' --condition-expression "attribute_exists(user_id)"

   # on the data service: get-item answers {}, put-item fails with ConditionalCheckFailedException
   aws dynamodb get-item --region us-west-2 --table-name user_db --key '{"user_id":{"S":"iam-check"}}'
   aws dynamodb put-item --region us-west-2 --table-name user_db --item '{"user_id":{"S":"iam-check"}}' --condition-expression "attribute_exists(user_id)"
   ```

### Updating, logs and fixes

[SETUP.md](SETUP.md) has the update commands (one paste on Chess-Stockfish), the
logs, and a fix for each error, with the machine each command runs on.

- **Refused requests** are one `REFUSED` line each in the data service's journal
  (route and reason, never a body or token). Many 401s mean a secret or version
  mismatch; 400s or 403s mean a bug, or requests that aren't the chess server's.
- **Changed `deploy/chess.service` or `deploy/data-service.service`?** Copy it to
  `/etc/systemd/system/` and run `sudo systemctl daemon-reload` before the restart.
- **Changed `deploy/nginx.conf`?** Copy it, then `sudo nginx -t && sudo systemctl reload nginx`.
  The copy replaces certbot's HTTPS block, so run the certbot line again.
- **Rollback:** deploy the previous commit. Code from before #252 (`112b1c0`) needs
  the same `JWT_SECRET` back in both `.env` files; code from before #249 (`8414ecc`)
  talks to DynamoDB itself and needs #250's role policy back.

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

## Project layout

```
client/
  home.html                  Home markup: Play the AI (level), Play a friend (email), Invites, Your games, menu (Home, Invites, Your games, Settings, Logout)
  settings.html              Settings markup: Username, Account, Default start settings, Friends, Closed games, Delete my data, menu (Home, Settings, Logout)
  guest.html                 Guest homepage markup: board picture, Sign in, Play the AI (level, color), menu (Home, Play the AI, Sign in)
  play.html                  Game menu markup (Resume, Restart / Forfeit / Rematch, Home, Exit)
  webpack.config.js          One entry + HTML page each (home, guest, play, settings), PWA manifest, dotenv, dev proxy (/api, /socket.io, pages)
  src-sw.js                  Workbox service worker (not registered at the moment)
  src/css/nav.css            The menu (3 line button, top right) on every page, plus the colors and fonts
  src/css/home.css           Home + guest homepage styles
  src/css/style.css          Play page layout (canvas), imported by pages/play
  src/js/pages/
    home/index.js            Open games (opponent, level, color), new solo games, invites (send, accept, decline, cancel), color dropdowns, the open AI & friend games (Continue / forfeit)
    guest/index.js           Guest homepage menu, re-ups an expired session, the guest's game board, Play AI / New game
    settings/index.js        Username (first pick goes Home), account info, saves the Default start settings, Delete my data (two presses, then logout)
    play/index.js            Finds the player + game (url or guest localStorage, a missing guest game is made as Random), starts renderCanvas()
    utils/index.js           startNav() (the menu on pages without the game), table background, showCurrentGame() / hideCurrentGame(), loadLevels(), colorText()
    utils/boardPicture.js    drawBoardPicture(): a still of a game's board, drawn like the play page
  src/js/auth/index.js       login() / logout() / getUser() / refresh() → server auth routes
  src/js/socket/index.js     joinGame() / leaveGame(): friend game socket, watchGames(): Home's socket
  src/js/gameplay/
    index.js                 renderCanvas() (sets up the canvas, starts once the sprites are in), startGame() (loads the game, joins a friend game, listeners), renderLoop()
    state/index.js           game: the state every gameplay file shares, plus the canvas, ctx & the chess.js boards
    images/index.js          preloadImages() / imageProgress(): loads the sprites into images[] (home, guest + play call it)
    sprites/index.js         Every sprite url in image number order + the image numbers (wFrontKingImg = 5, ...)
    layout/index.js          renderBoard(): sizes the canvas & board to the window, draws the table & board; resize
    draw/index.js            drawScreen (handleInitialData): pieces, highlights, slides, taken piece trays, which way pieces face
    animate/index.js         Knight hop height, the pieces sliding home after Restart & Rematch
    input/index.js           Mouse, touch & TV remote handlers
    moves/index.js           Loads the game, sends the player's moves, finishes the AI's & a friend's (socket move event), refreshData()
    menu/index.js            Menu buttons, Restart / Forfeit / Rematch (loads the new board in place), game over, socketHandlers
    validate/index.js        Backend calls: get game, move, reset, new AI game (newAiGame), AI move, levels, user games, invite, accept, decline, save settings, save username, delete my data
    ai/index.js              playAi(): asks the server for the AI's move (the server picks and saves it)
    user/index.js            Converts a dropped tile into a { from, to, promotion } move
    utils/index.js           Per-square tile state
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
data-service/                The only code that reads and writes DynamoDB (#245), the chess server calls it; on a private instance on AWS
  index.js                   Express: /health, JSON bodies (16kb), the signature, the player, the routes. Listens on DATA_SERVICE_HOST
  config.js                  Reads data-service/.env
  dynamoDB.js                chess_db / user_db reads and writes (was the lambda's database-controller.js, then server/dynamoDB.js)
  routes/gameRoutes.js       /games/ai, guest, invite & /games/:gameId, move, ai-move, forfeit, accept, decline, rematch, ratings, each with the body fields it takes
  routes/userRoutes.js       /users/me, settings, username, delete: only the signed-in requester's own row
  routes/sessionRoutes.js    /session/login, refresh, logout: the only place session tokens are made
  controllers/gameController.js  Each game action, checked against the stored game before it saves
  controllers/userController.js  getMe (with games), saveSettings, saveUsername, deleteMe (only once every game is left)
  controllers/sessionController.js  login (checks Auth0's id_token), refresh & logout (the session id on the player's row)
  middleware/signature.js    checkSignature(): only signed requests, sent within 30 seconds, once; keepRawBody()
  middleware/player.js       req.player from X-Player-Token or X-Guest-Game, checked with its own key; requirePlayer, requireSignedIn
  middleware/fields.js       onlyFields(): refuses a body field the route doesn't name
  utils/games.js             playerInGame (a guest only in their own game), game state, start settings & pickSides, level & id checks
  utils/refuse.js            refuse(): the 4xx answer and its REFUSED log line
  utils/signature.js         sign(), signedHeaders(), signatureMatches(): the HMAC the chess server signs with
  utils/tokens.js            Signs the access, refresh & guest tokens with SESSION_PRIVATE_KEY (ES256)
  utils/validate.js, rating.js, username.js, sessionKeys.js  The same files as server/utils/ (test/shared.test.js)
  auth0-jwks.json            Auth0's public keys, saved here (not committed, README -> Saving Auth0's keys)
  test/                      Data service tests (npm test): games, lifecycle, users, session, signature, dynamoDB, rating, shared, plus helpers/ (keys.js: the test run's keys)
.github/
  workflows/ci.yml           GitHub Actions: server tests (with the data service), data service tests and the client build on every pull request
deploy/
  chess.service              systemd unit for the server
  data-service.service       systemd unit for the data service (its own user, read-only system, on the private instance)
  nginx.conf                 nginx site (proxy, Socket.IO WebSockets, rate limit)
terraform/
  aws-enviroment/            Root module: bucket, domain names, table names, the server's Elastic IP
  modules/server/            IAM role + instance profile, chess + engine DNS records
  modules/cloudfront/        Assets: ACM cert, DNS validation, CloudFront, Route 53 alias
  modules/dynamodb/          Chess (games) and user tables
  modules/data_service/      The data service's private subnet, DynamoDB endpoint, security group, role and instance, and the upkeep NAT
```

## License

Proprietary, all rights reserved: see [LICENSE](LICENSE). To contribute, see
[CONTRIBUTING.md](CONTRIBUTING.md), and report security problems as described in
[SECURITY.md](SECURITY.md). Third-party packages keep their own licenses, and
Stockfish isn't included in this repo (see below).

## Stockfish license

The AI plays with [Stockfish](https://stockfishchess.org/), free software by
the Stockfish developers, distributed under the
[GNU General Public License version 3](https://github.com/official-stockfish/Stockfish/blob/sf_19/Copying.txt)
(GPL v3). Whenever Stockfish is distributed, the license and the full source
code (or a link to it) for that exact binary have to go with it, and any
changes to its source have to be released under GPL v3 too.

- **This repo doesn't include or ship Stockfish.** The chess server asks the
  [chess-engine-api](../chess-engine-api) service for moves, and the browser
  never downloads an engine. That service runs Stockfish built, unmodified,
  from the official
  [`sf_19` source](https://github.com/official-stockfish/Stockfish/tree/sf_19)
  (see the Stockfish license section in its README).
- **The EC2 instance's AMI has a Stockfish binary in it.** Keep it private.
  Sharing it, or making it public, distributes Stockfish, and then
  `Copying.txt` and a link to the `sf_19` source have to go with it.
- **The local `stockfish/` folder** (the unmodified Stockfish 17.1 source and
  the build used to measure the [AI levels](#ai-levels)) is in `.gitignore`,
  so it's never committed. If you share it, or a binary built from it, keep
  its `Copying.txt` and source with it.
