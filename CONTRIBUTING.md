# Contributing to EasySend

Thanks for helping. This file describes how changes get into `main`. For setting up a development machine, see [section 14 of the README](README.md#14-local-development).

## Workflow

1. Open (or pick) an issue that describes the change.
2. Branch from an up-to-date `main`: `feat/<short-description>` or `fix/<short-description>`.
3. Commit in small steps using [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`, `docs:`, `build:`, `ci:`, `chore:`, `refactor:`, `test:`; add `!` or a `BREAKING CHANGE:` footer for incompatible changes). Messages in English.
4. Open a pull request to `main` using the template (summary, linked issue with `Closes #N`, how to verify, checklist).
5. Merge is **squash only** and the PR title becomes the commit message on `main`, so the title must itself be a valid Conventional Commit. release-please builds the changelog from it.

`main` is protected: a pull request is required, force pushes and deletion are blocked, and the branch must be up to date. These checks must be green (do not rename the jobs):

| Check       | What it runs                                                                          |
| ----------- | ------------------------------------------------------------------------------------- |
| `lint`      | ESLint, Prettier, ShellCheck, actionlint, `api:docs:check`, `db:check`, Compose files |
| `typecheck` | `tsc --noEmit` in every package                                                       |
| `test`      | Vitest, plus `pnpm test:mailpit`                                                      |
| `build`     | Production build, Docker images and a smoke test                                      |
| `e2e`       | Playwright against a production-mode stack with a fake Cloudflare API                 |

Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck` and `pnpm test` before pushing. `pnpm test:e2e` needs Docker.

## Rules

- **Validation**: every input is validated with a Zod schema. Schemas, types and constants used by both sides live in `packages/shared`; do not duplicate types.
- **Authorization**: check it on every resource. A non-owner gets 404, not 403.
- **API contract**: endpoints are registered in `packages/shared/src/contract`. After any change to the contract or the schemas, run `pnpm api:docs` and commit `docs/api.md`.
- **Database**: after any change to the Drizzle schema, run `pnpm db:generate` and commit the migration. `pnpm db:check` fails if they differ.
- **No secrets** in the repository, logs or error messages. IP addresses are logged only as HMAC hashes, download tokens never.
- **Frontend**: use shadcn/ui components wherever an equivalent exists instead of native controls. Every user-facing string goes in both `apps/web/src/i18n/locales/it/` and `.../en/` (a test checks that the keys match). Target WCAG 2.2 AA: keyboard use, contrast, labels, controls of at least 44x44 px, no horizontal scroll from 320 px.
- **Memory**: uploads, downloads and zips stream. Never load a whole file in memory.
- **Tests**: add or update tests with the change (Vitest for units, Supertest for the API, Playwright for end-to-end flows).

## Dependencies

Do not add a dependency without saying which one and why in the PR. Prefer maintained, light libraries that work on Alpine (musl). Versions shared between packages go in the `catalog:` of `pnpm-workspace.yaml`.

The API is bundled with tsdown, so for `apps/api`:

- pure-JavaScript packages go in `devDependencies` (they end up in the bundle);
- native packages go in `dependencies` and in the `NATIVE` list in `apps/api/tsdown.config.ts`, so they stay external and are installed in the image.

TypeScript is pinned to 6.0.x until typescript-eslint supports a newer one.

## Releases

Releases are automated with [release-please](https://github.com/googleapis/release-please):

1. Conventional Commits on `main` keep a release pull request up to date (version bump, changelog).
2. Checks started by the release bot's `GITHUB_TOKEN` wait for approval: open the release PR and use "Approve workflows to run" (or `gh api -X POST repos/ivanerricis/easysend/actions/runs/<id>/approve`). Then wait for green checks.
3. The maintainer merges the release PR. That creates the tag `vX.Y.Z` and the GitHub Release, and `publish.yml` builds and pushes the images `easysend-api`, `easysend-web` and `easysend-cloudflared` to GHCR with attestations and a Trivy scan.

While the version is 0.x, incompatible changes bump the minor number. 1.0.0 is decided by the maintainer.

## Dependabot

Dependabot opens PRs for npm packages, GitHub Actions and Docker base images. They are reviewed by hand: read the changelog, wait for green checks, and squash merge. Major bumps may need code changes.

## Reporting security problems

Do not open a public issue. See [SECURITY.md](SECURITY.md).
