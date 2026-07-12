# Fjord Design System 落地计划

Status: approved 2026-07-12。规范（活体 spec）: https://claude.ai/code/artifact/86619237-3010-414c-9edb-9cdedf77fade
方向：Nord 色温 × GitHub Dark 对比/结构，融合 emil-design-eng 动效框架。

## Token 定义（Source of Truth）

### Surfaces（暗色主主题）
| Token | 值 | 用途 |
|---|---|---|
| bg-base | #1B1F28 | 窗口底 |
| bg-panel | #232935 | 面板/卡片 |
| bg-elevated | #2B3242 | 浮层/菜单/modal |
| bg-inset | #161A21 | 编辑器/代码内嵌区（现 Monaco 暗色 bg #16181D，近似无缝） |

### Text（三级封顶）
| Token | 值 |
|---|---|
| text-1 | #ECEFF4 |
| text-2 | #A9B4C6 |
| text-3 | #67718A |

### Borders（两档，禁止第三种）
| Token | 值 | 用途 |
|---|---|---|
| line-1 | #353E50 | 结构边框：面板、表头、输入框 |
| line-2 | rgba(236,239,244,.07) | 发丝线：行分隔 |

### Accent 与语义色（永不混用）
| Token | 值 | 用途 |
|---|---|---|
| accent | #88C0D0 | 唯一交互/选中色（hover #9ED2E0，填充上文字 #16323A，淡底 rgba(136,192,208,.14)） |
| ok | #A3BE8C | 成功/已连接 |
| warn | #EBCB8B | 警告/limit |
| err | #BF616A | 错误（小字号文本用补偿色 #D8848D） |
| info | #81A1C1 | 信息 |

### 排版
- UI：系统 sans；一切数据值（Id/版本/数字/耗时）：mono + tabular-nums，数字列右对齐
- 字号六档：10 / 11.5 / 13 / 15 / 18 / 22，禁止中间值
- 大写微标签必配 letter-spacing ≥ .08em

### 间距/圆角
- 4px 基：4/8/12/16/24/32
- 圆角：4（chip/输入框）/ 6（按钮/卡片/表格容器）/ 10（modal/popover）

### Motion（emil-design-eng）
- --ease: cubic-bezier(.23,1,.32,1)（进场/交互）; --ease-io: cubic-bezier(.77,0,.175,1)（屏内移动）
- press 120ms scale(0.97)（一切可按元素）；hover/颜色 150ms；popover 180ms scale(.97)+opacity origin 朝触发器；modal 200ms 进 / 130ms 出，origin 居中
- **高频/键盘触发零动画**（tab/页面切换不动——保住 page-switch perf 成果）
- 一次性列表进场可 stagger 40ms；prefers-reduced-motion 降级为仅 opacity
- 只动 transform/opacity

### 编辑器
- 语法高亮**保留现有体系**（desktop/src/editor-themes.ts 的 4 套用户可选方案）不动
- Fjord 只接管 chrome：editor.background → bg-inset；selection/cursor/suggest 弹层/menu 配色对齐 token（DARK_COLORS 表按 Fjord 值更新）

## 五原则（巡检准绳）
1. 层级即空间：三级表面 + 两档边框，禁止野生灰/随手 opacity
2. 数据皆等宽：mono + tabular-nums
3. 一个 accent：交互/选中 = Frost；状态 = Aurora 语义色
4. 高频零动画
5. 状态必有形：选中=左缘条+底色；错误=色+图标/文字；空状态=一句引导+一个动作

## 分阶段执行

### Phase 1 — Token 层（本次）
- 先调查现状：主题机制在哪（desktop/src/theme.tsx、astryx tailwind-theme.css、@astryxdesign tokens.stylex、App 层 CSS 变量/tailwind 配置），暗色值当前如何注入
- 把 Fjord surfaces/text/line/accent/semantic 映射进主题层（暗色）；亮色主题本期不动值（留现状），只保证结构不破坏
- editor-themes.ts DARK_COLORS 对齐（只 chrome，语法 PALETTES 不动）
- 验收：全局肉眼可见换血；tsc/vitest/check-arch 全绿；无组件级硬编码新增

### Phase 2 — Motion 层
- easing/duration token 落进主题；Button/Dialog/Popover 默认动效按规范；audit 现有 transition

### Phase 3 — 数据层
- ResultTable 等表格规范化（mono sticky 列头/tabular 右对齐/选中行 accent 左缘条/hover 微亮）

### Phase 4 — 巡检
- 逐页对照五原则，消灭野生灰/野生字号/无引导空状态；一页一 commit

## 约束
- astryx 是 node_modules 包：优先通过它暴露的 theme 定制口（CSS 变量/tailwind theme）覆盖，不 fork 包源码；若定制口不足，把差异记录进计划再议
- 遵守 repo 架构规则（CLAUDE.md）；800 行上限；fallow 复杂度门禁

## Phase 4 巡检记录 (2026-07-12)

逐页对照五原则（1 层级/2 等宽/3 一个 accent/4 高频零动画/5 状态必有形）。

### 修复清单

| 页面/组件 | 原则 | 违规 | 修复 (file:line) |
|---|---|---|---|
| Schema · ObjectList | 5 | 选中态 `bg-accent`，无左缘条 | `ObjectList.tsx:62` → `bg-primary/10 + shadow-[inset_2px_0_0_0_var(--primary)]`（对齐 ResultTable/LogList 选中样式，Phase 3 遗留项） |
| Schema · FieldTable | 5 | 同上（孪生列表） | `FieldTable.tsx:93` 同一改法 |
| Logs · LogListPane | 5 | "No logs"/"No matches" 裸字，无引导无动作 | `LogListPane.tsx:156-179` 改为「一句引导 + 动作按钮」：空库→Refresh；筛无果→Clear filter |
| Schema · SchemaPanel | 5 | "未索引"空态只指向工具栏按钮，无就地动作 | 加 `onReindex` useCallback + "Reindex org" 动作按钮 `SchemaPanel.tsx:158-171,236-247` |
| Logs · QueriesView | 1 | `text-text-dim/70` 用 opacity 伪造第三级文字 | `QueriesView.tsx:58` → `text-text-dim` |
| Logs · InsightsView | 1 | 同上 ×2 | `InsightsView.tsx:57,68` → `text-text-dim` |
| Logs · LogDetailPane | 1 | 同上 | `LogDetailPane.tsx:51` → `text-text-dim` |
| Schema · ReferencesSection | 1 | `text-muted-foreground/70` 伪造层级 | `ReferencesSection.tsx:75` → `text-muted-foreground` |
| Apex · ApexHistoryDrawer | 1 | `text-foreground/80`、`/90` 伪造层级 | `:74` → `text-muted-foreground`；`:126` → `text-foreground`（去 opacity） |
| Titlebar · IndexProgress | 2 | `Indexing objects 45/120` 计数非等宽，跳动 | `IndexProgress.tsx:75` 加 `tnum` |
| Settings · About | 2 | 版本号 `v0.3.11` 非 mono | `SettingsPage.tsx:297` 版本号包进 `font-mono tabular-nums` span |

### 逐页结论（无违规 / 已合规）

| 页面 | 结论 |
|---|---|
| SOQL panel | 空态经 FileTabsPanel 已合规（引导句 + New query 按钮）；状态行已用 `.tnum`；无野生灰 |
| Apex panel | 空态同上（FileTabsPanel）；错误/warn 块用 destructive/amber token；仅历史抽屉两处 opacity 已修 |
| Logs · LogDetailView | SegmentedControl 切换无进场动画（原则 4 OK）；数据列已 mono/tnum |
| Schema search bar / 中栏"选择对象"空态 | 引导句 + 相邻可操作列表即动作，合规 |
| dialogs (SourceDialog/ConnectOrg) | SourceDialog 用 Monaco + `apex-target-line` 左缘条；无裸空态/野生灰 |
| Titlebar (OrgBadge/SchemaRefresh) | token 化；页面/tab 切换仅 hover `transition-colors`，无高频动画（原则 4 OK） |

### Flagged — 未修（原因）

| 项 | 位置 | 原因 |
|---|---|---|
| 破坏性 solid 按钮 | — | 代码内**不存在**自绘 solid destructive 按钮；`variant="destructive"` 零使用。唯一破坏性确认 = astryx `AlertDialog`（`confirm.tsx`），astryx-internal，按任务约定可保持填充 → flag 不重做 |
| 火焰图/时间线分类色 | `flameColor.ts`、`TimelineView.tsx`（`#eab308`/`#0b0f1a`/`bg-slate-500/60`）、`TimeBreakdownBar.tsx`（`bg-slate-500`） | data-viz 分类调色板（按事件类别着色），非 UI chrome 野生灰；改单色会破坏整套类别语义 → 需 dataviz/产品决策，超出外科式范围 |
| 第三级文字 token 未接线 | `styles.css` | 规范定义 text-3 `#67718A`，但 token 层只接了 text-1/text-2（`--c-text-dim` ≈ text-2）。本次把 opacity 伪造的第三级统一收敛回 text-2；若确需真三级，属 Phase 1 token 层补接 |
| OrgBadge 地球图标 `opacity:0.8` | `OrgBadge.tsx:58` | 图标弱化，非文字层级伪造，保留 |

### 验收

tsc 0 · oxlint 0 error（18 warning 全为既有，非本次引入）· vitest 256 passed · check-arch exit 0 · `FALLOW_AUDIT_BASE=HEAD fallow audit` exit 0（SchemaPanel HIGH 为既有 inherited finding，门禁排除；本次 11 改动文件 delta 干净）。未 commit。
