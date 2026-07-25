# 托盘常驻 + 冷启动优化

Grilling 定稿 2026-07-25。两块独立改动，分两个 commit。

## A. 托盘常驻（macOS 优先）

决策：关窗=隐藏窗口并退到 accessory（Dock 图标消失）；Cmd+Q 真退出；菜单栏只放
Show / Quit；拦截逻辑全放前端；图标自绘单色 template。

1. `Cargo.toml` — `tauri` features 加 `tray-icon`。
2. 图标 — 按现有 logo 的双箭头画透明底纯形状 PNG，`icons/tray-template.png` +
   `@2x`（22/44px）。`icon_as_template(true)`，菜单栏深浅色自动适配。
3. `src-tauri/src/tray.rs`（新）— `TrayIconBuilder`：左键点击 toggle 窗口显隐；
   菜单 Show / Quit。Quit 走 `app.exit(0)`。
4. `src-tauri/src/lib.rs` — 新命令 `set_dock_visible(visible: bool)`，macOS 下
   `set_activation_policy(Regular/Accessory)`，其他平台 no-op。
5. `desktop/src/main.tsx` — `onCloseRequested` 改为
   `e.preventDefault()` → `flush()` → `window.hide()` → `setDockVisible(false)`。
6. 显示路径 — 必须 `set_activation_policy(Regular)` → `show()` → `set_focus()`，
   顺序错了窗口会以未激活状态出现在别的 app 后面。
7. `capabilities/default.json` — 加 `core:window:allow-hide`
   （`allow-destroy` 已在上一轮补上）。
8. 唤出窗口时后台刷一次 org list（复用 B.2 的刷新函数，非阻塞）。

### 已知取舍
Cmd+Q 走 macOS terminate → Rust `ExitRequested`，不经过 `CloseRequested`，前端来不
及 flush，最多丢失 `DEBOUNCE_MS`(400ms) 内的编辑。用户已否决"Rust↔前端退出握手"
方案，接受此缺口，代码里留 `ponytail:` 注释标明上限与升级路径。

## B. 冷启动优化

决策：有缓存直接进 UI；失效 org 清 target 并提示、绝不自动切；保留连接检测；
PATH 缓存 + 后台重探；加轻量埋点。

1. `src-tauri/src/setup.rs:13` — `$SHELL -ilc "echo $PATH"` 结果缓存到 app config
   dir；启动读缓存（~0ms），后台 spawn 重探写回，下次启动生效。无缓存才同步探测。
2. `desktop/src/org.tsx` — org list 缓存进 store；启动读缓存立即渲染，并行
   `invoke("list_orgs")` 后台刷新。**不加** `--skip-connection-status`（它是判断
   org 失效的唯一依据，反正已挪到后台）。
3. `desktop/src/App.tsx:226` — `orgLoading` 仅在无缓存时为 true。
4. 刷新回来若当前 target 不在列表 → 清空 target + 提示条要求重选。不自动切 org
   （避免静默切到 prod 上跑 SOQL / 匿名 Apex）。
5. 埋点 — Rust tracing 记 process start → window 创建；前端 `performance.mark`
   记 first paint / org ready；dev 下各输出一行。

## 验收
- 改前 / 改后各跑 3 次冷启动，用埋点数字对比，报实测值而非"应该快了"。
- `cargo test`、`vitest --run`、`oxlint`、`scripts/check-arch.sh` 全绿。
- 手工目检：关窗→菜单栏图标存在、Dock 消失；点图标→窗口回前台并聚焦；
  Cmd+Q→进程真退出。
