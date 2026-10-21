---
status: accepted
---

# Scope metadata identity to org and authenticated user / 按组织与认证用户限定元数据身份

For #93, equivalent CLI aliases and usernames share a metadata snapshot only when both the physical Salesforce org ID and resolved authenticated username match. Different authenticated users in the same org retain separate metadata visibility contexts. Salesforce's [API access rules](https://developer.salesforce.com/docs/platform/api/guide/calls.html) state that object/field permissions affect describe results; an org-ID-only cache could reuse metadata from a more privileged user. Resolve the routing username from CLI identity metadata before fetching, while keeping requested-target stamps and display aliases distinct.
在 #93 中，等价 CLI 别名与用户名仅在 Salesforce 物理组织 ID 和解析出的认证用户名均一致时共享元数据快照。同一组织的不同认证用户保留独立的元数据可见性上下文。Salesforce 的 [API 访问规则](https://developer.salesforce.com/docs/platform/api/guide/calls.html) 明确对象/字段权限会影响 describe 结果；仅按组织 ID 缓存可能复用更高权限用户的元数据。获取前根据 CLI 身份元数据确定路由用户名，同时区分请求目标标记与显示别名。

The mapping must preserve explicit-root isolation, offline reads from previously verified bindings, and atomic generation publication. Existing logical-key snapshots require a documented verification/rebuild policy before reuse; a matching filename cannot prove organization or user identity. Directory layout and migration mechanics remain implementation work in #93. Identity discovery retains only routing metadata; credentials are excluded from its result.
映射必须保留显式根目录隔离、基于先前已验证绑定的离线读取，以及原子代次发布。复用既有逻辑键快照前须制定验证/重建策略；文件名相同不能证明组织或用户身份。目录布局与迁移机制仍属于 #93 的实现工作。身份发现仅保留路由元数据，结果不包含凭据。
