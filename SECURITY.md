# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue, pull request or discussion.

Go to the repository's **Security** tab and choose **[Report a vulnerability](https://github.com/Joeychez23/Chess/security/advisories/new)**. Only the maintainer can see the report.

Include:

- What the problem is and what someone could do with it
- Where it is: the url, API route, Socket.IO event or file
- Steps to reproduce it, or a proof of concept
- Anything you've already tried or noticed

You'll get a reply in the advisory. Once it's fixed, the advisory can be published with credit to you if you'd like.

## What's covered

- The live site, [chess.aws-prac-route53.com](https://chess.aws-prac-route53.com/), including `/api` and `/socket.io`
- The code in this repository on `main`, including the data service (`data-service/`), the Terraform and the deploy files
- The engine API at `engine.aws-prac-route53.com` (its code is in [Joeychez23/Chess-Engine](https://github.com/Joeychez23/Chess-Engine))

Only the latest `main` and the live site are supported. Older commits don't get fixes.

## How it's laid out

- **The public instance** (`Chess-Stockfish`) runs nginx (HTTPS), the chess server (Express and Socket.IO) and the engine API. It signs players in through Auth0, but it can't make a session: it only has the public half of the session key, so it can check tokens and not sign them (#252). It has no access to the database: its AWS role has no DynamoDB permissions (#250).
- **The data service** runs on a private instance with no public IP and no route to the internet. Its security group lets in only the public instance's group, on its port and SSH. It's the only code that can read or write the database:
  - its own IAM role, used through a VPC endpoint, allows the few calls it makes, on the two tables only;
  - it accepts only requests the chess server signed with a shared secret (`DATA_SERVICE_SECRET`), sent within 30 seconds and only once;
  - it holds the only session key, and signs a session only for an Auth0 login it checked itself (Auth0's signature, our tenant and app, recent and used once), and a guest token only for the game it just made;
  - it acts only for the player whose session token or guest token the request carries;
  - it re-checks every action against the stored data (the player is in the game, it's their turn, the move is legal), and takes only the fields that action allows.
- **Someone who takes over the public instance** gets no AWS keys and can't scan, delete or rewrite the tables, and can't sign a session or guest token. What it still doesn't stop: they would see the cookies of players using the site during that time, and could reuse those sessions until they expire (15 minutes for an access token, 7 days for a refresh token) or the player logs out, which ends their session on every device: the data service checks every access token's session id against the player's row, so tokens already out stop working at once too.

## Session keys

The data service signs every session and guest token with its private key (ES256). The chess server only has the public half. Keep them that way:

- **The private key is made on the data service and never leaves it.** It goes only in `/opt/data-service/.env` (mode 600, owned by `dataservice`) as `SESSION_PRIVATE_KEY`. It's never committed, copied to the public instance, or pasted anywhere else. Delete the key file once it's in the `.env`.
- **Only the public half goes on the chess server**, as `SESSION_PUBLIC_KEY` in `server/.env`. The server refuses to start with a private key there.
- **Your Mac uses its own pair**, so a session made locally can't be used on the live site.
- **Auth0's public keys** are saved next to the data service as `auth0-jwks.json`, because it has no internet. They're public, but they decide which logins are accepted, so only copy them from your Auth0 tenant's `/.well-known/jwks.json`.

### Setting them up on the live site

1. **On the data service, make the key:**

   ```bash
   openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out /tmp/session-key.pem
   openssl pkey -in /tmp/session-key.pem -pubout     # the public half, for step 4
   ```

2. **Save Auth0's keys.** On your Mac, from the `chess-frontend` folder (use the full path if your shell is somewhere else):

   ```bash
   curl -s https://<AUTH0_ISSUER_BASE_URL_ORIGIN>/.well-known/jwks.json -o data-service/auth0-jwks.json
   scp -J ubuntu@52.11.177.148 data-service/auth0-jwks.json ubuntu@172.31.64.10:/tmp/
   ```

   Then on the data service:

   ```bash
   sudo install -o dataservice -g dataservice -m 644 /tmp/auth0-jwks.json /opt/data-service/auth0-jwks.json
   ```

3. **Update the data service.** Copy the code with [deploy/README.md step 10](deploy/README.md#10-the-data-service)'s rsync. Then get the two Auth0 values on Chess-Stockfish:

   ```bash
   grep -E '^AUTH0_(ISSUER_BASE_URL_ORIGIN|CLIENT_ID)=' /opt/chess/server/.env
   ```

   On the data service, swap `JWT_SECRET` for the key and those two lines, delete the key file and restart it:

   ```bash
   sudo sed -i '/^JWT_SECRET=/d' /opt/data-service/.env
   { printf 'SESSION_PRIVATE_KEY="'; cat /tmp/session-key.pem; printf '"\n'; } | sudo tee -a /opt/data-service/.env >/dev/null
   sudo tee -a /opt/data-service/.env >/dev/null <<'EOF'
   <the two AUTH0_ lines>
   EOF
   rm /tmp/session-key.pem
   sudo systemctl restart data-service && journalctl -u data-service -n 5   # "Data service on http://172.31.64.10:8090"
   ```

4. **On Chess-Stockfish, deploy the new server code** ([SETUP.md → Deploy by hand](SETUP.md#deploy-by-hand), the chess server part, without the restart), **add the public half** (from step 1) and restart the chess server:

   ```bash
   sed -i '/^JWT_\(SECRET\|EXPIRES_IN\|REFRESH_EXPIRES_IN\)=/d' /opt/chess/server/.env
   cat >> /opt/chess/server/.env <<'EOF'
   SESSION_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----
   <the two lines from step 1>
   -----END PUBLIC KEY-----"
   EOF
   sudo systemctl restart chess && journalctl -u chess -n 5
   ```

5. **Check:** sign in, play a guest game and log out. Then, on the data service:

   ```bash
   journalctl -u data-service --since "15 min ago" | grep REFUSED
   ```

   A few `401 Bad refresh token` lines are the old sign-ins being refused, which signs everyone out once. If the chess server answers 503 and its journal says `its tokens are signed with key ...`, the public key in step 4 isn't the half of the data service's key.

`chess` exiting with `Missing required environment variable SESSION_PUBLIC_KEY` means the new code is deployed but step 4 isn't done.

### If a key leaks

Make a new pair (step 1) and replace both halves at once, without the overlap in [data-service/README.md → Changing the session key](data-service/README.md#changing-the-session-key). Take the old key out first, so the `.env` files don't hold both:

```bash
sudo sed -i '/^SESSION_PRIVATE_KEY=/,/END PRIVATE KEY/d' /opt/data-service/.env    # on the data service
sed -i '/^SESSION_PUBLIC_KEY=/,/END PUBLIC KEY/d' /opt/chess/server/.env    # on Chess-Stockfish
```

Then add the new halves with step 3's `SESSION_PRIVATE_KEY` line (not the Auth0 lines, they're already there) and step 4's `cat`, delete the key file, and restart both. Every session and guest token signed with the old key stops working, so everyone is signed out and guests start a new game.

## Please don't

- Run denial-of-service or load tests against the live site or the engine
- Access, change or delete other players' accounts or games; use your own test accounts
- Test Auth0, AWS or GitHub themselves. Report problems in those services to them
