# Development workflow (GitHub Flow + release-please)

This repo uses **GitHub Flow**: a single always-releasable trunk (`main`) with
short-lived branches and pull requests. Releases are automated — **release-please
owns versioning, the `CHANGELOG`, and tags** — so Conventional Commits are mandatory.

> Why GitHub Flow (not Gitflow): this is a continuously-delivered app with a single
> supported version. Gitflow's author and Atlassian both recommend GitHub Flow for
> exactly this case; Gitflow's `develop` / `release/*` branches add overhead with no
> benefit here.

## Branches

| Branch | Purpose |
|---|---|
| `main` | The trunk. Always releasable. **Protected** — changes land only via PR. release-please tags releases from here. |
| `<type>/<slug>` | Short-lived branch off `main` (e.g. `feat/soql-order-by`, `fix/log-parse-crash`, `docs/readme`). PR back into `main`. |

## Flow

```bash
git checkout main && git pull
git checkout -b feat/soql-order-by-completion
# commit with Conventional Commits: feat: / fix: / docs: / refactor: / test: / chore:
git push -u origin feat/soql-order-by-completion
gh pr create --base main
# review → merge
```

- Keep branches small and short-lived; merge to `main` often.
- Squash-merge is fine — but the **PR title must be a Conventional Commit**, since it
  becomes the commit on `main` that release-please reads.

## Releasing (automatic)

You never bump versions or tag by hand:

1. Merging Conventional Commits to `main` makes **release-please** open/update a
   `chore(main): release x.y.z` PR (version files + `CHANGELOG.md`).
2. **Merge that Release PR** → release-please tags `vx.y.z`, creates the GitHub
   Release, and the build job uploads signed bundles + `latest.json` for all platforms.

Version effect (pre-1.0): `fix:` → patch, `feat:` → minor, `feat!:` / `BREAKING CHANGE` → minor.
Non-shipping (`docs:` / `chore:` / `refactor:` / `test:` / `ci:`) → no release. Full
runbook: [`RELEASE.md`](./RELEASE.md).

## Hotfix

No special branch — it's just a normal change: branch off `main`, `fix:` commit,
PR → merge → release-please cuts the patch release.

## Rules

- **Never commit directly to `main`** — it's protected; use a PR.
- **Conventional Commits required** (drives version + changelog).
- **You never edit version numbers or create tags** — release-please does.
