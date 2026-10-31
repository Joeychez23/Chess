# Deploy

<div align="center">

[Home](../README.md) · [Client](../client/README.md) · [Server](../server/README.md) · [Data service](../data-service/README.md) · **Deploy** · [Terraform](../terraform/README.md) · [Setup & fixes](../SETUP.md)

</div>

---

```text
browser ──HTTPS──> nginx ──> chess server :8080 ──http://127.0.0.1:3001──> chess-engine-api ──> Stockfish 19
   │                         (Express + Socket.IO,
   │                          serves client/dist)
   └──HTTPS──> CloudFront (assets.chess.aws-prac-route53.com) ──> S3: images/, audio/
```

One EC2 instance runs the chess server and
[chess-engine-api](../../chess-engine-api). The browser loads the page and calls
`/api` and `/socket.io` on `chess.aws-prac-route53.com`. The session cookies
only work on that domain, so the same Express server serves the client (not
S3). CloudFront only serves the images and audio.

In order:

1. [Terraform](../terraform/README.md): the IAM role, the DNS records, CloudFront for the
   assets, and the DynamoDB tables.
2. chess-engine-api's
   [Deploy to EC2](../../chess-engine-api/README.md#deploy-to-ec2): launches the
   instance, moves the Elastic IP, builds Stockfish 19, and starts the engine.
3. [The chess server](#1-before-you-start) on the same instance.

## 1. Before you start

- The engine is running on the instance (chess-engine-api's steps 1–7).
- The instance has the `EC2_Chess_DynamoDB` instance profile. To add it to an
  instance that's already running: **EC2 → Actions → Security → Modify IAM
  role**.
- `dig +short chess.aws-prac-route53.com` prints the Elastic IP. certbot checks
  it in step 7.

## 2. Auth0

In the Auth0 app's settings, add
`https://chess.aws-prac-route53.com/api/auth/callback` to **Allowed Callback
URLs** and `https://chess.aws-prac-route53.com/` to **Allowed Logout URLs**.
Both fields take comma-separated lists, so keep the `localhost` entries for
development.

In **Advanced Settings** -> **Grant Types**, enable **Password**. In the Auth0
tenant settings, enable **Trust Token Endpoint IP Header** so Auth0 can use the
`auth0-forwarded-for` header for login protection.

## 3. Copy the code

From your Mac, in this folder:

```bash
ssh -i ~/path/to/key.pem ubuntu@<elastic-ip> 'sudo mkdir -p /opt/chess && sudo chown ubuntu: /opt/chess'
rsync -av --exclude node_modules --exclude .env --exclude dist --exclude .DS_Store \
  --exclude /.git --exclude /stockfish --exclude /terraform --exclude /data-service \
  --exclude /client/src/images --exclude /client/src/audio \
  -e "ssh -i ~/path/to/key.pem" ./ ubuntu@<elastic-ip>:/opt/chess/
```

That leaves out your `.env` files (the instance gets its own in step 4), the
local Stockfish build, the Terraform state, and the images and audio
(CloudFront serves them). Both `package-lock.json` files are committed, so
`npm ci` installs the same versions on the instance as everywhere else.

## 4. `.env` files

Copy both from your Mac, then change what's different on the instance:

```bash
scp -i ~/path/to/key.pem client/.env ubuntu@<elastic-ip>:/opt/chess/client/.env
scp -i ~/path/to/key.pem server/.env ubuntu@<elastic-ip>:/opt/chess/server/.env
```

`client/.env` is read when the client is built. Check that
`CHESS_ASSESTS_URL` is `https://assets.chess.aws-prac-route53.com`, not `.`:
every sprite, sound, and the favicon load from it.

`server/.env`, on the instance (`nano /opt/chess/server/.env`):

| Variable | On the instance |
| --- | --- |
| `API_PORT` | `8080`. chess-engine-api has 3001, and `deploy/nginx.conf` forwards to 8080 |
| `AUTH0_CALLBACK_URL` | `https://chess.aws-prac-route53.com/api/auth/callback` |
| `CLIENT_URL` | `https://chess.aws-prac-route53.com/` |
| `ENGINE_URL` | `http://127.0.0.1:3001/v1` |
| `SESSION_PUBLIC_KEY` | The public half of the live data service's key ([Making the session keys](../data-service/README.md#making-the-session-keys)), not your Mac's, so a session made on your Mac can't be used on the live site |
| `DATA_SERVICE_URL` | `http://172.31.64.10:8090`, the data service's private IP ([Data service instance](../terraform/README.md#data-service-instance)) |
| `DATA_SERVICE_SECRET` | A new one (the command is in `server/.env.example`). The same value goes in the data service's `.env` in step 10 |

The server won't start without `SESSION_PUBLIC_KEY` and `DATA_SERVICE_SECRET`.
On a new setup, make the session key on the data service first (step 10, with
its instance from [Data service instance](../terraform/README.md#data-service-instance)), or fill
these in before step 6.

The Auth0 values stay the same. Then lock the file to your user:
`chmod 600 /opt/chess/server/.env`.

## 5. Install and build

On the instance:

```bash
cd /opt/chess
npm ci
npm run build
cd server && npm ci --omit=dev
```

`npm run build` bundles the client into `client/dist`. The service only runs
the server (not `npm start`), so restarting it doesn't rebuild the client:
build again after copying new client code.

## 6. Start the server

```bash
cd /opt/chess
sudo cp deploy/chess.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now chess
curl -s localhost:8080/api/chess/levels
```

`/api/chess/levels` answers without DynamoDB or Auth0, so it only checks that
the server is up. The service runs as `ubuntu` with `NODE_ENV=production`,
which makes the session cookies HTTPS-only: logging in only works through
`https://`, after step 7.

## 7. nginx and HTTPS

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/chess
sudo ln -s /etc/nginx/sites-available/chess /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d chess.aws-prac-route53.com
```

`deploy/nginx.conf` forwards everything to the server on 8080, passes
Socket.IO's WebSocket upgrade through, and allows 10 requests per second per
IP (bursts of 40). The server also limits making games itself (see [Chess API](../server/README.md#chess-api)). Its upgrade variable is named `$chess_connection_upgrade`
because chess-engine-api's site on the same instance already defines
`$connection_upgrade`, and nginx won't start with two.

## 8. Check it

- Open `https://chess.aws-prac-route53.com`, log in, and play a level 8 game.
  `journalctl -u chess -f` should show no `STOCKFISH FAILED` line. If it
  does, check `curl -s localhost:3001/health`.
- Play a friend game in two browsers (or one private window) to check that
  moves arrive over Socket.IO.
- `sudo systemctl status chess chess-engine-api nginx` shows all three running.

## 9. Make an AMI

Once everything works: **EC2 → Instances**, select it, **Actions → Image and
templates → Create image**. If the instance is ever lost, launch from that AMI
with the `EC2_Chess_DynamoDB` instance profile and move the Elastic IP
(chess-engine-api's step 2). Both services start on boot. Keep the AMI private:
it has your `.env` secrets and a Stockfish binary in it (see
[Stockfish license](../README.md#stockfish-license)).

The data service's instance needs no AMI: Terraform makes it again
([Data service instance](../terraform/README.md#data-service-instance)) and step 10 installs it.

## 10. The data service

The data service runs on its own private instance (`172.31.64.10`, made by
Terraform in [Data service instance](../terraform/README.md#data-service-instance)), as its own user
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
   | `SESSION_PRIVATE_KEY` | A new key made on this instance ([Making the session keys](../data-service/README.md#making-the-session-keys)). Its public half goes in the server's `.env` as `SESSION_PUBLIC_KEY` |
   | `AUTH0_ISSUER_BASE_URL_ORIGIN` / `AUTH0_CLIENT_ID` | The same values as the server's `.env` |
   | `DATA_SERVICE_SECRET` | The same value as the server's `.env` (step 4). If it doesn't have one yet, make it with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and put it in both |
   | `DYNAMODB_REGION` | `us-west-2` |

   ```bash
   nano /tmp/data-service.env                                   # on the data service
   sudo install -o dataservice -g dataservice -m 600 /tmp/data-service.env /opt/data-service/.env
   rm /tmp/data-service.env
   ```

   No AWS keys go anywhere. It uses its instance's role, `EC2_Chess_DataService`.
   Then save Auth0's keys next to it ([Saving Auth0's keys](../data-service/README.md#saving-auth0s-keys)).

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

6. **The session key** ([Making the session keys](../data-service/README.md#making-the-session-keys)):
   make it here and put its public half in the server's `.env` as
   `SESSION_PUBLIC_KEY`. [SETUP.md](../SETUP.md#make-the-session-key) has the commands.

## 11. Check the whole site

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

## Updating, logs and fixes

[SETUP.md](../SETUP.md) has the update commands (one paste on Chess-Stockfish), the
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

## Layout

```text
deploy/
  chess.service              systemd unit for the server
  data-service.service       systemd unit for the data service (its own user, read-only system, on the private instance)
  nginx.conf                 nginx site (proxy, Socket.IO WebSockets, rate limit)
```

---

<div align="center">

[Home](../README.md) · [Client](../client/README.md) · [Server](../server/README.md) · [Data service](../data-service/README.md) · **Deploy** · [Terraform](../terraform/README.md) · [Setup & fixes](../SETUP.md)

</div>
