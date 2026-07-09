# Handoff: SOQL 子查询结果展示 + 子记录筛选（设计已锁定，待写实施计划）

**日期:** 2026-07-08 · **状态:** grilling 完成、红队审查完成 → 下一步写实施计划
**背景:** 同一条带子查询的 SOQL,Ultraforce 只把子查询渲染成计数列(数据丢失),IC2 摊平成位置列(可见但列爆炸)。目标:比两者都好的展示 + 基于子记录的筛选。

## 已锁定的 9 个用户决策

| # | 决策 | 结论 |
|---|---|---|
| 1 展示模型 | **D** | 默认可展开主从 + 摊平开关(IC2 位置列模式) |
| 2 范围 | **A** | 仅桌面 UI;`features::soql::to_table` 原样保留给 MCP soql_query(agent 只要紧凑计数) |
| 3 数据模型 | **A** | 现有扁平 `columns/rows` 网格不变 + 稀疏子表 sidecar |
| 4 摊平列上限 | **B** | 无 UX 上限,用列虚拟化兜底 |
| 5 展开形态 | **A** | 内联子网格(TanStack `getExpandedRowModel`),默认折叠,点计数格/箭头展开 |
| 6 导出 | **A** | 恒用摊平投影导出(无损扁平 CSV),与当前视图无关 |
| 7 多子子查询 | **A** | 展开=纵向堆叠带标签子网格(`关系名 (N)`);摊平=各关系各自 `rel[i].col` 展列 |
| 8 子筛选范围 | **A** | 仅客户端视图筛选(只过滤已加载行);服务端半连接(`WHERE Id IN (SELECT...)` 真 join,可用 OST 索引解析 lookup 字段)明确**暂缓、后续独立立项** |
| 9 筛选谓词 | **C** | 完整谓词构建器,用 **react-querybuilder**(MIT)的 subquery/match-mode 功能(`some/all/none/at least/at most/exactly N` + 子字段各带完整操作符) |

## 红队审查修正（覆盖实现层假设,必须遵守）

1. **🔴 sidecar 必须携带类型化 JSON 标量**(`Vec<Vec<serde_json::Value>>`),不能复用 `TableModel` 的预渲染字符串——否则筛选的 `> < between` 对数字做字典序比较(`"10"<"9"`)。渲染时再字符串化。
2. **🔴 求值不走 jsonLogic**:react-querybuilder 只当 UI;求值用自写 ~100 行求值器遍历 RQB 的 RuleGroup JSON 对类型化 sidecar 求值(match-mode = some/all/none/count 谓词组合)。不引 `json-logic-js`(其对 at-least/at-most/exactly 的支持未验证)。
3. **🟠 水平虚拟化 vs 现有滚动 hack 是最大工程雷区**:`ResultTable.tsx` 现为 `overflow-x: hidden` + 手动转发 trackpad 滚轮到 scrollLeft + 首列 sticky(~196 行注释)。列虚拟化要接管同一坐标系,单独成任务。
4. **🟠 内联展开 = 可变行高**:现有 `useVirtualizer`(>100 行触发)需切 `measureElement` 动态测量。
5. **🟠 Columns 可见性菜单**:摊平的位置列不逐个列出,按关系分组整组显隐。
6. sidecar 条目结构:`{rowIndex, column, totalSize, done, columns, rows}`——`done=false` 时 UI 显示 `200+…` 截断提示(子查询 SF 默认 200/父,child queryMore 不在范围)。
7. 高级筛选字段列表**包含父字段**(不只子记录谓词)。
8. 导出**尊重当前生效筛选**(所见即所得)。
9. react-querybuilder 钉版本(match modes 是 v8 特性),需按应用暗色主题定制样式;现有 "Filter rows…" 文本框保留做父行快速文本过滤(不做子记录感知)。
10. IPC payload 可到 MB 级(189 父 × ≤200 子 × 多字段)——可接受,计划注明。

## 已探明的代码事实

- 子查询塌缩点:`crates/features/src/soql.rs` `render_cell` L204 `Children(qr) => qr.total_size.to_string()`;`to_table()` L127。
- 桌面执行路径:`desktop/src-tauri/src/soql_exec.rs:137` 调 `to_table()`(与 MCP 共享!)→ `SoqlResultDto{columns, rows}` (`dto.rs:788`) → `desktop/src/types.ts`。改法:features 加**新的保留子结构投影函数**,桌面切过去,`to_table` 不动。
- 前端网格:`desktop/src/components/ResultTable.tsx`(497 行),**@tanstack/react-table + @tanstack/react-virtual**(行虚拟化已有),内联展开/列虚拟化是自然延伸。
- 默认项:视图切换 `Expandable|Flatten` 放 Columns 按钮旁,默认 Expandable,per-session 不持久化;子数据已内联在 REST 响应的 `FieldValue::Children`,sidecar 只是投影不重查。

## 实现分层(每层独立可交付)

1. **Rust**:features 新投影(类型化 sidecar)→ 桌面 DTO+types.ts 镜像(同 commit,camelCase)
2. **前端展示**:内联展开(measureElement)+ 摊平切换 + 水平虚拟化 + Columns 分组 + 导出摊平
3. **前端筛选**:react-querybuilder 面板 + 自写求值器(放最后,依赖 sidecar)

## 流程约定(本项目惯例)

- **编码任务派 Opus subagent(subagent-driven-development,每任务 brief/report/review-package),Fable 主会话只做计划与评审**;评审者一般 sonnet,安全/复杂任务用 opus。
- 计划写到 `docs/superpowers/plans/2026-07-08-subquery-display.md`(writing-plans skill 格式,TDD)。
- 仓库注意:工作树常年有无关脏文件,**git add 只加显式路径**;本地 main 与 origin/main 分叉(本地含未推送的 live-org MCP 合并 8f8023a),**新工作从本地 main 拉新分支**(如 `feat/subquery-display`),不要碰 origin 分叉;pre-commit fallow 会输出全树噪音属正常;`rtk` 前缀跑命令;arch 规则见根 CLAUDE.md(DTO camelCase 双侧同 commit、IPC 走 ipc/*、800 行/文件上限)。
