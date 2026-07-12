# Org Selector 重构：per-org 配置 + modal 切换

Status: approved (grilling 2026-07-12). Branch: `feat/org-selector-modal` (从 feat/schema-browser HEAD 切出)。

## 共识（不可偏离）

1. per-org 配置 `{ apiVersion?, timeoutSecs?, alias?, color? }`，存现有 tauri-plugin-store
   (`appDataDir/ultraforce.json`)，key `orgConfig.<username>`。
2. API version 统一覆盖：`effective = override ?? sf org display 动态值`，在版本解析入口应用，
   下游（索引/SOQL/Apex/日志 REST URL）全部继承。override 变更 → 走索引 staleness 机制触发重建。
3. 超时：单一 `timeoutSecs` 应用到该 org 全部 HTTP 请求；未配置用现有默认。
4. 别名/颜色仅显示层（titlebar 徽章 + modal 列表行）；内部 key 永远 username。
5. modal 完全替代 dropdown：titlebar 当前-org 徽章（org 颜色整块填充 + 别名，无颜色时用默认样式），
   点击打开 modal。
6. modal 列表行：颜色、别名、username、api version、org 类型（仅当 `sf org list` 已返回该信息，
   不新增网络调用）。点击行即切换：成功自动关 modal、失败 toast 不关、点已选中行只关闭。
7. 配置编辑：modal 内视图切换（列表 ↔ 编辑面板，返回箭头），显式「保存」按钮一次性写入。
   保存时若修改了当前活跃 org 的 apiVersion → 立即触发 reindex（复用 `triggerIndex`/`ensureReady`）。
   颜色 = 预设色板（6–8 个），apiVersion 只做格式校验（接受 `58`/`58.0`，规范化为 `58.0`），
   timeoutSecs 正整数校验。输入框 placeholder 显示当前动态 api version / 当前默认超时。
8. 「Connect Org」按钮：关闭 org modal 后顺序打开现有 `ConnectOrgDialog`（不嵌套、不改造）。
9. 范围外：logout/移除 org、残留 orgConfig 清理、分场景版本覆盖、分类超时、全窗口 prod 着色、
   自定义取色、org 搜索/键盘导航。

## 架构约束（CLAUDE.md 强制）

- IPC 错误一律 `CommandError`；DTO camelCase 且住 `dto.rs`，手工镜像到 `desktop/src/types.ts`，同一 commit 改两边。
- 前端 IPC 只走 `desktop/src/ipc/`；组件不直接 import `@tauri-apps/api/core`。
- `lib.rs` 只放 command 壳，编排进模块。
- `crates/sf-core` 不得依赖 tauri —— override/timeout 由 src-tauri 组合根解析后注入
  （参数或 setter，agent 自选最小方案）。
- 单文件 ≤800 行。No native title tooltips —— icon 按钮用 aria-label。

## 实现要点

### 存储与读取路径
- 前端读写走现有 `desktop/src/store.ts` typed wrapper（`getJson`/`setJson`），key `orgConfig.<username>`。
- Rust 侧用 tauri-plugin-store Rust API（`app.store(...)`）按需读取同一 store —— 先验证 v2 中
  JS `set` 后 Rust 立即可见（同一内存实例）；若属实则**不需要** set_org_config 命令和 AppState 缓存。
  若验证不成立，退回方案：`set_org_config` 命令 + AppState 缓存。
- 保存后调用 `flush()` 确保落盘再触发 reindex。

### API version override
- 现状：`crates/sf-core/src/org.rs:69` `api_version()` 来自 `sf org display`；索引 meta 存
  `api_version`（`crates/apex-lang/src/db.rs`）；REST URL 拼接在 `crates/apex-lang/src/acquire.rs:33`；
  UI 经 `StatusDto.api_version`。
- 在 src-tauri 解析 effective version 并注入下游调用链；确认索引 staleness 比对会因版本变化而判定过期
  （若现有比对不含 api_version，补上）。
- `StatusDto.api_version` 应报告 effective 值（UI 显示的就是实际生效版本）。

### 超时
- 先查清当前 reqwest client 的默认超时（可能未设置 = 无限）；把 per-org timeout 应用到该 org 的
  请求路径（client 构建处或 per-request）。默认值写进编辑面板 placeholder。

### 前端
- 删除 `OrgSelector.tsx` dropdown 用法，新增：
  - `OrgBadge`（titlebar，当前 org 颜色填充 + 别名 fallback username）
  - `OrgSwitcherModal`（`@astryxdesign/core/Dialog`，参考 `ConnectOrgDialog` 的 isOpen/onOpenChange 形态）
    内含列表视图 + 编辑视图切换。
- `org.tsx` Context 扩展：暴露 orgConfig 读取（别名/颜色供徽章与列表用）；切换逻辑复用现有 `select()`。
- `types.ts` 增加 `OrgConfig` 类型。

## 验证（完成定义）

- `cargo check` + `cargo test`（workspace）通过
- `rtk tsc` / lint 通过；vitest 加 `--run`
- `scripts/check-arch.sh` 通过
- 前端单测：apiVersion 规范化、OrgConfig 读写 round-trip（mock store）
- 不自行 commit —— 完成后停在工作区，等主会话 review diff
- 不启动 tauri dev（用户规则：agent 开发期间不跑 dev server）
