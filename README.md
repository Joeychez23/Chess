# Chess

**Live:** [chess.aws-prac-route53.com](https://chess.aws-prac-route53.com/)

A chess game drawn entirely on an HTML5 canvas: sprite pieces with shadows and
reflections on a wooden table, sliding move animations, and move sounds. Play
the computer or challenge a friend by email. The browser checks each move
first, then a Lambda backend
([chess-validation](https://github.com/Joeychez23/Lambdas)) checks it again
against the board stored in DynamoDB before it counts.

Built with vanilla JavaScript, HTML5 Canvas, Webpack 5,
[chess.js](https://github.com/jhlywa/chess.js) (rules, legal moves, check),
and [js-chess-engine](https://github.com/josefjadrny/js-chess-engine) (the
computer opponent). Hosted on S3 + CloudFront, provisioned with Terraform.

## Features

| | |
| --- | --- |
| **Canvas rendering** | Board, table, and pieces are sprites drawn in layers (reflection, shadow, piece). Knights face the direction they last moved; the backend tracks each knight's last move so this survives a reload. |
| **Moving** | Drag and drop, or click a piece and then a square. Legal moves are highlighted, and a king in check is highlighted. Moves slide into place with a sound. |
| **Promotion** | When a pawn reaches the last rank, you pick the new piece by clicking one of your captured pieces beside the board. |
| **Play AI** | The computer opponent (js-chess-engine, level 1) runs in the browser. Your color is random. |
| **Play Friends** | Enter your opponent's email. The backend looks up their Auth0 account and creates the game. Their moves are picked up by polling every 2 seconds and animated when they arrive. |
| **Home** | Signed-in players only: a list of their open games. Hidden for guests. |
| **Login / Logout** | The menu's Exit button logs guests in and signed-in players out. Auth0 runs on the Express server (see [Auth](#auth)). |
| **Mobile** | Portrait and landscape layouts and touch input. iOS audio is unlocked on the first tap so the opponent's move sounds play. |
| **TV / remote mode** | Arrow keys move a cursor and Enter picks up and drops pieces and drives the menu. Turn it on with the `TV_DEV` flag in `client/src/js/main.js`. |

## How it works

1. **Startup.** If the page is opened directly (not in an iframe), it asks the
   server who is signed in (`GET /api/user`) while the page loads. A signed-in
   player opens their latest game (or a new one vs. the AI). A guest gets
   `PLAYER_ID`, `GAME_ID`, and `CHESS_URL` from `client/.env`, which
   `dotenv-webpack` inlines at build time. Inside an
   iframe, it waits for the host page to send `userinfo` and `start` messages
   (see [Embedding](#embedding)).
2. **Load.** `renderCanvas()` preloads every sprite, then asks the backend for
   the game (`POST { game_id, player_id }`). The backend returns the board
   (FEN), your color, and whether the opponent is the AI. If `PLAYER_ID`
   equals `GAME_ID` and no game exists yet, a new game against the AI is
   created first.
3. **Render loop.** A ~33 fps loop redraws only when something changed: a
   hover, a drag, a slide in progress, or new data.
4. **Your move.** chess.js plays the move locally, which throws on an illegal
   move. If it's legal, the move is sent as
   `POST { game_id, player_id, move: [from, to], promotion }`. If the server
   rejects it, the board reverts to the last state the server confirmed.
5. **AI move.** js-chess-engine picks a move from the current FEN. The move is
   animated and then submitted under the player id `CHESS_AI`, so the server
   validates it like any other move.
6. **Friend's move.** Every 2 seconds the client fetches the game, and if the
   board changed it animates the server's `prev_move`.

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

In the Auth0 app's settings, add `AUTH0_CALLBACK_URL` to **Allowed Callback
URLs** and `CLIENT_URL` to **Allowed Logout URLs**.

`client/.env`:

| Variable | Purpose |
| --- | --- |
| `CHESS_URL` | Chess API endpoint, e.g. `https://backend.chess.aws-prac-route53.com/api/chess` |
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
npm run dev     # webpack-dev-server on http://localhost:3002, /api is proxied to :3001 (run the server too)
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

## Deploy

`client/dist` is uploaded to an S3 static-website bucket. The Terraform in
`terraform/` puts CloudFront in front of it:

- ACM certificate for `chess.aws-prac-route53.com` (us-east-1, as CloudFront
  requires), validated through a Route 53 DNS record
- CloudFront distribution with the S3 website endpoint as origin, HTTP →
  HTTPS redirect, and TTL 0 so a new deploy shows up right away
- Route 53 `A` alias record pointing the subdomain at the distribution

```bash
cd terraform/aws-enviroment
terraform init
terraform apply
```

The Route 53 hosted zone for `aws-prac-route53.com` and the S3 bucket
(`aws-prac-chess-s3`, us-west-2) must already exist. Names are set in
`terraform/aws-enviroment/locals.tf`.

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

Send a `POST` to `https://backend.chess.aws-prac-route53.com/api/chess` from
Postman, Insomnia, or curl. `player_id_1` plays white:

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
  index.html                 Menu markup (Resume, Restart, Home, Play AI, Play Friends, Exit)
  webpack.config.js          Entry, HTML template, PWA manifest, dotenv, dev proxy
  src-sw.js                  Workbox service worker (not registered at the moment)
  src/css/style.css          Menu, game list, and layout styles
  src/js/main.js             Menu, postMessage handling, new solo/multiplayer games
  src/js/auth/clientSideAuth.js  login() / logout() / getUser() / refresh() → server auth routes
  src/js/gameplay/
    index.js                 renderCanvas(): sprite loading, render loop, input, animation
    validate/index.js        Backend calls: get game, move, reset, user games, invite
    ai/index.js              Computer move via js-chess-engine (+ promotion)
    user/index.js            Converts a dropped tile into a { from, to, promotion } move
    utils/index.js           Per-square tile state
server/
  index.js                   Express: serves client/dist + /api routes
  config.js                  Reads server/.env
  routes/api/                /api/auth/* and /api/user
  controllers/
    authController.js        login, callback, logout, refresh
    userController.js        getUser
  middleware/auth.js         JWT session cookies, requireAuth
  utils/auth0.js             Auth0 requests: login/logout urls, code exchange, getAuth0User
terraform/
  aws-enviroment/            Root module: bucket, domain names
  modules/cloudfront/        ACM cert, DNS validation, CloudFront, Route 53 alias
```
