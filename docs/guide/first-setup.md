# First setup (wizard)

The web container is published only on `127.0.0.1:8080` of the LXC, so before Cloudflare is configured you reach it through an SSH tunnel. From your PC:

```sh
ssh -L 8080:127.0.0.1:8080 easysend@<lxc-address>
```

Open http://localhost:8080. The wizard asks for a setup code, which the api prints in its log at every start until the setup is complete:

```sh
cd /opt/easysend
docker compose logs api | grep "Setup code"
```

The steps:

1. **Admin account**: email and password, then mandatory two-factor authentication (scan the QR code) and your recovery codes. Save the codes: they are shown once.
2. **SMTP**: server, port, credentials and sender. The wizard sends a test email and does not let you continue until it succeeds.
3. **Cloudflare**: your domain, the hostname for the app and an API token ([Cloudflare API token](./cloudflare)).
4. **General settings**: instance name, disk space reserve, upload chunk size, default language and theme.

When the Cloudflare step ends, the `cloudflared` container starts by itself and the app answers at `https://<your hostname>`. From then on you can close the SSH tunnel and use the public address.

![Setup wizard: admin account](../screenshots/02-setup-admin-qr-light.png)
