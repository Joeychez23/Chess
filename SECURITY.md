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
- **Someone who takes over the public instance** gets no AWS keys and can't scan, delete or rewrite the tables, and can't sign a session or guest token. What it still doesn't stop: they would see the cookies of players using the site during that time, and could reuse those sessions until they expire (15 minutes for an access token, 7 days for a refresh token) or the player logs out, which ends their session on every device.

## Please don't

- Run denial-of-service or load tests against the live site or the engine
- Access, change or delete other players' accounts or games; use your own test accounts
- Test Auth0, AWS or GitHub themselves. Report problems in those services to them
