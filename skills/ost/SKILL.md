---
name: ost
description: >-
  Query Salesforce schema and Apex symbols offline through Ultraforce's ost_*
  MCP tools. Use before writing SOQL/Apex, for object/field/picklist checks,
  and for cross-org metadata comparisons.
  通过 Ultraforce 的 ost_* MCP 工具离线查询 Salesforce schema 与 Apex 符号。
  编写 SOQL/Apex 前、检查对象/字段/选项列表时，以及跨组织比较元数据时使用。
---

# OST — offline schema and Apex for agents / 代理的离线 schema 与 Apex 工具

The `ultraforce` MCP server reads local SQLite snapshots built by `uf-ost index`
or `ost_reindex`. Org-scoped results identify the requested target and snapshot
age; structured stamps also include the generation. Read that provenance before using metadata.
`ultraforce` MCP 服务读取由 `uf-ost index` 或 `ost_reindex` 建立的本地 SQLite 快照。
组织范围结果标记请求目标及快照年龄；结构化标记还包含代次。使用元数据前先检查这些来源信息。

## When to consult OST / 使用时机

- Confirm object/field API names and types before writing SOQL or Apex.
  编写 SOQL 或 Apex 前确认对象/字段 API 名称及类型。
- Verify fields, objects, active picklist values and record types.
  核验字段、对象、有效选项列表值及记录类型。
- Compare schema across indexed contexts with `ost_field` or `ost_search` without `org`.
  不指定 `org` 调用 `ost_field` 或 `ost_search`，比较已索引上下文的 schema。
- Inspect Apex class/interface/enum members from the snapshot.
  从快照查看 Apex 类/接口/枚举成员。

## Tools / 工具

| Tool / 工具 | Use / 用途 |
|---|---|
| `ost_object(org, object)` | compact field table; optional `filter` / 精简字段表，可用 `filter` 筛选 |
| `ost_soql(org, query)` | validate SOQL offline / 离线校验 SOQL |
| `ost_fields(org, object, fields)` | formulas, dependencies and selected field details / 公式、依赖及指定字段详情 |
| `ost_recordtype(org, object)` | record type metadata / 记录类型元数据 |
| `ost_field(field, org?)` | field presence/type across objects and contexts / 对象及上下文中的字段存在性与类型 |
| `ost_picklist(org, object, field)` | active picklist values / 有效选项列表值 |
| `ost_apex(org, name)` | Apex members for an org type or stdlib / 组织类型或标准库的 Apex 成员 |
| `ost_search(query, org?)` | indexed schema/Apex search / 已索引 schema/Apex 搜索 |
| `ost_status(org?)` | freshness, counts, `stdlibError`, refresh state / 时效、数量、`stdlibError` 及刷新状态 |
| `ost_sync(org)` | synchronous delta → `{added, updated, removed}` / 同步执行增量刷新 |
| `ost_reindex(org)` | async full rebuild → `started` or `already_running` / 异步完整重建 |

## Retrieval discipline / 检索流程

1. Check the target and `age` on every result; use `ost_status` when freshness is uncertain.
   检查每项结果的目标及 `age`；时效不确定时调用 `ost_status`。
2. On a contradiction with live behavior or a previously unused target, call `ost_sync`, then repeat the read.
   Sync can resolve a previously unused alias to an existing verified snapshot.
   与实际行为冲突或目标首次使用时，先调用 `ost_sync`，再重新读取；同步可以将新别名解析至既有已验证快照。
3. If sync reports a missing/unverified context, incompatible snapshot or unresolved contradiction,
   request `ost_reindex`. Both `started` and `already_running` are pending states.
   Use authorized live `sf` queries while rebuilding; check `ost_status` and the
   subsequent read's provenance before relying on the replacement. If another
   refresh owns the global slot, retry your request after it becomes idle.
   若同步报告缺失/未验证上下文、不兼容快照或仍未解决的冲突，请求 `ost_reindex`。
   `started` 和 `already_running` 均表示尚未完成。重建期间使用已获授权的实时 `sf` 查询；
   依赖替换快照前，检查 `ost_status` 及后续读取的来源信息。若全局刷新槽由其他请求占用，空闲后重试自身请求。
4. When `stdlibError` is set, org types and sObjects can remain usable while
   System/stdlib members are unavailable. A later full rebuild can retry the failed stdlib source.
   当 `stdlibError` 非空时，组织类型及对象仍可能可用，但 System/标准库成员可能缺失；后续完整重建可重试失败的标准库来源。

## Targets and identity / 目标与身份

Pass a Salesforce CLI alias or username as `org`. Storage is scoped to the
verified physical org ID and authenticated username within the selected cache
root. Equivalent targets for the same user share a snapshot; different users
in one org remain separate. Response stamps echo the requested target.
将 Salesforce CLI 别名或用户名作为 `org`。存储在选定缓存根目录内按已验证的物理组织 ID 和认证用户名划分。
同一用户的等价目标共享快照；同一组织的不同用户保持独立。响应标记回显请求目标。

Treat the target as a routing name: after CLI alias or authentication changes,
refresh that target explicitly and repeat affected reads before using its metadata.
目标是路由名称：CLI 别名或认证变化后，显式刷新该目标，并在使用元数据前重新执行受影响的读取。

Offline reads use previously verified bindings and perform no CLI discovery.
An unknown alias produces an actionable miss until an explicit refresh resolves it.
For cache locations and legacy-index rebuild behavior, consult the repository
[README](https://github.com/dormonbear/ultraforce-desktop/blob/main/README.md).
离线读取使用先前验证的绑定，不执行 CLI 身份发现。未知别名在显式刷新解析前返回可操作的未命中提示。
缓存位置及旧索引重建行为参见仓库 [README](https://github.com/dormonbear/ultraforce-desktop/blob/main/README.md)。
