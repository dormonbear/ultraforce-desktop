# Plan ↔ Code 完成度对账

> 生成于 2026-07-04。判定依据：实际代码（crates/、desktop/）+ git 历史，**不看 checkbox**（本仓库习惯从不勾选）。
> DONE = 功能已落地并合入 main；PARTIAL = 部分落地；MISSING = 完全未做。

| 计划文件 | 判定 | 证据 / 缺口 |
|---|---|---|
| 2026-06-18-desktop-slice1-soql.md | DONE | `SoqlPanel.tsx` + Monaco 编辑器 + TanStack 结果表已落地 |
| 2026-06-18-features-anon-apex.md | DONE | `crates/features/src/anon_apex.rs` 存在 |
| 2026-06-18-features-debug-log.md | DONE | `crates/features/src/debug_log.rs` 存在 |
| 2026-06-18-features-soql.md | DONE | `crates/features/src/soql.rs` 存在 |
| 2026-06-18-log-parser.md | DONE | `crates/log-parser` 独立 crate 存在 |
| 2026-06-18-sf-schema.md | DONE | `crates/sf-schema` 存在（含 model/puller/store） |
| 2026-06-18-soql-lang.md | DONE | `crates/soql-lang` 存在（complete/diagnostics） |
| 2026-06-18-sp0-sf-core.md | DONE | `crates/sf-core` 基础 crate 存在 |
| 2026-06-19-apex-debug-config.md | DONE | `features/debug_config.rs` + `debug_cfg.rs` command + `DebugConfigRow.tsx` |
| 2026-06-19-apex-desktop-completion.md | DONE | `apex_complete.rs` + `editor/monaco-apex.ts` provider |
| 2026-06-19-apex-generic-element.md | DONE | 泛型集合访问器推断在 `ast/infer.rs` |
| 2026-06-19-apex-inheritance.md | DONE | `acquire.rs`/`symbols.rs` parentClass 链合并 |
| 2026-06-19-apex-inner-classes.md | DONE | `acquire.rs` innerClasses 解析 |
| 2026-06-19-apex-lang-expr-inference.md | DONE | 链式表达式推断在 `ast/infer.rs` |
| 2026-06-19-apex-lang.md | DONE | `crates/apex-lang` Phase 1（OST 获取+补全）落地 |
| 2026-06-19-apex-namespace-qualified.md | DONE | `type_in` 命名空间限定头解析已实现 |
| 2026-06-19-apex-sobject-methods.md | DONE | `apex_complete.rs` 合成 sObject 实例方法（getSObjectType 等） |
| 2026-06-19-apex-sobject-ost.md | DONE | `schema_to_apex_type` + 按需 describe 注入 |
| 2026-06-19-apex-soql-diagnostics.md | DONE | `apex-lang/soql_region.rs` + `monaco-markers.ts` |
| 2026-06-19-desktop-slice2-apex-logs.md | DONE | `ApexPanel.tsx` + `LogsPanel.tsx` 面板 |
| 2026-06-19-lang-parity.md | DONE | `OrgSelector.tsx` + RecordTree + `LogView.tsx` |
| 2026-06-19-multi-tab.md | DONE | `SoqlTabs.tsx`/`ApexTabs.tsx` + `src/tabs/` |
| 2026-06-19-soql-in-apex.md | DONE | Apex 内 `[SELECT]` SOQL 补全路径 + `soql_region.rs` |
| 2026-06-19-soql-panel-completion.md | DONE | `editor/monaco-soql.ts` 补全 provider |
| 2026-06-19-soql-panel-diagnostics.md | DONE | SOQL 编辑器 Monaco marker 诊断 |
| 2026-06-19-soql-select-harden.md | DONE | `soql-lang` outline 硬化（不再误报函数/别名） |
| 2026-06-19-three-ost-increments.md | DONE | `features/api_version.rs` per-org 版本探测等 |
| 2026-06-20-explorer-sidebar.md | DONE | `src/fs/*` + `Explorer.tsx` 文件树 |
| 2026-06-20-shadcn-migration.md | DONE | `components/ui/*`（含 command 面板、sonner toast） |
| 2026-06-20-ultraforce-core.md | DONE | 品牌改名 + 统一 CompletionItem DTO + `metrics.ts`/`store.ts` |
| 2026-06-21-batched-composite-describe.md | DONE | `sf-schema` composite 批量 + `get_or_fetch_many`（commit 76f5386/d6f57bc） |
| 2026-06-21-explorer-polish.md | DONE | 可调宽侧栏 + `ui/context-menu.tsx` + `fs/search.ts` |
| 2026-06-21-incremental-index.md | DONE | `features/index.rs::sync_org` 增量同步（commit c274011） |
| 2026-06-21-offline-symbol-table.md | DONE | `features/index.rs` 全量后台索引 + 快照 |
| 2026-06-21-soql-relationship-completion.md | DONE | `soql-lang` `relationship_chain_at` 多跳补全（commit 6a55051） |
| 2026-06-23-apex-treesitter-foundation-completion.md | DONE (superseded) | tree-sitter CST 已完整实现（commit e301a06…beb36ea），随后被手写 `ast/` 引擎取代并移除 tree-sitter 依赖（2cc16fc）。目标（用 CST/AST 取代文本启发式补全）已达成 |
| 2026-06-30-settings-page.md | DONE | `SettingsPage.tsx`（commit 2bde828） |
| 2026-07-01-apex-log-charts.md | DONE | `flame.ts`/`timeBreakdown.ts`/`queryStats.ts` + `TimelineView.tsx` |
| 2026-07-02-apex-completion-maturity.md | DONE | 预确认（8 任务全合入，2da673a…1fa3428） |
| 2026-07-04-uf-ost-mcp-phases.md | PARTIAL | Phase 1/2 DONE（8633b8e SQLite 化、b81cc37 uf-ost MCP crate）；Phase 3 差异校验已 PASS、两个 sandbox 已建 SQLite 索引。**剩余**：omni-stack 侧迁移（4 个 OST wiring 提交、launchd 切换、退役 db/ost + ost.mjs）+ PROD 组织（SFDC_Live/SFOA_Live）索引 —— 均在 omni-stack repo，本轮明确不动 |
| uf-ost-phase3-diff-SFDC_Staging.md | N/A（结果报告） | 非计划文件，是 Phase 3 gate 差异校验结果报告（SFDC_Staging 零分歧 PASS） |
| 2026-07-08-live-org-mcp-phase1.md | DONE | live-org MCP tools + telemetry opt-in（合入本地 main 8f8023a，未推送） |
| 2026-07-08-telemetry-optin-aptabase.md | DONE | 同上分支合入（Aptabase 远端 sink + Settings 隐私披露） |
| 2026-07-08-subquery-display.md | DONE | feat/subquery-display 分支 11 任务全落地（9ee7878…f6743cd）：soql_children 类型化投影、childTables IPC、内联展开子网格、摊平视图、列虚拟化、摊平导出、RQB 8.20.2 筛选面板 + 自写求值器、运行时 e2e 全过。待合并 |
