# LXC preparation

Docker inside an unprivileged LXC needs the `nesting` and `keyctl` features.

On the Proxmox host, download the Debian 12 template (`pveam update && pveam available | grep debian-12`, then `pveam download local <template>`) and create the container (adjust the ID, template name, storage and bridge):

```sh
pct create 200 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname easysend --unprivileged 1 --features nesting=1,keyctl=1 \
  --cores 2 --memory 2048 --swap 512 \
  --rootfs local-lvm:40 --net0 name=eth0,bridge=vmbr0,ip=dhcp
pct start 200
```

In the GUI: Create CT, leave "Unprivileged container" checked, then select the container, Options, Features, Edit, and tick Nesting and keyctl. Restart the container.

Inside the container, install Docker CE from the official repository:

```sh
apt update && apt install -y ca-certificates curl sudo
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  > /etc/apt/sources.list.d/docker.list
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

Create a normal user, add it to the `docker` group and set the timezone:

```sh
adduser easysend
usermod -aG docker easysend
timedatectl set-timezone Europe/Rome
```

Log out and in again so the group applies. The commands in the next pages are run as that user.
