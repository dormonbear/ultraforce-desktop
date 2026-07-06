#!/usr/bin/env node
// Fetch the uf-ost binary for this platform from the matching GitHub Release.
// ponytail: runtime download over per-platform npm packages — one package, no matrix.
// Version equals the release tag (release-please bumps this package.json), so the
// URL always points at the binary shipped in the same release.
"use strict";
const fs = require("fs");
const path = require("path");
const { version } = require("./package.json");

const REPO = "dormonbear/ultraforce-desktop";
// node `${platform} ${arch}` -> Rust target triple as named by release.yml assets.
const TRIPLES = {
  "darwin arm64": "aarch64-apple-darwin",
  "darwin x64": "x86_64-apple-darwin",
  "linux x64": "x86_64-unknown-linux-gnu",
  "win32 x64": "x86_64-pc-windows-msvc",
};

async function main() {
  if (process.env.UF_OST_SKIP_DOWNLOAD) return;

  const key = `${process.platform} ${process.arch}`;
  const triple = TRIPLES[key];
  const ext = process.platform === "win32" ? ".exe" : "";
  if (!triple) {
    console.warn(
      `[uf-ost] no prebuilt binary for ${key}; download manually from https://github.com/${REPO}/releases`
    );
    return; // don't fail the install on unsupported platforms
  }

  const url = `https://github.com/${REPO}/releases/download/v${version}/uf-ost-${triple}${ext}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

  const binDir = path.join(__dirname, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const dest = path.join(binDir, `uf-ost${ext}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()), { mode: 0o755 });
  console.log(`[uf-ost] installed ${triple} binary (v${version})`);
}

// Never hard-fail install: a missing binary is reported clearly at run time.
main().catch((e) =>
  console.warn(
    `[uf-ost] download skipped (${e.message}); download manually from https://github.com/${REPO}/releases`
  )
);
