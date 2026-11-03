# Data location

By default EasySend keeps everything it stores (database, encrypted files, logos, the master key) in the Docker volume `easysend-data`, which lives on the disk that holds Docker's data (`/var/lib/docker`). If that disk is small, or you want the data on a second disk, a NAS share or a folder you back up with other tools, point `DATA_PATH` at a folder of your choice.

Only the data volume is affected. The small `easysend-shared` volume (the tunnel token) stays a Docker volume.

## 1. Choose the folder (Proxmox LXC)

Inside an unprivileged LXC the disk has to be given to the container first. Two usual ways, on the Proxmox host:

- **A new disk for the container** (simplest). Proxmox creates and formats it, and it shows up inside the container as a normal folder:

  ```sh
  pct set 200 -mp0 local-lvm:200,mp=/mnt/dati   # 200 GB volume mounted at /mnt/dati
  ```

- **An existing host folder or second physical disk.** Mount the disk on the host (for example at `/mnt/disk2`), create a folder and hand it to the container user. In an unprivileged container the container's uid 1000 is uid 101000 on the host:

  ```sh
  mkdir -p /mnt/disk2/easysend
  chown 101000:101000 /mnt/disk2/easysend
  pct set 200 -mp0 /mnt/disk2/easysend,mp=/mnt/dati/easysend
  ```

Restart the container (`pct reboot 200`) so the mount point appears. For a plain Debian host or VM with no LXC, any local folder works.

## 2. Create it with the right owner

The api runs as uid/gid 1000 and cannot start if it cannot write the folder. Inside the LXC:

```sh
sudo install -d -o 1000 -g 1000 /mnt/dati/easysend
```

`DATA_PATH` must be an absolute path that exists, without a trailing slash and without `:`.

## 3. Set DATA_PATH and deploy

Add the line to `.env` (see `.env.example`) and run the deploy script, which checks the folder (exists, is a directory, writable by uid 1000) before it touches the running stack:

```sh
echo 'DATA_PATH=/mnt/dati/easysend' >> .env
./scripts/deploy.sh --force
```

On a new installation this is all: the folder is empty and EasySend starts a fresh database in it. If a deploy stops with exit code 22 the folder is wrong, and the message says what to fix. The admin page **Storage** shows the folder, the free space of that disk and the reserve.

## Moving existing data

Do this only if you already have data in the volume. Plan a short downtime.

```sh
cd /opt/easysend

# 1. back up first and keep the archive (it also contains the master key)
./scripts/backup.sh

# 2. stop the stack (the volume stays)
docker compose stop

# 3. copy the volume into the folder, keeping owners and permissions
#    (<project> is the Compose project name: see `docker volume ls`)
docker run --rm -v <project>_easysend-data:/from:ro -v /mnt/dati/easysend:/to alpine:3.24.2 \
  sh -c 'cp -a /from/. /to/'

# 4. check it: owner must be 1000 and db/, storage/, secrets/ must be there
ls -ln /mnt/dati/easysend
du -sh /mnt/dati/easysend

# 5. use the folder and start again
echo 'DATA_PATH=/mnt/dati/easysend' >> .env
./scripts/deploy.sh --force
```

Verify before deleting anything: sign in, open **Storage** (it must show the host folder), open a transfer and download a file. Only when everything works, and after you have a backup archive stored elsewhere, remove the old volume:

```sh
docker volume rm <project>_easysend-data
```

To go back to the volume, remove the `DATA_PATH` line and deploy again: the volume must still hold the data you want.

## Backups, rollbacks and uninstall

- `./scripts/backup.sh` reads the folder when `DATA_PATH` is set ([Backup and restore](./backup)).
- `./scripts/rollback.sh` refuses to go back to a release older than this feature while `DATA_PATH` is set: that release would ignore the folder and start on an empty volume. Your data is not touched.
- `./scripts/uninstall.sh --purge` never deletes the folder: it prints its path and the command to remove it by hand ([Uninstall](./uninstall)).
