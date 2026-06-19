# sf-toolkit — Rust 独立替代 that plugin（SOQL / Anonymous Apex / Debug Log）设计文档

> Date: 2026-06-18 · Status: Approved (overall design) · Next: per-sub-project specs

## 1. 目标与非目标

**目标**：一个独立的 Rust 单体桌面应用，复刻 the established Salesforce IDE plugin 的三块功能：
1. **SOQL Query** — 编写/执行 SOQL，表格与树形结果视图。
2. **Anonymous Apex** — 编写/执行匿名 Apex，查看编译/执行结果与 debug log。
3. **Debug Log** — 拉取/解析调试日志，原始视图 + 执行树 + governor-limit 聚合。

并复刻 that plugin 的"精华"：**schema/符号感知的补全与校验**（SOQL 全量 + Apex 完整类型感知补全）。

**非目标**：不做完整 IDE（重构、部署、元数据管理、版本控制集成等一律不做）。不做 IntelliJ 插件。

**路线图**：桌面 GUI 采用 Tauri 2 + React 19。UI 无关的逻辑全部下沉到 Rust crate，桌面层只做渲染与交互。

## 2. 关键决策

| 决策 | 选择 | 理由 |
|---|---|---|
| UI 形态 | Tauri 2 + React 19（Vite 7 + TS） | 原生 webview 桌面应用；前端只读 `features` 暴露的视图模型，逻辑全在 Rust crate |
| 认证 | 复用本机 `sf` CLI 登录态 | 零认证 UI，复用已有 org 授权 |
| API 协议 | **sf-first**：调 `sf` + 解析 `--json`，直连 HTTP 仅作后备 | 砍掉自建 REST/SOAP 管线，借成熟工具 |
| Anon Apex 日志 | `sf apex run -f --json`（结果含 `logs`） | 一次拿回结果+日志，**废弃 trace-flag 轮询方案** |
| 补全引擎 | 进程内引擎，吃缓存 schema/符号；`sf` 仅做一次性拉取 | `sf` 进程启动 ~0.5–1.5s，喂不动逐键补全 |

## 3. 架构原则

1. **sf-first**：执行/数据后端 = `sf` 子进程编排。直连 HTTP 仅在 `sf` 不够用/太慢时引入（如批量 describe 提速），不是地基。
2. **UI 薄如纸**：Tauri 前端（`desktop/`）只放渲染与交互，零业务逻辑。所有 sf/解析/补全在下层 crate，前端经 `src-tauri` 命令只读 `features` 暴露的视图模型。
3. **补全在进程内、吃缓存**：schema 与 Apex 符号一次性拉取并落盘缓存，补全引擎在内存中跑，绝不每次按键 spawn `sf`。
4. **依赖方向单向无环**：`desktop(src-tauri) → features → {sf-core, log-parser, sf-schema, soql-lang, apex-lang}`；`soql-lang/apex-lang → sf-schema → sf-core`；`log-parser` 零依赖纯函数。

## 4. sf 命令能力映射（已核实，sf 2.127）

| 功能 | sf 命令 | 备注 |
|---|---|---|
| SOQL 执行 | `sf data query -q --json [-t] [--all-rows]` | 内部处理 queryMore；`-t` 切 Tooling；超大集走 `data export bulk` |
| Anon Apex | `sf apex run -f --json` | 结果含 `logs`，编译错误带 line/column |
| Debug Log 列表/取/跟 | `sf apex list log` / `sf apex get log -i\|-n` / `sf apex tail log` | — |
| Describe（schema） | `sf sobject describe -s [-t] --json` / `sf sobject list` | 单对象 describe + describeGlobal |
| TraceFlag/DebugLevel | `sf data create\|update record --sobject TraceFlag\|DebugLevel` | 当普通 sobject DML |
| org 列表/详情 | `sf org list --json` / `sf org display --json` | 认证基石 |

## 5. Cargo workspace 布局

```
sf-toolkit/
├── crates/
│   ├── sf-core/        # SP0  纯 sf 编排 + 类型模型（无 UI、无 schema）
│   ├── log-parser/     # SP-A.2/A.3  纯函数：日志文本 → 树/聚合（零 IO、零 sf）
│   ├── sf-schema/      # SP-D  describe 拉取 + 缓存 + 查询 API
│   ├── soql-lang/      # SP-E  SOQL 词法/语法/补全/校验（吃 sf-schema）
│   ├── apex-lang/      # SP-F  Apex 语言引擎（吃 sf-schema + 标准库数据）
│   └── features/       # SP-A/B/C  把 core+parser+lang 编排成功能用例
├── desktop/            # Tauri 2 + React 19 桌面应用（前端 + src-tauri 桥接 crate）
└── xtask/              # 构建/数据生成（如 F.2 标准库数据集打包）
```

桌面 UI 不是 workspace crate，而是 `desktop/` 下的 Tauri 应用：React 前端 + `src-tauri` 桥接 crate（依赖 `features`）。

## 6. 模块级分解

### sf-core (SP0)
| 模块 | 职责 | 关键接口 | 测试缝 |
|---|---|---|---|
| `invoker` | 异步 spawn `sf` + stdout/stderr 捕获 + 超时/取消 | `SfInvoker::run(args)->Result<RawJson>` | trait `CommandRunner`，注入假命令 |
| `json` | 解析 `{status,result,warnings}` 信封 + 错误映射 | `SfEnvelope<T>`、`SfError` | 录制 JSON 夹具 |
| `org` | `sf org list`、活动 org、target-org 注入 | `OrgRegistry`、`OrgRef` | 夹具 |
| `models` | 共享结果结构 | `QueryResult`、`ApexRunResult`、`DescribeSObject`、`ApexLogRef` | serde round-trip |
| `version` | `sf --version` 探测 + 最低版本门槛 | `SfVersion::detect()` | — |

### log-parser (SP-A.2/A.3) — 纯，最先可 TDD
`lex`(行→token) · `event`(事件枚举，移植 `ApexLogEvent`) · `tree`(执行单元树，移植 `ParsedApexLog`) · `limits`(CPU/SOQL/DML/heap 聚合) · `hotspot`(caller/callee，**留后期**，先空壳 trait)

### features (SP-A/B/C) — 用例编排，无 UI
- `debug_log`：list/get/tail → log-parser → 视图模型；trace flag/debug level CRUD
- `soql`：data query → QueryResult → 表模型 + 树模型（父子子查询）
- `anon_apex`：apex run → 结果+日志（复用 debug_log 视图模型）+ 错误定位

### desktop (Tauri 2 + React 19)
`src-tauri`(命令层：把 `features` 用例暴露为 `#[tauri::command]`，共享 `Arc<SfInvoker>`) · React 前端：app shell（顶栏/左栏/面板）· Monaco 编辑器（SOQL/Apex）· TanStack 结果表 · 日志视图（树表+raw）· org 选择条 · Tailwind v4 设计令牌。详见 `desktop-design-system` spec 与 desktop-slice 系列 plan。

### sf-schema (SP-D)
`puller`(list+describe，std+tooling，增量) · `store`(磁盘+内存，按 org+apiVersion 版本化) · `model`(Object/Field/Relationship/Picklist) · `query`(对象·字段·关系路径·picklist 取值) · `refresh`(失效/重建)

### soql-lang (SP-E)
`lexer` · `parser`(AST: SELECT/FROM/WHERE/关系路径/子查询) · `resolve`(AST × sf-schema) · `complete`(光标上下文→候选) · `diagnostics`(未知字段/对象/类型)

### apex-lang (SP-F) — 自身多 spec，先占边界
`lexer` · `parser`(AST) · `stdlib`(System 标准库数据模型 + 打包数据集 ← **最大未知，单独 brainstorm**) · `symbols`(org ApexClass 符号摄取) · `infer`(类型推断) · `complete` + `diagnostics`

## 7. 技术选型（桌面 = Tauri 2 + React 19）

| 用途 | 选择 | 备注 |
|---|---|---|
| 桌面框架 | Tauri 2 | 原生 webview，Rust 后端直接 link `features` crate |
| 前端 | React 19 + Vite 7 + TypeScript | — |
| 样式/令牌 | Tailwind v4 设计令牌 | 见 `desktop-design-system` spec |
| 异步→UI | `#[tauri::command]` async + `invoke` | sf 调用在 Rust 侧跑 tokio，前端 await，不阻塞 UI |
| 大结果表 | **TanStack Table**（虚拟化） | 超大集走 `data export bulk` |
| 代码编辑器 | **Monaco**（SOQL/Apex 语法 + 补全接 soql-lang/apex-lang） | — |
| 通知 | 前端 toast 组件 | 错误/成功提示 |

## 8. 建造顺序（每单元独立 spec → plan → 实现）

`SP0 sf-core` → `SP-A Debug Log` → `SP-D Schema 引擎` → `SP-B SOQL 执行` → `SP-E SOQL 补全` → `desktop slice1 SOQL` → `SP-C Anon Apex 执行` → `desktop slice2 Apex+Logs` → `SP-F Apex 语言引擎（分期）`

理由：SP0 是地基；SP-A 独立、低风险、快速见效，且产出日志解析器供 SP-C 复用；SP-D→B→E 交付带"精华"的 SOQL 窗口；SP-F 最难，最后分期攻坚，期间 SP-C 先用轻量补全跑通。

## 9. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| **Apex 标准库数据来源**（SP-F.2） | 无 System 库模型则 Apex 补全无从谈起 | 单独 brainstorm；候选：从 that plugin OST 的 systemDeclaration 数据提取 / Salesforce 文档抽取 / 打包 curated 数据集 |
| `sf` 进程启动延迟 | 不能用于逐键补全 | 架构已隔离：补全吃缓存，sf 仅一次性拉取 |
| Tauri/React 依赖升级 | 跟版本成本 | UI 薄、逻辑在下层 crate，升级面收敛在 `desktop/` |
| 超大 SOQL 结果集 | 内存/渲染卡顿 | TanStack Table 虚拟化 + 大集走 `data export bulk` |
| describe 逐对象慢（SP-D） | 首次缓存构建慢 | 增量 + 后台拉取；必要时直连 REST composite 批量 describe |
| `sf --json` 输出契约变动 | 解析失败 | 集中在 sf-core/json，版本门槛 + 夹具回归 |

## 10. 测试策略

- `log-parser`：纯函数，喂真实日志夹具，TDD 主战场。
- `sf-core`：`CommandRunner` trait 注入录制的 sf JSON 输出，不真调 sf。
- `sf-schema`/`soql-lang`/`apex-lang`：喂录制 describe + 固定查询/脚本，断言补全候选与诊断。
- `desktop`：薄层，逻辑已下沉，UI 仅做冒烟/快照（Playwright）。
- 覆盖目标遵循全局 80%。
