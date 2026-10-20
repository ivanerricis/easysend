# Requisiti

- Un LXC Proxmox con Debian 12, Docker CE e il plugin Compose (vedi [Preparazione del container LXC](./lxc)). Funziona anche qualsiasi host Linux con Docker.
- 2 GB di RAM per tutto lo stack. I limiti di memoria sommano circa 1 GB.
- Spazio su disco: mentre un file viene cifrato esiste due volte (la copia caricata e quella cifrata), quindi prevedi almeno 2 volte la dimensione del file più grande che gestirai, più tutto ciò che conservi. L'app rifiuta un upload quando `spazio libero - riserva < 2 x dimensione`. La riserva predefinita è 1 GB e si cambia nelle impostazioni admin.
- Un dominio gestito da Cloudflare (basta il piano gratuito) e un token API ([Token API di Cloudflare](./cloudflare)).
- Un server SMTP funzionante: le notifiche sono sempre attive, quindi il wizard richiede un'email di prova inviata con successo.
