---
layout: home
title: EasySend
titleTemplate: Self-hosted large file transfer

hero:
  name: EasySend
  text: Send large files from your own server
  tagline: A self-hosted WeTransfer alternative with resumable uploads, encryption at rest and a Cloudflare Tunnel, so no inbound port is opened.
  image:
    src: /favicon.svg
    alt: EasySend logo
  actions:
    - theme: brand
      text: Get started
      link: /guide/install
    - theme: alt
      text: Introduction
      link: /guide/introduction
    - theme: alt
      text: GitHub
      link: https://github.com/ivanerricis/easysend

features:
  - title: Resumable uploads
    details: Very large files with the tus protocol, in chunks of 25 MB, within the Cloudflare free plan limits.
  - title: Encrypted at rest
    details: AES-256-GCM on the server disk. Upload, download and zip are streamed, so RAM does not grow with file size.
  - title: Links with controls
    details: Share by link or email. Expiry, optional password and download limit. Revoke a transfer at any time.
  - title: Users and 2FA
    details: Admin and user roles, per-user quotas, mandatory TOTP two-factor authentication for admins.
  - title: Setup wizard
    details: Admin account, SMTP, Cloudflare tunnel and general settings. No config files to edit by hand.
  - title: Light on resources
    details: The whole stack runs within about 1 GB of memory limits. Italian and English interface, light and dark theme, custom branding.
---

<div class="home-shot">

![New transfer page](./screenshots/06-new-transfer-light.png)

</div>
