# Scratch-org integration CI / 临时组织集成 CI

The real-org suite runs only against an explicitly selected disposable scratch org. It deploys the synthetic `UfE2eFixture` class, creates one synthetic Account, and exercises the actual Salesforce CLI and backend. The test cache is isolated from the normal UltraForce cache. One test inserts and deletes an additional marked Account; use a disposable org, never a production or business org.

真实组织测试仅针对明确指定的一次性临时组织运行。它部署合成的 `UfE2eFixture` 类、创建一个合成 Account，并验证真实 Salesforce CLI 与后端。测试缓存与 UltraForce 的正常缓存隔离。一项测试还会插入并删除另一条带标记的 Account；请使用一次性组织，绝不要使用生产组织或业务组织。

## Configure CI / 配置 CI

1. Use a dedicated Dev Hub integration account with permission to create and delete scratch orgs. Store its Salesforce DX authorization URL in the GitHub Actions secret `UF_SCRATCH_CI_DEV_HUB_AUTH_URL`. Treat the URL as a credential; do not commit it or print it. See [Salesforce's CI authorization guide](https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-dev-auth-url.html).
2. Run the **Scratch-org integration** workflow manually on `main`. After the first successful real-org run, set the repository Actions variable `UF_SCRATCH_CI_ENABLED` to `true` to enable the weekly scheduled run. The schedule is otherwise skipped. A manual run without the secret fails explicitly.
3. The workflow uses a randomly named Developer scratch org with a one-day expiry, deploys only the fixture, runs all 14 ignored live tests serially, and attempts deletion even when creation or testing fails. It is restricted to trusted `main` manual or scheduled runs; pull requests do not receive the credential. CLI telemetry and log files are disabled.
4. The workflow pins Salesforce CLI 2.156.8, which uses redacted org-display output; this exercises the dedicated access-token command during live REST tests. Older inline-token behavior remains covered by synthetic unit tests.

1. 使用有权创建和删除临时组织的专用 Dev Hub 集成账号。将其 Salesforce DX 授权 URL 保存为 GitHub Actions 密钥 `UF_SCRATCH_CI_DEV_HUB_AUTH_URL`。该 URL 属于凭据，不要提交或打印。参见 [Salesforce CI 授权指南](https://developer.salesforce.com/docs/platform/sfdx-dev/guide/sfdx-dev-auth-url.html)。
2. 在 `main` 上手动运行 **Scratch-org integration** 工作流。首次真实组织运行成功后，将仓库 Actions 变量 `UF_SCRATCH_CI_ENABLED` 设为 `true`，以启用每周定时运行；否则定时作业会跳过。手动运行缺少密钥时会明确失败。
3. 工作流创建随机命名、一天后过期的 Developer 临时组织，仅部署夹具，串行运行全部 14 项默认跳过的真实测试，并在创建或测试失败时尝试删除。它仅允许可信的 `main` 手动或定时运行；拉取请求不会获得该凭据。CLI 遥测和日志文件均已禁用。
4. 工作流固定 Salesforce CLI 2.156.8，该版本会隐藏组织信息输出中的凭据；真实 REST 测试将覆盖专用访问令牌命令。旧版内联令牌行为仍由合成单元测试覆盖。

Deletion is best effort: an interrupted runner or a creation timeout before the CLI records the alias can prevent deletion. The one-day expiration is a fallback, not proof of cleanup; investigate failed cleanup in the Dev Hub. CI does not upload CLI authentication files or logs.

删除是尽力执行：运行器被中断，或创建超时发生在 CLI 记录别名之前，都可能导致无法删除。一天过期时间只是后备措施，并不证明清理成功；清理失败时应在 Dev Hub 中核查。CI 不上传 CLI 身份验证文件或日志。

All child-process output from the scratch CI script, including live test failure details, is discarded to avoid exposing credentials or org data in CI logs. A failure reports the stage and exit status or timeout; detailed diagnosis requires a secure reproduction using a disposable org.

临时组织 CI 脚本的所有子进程输出（包括真实测试的失败详情）均被丢弃，以免凭据或组织数据出现在 CI 日志中。失败时会报告阶段和退出码或超时；详细排查需要使用一次性组织在安全环境中复现。

## Local disposable org / 本地一次性组织

Use Salesforce CLI 2.156.8 or later for the redaction regression. Deploy `tests/scratch-org/force-app` to a disposable scratch org, create an Account named `UltraForce synthetic CI`, and set `UF_E2E_ORG` to its explicit alias before running the ignored test target. Avoid the `default` sentinel. The suite does not validate that a manually supplied alias is a scratch org.

凭据隐藏回归需要 Salesforce CLI 2.156.8 或更高版本。将 `tests/scratch-org/force-app` 部署到一次性临时组织，创建名为 `UltraForce synthetic CI` 的 Account，并在运行默认跳过的测试目标前将 `UF_E2E_ORG` 设为其明确别名。不要使用 `default` 哨兵值。测试套件不会验证手动提供的别名是否指向临时组织。

```sh
UF_E2E_ORG=<scratch-alias> cargo test --locked -p features --test real_org_e2e -- --ignored --test-threads=1
```
