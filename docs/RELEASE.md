# Release process / 发布流程

The desktop app, `uf-ost` binaries and `@dormon/ultraforce-mcp` npm wrapper share one release version. The [release workflow](../.github/workflows/release.yml) uses Release Please to maintain a release PR; merging that PR creates the tag and starts publication.
桌面应用、`uf-ost` 二进制及 `@dormon/ultraforce-mcp` npm 包装器共享同一发布版本。[发布工作流](../.github/workflows/release.yml) 使用 Release Please 维护发布 PR；合并该 PR 后创建标签并启动发布。

## Version alignment / 版本一致性

The source version is `.release-please-manifest.json`. The [Release Please configuration](../release-please-config.json) updates these five additional locations together:
版本真源为 `.release-please-manifest.json`。[Release Please 配置](../release-please-config.json) 同时更新以下五处：

- `desktop/package.json`
- `npm/package.json`
- `desktop/src-tauri/tauri.conf.json`
- `desktop/src-tauri/Cargo.toml`
- The local `ultraforce-desktop` entry in `Cargo.lock`. / `Cargo.lock` 中的本地 `ultraforce-desktop` 记录。

Keep all six values aligned in the release PR. CI checks the lockfile too; relying on a build to repair it causes locked builds to fail. Do not bump only one package manually.
发布 PR 中须保持六处值一致。CI 也会检查锁文件；依赖构建自动修复会导致锁定依赖构建失败。不要仅手动提升其中一个包的版本。

Before 1.0, ordinary `fix:` and nonbreaking `feat:` commits produce patch releases under the current configuration. `docs:`, `refactor:` and `test:` changes alone do not trigger releases. Use a reviewed `Release-As: x.y.z` commit footer when an explicit version is required; inspect the generated PR rather than assuming the result.
在 1.0 之前，当前配置下的普通 `fix:` 和非破坏性 `feat:` 提交会产生补丁版本。仅有 `docs:`、`refactor:` 和 `test:` 变更不会触发发布。需要指定版本时，可在经审查的提交尾部使用 `Release-As: x.y.z`；应检查生成的 PR，不要假定其结果。

## Review and publish / 审查与发布

1. Merge verified changes into `main` with Conventional Commit titles. Release Please opens or updates the release PR.
   使用 Conventional Commit 标题将验证后的变更合并至 `main`，由 Release Please 创建或更新发布 PR。
2. Review the release diff, all six version values and bilingual changelog. Verify the release includes intended fixes and does not claim unfinished work. Run the existing checks below and inspect CI results.
   审查发布差异、六处版本值及双语更新记录，确认包含预期修复且未宣称未完成工作。执行下方现有检查，并检查 CI 结果。
3. Merge the release PR. The workflow creates the tag and a public GitHub Release, then runs platform builds. The release page can exist before its assets are complete.
   合并发布 PR。工作流创建标签和公开的 GitHub Release，再执行平台构建。发布页面可能早于完整产物出现。
4. Verify every publication job and the resulting artifacts before reporting the release as ready. A created tag or successful Release Please job alone does not prove publication succeeded.
   报告发布就绪前，应验证所有发布任务及实际产物。仅创建标签或 Release Please 任务成功，不能证明发布成功。

```sh
python scripts/check_release_versions.py
python -m unittest discover -s scripts -p '*_test.py'
cargo test --locked --workspace
```

Run each command separately and preserve its exit code. Frontend, native desktop and other required CI gates still apply.
分别运行各命令并保留其退出码。前端、原生桌面及其他必需 CI 检查仍须通过。

## Publication order / 发布顺序

| Stage / 阶段 | Current behavior / 当前行为 |
|---|---|
| Release Please | Creates the tag and public release after the release PR merges. / 发布 PR 合并后创建标签及公开发布。 |
| Four platform builds / 四个平台构建 | macOS Apple Silicon, macOS Intel, Linux on Ubuntu 22.04, and Windows. Each uploads desktop bundles, updater signatures and a target-named `uf-ost` binary. / macOS Apple Silicon、macOS Intel、Ubuntu 22.04 上的 Linux，以及 Windows；各自上传桌面包、更新签名及按目标平台命名的 `uf-ost` 二进制。 |
| `publish-updater` | Waits for every platform build, reads uploaded assets and signatures, then generates and uploads one complete `latest.json`. Platform jobs do not write competing manifests. / 等待所有平台构建，读取已上传产物及签名，再生成并上传一份完整的 `latest.json`；平台任务不各自写入相互覆盖的清单。 |
| `publish-npm` | Waits for builds and updater publication, then publishes the npm wrapper with OIDC trusted publishing and provenance. / 等待构建及更新清单发布，再通过 OIDC 可信发布及来源证明发布 npm 包装器。 |

The npm wrapper downloads the matching `uf-ost` release binary during installation. Verify a fresh package installation against the published release, including the downloaded binary and an offline MCP handshake.
npm 包装器在安装期间下载匹配的 `uf-ost` 发布二进制。应针对已发布版本验证全新安装，包括下载的二进制及离线 MCP 握手。

Use synthetic fixtures and an owned temporary cache for acceptance. Do not use personal Salesforce credentials, real organization data or existing business caches. Verify updater asset coverage and signatures, and inspect actual release downloads rather than relying only on source tests.
验收使用合成数据及专属临时缓存，不使用个人 Salesforce 凭据、真实组织数据或既有业务缓存。应验证更新产物覆盖情况与签名，并检查实际发布下载，不仅依赖源码测试。

## Updater signing / 更新签名

The updater public key and release endpoint are configured in [`tauri.conf.json`](../desktop/src-tauri/tauri.conf.json). CI receives `TAURI_SIGNING_PRIVATE_KEY` through GitHub Actions secrets; `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` supplies its password when configured. Keep private keys outside the repository and logs. Investigate missing or changed signing identities before publishing updates for existing installations.
更新公钥及发布地址配置在 [`tauri.conf.json`](../desktop/src-tauri/tauri.conf.json)。CI 通过 GitHub Actions secrets 获取 `TAURI_SIGNING_PRIVATE_KEY`；配置密码时由 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 提供。私钥须保存在仓库及日志之外。向既有安装发布更新前，应调查缺失或变化的签名身份。

Updater signatures are separate from operating-system code signing. The current macOS configuration uses ad-hoc signing (`signingIdentity: "-"`); it does not provide Apple notarization. Windows users may encounter SmartScreen prompts. Follow the installation instructions in the [README](../README.md).
更新签名与操作系统代码签名相互独立。当前 macOS 配置使用临时签名（`signingIdentity: "-"`），不提供 Apple 公证。Windows 用户可能遇到 SmartScreen 提示。请遵循 [README](../README.md) 中的安装说明。

## Setup and recovery / 配置与恢复

GitHub Actions needs permission to create release PRs and write releases. Updater signing secrets and npm trusted publishing must be configured for this repository and workflow. Prior successful releases do not prove that permissions or signing configuration remain valid forever.
GitHub Actions 需要创建发布 PR 及写入发布的权限。更新签名 secrets 和 npm 可信发布须针对本仓库及工作流配置。之前的成功发布不能证明权限或签名配置永远有效。

| Symptom / 现象 | Check / 检查 |
|---|---|
| No release PR / 没有发布 PR | Inspect the Release Please job, repository permissions and eligible commit types. / 检查 Release Please 任务、仓库权限及可触发发布的提交类型。 |
| Version check or locked build fails / 版本检查或锁定构建失败 | Compare all six values, including the local desktop entry in `Cargo.lock`. / 比较六处值，包括 `Cargo.lock` 中的本地桌面记录。 |
| Release exists but assets are missing / 发布存在但产物缺失 | Inspect every platform job; the public release is created before builds finish. / 检查所有平台任务；公开发布在构建完成前已创建。 |
| Updater manifest missing or incomplete / 更新清单缺失或不完整 | Inspect `publish-updater`, platform assets and `.sig` files. The manifest builder rejects incomplete input. / 检查 `publish-updater`、平台产物及 `.sig` 文件；清单生成器会拒绝不完整输入。 |
| npm publication fails / npm 发布失败 | Verify prerequisite jobs and the repository/workflow's trusted publisher configuration. / 验证前置任务以及仓库／工作流的可信发布配置。 |

For a partially failed release, identify failed jobs and dependencies before rerunning them. Recheck the updater manifest, signatures and npm installation afterward. Do not create a replacement version merely to hide an unexplained failure, or overwrite signing keys as a troubleshooting shortcut.
发布部分失败时，先定位失败任务及其依赖，再重新运行。之后重新检查更新清单、签名及 npm 安装。不要仅为掩盖未查明的失败而创建替代版本，也不要将覆盖签名密钥作为排障捷径。
