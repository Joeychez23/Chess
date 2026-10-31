# Setup and fixes

Commands for deploying the live site and fixing what goes wrong. Each command says which machine it runs on. The full walkthrough is in [deploy/README.md](deploy/README.md), and the key rules are in [SECURITY.md → Session keys](SECURITY.md#session-keys).

**Never paste a `.env`'s values into a chat, an issue or a PR.** To check one, list only the names (see [Check a `.env` without showing it](#check-a-env-without-showing-it)).

## The machines

| Name | Where | Prompt | Runs |
|---|---|---|---|
| **Your Mac** | your laptop | — | the repo, Terraform |
| **Chess-Stockfish** | public, `52.11.177.148` | `ubuntu@ip-172-31-44-94` | nginx, `chess` (the chess server), the engine |
| **Data service** | private, `172.31.64.10` | `ubuntu@ip-172-31-64-10` | `data-service`, the only access to DynamoDB |

Run `hostname` when you're not sure which one you're on.

### Log in

**On your Mac:** load your key, so the jump and `ssh -A` work (use your key file's path)
```bash
ssh-add ~/.ssh/key-10-14-26.pem
```

**On your Mac:** Chess-Stockfish, with your key forwarded (so it can reach the data service)
```bash
ssh -A ubuntu@52.11.177.148
```

**On your Mac:** the data service, through Chess-Stockfish
```bash
ssh -J ubuntu@52.11.177.148 ubuntu@172.31.64.10
```

## Deploy a new version

Data service first, then the chess server.

**On Chess-Stockfish** (logged in with `ssh -A`)
```bash
set -e
rm -rf /tmp/chess-new && git clone --depth 1 --branch main https://github.com/Joeychez23/Chess.git /tmp/chess-new

# DATA SERVICE: KEEPS ITS .env, auth0-jwks.json & node_modules
rsync -a --delete --exclude node_modules --exclude .env --exclude auth0-jwks.json --exclude test /tmp/chess-new/data-service/ ubuntu@172.31.64.10:/opt/data-service/
ssh ubuntu@172.31.64.10 'sudo systemctl restart data-service && sleep 2 && journalctl -u data-service -n 5 --no-pager'
curl -s http://172.31.64.10:8090/health; echo

# CHESS SERVER: KEEPS ITS .env, node_modules, images & audio
rsync -a --delete --exclude .env --exclude node_modules --exclude dist --exclude /.git --exclude /stockfish --exclude /terraform --exclude /data-service --exclude /client/src/images --exclude /client/src/audio /tmp/chess-new/ /opt/chess/
cd /opt/chess && npm ci && npm run build
cd server && npm ci --omit=dev && sudo systemctl restart chess
sleep 2 && journalctl -u chess -n 20 --no-pager
rm -rf /tmp/chess-new
```

It worked when:
- the data service's journal says `Data service on http://172.31.64.10:8090`;
- `/health` prints `{"status":200,"message":"OK"}`;
- the chess journal has no `Missing required environment variable`.

**The data service's packages changed** (`data-service/package-lock.json`). It has no internet, so open an upkeep window around the install.

**On your Mac** (in `terraform/aws-enviroment`)
```bash
terraform apply -var maintenance=true
```

**On the data service**
```bash
cd /opt/data-service && . /opt/nvm/nvm.sh && npm ci --omit=dev && sudo systemctl restart data-service
```

**On your Mac** (in `terraform/aws-enviroment`): close the window, about 4.5¢ an hour while it's open
```bash
terraform apply
```

## Check a `.env` without showing it

**On Chess-Stockfish**
```bash
grep -oE '^[A-Z0-9_]+=' /opt/chess/server/.env
```

**On the data service**
```bash
sudo grep -oE '^[A-Z0-9_]+=' /opt/data-service/.env; ls -l /opt/data-service/auth0-jwks.json
```

| `server/.env` (Chess-Stockfish) needs | `/opt/data-service/.env` needs |
|---|---|
| `API_PORT` (`8080`) | `DATA_SERVICE_HOST` (`172.31.64.10`) |
| `AUTH0_ISSUER_BASE_URL_ORIGIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` | `DATA_SERVICE_PORT` (`8090`) |
| `AUTH0_CALLBACK_URL`, `CLIENT_URL` | `DATA_SERVICE_SECRET` (the same as the server's) |
| `ENGINE_URL` (`http://127.0.0.1:3001/v1`) | `SESSION_PRIVATE_KEY` |
| `DATA_SERVICE_URL` (`http://172.31.64.10:8090`) | `AUTH0_ISSUER_BASE_URL_ORIGIN`, `AUTH0_CLIENT_ID` (the same as the server's) |
| `DATA_SERVICE_SECRET` | `DYNAMODB_REGION` (optional, `us-west-2`) |
| `SESSION_PUBLIC_KEY` | and the file `auth0-jwks.json` next to it |
| **No** `JWT_SECRET` | **No** `JWT_SECRET` |

## Editing a `.env`

The data service's `.env` is owned by `dataservice` with mode 600: every command on it needs `sudo`. A plain `nano`, `cat` or `>>` gets "Permission denied".

**On the data service**
```bash
sudo nano /opt/data-service/.env
sudo systemctl restart data-service && journalctl -u data-service -n 5 --no-pager
```

**On Chess-Stockfish**
```bash
nano /opt/chess/server/.env
sudo systemctl restart chess && journalctl -u chess -n 10 --no-pager
```

Multi-line keys go in double quotes, with every line:
```
SESSION_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----
...
-----END PUBLIC KEY-----"
```

**A pasted block (heredoc) didn't save:** the paste broke the `<<'EOF'` part. Use `sudo nano`, or append one line at a time.

**On the data service**
```bash
sudo sh -c 'printf "%s\n" "NAME=value" >> /opt/data-service/.env'
```

## What you see, and the fix

### `chess` won't start

**`Missing required environment variable SESSION_PUBLIC_KEY`:** the new code is deployed, but the server doesn't have the public half of the data service's key yet. Print it from the data service's private key.

**On the data service**
```bash
cd /opt/data-service && sudo -u dataservice /usr/local/bin/node24 -e 'require("dotenv").config({ quiet: true }); console.log(require("crypto").createPublicKey(process.env.SESSION_PRIVATE_KEY).export({ type: "spki", format: "pem" }))'
```

**On Chess-Stockfish:** paste it as `SESSION_PUBLIC_KEY="..."` (all lines, in quotes), then restart
```bash
nano /opt/chess/server/.env
sudo systemctl restart chess && journalctl -u chess -n 10 --no-pager
```

If the data service has no `SESSION_PRIVATE_KEY` either, make the key first ([Make the session key](#make-the-session-key)).

**`Missing required environment variable DATA_SERVICE_SECRET`** (or `is too short`): copy the data service's value.

**On the data service**
```bash
sudo grep '^DATA_SERVICE_SECRET=' /opt/data-service/.env
```

**On Chess-Stockfish:** add it with `DATA_SERVICE_URL=http://172.31.64.10:8090`, then restart
```bash
nano /opt/chess/server/.env
cd /opt/chess/server && npm ci --omit=dev && sudo systemctl restart chess
```

**`Missing required environment variable AUTH0_...`:** the Auth0 values are in your Mac's `server/.env`. Copy them into the instance's.

**`SESSION_PUBLIC_KEY isn't a P-256 public key in PEM`:** the key lost its quotes or a line, or it's the private key. Paste the output of the print command above again, in quotes.

### `data-service` won't start

**`Missing required environment variable AUTH0_ISSUER_BASE_URL_ORIGIN`** (or `AUTH0_CLIENT_ID`)

**On Chess-Stockfish:** print the values
```bash
grep -E '^AUTH0_(ISSUER_BASE_URL_ORIGIN|CLIENT_ID)=' /opt/chess/server/.env
```

**On the data service:** add both lines, then restart
```bash
sudo nano /opt/data-service/.env
sudo systemctl restart data-service && journalctl -u data-service -n 5 --no-pager
```

**`Missing required environment variable SESSION_PRIVATE_KEY`:** see [Make the session key](#make-the-session-key).

**`SESSION_PRIVATE_KEY isn't a P-256 key in PEM`:** the key lost its quotes or a line. Open the `.env` with `sudo nano` and check that it runs from `"-----BEGIN` to `-----END PRIVATE KEY-----"`.

**`Can't read Auth0's keys from .../auth0-jwks.json`:** the file is missing, or isn't JSON.

**On your Mac**
```bash
curl -s https://<AUTH0_ISSUER_BASE_URL_ORIGIN>/.well-known/jwks.json -o /Users/josephsanchez/Desktop/TimeLost/Portfolio/chess-frontend/data-service/auth0-jwks.json
scp -J ubuntu@52.11.177.148 /Users/josephsanchez/Desktop/TimeLost/Portfolio/chess-frontend/data-service/auth0-jwks.json ubuntu@172.31.64.10:/tmp/
```

**On the data service**
```bash
sudo install -o dataservice -g dataservice -m 644 /tmp/auth0-jwks.json /opt/data-service/auth0-jwks.json
sudo systemctl restart data-service && journalctl -u data-service -n 5 --no-pager
```

**`Missing required environment variable DATA_SERVICE_SECRET`:** use the same value as the chess server's.

**On Chess-Stockfish**
```bash
grep '^DATA_SERVICE_SECRET=' /opt/chess/server/.env
```

**On the data service:** add it, then restart
```bash
sudo nano /opt/data-service/.env
```

**`Cannot find module ...`:** its packages aren't installed. See the upkeep window under [Deploy a new version](#deploy-a-new-version).

### Commands that fail

**`Unit data-service.service not found`:** you're on Chess-Stockfish, not the data service. Run `hostname`, then log in to the right one.

**`scp: stat local "data-service/auth0-jwks.json": No such file or directory`:** your shell isn't in `chess-frontend`. Use the full path (`/Users/josephsanchez/Desktop/TimeLost/Portfolio/chess-frontend/data-service/auth0-jwks.json`).

**`ubuntu@172.31.64.10: Permission denied (publickey)`, from Chess-Stockfish:** Chess-Stockfish has no key for the data service. It uses your Mac's, forwarded.

**On your Mac**
```bash
ssh-add ~/.ssh/key-10-14-26.pem
ssh -A ubuntu@52.11.177.148
```

Or do the step on the data service itself (`ssh -J` from your Mac).

**`Permission denied` on `/opt/data-service/.env`:** use `sudo` (see [Editing a `.env`](#editing-a-env)).

**`npm ci` on the data service hangs or says `ENOTFOUND` / `ETIMEDOUT`:** it has no internet. Open an upkeep window first.

**`git pull` on Chess-Stockfish stops with "local changes would be overwritten"**

**On Chess-Stockfish**
```bash
cd /opt/chess && git status
git checkout -- <file>   # only files that were just rebuilt (package-lock.json, built files)
```

### The site is up but something's wrong

**Pages answer "Try again in a moment", and the chess journal says `no answer in 3 seconds` or `fetch failed`:** the chess server can't reach the data service.

**On Chess-Stockfish**
```bash
curl -s http://172.31.64.10:8090/health; echo
grep '^DATA_SERVICE_URL=' /opt/chess/server/.env    # http://172.31.64.10:8090
```

**On the data service**
```bash
sudo systemctl status data-service --no-pager
sudo grep '^DATA_SERVICE_HOST=' /opt/data-service/.env       # 172.31.64.10, never 127.0.0.1
```

**The chess journal says `refused the signature (Bad signature)`:** the two `DATA_SERVICE_SECRET` values differ. Make them the same in both `.env` files and restart both.

**The chess journal says `refused the signature (Request too old)`:** the clocks are more than 30 seconds apart. `NTP service` should be `active`.

**On Chess-Stockfish, then on the data service**
```bash
timedatectl
```

**Signing in or refreshing answers 503, and the chess journal says `its tokens are signed with key ...`:** `SESSION_PUBLIC_KEY` isn't the half of the data service's key. Print it again (see [`chess` won't start](#chess-wont-start)), replace it, and restart `chess`.

**Logins land back on the site signed out.**

**On the data service**
```bash
journalctl -u data-service --since "15 min ago" | grep "session/login"
```

| The line says | Fix |
|---|---|
| `Bad id token: unknown key` | Auth0 changed its key: save `auth0-jwks.json` again |
| `jwt audience invalid` / `jwt issuer invalid` | `AUTH0_CLIENT_ID` / `AUTH0_ISSUER_BASE_URL_ORIGIN` differ from the server's |
| `not this user` / `not this email` | The login isn't a database (`auth0\|`) user, e.g. a social login |
| `already used` / `maxAge exceeded` | A replayed or slow login, so try again |
| (no line) | The chess server didn't get that far. Check `journalctl -u chess -n 30` for `Login failed` |

**Everyone was signed out after a deploy** and the data service logs `401 Bad refresh token`: this is expected once after #252, or after the key changes. Players sign in again.

**Every request says "Player is not in this game", and the data service logs `401 Bad player token`:** the two machines run different versions. Deploy the same commit on both.

**The chess journal says `Data service: ... 500`, and the data service's journal shows `AccessDeniedException`:** the data service can't reach the tables.

**On the data service**
```bash
aws dynamodb get-item --region us-west-2 --table-name user_db --key '{"user_id":{"S":"none"}}'   # {} = allowed
```

**The site breaks with `AccessDeniedException` on Chess-Stockfish:** old chess server code that still talks to DynamoDB, after #250 removed its access. Deploy current `main`.

**The AI is slow:** `ENGINE_URL` isn't `http://127.0.0.1:3001/v1`, so it goes out to the public engine.

**On Chess-Stockfish**
```bash
grep '^ENGINE_URL=' /opt/chess/server/.env
systemctl status chess-engine-api --no-pager
```

## Logs

**On Chess-Stockfish**
```bash
journalctl -u chess -n 40 --no-pager
journalctl -u chess -f                                         # live
journalctl -u chess --since "15 min ago" | grep "Data service"
```

**On the data service**
```bash
journalctl -u data-service -n 40 --no-pager
journalctl -u data-service --since today | grep -c REFUSED     # how many refusals today
journalctl -u data-service --since today | grep REFUSED | tail -20
```

Many 401s mean a version or secret mismatch, or something without the secret calling it. 400s or 403s mean a bug, or requests that aren't the chess server's own.

## Keys and secrets

### Make the session key

**On the data service**
```bash
openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out /tmp/session-key.pem
openssl pkey -in /tmp/session-key.pem -pubout                 # the public half, for the chess server
sudo sed -i '/^SESSION_PRIVATE_KEY=/,/END PRIVATE KEY/d' /opt/data-service/.env   # removes an old one
{ printf 'SESSION_PRIVATE_KEY="'; cat /tmp/session-key.pem; printf '"\n'; } | sudo tee -a /opt/data-service/.env >/dev/null
rm /tmp/session-key.pem
sudo systemctl restart data-service && journalctl -u data-service -n 5 --no-pager
```

**On Chess-Stockfish:** remove the old public key, then paste the new one as `SESSION_PUBLIC_KEY="..."`
```bash
sed -i '/^SESSION_PUBLIC_KEY=/,/END PUBLIC KEY/d' /opt/chess/server/.env
nano /opt/chess/server/.env
sudo systemctl restart chess && journalctl -u chess -n 10 --no-pager
```

A new key signs everyone out once. To change it without that, see [data-service/README.md → Changing the session key](data-service/README.md#changing-the-session-key).

### A key or secret was shown somewhere it shouldn't be

- **`SESSION_PRIVATE_KEY`:** make a new one (above).
- **`DATA_SERVICE_SECRET`:** make a new one, put it in both `.env` files, and restart both.

  **On your Mac**
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```

  To change it without any refusals, use `DATA_SERVICE_SECRET_OLD` ([data-service/README.md](data-service/README.md)).
- **`AUTH0_CLIENT_SECRET`:** rotate it in the Auth0 dashboard (Applications → the app → Settings), then update `server/.env` and restart `chess`.

## Changed files that need more than a restart

**`deploy/chess.service` changed**

**On Chess-Stockfish**
```bash
sudo cp /opt/chess/deploy/chess.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl restart chess
```

**`deploy/data-service.service` changed**

**On your Mac**
```bash
scp -J ubuntu@52.11.177.148 /Users/josephsanchez/Desktop/TimeLost/Portfolio/chess-frontend/deploy/data-service.service ubuntu@172.31.64.10:/tmp/
```

**On the data service**
```bash
sudo cp /tmp/data-service.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl restart data-service
```

**`deploy/nginx.conf` changed:** copying it removes certbot's HTTPS block, so run certbot again ([deploy/README.md → 7. nginx and HTTPS](deploy/README.md#7-nginx-and-https)).

**On Chess-Stockfish**
```bash
sudo cp /opt/chess/deploy/nginx.conf /etc/nginx/sites-available/chess && sudo nginx -t && sudo systemctl reload nginx
```

## Roll back

Deploy the previous commit the same way, but clone the whole history (no `--depth 1`) and check out the commit before the `rsync`s:

**On Chess-Stockfish**
```bash
rm -rf /tmp/chess-new && git clone https://github.com/Joeychez23/Chess.git /tmp/chess-new && git -C /tmp/chess-new checkout <commit>
```

 Going back to code from before #252 (`112b1c0` or older) also needs `JWT_SECRET` back in both `.env` files, the same value in each. Code from before #249 (`8414ecc`) talks to DynamoDB itself, and needs #250's role policy back (revert it in Terraform, then `terraform apply` on your Mac).
