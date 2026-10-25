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
backup). The server and the engine share one EC2 instance behind nginx, the
images and audio come from S3 through CloudFront, and Terraform sets up the
AWS side (see [Deploy](#deploy)).

## Features

| | |
| --- | --- |
| **Canvas rendering** | Board, table, and pieces are sprites drawn in layers (reflection, shadow, piece). Knights face the direction they last moved; the backend tracks each knight's last move so this survives a reload. |
| **Moving** | Drag and drop, or click a piece and then a square. Legal moves are highlighted, and a king in check is highlighted. Moves slide into place with a sound. |
| **Promotion** | When a pawn reaches the last rank, you pick the new piece by clicking one of your captured pieces beside the board. |
| **Play AI** | The computer opponent is Stockfish at the level picked in the dropdown next to Play AI on Home (8 levels, each shown with its approximate Elo, see [AI levels](#ai-levels)). The server picks and saves the AI's moves, so the level can't change mid game and the browser can't move for the AI. Your color is random. Restart flips your color and starts a new game at the same level. Restarting a game that's still going counts as a forfeit. A signed-in player has **one AI game open at a time**: while it's open, Play the AI shows its board with Continue current game, and Play AI becomes New game, which forfeits the open game after a second press. |
| **Play Friends** | Enter your opponent's email in Home's Play a friend box. The backend looks up their Auth0 account and sends them an invite: the game waits (`PENDING`) until they press Accept in their Invites box on Home, or Decline. You have one sent invite at a time (a new one cancels it, and so does Cancel invite) and can get invites from any number of friends. Home updates live over Socket.IO as invites arrive and are answered. A signed-in player has **one friend game open at a time** (plus one AI game): while it's open, Play a friend shows its board with Continue current game, and sending an invite or accepting one forfeits it after a second press (your friend wins). While you're both in the game, each move is pushed to the other player over Socket.IO and animated when it arrives. Moves are saved either way, so you can move, leave, and your friend sees it when they open the game. The menu's Restart button is **Forfeit** here (it asks "Are you sure?" first). |
| **Game over** | The server ends a game on checkmate, stalemate, insufficient material, the fifty-move rule, or a forfeit, and saves who won and why. Both boards open the menu with the result. Finished games leave Home. |
| **Rematch** | After a friend game ends, both players get a Rematch button. If both press it within 1 minute, a new game starts with the sides picked at random and both boards load it. If either player is already in another friend game, the button reads Can't rematch. |
| **Home** | `/` for signed-in players: four boxes, Play the AI (level dropdown, or the open AI game's board with Continue current game), Play a friend (the open friend game's board with Continue current game, and the email form), Invites (invites you got with Accept and Decline, and your sent invite with Cancel invite) and Your games (finished games aren't listed, the AI game is marked vs AI and the friend game vs their screenname), each game opening at `/play/:gameId`. Guests get the homepage: a picture of the board, Play as guest and Sign in, plus their game's board and Continue current game while it's open (see [Pages](#pages)). |
| **Menu** | The 3 line button in the top right opens and closes the menu on every page. On Home and the guest page it holds the page links. In a game it's the game's menu (Resume, Restart / Forfeit / Rematch, Home, Logout or Sign in) and it opens with the result when the game ends. |
| **Login / Logout** | The menu's Sign in / Logout link (Exit in a game) logs guests in and signed-in players out. A game link opened while signed out logs in, then opens the game. Auth0 runs on the Express server (see [Auth](#auth)). |
| **Mobile** | Portrait and landscape layouts and touch input. iOS audio is unlocked on the first tap so the opponent's move sounds play. |
| **TV / remote mode** | Arrow keys move a cursor and Enter picks up and drops pieces and drives the menu. Turn it on with the `TV_DEV` flag in `client/src/js/pages/play/index.js`. |

## How it works

1. **Pages.** The server picks the page for the url (see [Pages](#pages)).
   Going between pages is a normal page load (`window.location.href`), so the
   url, refresh and the back button all work. The play page asks the server
   who is signed in (`GET /api/user`) while the sprites load. A signed-in
   player gets the game in the url. A guest (`/play`) gets their own game vs.
   the AI: its id is saved in the browser's localStorage (`GUEST_GAME_ID`),
   and a new id is made when none is saved. The guest's player id is the same
   as the game id, so it never goes in the url.
2. **Load.** `renderCanvas()` preloads every sprite, then asks the server for
   the game (`GET /api/chess/game/:gameId?player_id=`). The server returns the board
   (FEN), your color, and whether the opponent is the AI. For a guest, if no
   game exists for their id yet (a new guest, or the game expired), a new game
   against the AI is created first (`POST /api/chess/game`).
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
| `API_PORT` | Server port: `3001` on your Mac (`npm run dev` proxies to it), `8080` on the EC2 instance |
| `AUTH0_ISSUER_BASE_URL_ORIGIN` | Auth0 tenant domain |
| `AUTH0_CONNECTION` | Database connection players log in with (`auth0-default-connection`) |
| `AUTH0_CLIENT_ID` / `AUTH0_CLIENT_SECRET` | Auth0 app used for login and the Management API (`read:users`) |
| `JWT_SECRET` | Signs the session tokens |
| `AUTH0_CALLBACK_URL` | Optional. Defaults to `http://localhost:API_PORT/api/auth/callback` |
| `CLIENT_URL` | Optional. Where the browser goes after login/logout. Defaults to `http://localhost:API_PORT/` |
| `ENGINE_URL` | Optional. The Stockfish engine API the AI asks for its moves. Defaults to `https://engine.aws-prac-route53.com/v1` (what your Mac uses). On the EC2 instance it's `http://127.0.0.1:3001/v1` |

In the Auth0 app's settings, add `AUTH0_CALLBACK_URL` to **Allowed Callback
URLs** and `CLIENT_URL` to **Allowed Logout URLs**.

The server reads and writes the DynamoDB tables with the AWS credentials on the
machine: `~/.aws` locally (`aws configure`), or the instance's IAM role on AWS.
It needs read/write access to `chess_db` and `user_db` in us-east-1.

`client/.env`:

| Variable | Purpose |
| --- | --- |
| `CHESS_ASSESTS_URL` | Where the images and audio load from, with `https://` and no trailing slash: `https://assets.chess.aws-prac-route53.com` (CloudFront), or `.` to use local copies. It's built into the bundle, so rebuild after changing it. |

**Images and audio aren't in the repo.** `client/src/images` and
`client/src/audio` are git-ignored. They're uploaded to the `aws-prac-chess-s3`
bucket under `images/` and `audio/`, and CloudFront serves them at
`https://assets.chess.aws-prac-route53.com`. Every sprite, the move sound, the
table background, and the favicon start with `CHESS_ASSESTS_URL`, e.g.
`${process.env.CHESS_ASSESTS_URL}/images/board/table.webp`. The homepage's picture of the board is
`images/home/board.webp` (rendered with the `preview` job in `images/_ideas/generator`, no props). The favicon is
the white bishop, `images/icon/bishop-32.png` and `bishop-192.png`, plus `bishop-180.png` on the baize green for
the iOS home screen (all three from the `icon` job). So with the
CloudFront URL set the browser downloads them from CloudFront, not from this
server. To use local copies instead, put them back in `client/src/`, set
`CHESS_ASSESTS_URL=.`, and turn on the `CopyWebpackPlugin` block in
`client/webpack.config.js` so they're copied into `client/dist`. The game waits
for every sprite to load before it starts.

To upload new or changed images:

```bash
aws s3 sync client/src/images s3://aws-prac-chess-s3/images --exclude "*.DS_Store"
```

CloudFront's TTL is 0, so the new files show up right away.

## Run

```bash
npm start       # builds client/dist and serves it + the auth routes on http://localhost:3001
npm run dev     # webpack-dev-server on http://localhost:3002, /api, /socket.io and the pages (/, /play) are proxied to :3001 (run the server too)
npm run build   # bundles into client/dist
```

With `npm run dev`, set `CLIENT_URL=http://localhost:3002/` so login returns
to the dev server. The dev server writes the `.html` pages to `client/dist`
so the server can pick between them, and keeps the bundles in memory.

## Pages

The server sends the page (`server/routes/pageRoutes.js`). It checks the same
access-token cookie as the API, so the client never works out which page it
should be on. Each page is its own `.html` and bundle (`client/src/js/pages/`).

| Url | Page |
| --- | --- |
| `/` | Signed in: `home.html`, the Play the AI, Play a friend, Invites and Your games boxes. Play the AI and Play a friend show their open game's board (`pages/utils/boardPicture.js`) and Continue current game, and Invites lists the invites. Signed out: `guest.html`, the homepage with Play as guest and Sign in, and the guest's game board while it's open. The access cookie lives as long as the token (15 minutes), so the guest page re-ups the session first and goes Home if it can |
| `/play/:gameId` | A signed-in player's game. Signed out, it goes through `/api/auth/resume` and comes back. A `PENDING` invite goes to `/` (it's answered on Home). Restart and Rematch swap the url to the new game's id |
| `/play` | The guest's game. Signed-in players are sent Home |

Anything else goes to `/`, and an unknown `/api` route gets a JSON `404`.
The `.html` files are only sent through these routes, never as static files.
Home and the guest page call `preloadImages()` (`client/src/js/gameplay/index.js`)
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
| `GET /api/auth/callback` | Auth0 redirects back here. Trades the code for the user, looks them up through the Management API (`getAuth0User`, which replaced the `user` lambda), starts the session, and goes to `returnTo` or Home |
| `POST /api/auth/refresh` | Re-ups the session: a valid refresh token gets a new access + refresh token |
| `GET /api/auth/resume` | Where `/play/:gameId` sends a signed-out player (the page can't see the refresh token). A valid refresh token re-ups the session and goes back to `?returnTo=`, otherwise it logs in first |
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
in the pages (`client/src/js/pages/`). Responses keep the lambda's body (`{ status, ..., message }`),
and a rejected move or missing game still comes back as HTTP 200 with
`status: 500` in the body, so the client checks them the same way as before.

The player is whoever is signed in. The server reads it from the session
cookie and ignores the player ids the client sends. Nobody can move for the AI:
its moves only come from `/ai-move`. Guests (no session) can only play an AI
game whose `game_id` equals their player id, which is how the client sets up
each guest. Guests aren't added to `user_db`. A request for a game you're not in gets `401` when signed out (the client
then calls `/api/auth/refresh` once and retries, in case the access token
expired mid game) or `403` when signed in.

| Route | Body / query | What it does |
| --- | --- | --- |
| `GET /api/chess/game/:gameId` | | The board, the player's color, whether the opponent is the AI, the AI's level (`ai_level`), the friend's screenname (`opponent_name`), and the result (`state`, `winner`, `reason`) |
| `POST /api/chess/game` | `{ game_id, player_id_1, player_id_2, ai_level, replace_current }` | New game vs. the AI at `ai_level` (1-8, anything else gets the default). One side must be `CHESS_AI`, and the other side is always you. `player_id_1` plays white. Leave out `game_id` to generate one. A guest's existing `game_id` is overwritten with a new board (restart, the level is kept unless `ai_level` is sent). Signed-in players can't overwrite a game here, they restart with `/restart`. Signed-in players have one AI game open at a time: while one is open this returns `{ status: 409, game_id }` (the open game), unless `replace_current: true` forfeits it first |
| `PUT /api/chess/game/:gameId` | `{ move: [from, to], promotion }` | Your move. Validates it against the stored board and saves it. Closes the game on checkmate or a draw. Refused while the game is `PENDING` or once it's closed, and refused if the board changed first (two moves at once) |
| `POST /api/chess/game/:gameId/ai-move` | | AI games, on the AI's turn. The server picks the AI's move at the game's level, saves it, and returns the game with `ai_move: { from, to, promotion }`. After the AI moved, it returns that saved move instead of a new one |
| `POST /api/chess/game/:gameId/restart` | `{ ai_color }` | AI games. Forfeits the game if it's still going, then starts a new game with a new id at the same level. `ai_color` is the AI's color in the new game. Guests' one game is overwritten instead |
| `GET /api/chess/levels` | | The AI levels for Home's dropdown: `{ levels: [{ level, elo }], default_level }` |
| `POST /api/chess/game/:gameId/forfeit` | | Signed in, friend games. Closes the game, and the other side wins. Emits `game-over` |
| `POST /api/chess/game/:gameId/rematch` | | Signed in, finished friend games. The first press waits 1 minute (`{ waiting, expires_in }`). If the other player presses in time, a new game starts with random sides (`{ new_game_id }`), both players' sent invites are cancelled, and `rematch` is emitted. `{ status: 409 }` if either player is in another friend game |
| `POST /api/chess/invite` | `{ game_id, opponent_email, replace_current }` | Signed in only. Invites a friend: finds their Auth0 account by email (`getAuth0User`) and creates a `PENDING` game with both screennames (`white_name`, `black_name`). You play white. Your last sent invite is deleted. `game_id` must not exist yet. Refused for your own email, and for a friend who already invited you. While you have a friend game open this returns `{ status: 409, game_id }`, unless `replace_current: true` forfeits it first |
| `POST /api/chess/game/:gameId/accept` | `{ replace_current }` | Signed in, the invited player. `PENDING` → `OPEN`, the game moves from both players' `requested_games` to `open_games`, and your own sent invite is cancelled. Same `409` / `replace_current` rule as `/invite`. Refused if the inviter is in another friend game by then (the invite is deleted) |
| `POST /api/chess/game/:gameId/decline` | | Signed in, either player of a `PENDING` game. The invited player declines or the inviter cancels: the game is deleted and dropped from both players' `requested_games` |
| `GET /api/chess/user/:userId` | | Signed in only, your own id. Your game lists for Home, plus `ai_game_id` and `friend_game_id` (your open AI and friend games, or `null`), `sent_invite` (`{ game_id, name }` or `null`) and `received_invites` (`[{ game_id, name }]`). Ids of games and invites TTL already deleted are pruned first |

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
| `reason` | `checkmate`, `stalemate`, `insufficient material`, `fifty-move rule`, `forfeit`, or `null` |

A friend invite is a `PENDING` game listed in both players' `requested_games`.
Accepting it makes it `OPEN` and moves it to `open_games`, declining or
cancelling deletes it. Closing a game moves its id from `open_games` to `closed_games` on both
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
  instance profile (made in the console, imported below), allowed only `GetItem`, `PutItem`, `UpdateItem` and `BatchGetItem`
  on the two tables (the calls `server/dynamoDB.js` makes), and Route 53 `A`
  records for `chess` and `engine` pointing at the instance's Elastic IP
  (`server_ip` in `locals.tf`). The `engine` record was made in the console;
  `allow_overwrite` lets Terraform take it over.
- **Assets** (`modules/cloudfront`): ACM certificate for
  `assets.chess.aws-prac-route53.com` (us-east-1, as CloudFront requires),
  validated through a Route 53 DNS record, a CloudFront distribution in front
  of the `aws-prac-chess-s3` bucket's website endpoint (HTTP → HTTPS redirect,
  TTL 0 so new files show up right away), and the Route 53 alias record.
- **DynamoDB** (`modules/dynamodb`, us-east-1): `chess_db` (key `game_id`,
  TTL on `expireAt`: open games and finished AI games are deleted 25 days
  after the last move, finished friend games are kept) and `user_db` (key
  `user_id`).

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

The two DynamoDB tables and the IAM role were created in the AWS console before
they were added to Terraform. Import each one that isn't in the state yet
(`terraform state list` shows what is) before the next `apply`; otherwise
`apply` tries to create them and fails with "table already exists" or
`EntityAlreadyExists`. Importing one that's already there only fails with
"Resource already managed by Terraform":

```bash
terraform import module.dynamodb_module.aws_dynamodb_table.chess_table chess_db
terraform import module.dynamodb_module.aws_dynamodb_table.user_table user_db
terraform import module.server_module.aws_iam_role.server_role EC2_Chess_DynamoDB
terraform import module.server_module.aws_iam_role_policy.dynamodb_policy EC2_Chess_DynamoDB:EC2_Chess_DynamoDBPolicy
terraform import module.server_module.aws_iam_instance_profile.server_profile EC2_Chess_DynamoDB
```

`terraform plan` should then show no changes for the tables or the role. Both
tables have `prevent_destroy` set, so Terraform refuses any plan that would
delete or replace them.

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
  --exclude /.git --exclude /stockfish --exclude /terraform \
  --exclude /client/src/images --exclude /client/src/audio \
  -e "ssh -i ~/path/to/key.pem" ./ ubuntu@<elastic-ip>:/opt/chess-frontend/
```

That leaves out your `.env` files (the instance gets its own in step 4), the
local Stockfish build, the Terraform state, and the images and audio
(CloudFront serves them). `package-lock.json` is git-ignored but copied on
purpose, so `npm ci` installs the same versions as your Mac.

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
| `JWT_SECRET` | A new one (the command is in `server/.env.example`), so a session made on your Mac can't be used on the live site |

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
IP (bursts of 40). Its upgrade variable is named `$chess_connection_upgrade`
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

### Updating and logs

```bash
# from your Mac: the rsync from step 3

# on the instance
cd /opt/chess-frontend && npm ci && npm run build
cd server && npm ci --omit=dev && sudo systemctl restart chess
journalctl -u chess -f
```

Changed `deploy/chess.service`? Copy it again and run
`sudo systemctl daemon-reload` before the restart. Changed `deploy/nginx.conf`?
Copy it again and run `sudo nginx -t && sudo systemctl reload nginx`. certbot's
HTTPS block lives in the copy in `/etc/nginx/sites-available/chess`, so copying
over it removes HTTPS until you run the certbot line again.

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
  home.html                  Home markup: Play the AI (level), Play a friend (email), Invites, Your games, menu (Home, Invites, Your games, Logout)
  guest.html                 Guest homepage markup: board picture, Play as guest, Sign in, menu (Home, Play as guest, Sign in)
  play.html                  Game menu markup (Resume, Restart / Forfeit / Rematch, Home, Exit)
  webpack.config.js          One entry + HTML page each (home, guest, play), PWA manifest, dotenv, dev proxy (/api, /socket.io, pages)
  src-sw.js                  Workbox service worker (not registered at the moment)
  src/css/nav.css            The menu (3 line button, top right) on every page, plus the colors and fonts
  src/css/home.css           Home + guest homepage styles
  src/css/style.css          Play page layout (canvas), imported by pages/play
  src/js/pages/
    home/index.js            Open games, new solo games, invites (send, accept, decline, cancel), AI level dropdown, the open AI & friend games (Continue / forfeit)
    guest/index.js           Guest homepage menu, re-ups an expired session, the guest's game board
    play/index.js            Finds the player + game (url or guest localStorage), starts renderCanvas()
    utils/index.js           startNav() (the menu on pages without the game), table background, showCurrentGame() / hideCurrentGame()
    utils/boardPicture.js    drawBoardPicture(): a still of a game's board, drawn like the play page
  src/js/auth/index.js       login() / logout() / getUser() / refresh() → server auth routes
  src/js/socket/index.js     joinGame() / leaveGame(): friend game socket, watchGames(): Home's socket
  src/js/gameplay/
    index.js                 renderCanvas(): sprite loading, render loop, input, animation
    sprites/index.js         Every sprite url in image number order (preloadImages() loads them, also on home + guest)
    validate/index.js        Backend calls: get game, move, reset, AI move, levels, user games, invite, accept, decline
    ai/index.js              playAi(): asks the server for the AI's move (the server picks and saves it)
    user/index.js            Converts a dropped tile into a { from, to, promotion } move
    utils/index.js           Per-square tile state
server/
  index.js                   Express: serves the client/dist bundles + the page and /api routes, starts Socket.IO
  socket.js                  Socket.IO: session check, game & player rooms, emitToGame() / emitToPlayer()
  config.js                  Reads server/.env
  dynamoDB.js                chess_db / user_db reads and writes (was the lambda's database-controller.js)
  routes/pageRoutes.js       /, /play, /play/:gameId
  routes/api/                /api/auth/*, /api/user, /api/chess/*
  controllers/
    pageController.js        Picks the page (home, guest, play) from the session cookie, PENDING invites go Home
    authController.js        login, callback, logout, refresh, resume
    userController.js        getUser
    chessController.js       get game, new game, move, AI move, levels, restart, forfeit, rematch, invite, accept, decline, user games (was the chess lambda)
  middleware/auth.js         JWT session cookies, requireAuth, optionalAuth
  utils/auth0.js             Auth0 requests: login/logout urls, code exchange, getAuth0User
  utils/ai.js                AI levels, the AI's move from the Stockfish engine API (js-chess-engine if it's down)
  utils/validate.js          Move rules (was the lambda's validate/validate.js)
deploy/
  chess.service              systemd unit for the server
  nginx.conf                 nginx site (proxy, Socket.IO WebSockets, rate limit)
terraform/
  aws-enviroment/            Root module: bucket, domain names, table names, the server's Elastic IP
  modules/server/            IAM role + instance profile, chess + engine DNS records
  modules/cloudfront/        Assets: ACM cert, DNS validation, CloudFront, Route 53 alias
  modules/dynamodb/          Chess (games) and user tables
```

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
