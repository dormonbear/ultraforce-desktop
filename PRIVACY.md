# Privacy

Ultraforce Desktop and its `uf-ost` MCP server do not collect product analytics,
usage events, device identifiers, or automatic crash reports. There is no
analytics service, local invocation database, collection opt-in, or development
build exception. Tool names, parameters, organization names, queries, code,
records, and errors are not copied into a separate usage log.

## Your local work

The application processes the Salesforce data needed for the tools you use.
It keeps working files and functional caches on your computer:

- SOQL and Apex scripts, open tabs and editor state in your workspace.
- Preferences, selected organization, cached organization and log lists in the
  local `ultraforce.json` application store.
- The last 50 anonymous Apex executions you run, including source, returned
  debug log (limited to 200,000 characters per entry), status and exception
  message. Open Apex **History** and use **Clear history** to remove this history.
- Salesforce debug logs that you open, cached under the application data
  directory's `workspace/logcache` folder for reopening without downloading.
- Local Salesforce schema and Apex symbol indexes for offline completion, plus current
  routing bindings (organization ID, authenticated username, requested target and generated
  cache key). These bindings keep aliases and offline snapshots associated with the correct
  user; they contain no credentials or usage history.
  用于离线补全的本地 Salesforce schema 与 Apex 符号索引，以及当前路由绑定（组织 ID、认证用户名、
  请求目标和生成的缓存键）。这些绑定确保别名及离线快照关联至正确用户，不包含凭据或使用历史。

These files may contain private business data. They are work products and
functional caches, not analytics, and are not uploaded to the maintainers.
They remain on disk until you clear the relevant history, remove the files, or
replace the workspace/cache. Uninstalling the application may leave them behind.
Ultraforce does not promise encryption of workspace files or caches; use your
operating system's access controls and disk encryption where needed.

Authentication remains managed by the Salesforce CLI. The application uses
credentials in memory for the Salesforce requests you authorize. CLI-launched
commands explicitly disable Salesforce CLI telemetry and file logging, overriding
inherited opt-in settings for those subprocesses without changing your global CLI
configuration. See Salesforce's [telemetry opt-out documentation](https://developer.salesforce.com/docs/platform/sfdx-setup/guide/sfdx-dev-cli-telemetry.html)
and [supported environment flags](https://forcedotcom.github.io/sfdx-core/enums/config_envVars.EnvironmentVariable.html).

Production organization detection uses a short-lived in-memory safety cache.
Missing, expired or unverified organization type requires live verification;
failures continue to require confirmation before mutations.

## Network access

Salesforce login and tools communicate with Salesforce. The desktop application
also checks GitHub Releases at startup or when you select **Check for updates**;
updates are downloaded when you choose to install them. Opening an external link
uses your browser. These providers necessarily receive ordinary connection
information such as your IP address and apply their own policies. Queries, code,
record contents and error text are not added to update requests.

The stdio MCP server returns requested tool results to your chosen MCP client.
If that client uses a hosted AI service, its handling of those results is governed
by the client's configuration and provider policy. Ultraforce has no analytics
upload running alongside those responses.

Editor code and workers are bundled with the application. Fonts use installed
local fonts and system fallbacks. Opening an editor does not fetch scripts or
fonts from Google Fonts or a public CDN.

## Upgrading from older versions

Older builds supported optional telemetry, and development builds could enable
remote telemetry automatically. That capability has been removed. Existing
`telemetry.json` and `telemetry.db` files are ignored: this version neither opens,
updates nor uploads them, even if their old opt-in flags are enabled. Old
application diagnostic logs are no longer written either.

Existing telemetry files and logs are not automatically deleted. After closing
older running versions, you can remove these legacy files yourself if desired.
No migration reads their contents. This policy describes this source version;
it does not retroactively change older released applications.
