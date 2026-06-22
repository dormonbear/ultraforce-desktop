# Security Policy

## Supported versions

This is an actively developed personal tool; only the **latest release** receives
security fixes.

## Reporting a vulnerability

**Please do not report security issues in public GitHub issues.**

Use GitHub's private vulnerability reporting:
[Report a vulnerability](https://github.com/dormonbear/ultraforce-desktop/security/advisories/new).
(Repo maintainer: enable it under Settings → Security → "Private vulnerability reporting".)

Please include reproduction steps, affected version, and impact. We aim to
acknowledge reports within a few days and will keep you updated on the fix.

## Scope notes

This app runs locally and shells out to the Salesforce CLI (`sf`) using your own
authenticated orgs. It does not store org credentials itself — authentication is
delegated to `sf`. Reports about credential handling, command injection via
SOQL/Apex input, or the auto-updater are especially welcome.
