# Requirements

- A Proxmox LXC with Debian 12, Docker CE and the Compose plugin (see [LXC preparation](./lxc)). Any Linux host with Docker works too.
- 2 GB of RAM for the whole stack. The memory limits add up to about 1 GB.
- Disk space: while a file is being encrypted it exists twice (the uploaded copy and the encrypted copy), so plan for at least 2 times the size of the largest file you will handle, plus everything you keep stored. The app refuses an upload when `free space - reserve < 2 x size`. The default reserve is 1 GB and can be changed in the admin settings.
- A domain managed by Cloudflare (the free plan is enough) and an API token ([Cloudflare API token](./cloudflare)).
- A working SMTP server: notifications are always on, so the wizard requires a successful test email.
