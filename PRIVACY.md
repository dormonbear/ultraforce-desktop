<a id="privacy"></a>

# Privacy / 隐私

Ultraforce Desktop and its `uf-ost` MCP server do not collect product analytics,
usage events, device identifiers, or automatic crash reports. There is no
analytics service, local invocation database, collection opt-in, or development
build exception. Tool names, parameters, organization names, queries, code,
records, and errors are not copied into a separate usage log.

Ultraforce Desktop 及其 `uf-ost` MCP 服务端不收集产品分析数据、使用事件、设备标识符或自动崩溃报告。
产品没有分析服务、本地调用数据库、收集启用选项，开发构建也没有例外。
工具名称、参数、组织名称、查询、代码、记录及错误不会被复制到单独的使用日志中。

<a id="your-local-work"></a>

## Your local work / 本地工作内容

The application processes the Salesforce data needed for the tools you use.
It keeps working files and functional caches on your computer:

应用会处理你所使用工具所需的 Salesforce 数据，并在你的计算机上保留工作文件及功能性缓存：

- SOQL and Apex scripts, open tabs and editor state in your workspace.
  工作区中的 SOQL／Apex 脚本、打开的标签页及编辑器状态。

- Preferences, selected organization, cached organization and log lists in the
  local `ultraforce.json` application store.
  本地 `ultraforce.json` 应用存储中的偏好设置、所选组织、缓存的组织及日志列表。

- The last 50 anonymous Apex executions you run, including source, returned
  debug log (limited to 200,000 characters per entry), status and exception
  message. Open Apex **History** and use **Clear history** to remove this history.
  最近 50 次匿名 Apex 执行，包括源码、返回的调试日志（每项最多 200,000 个字符）、状态及异常消息。
  打开 Apex **History（历史）**，使用 **Clear history（清除历史）** 移除这些记录。

- During an anonymous Apex run, the source is staged in an `ultraforce-anon-*.apex`
  file in the system temporary directory for the Salesforce CLI. The application
  attempts to remove it on completion, error or cancellation; a crash or deletion
  failure can leave it behind. Existing leftovers are not automatically removed.
  On Unix the file is restricted to its owner; on Windows it inherits the temporary
  directory's access controls.
  运行匿名 Apex 时，源码会暂存到系统临时目录中的 `ultraforce-anon-*.apex` 文件，供 Salesforce CLI
  使用。应用会在完成、出错或取消时尝试删除该文件；崩溃或删除失败可能使其残留。已有残留文件不会被
  自动移除。Unix 上该文件仅限所有者访问；Windows 上它继承临时目录的访问控制。

- Salesforce debug logs that you open, cached under the application data
  directory's `workspace/logcache` folder for reopening without downloading.
  你打开的 Salesforce 调试日志，缓存在应用数据目录的 `workspace/logcache` 文件夹中，
  便于再次打开时无需重新下载。

- Local Salesforce schema and Apex symbol indexes for offline completion, plus current
  routing bindings (organization ID, authenticated username, requested target and generated
  cache key). These bindings keep aliases and offline snapshots associated with the correct
  user; they contain no credentials or usage history.
  用于离线补全的本地 Salesforce schema 与 Apex 符号索引，以及当前路由绑定（组织 ID、认证用户名、
  请求目标和生成的缓存键）。这些绑定确保别名及离线快照关联至正确用户，不包含凭据或使用历史。
  On-demand object descriptions use a separate, generation-scoped table in the
  same local index database. Publishing the next generation clears those entries.
  按需对象描述保存在同一本地索引数据库的独立表中，仅对获取时的代次有效；
  发布下一代次时会清除这些条目。

These files may contain private business data. They are work products and
functional caches, not analytics, and are not uploaded to the maintainers.
They remain on disk until you clear the relevant history, remove the files, or
replace the workspace/cache. Uninstalling the application may leave them behind.
Ultraforce does not promise encryption of workspace files or caches; use your
operating system's access controls and disk encryption where needed.

这些文件可能包含私有业务数据。它们是工作产物及功能性缓存，不属于分析数据，也不会上传给维护者。
在你清除相关历史、删除文件或替换工作区／缓存之前，这些内容会保留在磁盘上；卸载应用也可能留下这些文件。
Ultraforce 不承诺对工作区文件或缓存加密；请按需要使用操作系统访问控制及磁盘加密。

Authentication remains managed by the Salesforce CLI. The application uses
credentials in memory for the Salesforce requests you authorize. CLI-launched
commands explicitly disable Salesforce CLI telemetry and file logging, overriding
inherited opt-in settings for those subprocesses without changing your global CLI
configuration. See Salesforce's [telemetry opt-out documentation](https://developer.salesforce.com/docs/platform/sfdx-setup/guide/sfdx-dev-cli-telemetry.html)
and [supported environment flags](https://forcedotcom.github.io/sfdx-core/enums/config_envVars.EnvironmentVariable.html).

身份认证仍由 Salesforce CLI 管理。应用在内存中使用凭据，执行你授权的 Salesforce 请求。
通过 CLI 启动的命令会显式禁用 Salesforce CLI 遥测及文件日志，覆盖这些子进程继承的收集启用设置，
但不改变你的全局 CLI 配置。请参阅 Salesforce 的
[遥测退出文档](https://developer.salesforce.com/docs/platform/sfdx-setup/guide/sfdx-dev-cli-telemetry.html)及
[支持的环境标志](https://forcedotcom.github.io/sfdx-core/enums/config_envVars.EnvironmentVariable.html)。

Production organization detection uses a short-lived in-memory safety cache.
Missing, expired or unverified organization type requires live verification;
failures continue to require confirmation before mutations.

生产组织识别使用短时有效的内存安全缓存。组织类型缺失、过期或尚未验证时，需要在线核验；
核验失败时，在执行修改操作前仍需确认。

<a id="network-access"></a>

## Network access / 网络访问

Salesforce login and tools communicate with Salesforce. The desktop application
also checks GitHub Releases at startup or when you select **Check for updates**;
updates are downloaded when you choose to install them. Opening an external link
uses your browser. These providers necessarily receive ordinary connection
information such as your IP address and apply their own policies. Queries, code,
record contents and error text are not added to update requests.

Salesforce 登录及工具会与 Salesforce 通信。桌面应用还会在启动时，或你选择 **Check for updates（检查更新）** 时，
访问 GitHub Releases；只有你选择安装更新时才会下载更新。打开外部链接会使用你的浏览器。
这些提供方必然会接收 IP 地址等常规连接信息，并适用各自的政策。
查询、代码、记录内容及错误文本不会被加入更新请求。

The stdio MCP server returns requested tool results to your chosen MCP client.
If that client uses a hosted AI service, its handling of those results is governed
by the client's configuration and provider policy. Ultraforce has no analytics
upload running alongside those responses.

stdio MCP 服务端会将请求的工具结果返回给你选择的 MCP 客户端。
如果该客户端使用托管 AI 服务，其对这些结果的处理由客户端配置及服务提供方政策决定。
Ultraforce 不会在返回这些响应的同时另行上传分析数据。

Editor code and workers are bundled with the application. Fonts use installed
local fonts and system fallbacks. Opening an editor does not fetch scripts or
fonts from Google Fonts or a public CDN.

编辑器代码和工作线程随应用打包。字体使用已安装的本地字体及系统后备字体。
打开编辑器不会从 Google Fonts 或公共 CDN 获取脚本或字体。

<a id="upgrading-from-older-versions"></a>

## Upgrading from older versions / 从旧版本升级

Older builds supported optional telemetry, and development builds could enable
remote telemetry automatically. That capability has been removed. Existing
`telemetry.json` and `telemetry.db` files are ignored: this version neither opens,
updates nor uploads them, even if their old opt-in flags are enabled. Old
application diagnostic logs are no longer written either.

旧构建曾支持可选遥测，开发构建也可能自动启用远程遥测。该能力现已移除。
现有 `telemetry.json` 和 `telemetry.db` 文件会被忽略：即使旧的启用标志仍为开启状态，
此版本也不会打开、更新或上传这些文件，且不再写入旧式应用诊断日志。

Existing telemetry files and logs are not automatically deleted. After closing
older running versions, you can remove these legacy files yourself if desired.
No migration reads their contents. This policy describes this source version;
it does not retroactively change older released applications.

现有遥测文件和日志不会被自动删除。如有需要，在关闭仍运行的旧版本后，你可以自行移除这些遗留文件。
不会通过迁移读取它们的内容。本政策描述的是此源码版本，不会追溯改变已发布旧应用的行为。
