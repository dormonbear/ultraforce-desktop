# Development workflow (Gitflow + release-please)

This repo follows **Gitflow** branch conventions, with one adaptation:
**release-please owns the versioning/changelog/tag step** (you never bump versions
or tag by hand). Conventional Commits are therefore mandatory — they drive the
version and the `CHANGELOG`.

> Context: Gitflow's author and Atlassian both consider classic Gitflow heavy for
> continuously-delivered apps and recommend GitHub Flow there. We keep Gitflow's
> branch structure for explicit release control; a [lightweight option](#lightweight-option)
> is documented below if the overhead isn't worth it.

## Branches

| Branch | Base | Merges into | Purpose |
|---|---|---|---|
| `main` | — | — | Production. Every commit is a released version. Tagged by release-please. **Protected.** |
| `develop` | `main` | — | Integration of finished work. Default branch. **Protected.** |
| `feature/<slug>` | `develop` | `develop` | New features / fixes. Short-lived. |
| `release/<x.y.z>` | `develop` | `main` **and** `develop` | Stabilize a release (bugfix/docs only, no new features). |
| `hotfix/<x.y.z>` | `main` | `main` **and** `develop` | Urgent production fix outside the normal cycle. |

## Daily flow (feature)

```bash
git checkout develop && git pull
git checkout -b feature/soql-order-by-completion
# ... commit with Conventional Commits: feat: / fix: / docs: / refactor: / test: / chore:
git push -u origin feature/soql-order-by-completion
gh pr create --base develop        # PR targets develop
```

- Squash-merge is fine for `feature/* → develop`, but the **PR title must be a
  Conventional Commit** — it becomes the commit on `develop` that release-please reads.

## Cutting a release

```bash
git checkout develop && git pull
git checkout -b release/0.3.0          # name is a human label; real version is computed
# only stabilization commits here (fix:/docs:/chore:)
gh pr create --base main               # release/* -> main
```

1. **Merge the `release/* → main` PR with a merge commit** (not squash) so every
   Conventional Commit reaches `main` for the changelog.
2. The push to `main` runs the Release workflow → **release-please opens a
   `chore(main): release x.y.z` PR** (bumps the 3 version files + `CHANGELOG.md`).
3. **Merge that Release PR** → release-please tags `vx.y.z`, creates the GitHub
   Release, and the build job uploads signed bundles + `latest.json` for all platforms.
4. **Back-merge `main → develop`** (brings the version bump + changelog), then
   delete `release/0.3.0`.

```bash
git checkout develop && git pull
git merge origin/main && git push     # back-merge; via PR if develop blocks direct pushes
```

## Hotfix

```bash
git checkout main && git pull
git checkout -b hotfix/0.3.1
# fix: ...
gh pr create --base main
```

Then same as a release: merge → release-please Release PR → merge → tag/build →
back-merge `main → develop`.

## Rules

- **Never commit directly to `main` or `develop`** — both are protected; use a PR.
- **Conventional Commits are required.** Version effect (pre-1.0): `fix:` → patch,
  `feat:` → minor, `feat!:`/`BREAKING CHANGE` → minor. Non-shipping (`docs:`,
  `chore:`, `refactor:`, `test:`, `ci:`) → no release.
- **You never edit version numbers or create tags** — release-please does. See
  [`RELEASE.md`](./RELEASE.md).
- Keep `feature/*` short-lived and rebased on `develop` to avoid drift.

## Lightweight option

For solo / fast iteration, drop `release/*` and release straight from `develop`:
`feature/* → develop`, then open a `develop → main` PR when you want to ship — the
rest (Release PR, tag, build) is identical. `hotfix/*` still branches off `main`.
This is the trunk-leaning variant the upstream sources recommend for this kind of
continuously-delivered app.
