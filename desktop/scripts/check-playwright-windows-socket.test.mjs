import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

test("Playwright preserves its defaults and disables Windows TCP port randomization / Playwright 保留默认设置并禁用 Windows TCP 端口随机化", () => {
  // Node exits on Chromium's flags without starting a browser or server. / Node 遇到 Chromium 参数即退出，不启动浏览器或服务器。
  const launch = `
    const { chromium } = require('@playwright/test');
    chromium.launch({ executablePath: process.execPath }).catch(() => {});
  `;
  const result = spawnSync(process.execPath, ["-e", launch], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, DEBUG: "pw:browser" },
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  const line = result.stderr.split(/\r?\n/).find((entry) => entry.includes("<launching>"));
  assert.ok(line, "launch arguments are available / 可读取启动参数");
  const featureArgs = [...line.matchAll(/(?:^|\s)--disable-features=([^\s]+)/g)];
  assert.equal(featureArgs.length, 1, "one effective feature list / 仅有一个生效的特性列表");
  const features = new Set(featureArgs[0][1].split(","));
  for (const feature of [
    "AvoidUnnecessaryBeforeUnloadCheckSync",
    "BoundaryEventDispatchTracksNodeRemoval",
    "DestroyProfileOnBrowserClose",
    "DialMediaRouteProvider",
    "GlobalMediaControls",
    "HttpsUpgrades",
    "LensOverlay",
    "MediaRouter",
    "PaintHolding",
    "ThirdPartyStoragePartitioning",
    "Translate",
    "AutoDeElevate",
    "RenderDocument",
    "OptimizationHints",
    "msForceBrowserSignIn",
    "msEdgeUpdateLaunchServicesPreferredVersion",
    "TcpPortRandomizationWin",
  ]) {
    assert.ok(features.has(feature), `missing feature / 缺少特性: ${feature}`);
  }
});
