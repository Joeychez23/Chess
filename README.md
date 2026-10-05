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
| **Home** | Signed-in players see a list of their open games. |
| **Mobile** | Portrait and landscape layouts and touch input. iOS audio is unlocked on the first tap so the opponent's move sounds play. |
| **TV / remote mode** | Arrow keys move a cursor and Enter picks up and drops pieces and drives the menu. Turn it on with the `TV_DEV` flag in `client/src/js/main.js`. |

## How it works

1. **Startup.** If the page is opened directly (not in an iframe), it reads
   `PLAYER_ID`, `GAME_ID`, and `CHESS_URL` from `client/.env`, which
   `dotenv-webpack` inlines at build time, and starts a game. Inside an
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

Requires Node 18+.

```bash
npm install
```

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
npm run dev     # webpack-dev-server on http://localhost:3002
npm run build   # bundles into client/dist
```

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
| game → host | `auth` | Player chose Sign-in (guest) or Home without a session |

The player id `LAKESIDE_GUEST_USER` is treated as a guest. Guests get a fresh
game against the AI on each load, and Home becomes Sign-in.

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
  webpack.config.js          Entry, HTML template, PWA manifest, dotenv
  src-sw.js                  Workbox service worker (not registered at the moment)
  src/css/style.css          Menu, game list, and layout styles
  src/js/main.js             Menu, postMessage handling, new solo/multiplayer games
  src/js/gameplay/
    index.js                 renderCanvas(): sprite loading, render loop, input, animation
    validate/index.js        Backend calls: get game, move, reset, user games, invite
    ai/index.js              Computer move via js-chess-engine (+ promotion)
    user/index.js            Converts a dropped tile into a { from, to, promotion } move
    utils/index.js           Per-square tile state
terraform/
  aws-enviroment/            Root module: bucket, domain names
  modules/cloudfront/        ACM cert, DNS validation, CloudFront, Route 53 alias
```
