# Signed-release auto-update — Design (heavy tier, spec only — needs signing infra)

> Date: 2026-06-21 · Status: Spec (implementation deferred — requires signing keys + CI)
> Crates: desktop (tauri-plugin-updater), release CI. Roadmap item #8.

## Goal

In-app update: the desktop app checks for, downloads, and installs signed new releases.

## Hard prerequisites (infrastructure, not code)

1. **Code-signing identities** — Apple Developer ID (macOS notarization) and a Windows signing
   cert. Without these, auto-update ships unsigned binaries (blocked by Gatekeeper/SmartScreen).
2. **Tauri updater signing keypair** — generate, store the private key in CI secrets, ship the
   public key in the app.
3. **Release hosting** — a stable URL serving `latest.json` + signed artifacts (e.g. GitHub
   Releases). Versioning + changelog feed.

## Design sketch (only after infra exists)

- Add `tauri-plugin-updater`; configure the public key + update endpoint in `tauri.conf.json`.
- CI: on tag, build per-platform bundles, sign + notarize, generate the updater signature, publish
  `latest.json` + artifacts.
- Desktop: check on launch (and a manual "Check for updates"); prompt → download → verify
  signature → install on restart. Failures are non-blocking.

## Why deferred

Gated on signing certificates and release CI that don't exist yet. Engineering is ~1–2 days once
the infra is in place; obtaining the certs/notarization is the long pole.

## Testing (when implemented)

- A staging update channel; verify signature-mismatch is rejected and a valid update installs.
