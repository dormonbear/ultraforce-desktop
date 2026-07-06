#!/usr/bin/env node
// Thin launcher: exec the downloaded uf-ost binary, forwarding argv and stdio.
// stdio:"inherit" keeps the MCP stdio channel (stdin/stdout) wired straight through.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ext = process.platform === "win32" ? ".exe" : "";
const bin = path.join(__dirname, "bin", `uf-ost${ext}`);

if (!fs.existsSync(bin)) {
  console.error(
    "[uf-ost] binary not found. Re-run install with network access, or download " +
      "uf-ost from https://github.com/dormonbear/ultraforce-desktop/releases and put it on PATH."
  );
  process.exit(1);
}

const r = spawnSync(bin, process.argv.slice(2), { stdio: "inherit" });
if (r.error) {
  console.error(`[uf-ost] ${r.error.message}`);
  process.exit(1);
}
process.exit(r.status ?? 1);
