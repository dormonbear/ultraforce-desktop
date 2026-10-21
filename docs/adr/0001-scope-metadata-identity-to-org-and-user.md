---
status: accepted
---

# Scope metadata identity to org and authenticated user / 按组织与认证用户限定元数据身份

For #93, equivalent CLI aliases and usernames share a metadata snapshot only when both the physical Salesforce org ID and resolved authenticated username match. Different authenticated users in the same org retain separate metadata visibility contexts. Salesforce's [API access rules](https://developer.salesforce.com/docs/platform/api/guide/calls.html) state that object/field permissions affect describe results; an org-ID-only cache could reuse metadata from a more privileged user. Resolve the routing username from CLI identity metadata before fetching, while keeping requested-target stamps and display aliases distinct.
在 #93 中，等价 CLI 别名与用户名仅在 Salesforce 物理组织 ID 和解析出的认证用户名均一致时共享元数据快照。同一组织的不同认证用户保留独立的元数据可见性上下文。Salesforce 的 [API 访问规则](https://developer.salesforce.com/docs/platform/api/guide/calls.html) 明确对象/字段权限会影响 describe 结果；仅按组织 ID 缓存可能复用更高权限用户的元数据。获取前根据 CLI 身份元数据确定路由用户名，同时区分请求目标标记与显示别名。

The mapping preserves explicit-root isolation, offline reads from previously verified bindings, and atomic generation publication. Identity discovery retains only routing metadata; credentials are excluded from its result. Existing logical-key snapshots cannot prove the physical org/user of their generation: leave them untouched and require a rebuild into a verified context instead of silently adopting or relabeling them.
映射保留显式根目录隔离、基于先前已验证绑定的离线读取，以及原子代次发布。身份发现仅保留路由元数据，结果不包含凭据。既有逻辑键快照无法证明其代次所属的物理组织/用户：保留原文件不变，要求在已验证上下文中重建，不静默采用或重新标记旧快照。

A root-local SQLite catalog maps literal targets to `(canonical org ID, exact CLI-reported username)`. Normalize 15/18-character IDs with Salesforce's [case-safe ID format](https://help.salesforce.com/s/articleView?id=000005288&language=en_US&type=1). Generate stable random ASCII cache keys in the catalog transaction; usernames/aliases never become canonical directory names. Different roots have independent catalogs. The small catalog uses rollback journaling so offline read-only lookups do not create WAL/SHM sidecars; snapshot databases retain WAL and generation CAS.
根目录内的 SQLite 目录数据库将原样目标映射至“规范组织 ID、CLI 返回的原样用户名”。按 Salesforce 的[大小写安全 ID 格式](https://help.salesforce.com/s/articleView?id=000005288&language=en_US&type=1)统一 15/18 位 ID。在目录事务内生成稳定的随机 ASCII 缓存键；用户名/别名不作为规范目录名。不同根目录拥有独立目录数据库。小型目录数据库使用回滚日志，避免离线只读查找创建 WAL/SHM 边文件；快照数据库继续使用 WAL 和代次 CAS。

Reserve resolution order before CLI I/O, then bind only after successful validated discovery. An older completion cannot replace a target for which a newer resolution began. Pending/failed discovery retains the last verified offline binding, but never fabricates one for an unknown target. Publishing fetched data must not rebind aliases: an in-flight old-user fetch can finish only in its own context after alias reassignment.
在 CLI I/O 前预留解析顺序，仅在身份发现成功且校验通过后绑定。旧解析完成时不得覆盖已启动较新解析的目标。等待中或失败的解析保留最近已验证的离线绑定，但不为未知目标虚构绑定。发布已获取数据时不得再次绑定别名：别名重绑定后，仍在途的旧用户取数只能在自身上下文中完成。
