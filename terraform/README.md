# Terraform

<div align="center">

[Home](../README.md) · [Client](../client/README.md) · [Server](../server/README.md) · [Data service](../data-service/README.md) · [Deploy](../deploy/README.md) · **Terraform** · [Setup & fixes](../SETUP.md)

</div>

---

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
  TLS 1.2+ only, `GET`/`HEAD`/`OPTIONS` only, the managed `CachingOptimized`
  cache policy and `SecurityHeadersPolicy` response headers), and the Route 53
  alias record. The pages aren't on CloudFront (the chess server sends them,
  uncached). Assets are uploaded once per version folder with a one-year
  `Cache-Control`, so a changed image goes up under a new version instead of
  replacing a cached file (see `client/README.md`).
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

### Restoring a table

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

### Moving the tables to us-west-2

Done in October 2026 (#246): Terraform made new, empty tables in us-west-2, next
to `Chess-Stockfish`, after `terraform state rm` of the us-east-1 ones. Games,
settings, ratings and usernames started over; Auth0 accounts didn't change.
Delete the old us-east-1 tables once nothing is needed from them
(`aws dynamodb delete-table --region us-east-1 --table-name chess_db`, then `user_db`).

### Data service instance

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
   is deployed ([step 10](../deploy/README.md#10-the-data-service)), use a stand-in on the instance:

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

## Layout

```text
terraform/
  aws-enviroment/            Root module: bucket, domain names, table names, the server's Elastic IP
  modules/server/            IAM role + instance profile, chess + engine DNS records
  modules/cloudfront/        Assets: ACM cert, DNS validation, CloudFront, Route 53 alias
  modules/dynamodb/          Chess (games) and user tables
  modules/data_service/      The data service's private subnet, DynamoDB endpoint, security group, role and instance, and the upkeep NAT
```

---

<div align="center">

[Home](../README.md) · [Client](../client/README.md) · [Server](../server/README.md) · [Data service](../data-service/README.md) · [Deploy](../deploy/README.md) · **Terraform** · [Setup & fixes](../SETUP.md)

</div>
