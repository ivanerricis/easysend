# Preparazione del container LXC

Docker dentro un LXC non privilegiato richiede le funzioni `nesting` e `keyctl`.

Sull'host Proxmox scarica il template Debian 12 (`pveam update && pveam available | grep debian-12`, poi `pveam download local <template>`) e crea il container (adatta ID, nome del template, storage e bridge):

```sh
pct create 200 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname easysend --unprivileged 1 --features nesting=1,keyctl=1 \
  --cores 2 --memory 2048 --swap 512 \
  --rootfs local-lvm:40 --net0 name=eth0,bridge=vmbr0,ip=dhcp
pct start 200
```

Dall'interfaccia grafica: Create CT, lascia spuntato "Unprivileged container", poi seleziona il container, Options, Features, Edit e spunta Nesting e keyctl. Riavvia il container.

Dentro il container installa Docker CE dal repository ufficiale:

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

Crea un utente normale, aggiungilo al gruppo `docker` e imposta il fuso orario:

```sh
adduser easysend
usermod -aG docker easysend
timedatectl set-timezone Europe/Rome
```

Esci e rientra perché il gruppo venga applicato. I comandi delle pagine seguenti si eseguono con quell'utente.
