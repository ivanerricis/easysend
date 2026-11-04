# Changelog

## [0.4.0](https://github.com/ivanerricis/easysend/compare/v0.3.0...v0.4.0) (2026-11-04)


### Features

* folders in transfers (phase 10) ([#60](https://github.com/ivanerricis/easysend/issues/60)) ([c2ba29c](https://github.com/ivanerricis/easysend/commit/c2ba29c09847bd2c34b16e428ce97b79b8592c2b))


### Bug Fixes

* address open CodeQL and Dependabot alerts ([#59](https://github.com/ivanerricis/easysend/issues/59)) ([4ab5906](https://github.com/ivanerricis/easysend/commit/4ab5906a4be25d4472c0644a97d09875cefc68bf))
* **scripts:** refuse the one-click update runner in a protected install directory ([#54](https://github.com/ivanerricis/easysend/issues/54)) ([f4a69c2](https://github.com/ivanerricis/easysend/commit/f4a69c25da0c706d76bea7ef2d106732ccbf4675))
* **web:** keep dialog buttons inside the dialog and fail E2E on overflowing dialogs ([#58](https://github.com/ivanerricis/easysend/issues/58)) ([d5792cb](https://github.com/ivanerricis/easysend/commit/d5792cba72a2e810dbd13a7ea2e9d92076b7ffbc))
* **web:** keep the visible text in the accessible name of the copy-link and update-notice links ([#61](https://github.com/ivanerricis/easysend/issues/61)) ([f2022d8](https://github.com/ivanerricis/easysend/commit/f2022d80918fc8254d5b8109c613aca38b8eb3c0))
* **web:** reload on stale chunks after an update and stop the layout shift on open menus ([#55](https://github.com/ivanerricis/easysend/issues/55)) ([d0eab44](https://github.com/ivanerricis/easysend/commit/d0eab44122384708d76e25931205a49047e67ece))

## [0.3.0](https://github.com/ivanerricis/easysend/compare/v0.2.0...v0.3.0) (2026-11-04)


### Features

* selectable S3-compatible storage (phase 9) ([#52](https://github.com/ivanerricis/easysend/issues/52)) ([d38d507](https://github.com/ivanerricis/easysend/commit/d38d5074b03869e434bfc1d93955efd3e0065ef3))

## [0.2.0](https://github.com/ivanerricis/easysend/compare/v0.1.1...v0.2.0) (2026-11-04)


### Features

* configurable host folder for the data (DATA_PATH) ([#40](https://github.com/ivanerricis/easysend/issues/40)) ([6d61861](https://github.com/ivanerricis/easysend/commit/6d61861c91af876b14acea774ed67b22372e1890))
* one-click update from the admin panel (phase 7) ([#26](https://github.com/ivanerricis/easysend/issues/26)) ([e24e7cd](https://github.com/ivanerricis/easysend/commit/e24e7cd949d2e0379ac70181dfa609815baf1eb8))
* upload request links (phase 8) ([#49](https://github.com/ivanerricis/easysend/issues/49)) ([cd78716](https://github.com/ivanerricis/easysend/commit/cd78716b69160163d247de2819d457f1e2205bb3))
* **web:** copy the share link from the transfers tables ([#46](https://github.com/ivanerricis/easysend/issues/46)) ([4f21652](https://github.com/ivanerricis/easysend/commit/4f216523a42fa8be6fe7b066d70d9ac9a141cc5e))


### Bug Fixes

* **api:** create the tus upload directory synchronously ([#48](https://github.com/ivanerricis/easysend/issues/48)) ([8e0f19c](https://github.com/ivanerricis/easysend/commit/8e0f19c3d592e582f02cc7999a77aac3d15d8dbf))
* patch audited dependencies and restore the pointer cursor ([#38](https://github.com/ivanerricis/easysend/issues/38)) ([a387809](https://github.com/ivanerricis/easysend/commit/a387809af79f89c4efba588ca7fb60b2ba1615bf))
* remove the old DNS record after a domain change and warn about a stale PUBLIC_URL ([#47](https://github.com/ivanerricis/easysend/issues/47)) ([200f35c](https://github.com/ivanerricis/easysend/commit/200f35cdde2266e9ad3801ea24b72c5f2ea4b84b))
* **upload:** accept files whose type the browser does not know ([#24](https://github.com/ivanerricis/easysend/issues/24)) ([bc69949](https://github.com/ivanerricis/easysend/commit/bc699499328299d825b2c40b6436ac77cb9fbdce))
* **web:** give every form field an id or name ([#25](https://github.com/ivanerricis/easysend/issues/25)) ([7386e44](https://github.com/ivanerricis/easysend/commit/7386e446891a2f94815be8c8b1be0da640dd8e51))

## [0.1.1](https://github.com/ivanerricis/easysend/compare/v0.1.0...v0.1.1) (2026-10-21)


### Bug Fixes

* **docs:** run VitePress on a patched vite 6 ([#21](https://github.com/ivanerricis/easysend/issues/21)) ([441dc27](https://github.com/ivanerricis/easysend/commit/441dc273cc1580292b320c97046df70407f807b3))
* **web:** keep the focus in the field while typing after a failed submit ([#23](https://github.com/ivanerricis/easysend/issues/23)) ([40dabd3](https://github.com/ivanerricis/easysend/commit/40dabd3450bda65872e7cd3225139207fddbfb5d))

## 0.1.0 (2026-10-20)


### Features

* add EasySend logo and web icons ([#12](https://github.com/ivanerricis/easysend/issues/12)) ([33d9645](https://github.com/ivanerricis/easysend/commit/33d964571f49c801f6e85dcb2d5f63872818232b))
* authentication, 2FA and user management (phase 2) ([#13](https://github.com/ivanerricis/easysend/issues/13)) ([ee8fd24](https://github.com/ivanerricis/easysend/commit/ee8fd2498114ef0c9135a22a8a16ac9efe55b947))
* foundations and API contract (phase 1) ([#10](https://github.com/ivanerricis/easysend/issues/10)) ([0b82958](https://github.com/ivanerricis/easysend/commit/0b82958a7c6d1e49d56e7407c5729bb38f2f1e6c))
* hardening, E2E, release and deploy (phase 6) ([#18](https://github.com/ivanerricis/easysend/issues/18)) ([5280895](https://github.com/ivanerricis/easysend/commit/528089598d96558f7d37fa8ad53928872ecd7f8a))
* setup wizard, Cloudflare and branded email (phase 4) ([#15](https://github.com/ivanerricis/easysend/issues/15)) ([31b387e](https://github.com/ivanerricis/easysend/commit/31b387ec9edb448fb3f15ad70b0b3f483bb417eb))
* uploads, encryption, downloads and cleanup (phase 3) ([#14](https://github.com/ivanerricis/easysend/issues/14)) ([c43802c](https://github.com/ivanerricis/easysend/commit/c43802c8ce399bf4d86aafe9de45e2217beb3395))
* web interface (phase 5) ([#16](https://github.com/ivanerricis/easysend/issues/16)) ([8c226c6](https://github.com/ivanerricis/easysend/commit/8c226c6bc6791a9d41f6e87018526ae00f0c6ef7))
