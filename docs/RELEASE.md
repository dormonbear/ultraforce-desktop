# 发布流程（Release）

ULTRAFORCE 桌面端通过 **release-please + tauri-action** 全自动发布到 GitHub Releases，
用户端通过 Tauri updater 自动更新。本文档说明版本规则、日常发布流程、一次性设置与排错。

---

## 版本规则

- 遵循 [SemVer](https://semver.org/)，版本号真源在 `.release-please-manifest.json`。
- 版本号由 [Conventional Commits](https://www.conventionalcommits.org/) 自动推导（`< 1.0` 阶段）：
  | 提交类型 | 版本变化 | 例 |
  |---|---|---|
  | `fix:` | patch | 0.1.0 → 0.1.1 |
  | `feat:` | minor | 0.1.0 → 0.2.0 |
  | `feat!:` / 含 `BREAKING CHANGE` | minor（<1.0） | 0.1.0 → 0.2.0 |
  | `docs:` / `chore:` / `refactor:` 等 | 不发版 | — |
- 三处版本由 release-please 自动同步，**不要手动改**：
  - `desktop/package.json`
  - `desktop/src-tauri/tauri.conf.json`
  - `desktop/src-tauri/Cargo.toml`

---

## 日常发布流程（全自动）

```
1. 平时往 main 推规范化提交（feat:/fix:/...）
      └─ release-please 自动开/更新一个 "release x.y.z" PR
         （PR 内已 bump 三处版本 + 生成/更新 CHANGELOG.md）

2. review 后合并该 Release PR
      └─ 同一次 workflow 运行内：
         ├─ release-please 打 tag (vX.Y.Z) + 建 GitHub Release（含 changelog 说明）
         └─ build 任务编译 4 平台 → 上传带签名安装包 + latest.json 到该 release

3. 用户开 app → 自动检测并提示更新
```

发版动作 = **合并那个 Release PR**。其余无需手工操作。

构建矩阵：macOS arm64 / macOS x86_64 / Linux (Ubuntu 22.04) / Windows。

---

## 应用内更新（Updater）

- app 启动时调用 `desktop/src/updater.ts` 的 `checkForUpdates()`，向
  `https://github.com/dormonbear/ultraforce-desktop/releases/latest/download/latest.json`
  查询；有新版则右下角 toast 提示，点击后台下载并自动重启。无新版或离线时静默。
- 更新包用 Tauri 自带的 minisign 密钥签名（**与付费代码签名无关**）：
  - 公钥已内置在 `tauri.conf.json > plugins.updater.pubkey`。
  - 私钥在 CI 通过 Secret `TAURI_SIGNING_PRIVATE_KEY` 注入，给安装包签名并生成 `latest.json`。
- `0.1.0` 无 updater；`0.2.0` 起内置，之后版本均可应用内自动更新。

## 平台签名与首次打开（无付费签名）

- 安装包**未做付费代码签名/公证**。macOS 用 **ad-hoc 签名**（`tauri.conf.json > bundle.macOS.signingIdentity: "-"`），
  把下载后的 "is damaged" 降级为温和的"未识别开发者"提示。
- 首次打开需一次性放行（已写入 README「Install」）：macOS `xattr -cr /Applications/Ultraforce.app` 或右键→打开；
  Windows SmartScreen → More info → Run anyway。彻底消除提示需付费 Apple 公证。

---

## 一次性设置（仅首次）

> ✅ 本仓库两项均已完成（`v0.2.1` 已通过本流水线全平台发布）。以下保留为换仓/重建时的参考。

1. **仓库设置**：Settings → Actions → General → 勾选
   **"Allow GitHub Actions to create and approve pull requests"**（否则 release-please 无法开 PR）。

2. **签名私钥 Secret**：密钥已生成于本机 `~/.tauri/ultraforce.key`（私钥，仓库外，务必备份）。
   ```bash
   cat ~/.tauri/ultraforce.key | pbcopy
   ```
   → Settings → Secrets and variables → Actions → New secret，
   名 `TAURI_SIGNING_PRIVATE_KEY`，值粘贴上面内容。私钥无密码，无需再建 password secret。

   > ⚠️ 此私钥丢失则无法再向已安装用户推更新，请备份 `~/.tauri/ultraforce.key`。

---

## 相关文件

| 文件 | 作用 |
|---|---|
| `.github/workflows/release.yml` | 两段式工作流：release-please + 条件触发的 build |
| `release-please-config.json` | release-please 配置（单组件 + extra-files 同步三处版本） |
| `.release-please-manifest.json` | 版本真源 |
| `CHANGELOG.md` | release-please 自动维护 |
| `desktop/src/updater.ts` | 前端更新检查逻辑 |

---

## 排错

- **没出 Release PR**：检查上面第 1 项仓库设置是否已勾选；确认提交信息符合 Conventional Commits。
- **首个 Release PR 版本不对**：`release-type: simple` + toml extra-file 较少见，首次合并前扫一眼 PR diff，确认三处版本均已 bump。
- **出包没签名 / 用户收不到更新**：确认 Secret `TAURI_SIGNING_PRIVATE_KEY` 已配置，且 build 日志里有 latest.json 上传。
- **`Cargo.lock` 版本行未更新**：正常，release-please 不改 lock，cargo 构建时自动更新，不影响出包。
- **手动补发**：tag 已存在但产物缺失时，可在 Actions 页 re-run 对应 workflow 的 build 任务。
