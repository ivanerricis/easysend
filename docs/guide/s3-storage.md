# S3 storage

By default the encrypted files live on the local disk of the server (`/data/storage`). If that disk is small, you can store them on an S3-compatible service instead: Cloudflare R2, MinIO, AWS S3, Backblaze B2, Wasabi and similar. It is optional and you can switch at any time.

## When it makes sense

- The LXC disk is small and you do not want to grow it.
- You already have a bucket (or a MinIO server) with plenty of space.
- You want the files outside the host, so a lost disk does not mean lost files (see [Backup](./backup) for the other side of this).

If the local disk is big enough, stay on it: it is the simplest setup, with no extra service, no traffic costs and nothing more to back up separately.

## How it works

- Files are encrypted by EasySend before they leave the server, with the same format as on disk. The bucket only ever holds encrypted objects with random names (UUIDs); the keys stay in the database and the master key never leaves the server.
- Downloads and zips are streamed through EasySend (it reads the object in ranges and decrypts on the fly). Your visitors never talk to the bucket and the bucket does not need to be public. RAM use stays constant.
- Each file remembers where it is stored. Changing the storage only affects **new** files; the existing ones stay where they are until you move them (see [Moving files](#moving-files)). Both storages work at the same time during that period.
- The S3 secret key is stored encrypted in the database, like the SMTP password.

### What always stays local

| What                                        | Why                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Database, sessions, settings                | SQLite in `/data/db`.                                                                                                                |
| Master key and secrets                      | `/data/secrets`.                                                                                                                     |
| Logos, favicon, background                  | `/data/branding`.                                                                                                                    |
| Temporary upload files (tus) in `/data/tmp` | An upload arrives on the local disk first and is encrypted and sent to the bucket when it is complete. They are deleted right after. |

Disk space: with the local disk an upload needs **twice** its size free (the upload plus the encrypted copy). With S3 it needs **once** its size free in `/data/tmp`, because the encrypted copy goes straight to the bucket. The reserve you set in the general settings still applies. The bucket itself has no limit checked by EasySend, so watch your provider's quota.

## Settings by provider

Fill these in **Settings > File storage** (or in the wizard step "Where to save the files"). The panel lists the same examples under "Endpoint examples".

| Provider      | Endpoint                                        | Region                              | Path-style |
| ------------- | ----------------------------------------------- | ----------------------------------- | ---------- |
| Cloudflare R2 | `https://<account-id>.r2.cloudflarestorage.com` | `auto`                              | off        |
| MinIO         | `http://minio:9000` or your own HTTPS address   | `us-east-1` (the default)           | **on**     |
| AWS S3        | `https://s3.<region>.amazonaws.com`             | the bucket region, e.g. `eu-west-1` | off        |
| Backblaze B2  | `https://s3.<region>.backblazeb2.com`           | e.g. `eu-central-003`               | off        |
| Wasabi        | `https://s3.<region>.wasabisys.com`             | e.g. `eu-central-1`                 | off        |

- **Bucket**: create it first, private. **Prefix** is an optional folder inside the bucket (for example `easysend`), useful if the bucket is shared. EasySend only reads and writes objects under it.
- **Path-style** puts the bucket in the URL path (`https://host/bucket/key`) instead of the host name (`https://bucket.host/key`). Turn it on for MinIO and for any server that has no wildcard DNS for buckets.
- The region must match the one the provider expects, otherwise the signature is refused (the connection test says so).
- Use a key pair made only for EasySend, restricted to that bucket.

### Permissions

The key needs these actions on the bucket (and on the objects in it, under the prefix if you use one):

- `PutObject`, `GetObject`, `DeleteObject`;
- `ListBucket` (to find leftovers and check the connection);
- the multipart ones, used for big files: `AbortMultipartUpload`, `ListBucketMultipartUploads`, `ListMultipartUploadParts`.

On AWS S3, for a bucket called `easysend-files`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:ListBucketMultipartUploads"],
      "Resource": "arn:aws:s3:::easysend-files"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": "arn:aws:s3:::easysend-files/*"
    }
  ]
}
```

On Cloudflare R2 create an API token with **Object Read & Write** limited to the bucket. On B2 and Wasabi create an application key / user limited to the bucket with read, write and delete.

### Lifecycle rule for incomplete uploads

Big files are sent to the bucket in parts (multipart upload, 16 MB per part). If the server stops in the middle, the parts already sent stay in the bucket and, on most providers, are billed until someone removes them. EasySend aborts the ones older than 24 hours at start and during the hourly cleanup, but it is good practice to add a rule on the bucket as a safety net: **abort incomplete multipart uploads after 1 to 7 days** (AWS: lifecycle rule "Delete expired object delete markers or incomplete multipart uploads"; R2 and B2 have the same option in the bucket settings).

### Traffic and costs

Every download goes bucket -> EasySend -> visitor, so a transfer downloaded N times reads its bytes N times from the bucket. Providers differ a lot here: AWS S3 charges for the traffic out of the bucket, while Cloudflare R2 and Wasabi do not charge for egress (Wasabi has a minimum storage period and a fair-use policy) and B2 gives a free allowance. Check the current prices and limits of your provider before moving large amounts of data. The server also needs enough bandwidth: uploads and downloads go through it.

## Choosing the storage

### From the panel (recommended)

1. Open **Settings > File storage**, choose **S3-compatible storage** and fill in the fields.
2. Click **Test connection**. EasySend writes, reads and deletes a test object in the bucket. If it fails, the reason is shown (access denied, bucket not found, wrong keys or region, timeout, unreachable server).
3. **Save** is enabled only after a successful test with exactly these values. Change a field and you have to test again.

The new files go to S3 from that moment. The page shows how many files and bytes are on each storage.

While there are files on S3, **endpoint, bucket and prefix are locked** (they would make those files unreachable). Region, path-style and keys can still be changed after a new test, for example to rotate the keys. To change the bucket, move the files back to the local disk first.

To go back to the disk, choose **Local disk** and save: no test is needed. The S3 settings are kept.

### From `.env` at the first start

For automated installs you can seed the storage before the first start, in `.env`:

```sh
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=easysend-files
S3_PREFIX=
S3_FORCE_PATH_STYLE=false
S3_ACCESS_KEY_ID=...
# the secret key: directly, or (better) in a file inside /data/secrets
S3_SECRET_ACCESS_KEY=...
S3_SECRET_ACCESS_KEY_FILE=s3.key
```

`S3_SECRET_ACCESS_KEY_FILE` is a path relative to `/data/secrets` (the folder of the master key): put the key there with mode 600 and leave `S3_SECRET_ACCESS_KEY` empty so the secret does not sit in `.env`. An empty `STORAGE_DRIVER` or `local` means the local disk. An incomplete or invalid S3 configuration stops the start with a message naming the variables (never their values).

::: warning The variables are read only once
They are imported at the **first start** (when no storage setting exists yet) and saved, encrypted, in the database. From then on the database is the source of truth and the variables are ignored: changing `.env` later does nothing. If the active settings differ from the variables, the Storage page shows a notice; edit the settings from the panel.
:::

## Moving files

Switching the storage does not move anything. To move the existing files:

### From the panel

On **Settings > File storage**, the card **Move files between storages** shows how many files are on the other storage than the one in use. Click the button, confirm, and follow the progress. You can stop it at any time: the files already moved stay moved and the others stay where they were. Users can keep downloading during the move.

### From the command line

```sh
docker compose exec api node dist/cli/storage-migrate.js --to local --dry-run   # only counts
docker compose exec api node dist/cli/storage-migrate.js --to s3
docker compose exec api node dist/cli/storage-migrate.js --to local
```

(`pnpm storage:migrate -- --to s3|local [--dry-run]` in a development checkout.) It prints the progress and stops cleanly on Ctrl+C. `--to s3` needs the S3 settings to be saved already; `--to local` checks that the disk has room for everything.

### What happens during a move

- The encrypted bytes are copied **as they are** (no re-encryption, the keys do not change), one file at a time, with constant memory.
- A file switches to the new storage only after it was copied completely. A download that is already reading the old copy finishes normally.
- The original is **deleted after about one hour**, by the hourly cleanup job. During that hour both copies exist, so count the extra space (disk or bucket).
- If the server restarts in the middle, the move resumes by itself. If a file cannot be moved, the others continue and the result shows how many failed; start the move again to retry them.
- Only one move runs at a time.

## Backup

The backup script and archive do **not** include the files stored on S3. Back the bucket up with your provider's tools (versioning, replication) or with `rclone sync`. The database backup in the archive holds the wrapped key of every file and the encrypted S3 settings, and the master key is in the archive too, so the bucket together with the archive is enough to restore. See [Backup and restore](./backup).

## Troubleshooting

- **The connection test says "access denied"**: the key lacks one of the permissions above, or it is restricted to another bucket or prefix.
- **"The keys or the region are not correct"**: check the secret key and the region of the bucket; with R2 the region is `auto`.
- **"The bucket does not exist"**: wrong name, or wrong endpoint or region for that bucket.
- **"The server is not reachable"** with a self-hosted MinIO: from the api container the address must resolve and be reachable (`docker compose exec api wget -S -O- <endpoint>/minio/health/live`); a name that only works on your PC does not.
- **Downloads fail with "storage unavailable"**: the bucket did not answer. Check the provider status and the api logs (`docker compose logs api`); they contain the operation and the object name, never keys.
