# Data service

<div align="center">

[Home](../README.md) · [Client](../client/README.md) · [Server](../server/README.md) · **Data service** · [Deploy](../deploy/README.md) · [Terraform](../terraform/README.md) · [Setup & fixes](../SETUP.md)

</div>

---

`data-service/` is the only code that reads and writes DynamoDB (#245). The
chess server calls it for every read and write of the games and players
(`server/dataClient.js`). On AWS it runs on a private instance that only the
chess server can reach ([Data service instance](../terraform/README.md#data-service-instance),
[10. The data service](../deploy/README.md#10-the-data-service)). Each route is one named action, checked
against the stored data before anything is saved.

```bash
cd data-service
cp .env.example .env   # DATA_SERVICE_SECRET: a new one (the command is in .env.example). SESSION_PRIVATE_KEY & auth0-jwks.json: Session keys below
npm run dev            # http://127.0.0.1:8090, uses the DynamoDB tables in DYNAMODB_REGION
```

The chess server says who it's acting for with the player it already checked:
`X-Player-Token` (the signed-in player's access token) or `X-Guest-Game` (a
guest's `guest_game` token). The data service signed both, and checks them again
with its own key, and a player id in a body is never used. A player's access
token also has to carry the session id still on their row (one consistent read
per signed-in request), so after logout or Delete my data it's refused at once
with 401 `Session ended`, which the chess server answers as `SESSION EXPIRED`. A guest's player id is
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
| `GET /health/tables` | Signed, no player: reads a key that's never saved from each table, `503` with the error's name when DynamoDB can't answer. The chess server's `GET /api/health` calls it |
| `GET /games/:gameId` | The requester is in the game (`?consistent=true` for a strongly consistent read) |
| `POST /games/:gameId/move` `{ from, to, promotion }` | In the game, open, their turn, a legal move on the stored board. Checkmate or a draw closes the game and rates a friend game |
| `POST /games/:gameId/ai-move` `{ from, to, promotion }` | AI games: the requester is in it, it's the AI's turn, and the move is legal |
| `POST /games/:gameId/forfeit` | In the game and it's open. The other side wins |
| `GET /games/:gameId/ratings` | In the game. Both players' ratings |
| `POST /games/ai` `{ color, level, start_fen }` | A signed-in player vs `CHESS_AI`, at a level from 1 to 8 (3 if left out), from a playable position. The data service makes every new game id (16 random bytes, base64url, `newGameId` in `utils/games.js`) and answers with it in `game_data.game_id`; a body can't name one. The game is still saved only if the id is free (`attribute_not_exists`). Invites and rematches too |
| `POST /games/guest` `{ game_id, color, side, level, start_fen }` | Needs no player. `side` fixes this game's side while `color` is what Restart uses (the play page's first guest game). The guest's own game (their cookie) is reset and keeps its level, only while the stored game is still theirs; any other id (another browser's game, a player's game, `CHESS_AI`) gets a new game and that game isn't touched. Answers with `guest_token`, the guest's cookie for the game it saved |
| `POST /games/invite` `{ opponent_id, opponent_screenname, color, start_fen }` | A signed-in inviter, not to themselves or the AI. A `PENDING` game; the names are each player's username, or their screenname (the inviter's comes from their token) |
| `POST /games/:gameId/accept` `{ replace_current }` | Pending, only the invited player. In this order: their own open friend game answers `{ status: 409, game_id }` unless `replace_current`; the inviter in another friend game is refused; then the invite is accepted (a conditional write: one declined or cancelled since is refused and nothing changes), and only then their friend game is forfeited (`forfeited`) and their sent invite cancelled (`dropped_invites`) |
| `POST /games/:gameId/decline` | Pending, either player. The answer includes the invite, so the chess server can tell both Homes |
| `POST /games/:gameId/rematch` | A friend game that's over and the requester is in it. Neither player can be in another friend game. The first press waits a minute; the second makes the game with the inviter's pick and cancels both players' sent invites (`dropped_invites`). Pressing again while that game is open finishes whatever a failed save left: it makes the game under the saved id if it's missing, then repeats the list adds and the cancels |
| `GET /users/me` | A signed-in player's own row as stored (`?consistent=true`). `?games=true` also prunes expired games and invites and adds the open AI and friend game, the open games, the sent invite and the received invites. Guests have no row (403) |
| `POST /users/me/settings` `{ ai_level, ai_color, friend_color }` | A level from 1 to 8 and `w`, `b` or `random` for each color, all three |
| `POST /users/me/username` `{ username }` | The username rules again (`utils/username.js`), then `claimUsername`: someone else's name, in any capitals, answers `{ status: 409 }` |
| `POST /users/me/delete` | Refused (409) while the player has an open game or an invite: the chess server forfeits, cancels and declines them first. Then the row and the username claim are deleted |
| `POST /session/login` `{ id_token, user }` | Needs no player. Auth0's `id_token` checked against Auth0's saved keys (RS256, our tenant and client, not expired, at most 5 minutes old, used once), and `user` (the chess server's `getAuth0User`, which only looks on `AUTH0_CONNECTION`) must be the one it names, with an `auth0|` id. Then the access and refresh tokens, with the session id on the player's row (made at their first login) |
| `POST /session/refresh` `{ refresh_token }` | A refresh token it signed, whose session id is still the one on the row. A new pair |
| `POST /session/logout` `{ refresh_token }` | A refresh token it signed. Clears the session id, so no device can refresh and every access token already out is refused. A token from a session that already ended changes nothing |

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

## Session keys (#252)

The data service signs every access, refresh and guest token with its private
key (`SESSION_PRIVATE_KEY`, ES256). The chess server only has the public key
(`SESSION_PUBLIC_KEY`). Each token names its key in its header (`kid`, made from
the key itself), and only ES256 tokens signed with a key they have are
accepted: an HS256 token, a `none` token or another key's is refused by both.

### Making the session keys

On AWS, run this on the data service, so the private key never leaves it. Use a
different key on your Mac than on the live site, so a session made locally
can't be used there.

```bash
openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out session-key.pem   # SESSION_PRIVATE_KEY
openssl pkey -in session-key.pem -pubout                                                              # SESSION_PUBLIC_KEY
```

Each goes in its `.env` as a multi-line value in double quotes, the private key
in `data-service/.env` and the public key in `server/.env`:

```ini
SESSION_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----"
```

Then delete `session-key.pem`. Both services check the key when they start and
exit if it isn't a P-256 key (the chess server also refuses a private key).

### Saving Auth0's keys

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

### Changing the session key

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

## Stored data

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
  Both ratings and the game's `ratings` save in one transaction: conditional on
  `rated_games`, so two games ending at once both count, and on the game having no
  `ratings`, so it is never rated twice. A rating that still fails doesn't stop the
  game closing, and logs a line starting `RATING FAILED`.
  Each rated game keeps `ratings` (`{ w, b: { before, after }, at }`), the rating
  history for a future profile chart (#81).
- **Threefold repetition:** the server replays the saved moves, but only once 8
  half moves have passed without a capture or pawn move.

## Tests

The data service has its own tests, the same way as the [server's](../server/README.md#tests) (`data-service/test/`):

| File | What it covers |
| --- | --- |
| `signature.test.js` | Signed requests: unsigned, another secret, a changed body, path, query or method, a timestamp over 30 seconds either way, a replayed request, and the old secret during a change. Behind a good signature, another player's token still gets nothing, and a `user_id` in a body is refused |
| `session.test.js` | Logins: only Auth0's `id_token` (not forged, our client and tenant, not expired, at most 5 minutes old, used once) for the user it names. Refresh while the session id is unchanged, and not after logout (on any device) or Delete my data. An access token already out is refused after either, and can't make the deleted row again. The old key during a change. Guest tokens only for the game just made, with the same guest session from game to game |
| `users.test.js` | A player's own row: reading it with their games (expired ones pruned), settings, usernames (taken in any capitals, the rules), and Delete my data only once every game and invite is answered. Guests have no row |
| `lifecycle.test.js` | New AI games, guest games (only a guest's own game is reset), invites, accepts and declines, and rematches. Each refusal makes or changes nothing |
| `games.test.js` | The game routes: only the player in the request, only in their own game (a guest only in their one game), only the body fields the route names. Illegal moves, moves out of turn, moves in someone else's game, a board sent in place of a move, a refresh or changed token, another key's, an HS256 or a `none` token: each refused with the stored game unchanged, and logged without the body or token |
| `dynamoDB.test.js` | The conditional writes: two moves at once, an undo and a move at once, one close per game, a closing move saving its result in one write, a move refused on a game closed since its read, invite answers, rematch presses, game list changes at once. Saves that don't depend on reading back what they wrote |
| `rating.test.js` | The Elo math, which games are rated, two of a player's games ending at once, a failed write changing neither rating, and a game rated only once |
| `shutdown.test.js` | `SIGTERM` on the real `index.js`: a running request finishes before the exit, a new one is refused, and the next start answers `/health` |
| `shared.test.js` | `utils/validate.js`, `rating.js`, `username.js`, `signature.js` and `sessionKeys.js` are the same files as the server's, and both pin the same `chess.js` |

## Layout

```text
data-service/                The only code that reads and writes DynamoDB (#245), the chess server calls it; on a private instance on AWS
  index.js                   Express: /health, JSON bodies (16kb), the signature, /health/tables, the player, the routes. Listens on DATA_SERVICE_HOST
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
  auth0-jwks.json            Auth0's public keys, saved here (not committed, README.md -> Saving Auth0's keys)
  test/                      Data service tests (npm test): games, lifecycle, users, session, signature, dynamoDB, rating, shared, plus helpers/ (keys.js: the test run's keys)
```

---

<div align="center">

[Home](../README.md) · [Client](../client/README.md) · [Server](../server/README.md) · **Data service** · [Deploy](../deploy/README.md) · [Terraform](../terraform/README.md) · [Setup & fixes](../SETUP.md)

</div>
