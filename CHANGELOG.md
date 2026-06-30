# Changelog

## [0.3.7](https://github.com/dormonbear/ultraforce-desktop/compare/v0.3.6...v0.3.7) (2026-06-30)


### Bug Fixes

* **ci:** drop pnpm version input so action-setup uses packageManager ([#26](https://github.com/dormonbear/ultraforce-desktop/issues/26)) ([293133e](https://github.com/dormonbear/ultraforce-desktop/commit/293133e3fc47a3d10a0c78371d9f0b6348454070))

## [0.3.6](https://github.com/dormonbear/ultraforce-desktop/compare/v0.3.5...v0.3.6) (2026-06-30)


### Features

* **logs:** step-debugger, jump-to-source, and large-log performance ([#24](https://github.com/dormonbear/ultraforce-desktop/issues/24)) ([f2a62e4](https://github.com/dormonbear/ultraforce-desktop/commit/f2a62e463dbae32504055a897e38af3c09e3b7b3))

## [0.3.5](https://github.com/dormonbear/ultraforce-desktop/compare/v0.3.4...v0.3.5) (2026-06-25)


### Features

* apex log analyser, inline SOQL completion, IC2 logging config, large-log fix ([d63756d](https://github.com/dormonbear/ultraforce-desktop/commit/d63756d85feb3d1d3dca01f346b9b7030c426137))
* apex log analyser, inline SOQL completion, IC2 logging config, large-log fix ([3cd1c6c](https://github.com/dormonbear/ultraforce-desktop/commit/3cd1c6c0bdfc57d3a31d69041cc4df78b09aee4e))

## [0.3.4](https://github.com/dormonbear/ultraforce-desktop/compare/v0.3.3...v0.3.4) (2026-06-24)


### Features

* **apex-lang:** add tree-sitter-sfapex CST parse layer (P0) ([e301a06](https://github.com/dormonbear/ultraforce-desktop/commit/e301a063ee922c13510f5d73047521aaf0a29db6))
* **apex-lang:** collect CST local/param declarations for completion ([9326ce7](https://github.com/dormonbear/ultraforce-desktop/commit/9326ce7f37e9cb0055edfba4f2bb57b3c7815fe2))
* **apex-lang:** CST caret-position classification (classify) ([747cf65](https://github.com/dormonbear/ultraforce-desktop/commit/747cf6567f2d375ba7d777f9f9dce04c784f4cef))
* **apex-lang:** CST navigation helpers (node_at_offset, find_ancestor) ([97e8b47](https://github.com/dormonbear/ultraforce-desktop/commit/97e8b470ac3543aa189852d44cb1535639d9c5da))
* **apex-lang:** expose format_apex module ([32632aa](https://github.com/dormonbear/ultraforce-desktop/commit/32632aa16a433e695be1376cf105319528a93b6e))
* **apex-lang:** rewrite completion on the tree-sitter CST (P1) ([beb36ea](https://github.com/dormonbear/ultraforce-desktop/commit/beb36eab714a847b13660c0588ac17582899220d))
* **apex:** click a compile-error location to jump the editor cursor there ([ba820ca](https://github.com/dormonbear/ultraforce-desktop/commit/ba820cae5ca3231a537c26428837e5233d2dc3c5))
* **apex:** one-click copy of a runtime exception + stack trace ([6dea96e](https://github.com/dormonbear/ultraforce-desktop/commit/6dea96eb0f4c6b8ded8eb3f4868b6bbb63e64ad9))
* **apex:** persist the editor/result split layout ([69654a3](https://github.com/dormonbear/ultraforce-desktop/commit/69654a3682734fa4a9bfe78ba83aee0d49e5497c))
* **desktop:** add format_apex Tauri command ([d6e8751](https://github.com/dormonbear/ultraforce-desktop/commit/d6e8751daad160332ef760c36aa012aac31d337a))
* **desktop:** enable Format Document in Apex panel ([b1062a0](https://github.com/dormonbear/ultraforce-desktop/commit/b1062a04900e63a7847ad4473a5d77008c42101f))
* **desktop:** insert generic &lt;&gt; when completing Apex collection types ([cfb892c](https://github.com/dormonbear/ultraforce-desktop/commit/cfb892cd1474106531b344c114451c2f5f43ef1f))
* **desktop:** register Apex Format Document provider ([85917fa](https://github.com/dormonbear/ultraforce-desktop/commit/85917faba0cf55fc9b55f59c28813e93f26ca9b6))
* **editor:** focus the editor when a tab opens ([30850ca](https://github.com/dormonbear/ultraforce-desktop/commit/30850caf5b7ac355e7e2c54828ba811b8d088179))
* **editor:** placeholder hints in empty SOQL/Apex editors ([842bcc7](https://github.com/dormonbear/ultraforce-desktop/commit/842bcc783194378af9501347b0c353c3285c122a))
* **format:** SOQL casing/whitespace, apex formatter module, trimmed Monaco menu ([057f18f](https://github.com/dormonbear/ultraforce-desktop/commit/057f18f6466afb9274d886897a11b42b4a2e8b6b))
* **history:** filter the run-history drawer and close it on Escape ([0dbf0f2](https://github.com/dormonbear/ultraforce-desktop/commit/0dbf0f28d76257ddb40b56d276c144f7d48a989c))
* **logs:** one-click Copy on the log viewer ([f625005](https://github.com/dormonbear/ultraforce-desktop/commit/f6250051e2f9c6b94006cf885df102c93865539b))
* **results:** copy a whole column's values from a query result ([8348e78](https://github.com/dormonbear/ultraforce-desktop/commit/8348e78a0161b48a27150d5056074dd69dd8ab60))
* **results:** copy the whole result as tab-separated rows ([c688e53](https://github.com/dormonbear/ultraforce-desktop/commit/c688e536d6509cc4da6dd7db92ed4224a045794e))
* **results:** show a cell's full value on hover ([453b455](https://github.com/dormonbear/ultraforce-desktop/commit/453b455ab620c2c48a08b130dcb139def0cab4e7))
* **run:** nudge instead of a backend error when running an empty editor ([27bb4ba](https://github.com/dormonbear/ultraforce-desktop/commit/27bb4ba97b6e2c74c3c333b56d31080cfd261dc7))
* **soql:** show run time in the status line ([083138e](https://github.com/dormonbear/ultraforce-desktop/commit/083138e6c698554a77848994a8c880e196e29d5b))
* **tabs:** in-memory untitled tabs with Save As (Cmd+S) ([4d2765f](https://github.com/dormonbear/ultraforce-desktop/commit/4d2765f4948d11209dd5baca232c5c4a173c0876))
* **tabs:** middle-click a tab to close it ([00bb10e](https://github.com/dormonbear/ultraforce-desktop/commit/00bb10ec22442fae137db374fba4cde7f5294052))
* **tabs:** show a file tab's full path on hover ([83e739c](https://github.com/dormonbear/ultraforce-desktop/commit/83e739c83036e9a70f62f2bad8ea96b941f0990e))
* **tabs:** undo closing an unsaved untitled tab ([1cde9d8](https://github.com/dormonbear/ultraforce-desktop/commit/1cde9d80feb6e82183e26b7d049527f3f9ceb331))
* **tabs:** unsaved indicator on untitled tabs; de-flake completion e2e ([ee14f6d](https://github.com/dormonbear/ultraforce-desktop/commit/ee14f6da4d1a5d50b85107da993d01e19b07e189))
* **theme:** default to the OS color scheme on first launch ([4b6657c](https://github.com/dormonbear/ultraforce-desktop/commit/4b6657c406493e25022b3a4d250caf317711e5c8))
* tree-sitter Apex completion, formatters, and in-app UX polish ([217a0c6](https://github.com/dormonbear/ultraforce-desktop/commit/217a0c61fd030dc20fd4f96dd14eaa64e963a0e6))
* **ui:** Cmd/Ctrl+1..3 to switch tools, shown in rail tooltips ([6a66206](https://github.com/dormonbear/ultraforce-desktop/commit/6a662064500dc7e989ed6f7c7de8b264f2aed30d))
* **ui:** discoverable command-palette button in the header ([fa22a75](https://github.com/dormonbear/ultraforce-desktop/commit/fa22a750b0ed9dd0c4e6c4967b7cb0a155a27380))
* **ui:** New action in the empty SOQL/Apex panel ([d9d5da0](https://github.com/dormonbear/ultraforce-desktop/commit/d9d5da0f677ea8e6795120d9c6dbee540f20e930))
* **ui:** surface the Run keyboard shortcut on the RUN button ([39e2ff9](https://github.com/dormonbear/ultraforce-desktop/commit/39e2ff9ccd28316321de9941b9e5f850c155a881))


### Bug Fixes

* **apex-lang:** always offer built-in List/Set/Map types in completion ([659d46a](https://github.com/dormonbear/ultraforce-desktop/commit/659d46a9b418470f76df2fb3625d16c13d9daeee))
* **apex-lang:** complete members after a bare `a.` (empty prefix) ([35164ef](https://github.com/dormonbear/ultraforce-desktop/commit/35164efad2781e13d3a7b80816432169ad823f16))
* **apex-lang:** require SELECT/FIND for SOQL bracket classification ([a437fee](https://github.com/dormonbear/ultraforce-desktop/commit/a437fee3c0c7207cdf9dccdc0f1499836a31c45a))
* **apex-lang:** suppress type completion in variable-name position ([6fdc835](https://github.com/dormonbear/ultraforce-desktop/commit/6fdc83574718f1dba45b1eb9b90af5b18fb0e9a9))
* **ui:** diagnostics on first open + working New tab button ([3ee4a88](https://github.com/dormonbear/ultraforce-desktop/commit/3ee4a88351e69f51b269334f06f34b3d458fb17f))

## [0.3.3](https://github.com/dormonbear/ultraforce-desktop/compare/v0.3.2...v0.3.3) (2026-06-23)


### Features

* **ui:** add Ultraforce brand logo and app icons ([2775e59](https://github.com/dormonbear/ultraforce-desktop/commit/2775e5968318cc389224f35c92a7f5c5a602e0fd))
* **ui:** brand logo, app icons, motion polish + org dedupe fix ([0782c2f](https://github.com/dormonbear/ultraforce-desktop/commit/0782c2fe8368164ff4134c98bc603c64a90f34eb))
* **ui:** motion polish for press feedback and easing ([6d38365](https://github.com/dormonbear/ultraforce-desktop/commit/6d38365133ca174a0b5caae624d4e976d65ab551))


### Bug Fixes

* **org:** dedupe orgs listed under multiple sf categories ([8f950e5](https://github.com/dormonbear/ultraforce-desktop/commit/8f950e5ebb7097e698939245558a8d4b4edc6a8d))

## [0.3.2](https://github.com/dormonbear/ultraforce-desktop/compare/v0.3.1...v0.3.2) (2026-06-22)


### Features

* add TraceFlag/DebugLevel control to the Logs panel ([d316615](https://github.com/dormonbear/ultraforce-desktop/commit/d316615e95f58c900cba883087bb73c199d95765))
* add TraceFlag/DebugLevel control to the Logs panel ([a09f547](https://github.com/dormonbear/ultraforce-desktop/commit/a09f54747c7f0f65b40793cbfbb4c816a2286f19))
* Debug Traces management (Configure Logging dialog) ([361c614](https://github.com/dormonbear/ultraforce-desktop/commit/361c61434a2c1b4e3e19ee52728a0d0545df08f7))
* **debug-traces:** backend load/save_logging_config + dto + commands ([e2c0c88](https://github.com/dormonbear/ultraforce-desktop/commit/e2c0c88b805dec43cca5054fa52398c32d787ff1))
* **debug-traces:** Configure Logging dialog + tables + hook ([c6ffb85](https://github.com/dormonbear/ultraforce-desktop/commit/c6ffb8540ad4312e6dd71cde2d8f5ca64d257f33))


### Bug Fixes

* **debug-traces:** widen Configure Logging dialog so all columns fit ([9dbf1ea](https://github.com/dormonbear/ultraforce-desktop/commit/9dbf1eae9bd187fb94d84f980ae927fb631be0df))
* make debug-config grid responsive to container width ([b42e564](https://github.com/dormonbear/ultraforce-desktop/commit/b42e564f3f3550f7bbe4bebc2ac0e5bc070f38c9))
* make debug-config grid responsive to container width ([6223895](https://github.com/dormonbear/ultraforce-desktop/commit/6223895ae4b488211164dbbc40368ff2185b76a8))

## [0.3.1](https://github.com/dormonbear/ultraforce-desktop/compare/v0.3.0...v0.3.1) (2026-06-22)


### Bug Fixes

* **desktop:** warm sObject-name cache on org-select so FROM completion works ([cd80876](https://github.com/dormonbear/ultraforce-desktop/commit/cd80876e313ca7cee15fa7a3453ae31b9d9cf691))
* **desktop:** warm sObject-name cache on org-select so FROM completion works ([d9235f0](https://github.com/dormonbear/ultraforce-desktop/commit/d9235f063814c47ebd7556271e30aa71534362d4))

## [0.3.0](https://github.com/dormonbear/ultraforce-desktop/compare/v0.2.1...v0.3.0) (2026-06-22)


### Features

* **desktop:** guide setup when sf CLI missing or no org; fix macOS GUI PATH ([1665d26](https://github.com/dormonbear/ultraforce-desktop/commit/1665d26db76a50c9ba9784f47d40e9286279a139))


### Bug Fixes

* **desktop:** macOS GUI PATH + setup page for missing sf CLI / org ([c797fea](https://github.com/dormonbear/ultraforce-desktop/commit/c797fea57dc902b47c535af3db5d2e89366c1eaf))

## [0.2.1](https://github.com/dormonbear/ultraforce-desktop/compare/v0.2.0...v0.2.1) (2026-06-22)


### Bug Fixes

* display app name as Ultraforce and complete bundle metadata ([d41c777](https://github.com/dormonbear/ultraforce-desktop/commit/d41c777555c5904e9a8ef1821a773d8c1e98b667))
* display app name as Ultraforce and complete bundle metadata ([b637c87](https://github.com/dormonbear/ultraforce-desktop/commit/b637c87e15baaa30107861d1faeb591d46930210))

## [0.2.0](https://github.com/dormonbear/ultraforce-desktop/compare/v0.1.0...v0.2.0) (2026-06-22)


### Features

* **apex-lang:** Apex lexer with spans ([5cbc512](https://github.com/dormonbear/ultraforce-desktop/commit/5cbc51241150676523ebf4245000f8ebd5597fe9))
* **apex-lang:** AST types + declaration parser (Phase 1, increment 2-3) ([7a2a7f2](https://github.com/dormonbear/ultraforce-desktop/commit/7a2a7f205da4d4d08557bcb5c69e1e547741ebc4))
* **apex-lang:** AST-backed type-aware completion (Phase 6a) ([e5e149e](https://github.com/dormonbear/ultraforce-desktop/commit/e5e149eb595f8b7e67e86285bcb77b63cd0ac83e))
* **apex-lang:** AST-based diagnostics (Phase 5) ([f0d484f](https://github.com/dormonbear/ultraforce-desktop/commit/f0d484f9d03cdd1eaa71efbd3ed64043b34aed0b))
* **apex-lang:** AST-grade lexer (Phase 1, increment 1) ([eb40b00](https://github.com/dormonbear/ultraforce-desktop/commit/eb40b0042715ecc03993a61c3a13594a59563a36))
* **apex-lang:** basic type + receiver resolution ([38411cf](https://github.com/dormonbear/ultraforce-desktop/commit/38411cffb444350b6c792a897147920b995c6b03))
* **apex-lang:** capture and resolve dotted declared types in outline ([2b984c5](https://github.com/dormonbear/ultraforce-desktop/commit/2b984c5be6a5d558567d2f2889833a4ee0521df8))
* **apex-lang:** complete members through expression chains ([5688632](https://github.com/dormonbear/ultraforce-desktop/commit/5688632de9f5aed1ddd4a1cda7730fe9a0a278ae))
* **apex-lang:** complete the editing class's own members ([58fd9b6](https://github.com/dormonbear/ultraforce-desktop/commit/58fd9b6eeedba1b2a333214dce99c47352133c5d))
* **apex-lang:** delta acquisition queries (changed classes + entities) ([0244f60](https://github.com/dormonbear/ultraforce-desktop/commit/0244f60321f4dd0e8383a3eb76a68d85d2345e1b))
* **apex-lang:** detect inline SOQL literal region at cursor ([bd6908f](https://github.com/dormonbear/ultraforce-desktop/commit/bd6908fc4949e2c62625a9af10cf525580f04446))
* **apex-lang:** expose needed_type_at for on-demand type acquisition ([99f4588](https://github.com/dormonbear/ultraforce-desktop/commit/99f458859d0f35a8f5dce6f98f182d00177db4cc))
* **apex-lang:** expression type inference (Phase 4) ([6840c79](https://github.com/dormonbear/ultraforce-desktop/commit/6840c79764d8c0625085f1dc3d90786ec8db6856))
* **apex-lang:** find all inline SOQL literal regions ([f16ccf7](https://github.com/dormonbear/ultraforce-desktop/commit/f16ccf7f8fc2dfae5fd38052721fbecb72b944d1))
* **apex-lang:** first-party OST acquisition + parsers ([f3c5b9a](https://github.com/dormonbear/ultraforce-desktop/commit/f3c5b9a7b20e3b5cfd619d01a7a85894f62a183e))
* **apex-lang:** flatten implemented-interface members into org types ([45457c6](https://github.com/dormonbear/ultraforce-desktop/commit/45457c6032d23108fb5d700e1ef86c699b8139f3))
* **apex-lang:** flatten superclass members into org types ([0f53626](https://github.com/dormonbear/ultraforce-desktop/commit/0f536265a0295d6986bc542b1bcd16b80a2e061a))
* **apex-lang:** index SymbolTable variables (org class fields/constants) ([858a0ed](https://github.com/dormonbear/ultraforce-desktop/commit/858a0ed87620ff50b25b26243689c89cdfdcc98c))
* **apex-lang:** inherited-member + super. completion (that plugin-modeled) ([e2d7410](https://github.com/dormonbear/ultraforce-desktop/commit/e2d74100c66ce2b822bdac12bbfefaf5dd07caaa))
* **apex-lang:** OST snapshot + manifest persistence ([62b7e7e](https://github.com/dormonbear/ultraforce-desktop/commit/62b7e7e24de58748c1bf090917dd24731f8fdd80))
* **apex-lang:** OST symbol model ([a947f5a](https://github.com/dormonbear/ultraforce-desktop/commit/a947f5a35fb68c3866365fb4b59db01f7d267a67))
* **apex-lang:** outline locals + cursor context classification ([f54a571](https://github.com/dormonbear/ultraforce-desktop/commit/f54a5712786469aea659c7fa81ca2f469fdb19eb))
* **apex-lang:** parse Apex inner classes into the OST ([ec2f980](https://github.com/dormonbear/ultraforce-desktop/commit/ec2f980db4ca1abca2d5306d77cbb60b001481fc))
* **apex-lang:** parse generic type args + collection element table ([a731a8a](https://github.com/dormonbear/ultraforce-desktop/commit/a731a8ad052b8bacdbb2fe734d24617e476b3640))
* **apex-lang:** parse receiver chains for member completion ([9c8e232](https://github.com/dormonbear/ultraforce-desktop/commit/9c8e2324f050d6a2ef6f591d20dcfdbf796fc9e7))
* **apex-lang:** resolve namespace-qualified chain heads ([05eb5e7](https://github.com/dormonbear/ultraforce-desktop/commit/05eb5e75704faae07e63e9cedd9497923c03ca7a))
* **apex-lang:** resolve receiver-chain result type ([b584a6b](https://github.com/dormonbear/ultraforce-desktop/commit/b584a6bff4d64257b67e43bc440748c7a9358b90))
* **apex-lang:** scope & binding resolution (Phase 3) ([2a99e0e](https://github.com/dormonbear/ultraforce-desktop/commit/2a99e0eac7d8624ce1fcfc8e16d7daa00a209b2e))
* **apex-lang:** statement + expression parser (Phase 1, increment 4) ([cb2d343](https://github.com/dormonbear/ultraforce-desktop/commit/cb2d343653cc0c15aaed2034054611aed3490ce8))
* **apex-lang:** static vs instance member completion ([2cb3100](https://github.com/dormonbear/ultraforce-desktop/commit/2cb3100c1088d9b96bb615355816a4a9a433e064))
* **apex-lang:** structured type model (Phase 2) ([5f0f6ce](https://github.com/dormonbear/ultraforce-desktop/commit/5f0f6cea732d56de89ee5d14a38a18915184b30f))
* **apex-lang:** top-level + member-access completion ([9cf274b](https://github.com/dormonbear/ultraforce-desktop/commit/9cf274be21a318c0ad0b8cbcb9ccd617795b3258))
* **apex-lang:** unwrap generic collection element types in chains ([df82792](https://github.com/dormonbear/ultraforce-desktop/commit/df8279255effcf29d40e3e57b5387db7d4ca146f))
* **apex-lang:** versioned OST disk+memory cache ([62c93d5](https://github.com/dormonbear/ultraforce-desktop/commit/62c93d5858c738459c26b126d42ded854290e82d))
* **apex:** lazy per-type OST acquisition + background warm (scales to large orgs) ([48bd184](https://github.com/dormonbear/ultraforce-desktop/commit/48bd1845459c7784b886b8bf0c8b88277babf0e1))
* **apex:** restore top-level org-class-name completion + pin OST to selected org ([cfcb09f](https://github.com/dormonbear/ultraforce-desktop/commit/cfcb09f4d53728144dfb7457feee5042188be6d7))
* **apex:** SOQL bind-variable (:var) completion ([01032b0](https://github.com/dormonbear/ultraforce-desktop/commit/01032b0869b9bc46279f656324fd2cd13a98d4c5))
* AST diagnostics surfaced as editor markers (Phase 6c) ([1f545c1](https://github.com/dormonbear/ultraforce-desktop/commit/1f545c1aa79e2c8158598f41bb7e9863434161c3))
* automate GitHub releases and in-app updates ([eb9e017](https://github.com/dormonbear/ultraforce-desktop/commit/eb9e017731d21142393d017db07403fdb26382c9))
* **desktop:** add ⌘K command palette ([70659da](https://github.com/dormonbear/ultraforce-desktop/commit/70659da48fdbd22f9ad91dcf341131d4cde3afae))
* **desktop:** add light/dark theme toggle ([ea5e40d](https://github.com/dormonbear/ultraforce-desktop/commit/ea5e40df74c07bff6b38558d9dba7345e8f3213c))
* **desktop:** add tauri fs + dialog plugins for script files ([936d071](https://github.com/dormonbear/ultraforce-desktop/commit/936d071cd65115bec03f18c45f0940bba1c1fe60))
* **desktop:** always-visible floating horizontal scrollbar for result grid ([1c2277f](https://github.com/dormonbear/ultraforce-desktop/commit/1c2277f373fe79301dea142b2e8754e276652798))
* **desktop:** Apex runner + Debug Logs slice ([4f57044](https://github.com/dormonbear/ultraforce-desktop/commit/4f570449981c610738584fc66c185028b47185ed))
* **desktop:** apex_complete Tauri command + candidate DTO ([2ba2038](https://github.com/dormonbear/ultraforce-desktop/commit/2ba2038a1f0915fada78400e74a3c2a27aa8adfe))
* **desktop:** apex_soql_diagnostics Tauri command ([2cfb419](https://github.com/dormonbear/ultraforce-desktop/commit/2cfb41912af12e651351aac866715aad97c827b1))
* **desktop:** background delta-sync poll while an org is selected ([4b6dbc5](https://github.com/dormonbear/ultraforce-desktop/commit/4b6dbc5888c3a6dbf31179fc90b31be035d5af88))
* **desktop:** bridge Cursor tokens to shadcn tokens (.dark class) + rebrand accent→primary ([25c8b75](https://github.com/dormonbear/ultraforce-desktop/commit/25c8b75c6901713fde3ae683b7ca66c6d6933cc3))
* **desktop:** Catppuccin editor theme (Latte/Mocha) ([6d0e4a0](https://github.com/dormonbear/ultraforce-desktop/commit/6d0e4a049cd9ee1182e3c057ee3cfa665315e5e1))
* **desktop:** debounced per-file saver ([0fff328](https://github.com/dormonbear/ultraforce-desktop/commit/0fff328a15092cb0946685c4674c72fc11b803b9))
* **desktop:** debug-config row component and preset mirror ([6eec11c](https://github.com/dormonbear/ultraforce-desktop/commit/6eec11c650de95d5d2b2ee4fefa5d2b59116f468))
* **desktop:** explorer file-name filter + full-text content search ([b7b3d2f](https://github.com/dormonbear/ultraforce-desktop/commit/b7b3d2f4db1ee36b2f842283f8dd3825fd39d310))
* **desktop:** explorer sidebar + tree node UI ([335ffa3](https://github.com/dormonbear/ultraforce-desktop/commit/335ffa32476ba2718f3e657f6d0960ba70066013))
* **desktop:** file-backed tabs hook ([b0ddec5](https://github.com/dormonbear/ultraforce-desktop/commit/b0ddec5b12f3a555658d2b39d23a8e727b9310cb))
* **desktop:** generic TabStrip, tab models, and useTabs hook ([7a06e6a](https://github.com/dormonbear/ultraforce-desktop/commit/7a06e6a3cc486c2553018261ebebd1853573a991))
* **desktop:** index progress indicator + reindex control; index on org-select ([c185829](https://github.com/dormonbear/ultraforce-desktop/commit/c185829ddeda34573a37c125eaf2d5736844c3dc))
* **desktop:** index_org/reindex_org commands + progress events ([091bf71](https://github.com/dormonbear/ultraforce-desktop/commit/091bf7157cc0de2ff54bf090cf0371929b4d0833))
* **desktop:** jump to line from content-search results ([55a8da1](https://github.com/dormonbear/ultraforce-desktop/commit/55a8da1a03b56f2ed073a2825b72250a5819447b))
* **desktop:** match-case + regex options for explorer search ([d26e614](https://github.com/dormonbear/ultraforce-desktop/commit/d26e61400f5c33244a460fe7cc07bcd014ca107d))
* **desktop:** migrate debug-level pickers to shadcn Select ([6dd5866](https://github.com/dormonbear/ultraforce-desktop/commit/6dd586644cf826772d26ea53b602c1e3d247ded8))
* **desktop:** migrate OrgSelector to shadcn DropdownMenu ([0850765](https://github.com/dormonbear/ultraforce-desktop/commit/0850765cf9ce552821550a2a35fe164b3f71a3de))
* **desktop:** migrate RunButton + status indicators to shadcn Button/Badge ([62b76d6](https://github.com/dormonbear/ultraforce-desktop/commit/62b76d63021205d53a73dee22758707deec41b31))
* **desktop:** migrate table/resizable/scroll/tooltip to shadcn ([f4c7043](https://github.com/dormonbear/ultraforce-desktop/commit/f4c70433723d7ab7c76bbe353e79ca45c2ada4b2))
* **desktop:** migrate view/detail toggles to shadcn ToggleGroup ([67bb0db](https://github.com/dormonbear/ultraforce-desktop/commit/67bb0dbbcbc101504600a09b7c5278f05baa835f))
* **desktop:** Monaco Apex completion provider ([696b658](https://github.com/dormonbear/ultraforce-desktop/commit/696b658cae05f4244d7e5fcd1322451eeba3f9a0))
* **desktop:** one-time migrate persisted tabs to script files ([2352f3e](https://github.com/dormonbear/ultraforce-desktop/commit/2352f3e7aa0f9081a6e1a0cae5a7317e9b7f22c7))
* **desktop:** org list + target-org selection backend ([7e3c4b1](https://github.com/dormonbear/ultraforce-desktop/commit/7e3c4b1a3a4664ca487b7234b82464fd382b6e19))
* **desktop:** org selector dropdown in top bar ([0c1b5df](https://github.com/dormonbear/ultraforce-desktop/commit/0c1b5dfba31975b529291b0bb57f4d44cee4f8e5))
* **desktop:** persist selected org and warm schema on switch ([ab86707](https://github.com/dormonbear/ultraforce-desktop/commit/ab86707cc76d653ea9b29439f650d3b464e4ada7))
* **desktop:** pure path helpers + fs tree model ([46ce925](https://github.com/dormonbear/ultraforce-desktop/commit/46ce925b608fc62c6d74495ea7829e070d0c1c84))
* **desktop:** real right-click context menu in the explorer ([da81bac](https://github.com/dormonbear/ultraforce-desktop/commit/da81bac506f64e10350331f3e9e9ac5a44293c21))
* **desktop:** rebuild LogView with shadcn Input/Checkbox, virtualization, highlight-all ([d9273f3](https://github.com/dormonbear/ultraforce-desktop/commit/d9273f37644a869330afe90ed81fece89dd8157a))
* **desktop:** rebuild result grid as a proper shadcn data-table ([eddf3b2](https://github.com/dormonbear/ultraforce-desktop/commit/eddf3b28d070feec13c27046e509b1fbf48d1dfe))
* **desktop:** reload logs when the active org changes ([5c4086e](https://github.com/dormonbear/ultraforce-desktop/commit/5c4086ebb77841eb22ecb6b38078b28a8068cf06))
* **desktop:** resizable explorer sidebar (persisted width) ([adf8060](https://github.com/dormonbear/ultraforce-desktop/commit/adf806071852aa444d929a0c79e05548de5546f0))
* **desktop:** restyle UI to Cursor editorial design system ([e03ae67](https://github.com/dormonbear/ultraforce-desktop/commit/e03ae672d4e056f717ad27c5206afa98b3365296))
* **desktop:** settings to change/reset workspace roots ([c532ac0](https://github.com/dormonbear/ultraforce-desktop/commit/c532ac0b9d59f5b4a7d161270de8c1a4de6008ad))
* **desktop:** shared org store (fixes double-fetch + selector/palette drift) ([c761b9d](https://github.com/dormonbear/ultraforce-desktop/commit/c761b9d32fb11c7aa71d431efd759b78bf4bde27))
* **desktop:** show Apex inline-SOQL diagnostics as editor markers ([3977d37](https://github.com/dormonbear/ultraforce-desktop/commit/3977d37bab962eb5a5394ed4a0dab25e91a519ce))
* **desktop:** show SOQL unknown-field diagnostics as editor markers ([cb6d76a](https://github.com/dormonbear/ultraforce-desktop/commit/cb6d76a6292f58a7404522d07b5ddc69e62cf4c2))
* **desktop:** smart index_org entry — load snapshot + delta sync ([9fdf662](https://github.com/dormonbear/ultraforce-desktop/commit/9fdf662eb36b7dcb2b5c1cc84cc316d3b33b8d91))
* **desktop:** SOQL result returns record tree + real total_size ([c0cd95a](https://github.com/dormonbear/ultraforce-desktop/commit/c0cd95af40bea8a401f0fd21a38f9e12f3ebbcd5))
* **desktop:** SOQL slice — Tauri 2 + React shell, editor, result table ([a106f38](https://github.com/dormonbear/ultraforce-desktop/commit/a106f38b9913b65f2deca682d6c35cd2462c65c5))
* **desktop:** SOQL status line + Table/Tree result toggle ([ad6e8c4](https://github.com/dormonbear/ultraforce-desktop/commit/ad6e8c453ee13c9ba684f95198b3a42266ba447a))
* **desktop:** soql_complete Tauri command ([1a70f2c](https://github.com/dormonbear/ultraforce-desktop/commit/1a70f2cc8d96e0113be4251d61badc32e9758256))
* **desktop:** soql_diagnostics Tauri command ([00482f4](https://github.com/dormonbear/ultraforce-desktop/commit/00482f489725156c1c2d8bfc669759f9fbb0794e))
* **desktop:** src-tauri get/set debug-config commands ([c6f6f07](https://github.com/dormonbear/ultraforce-desktop/commit/c6f6f072708a46428ede52ff1c8a9b650b4312c3))
* **desktop:** surface execution tree + governor-limit rollup in Logs panel ([286f540](https://github.com/dormonbear/ultraforce-desktop/commit/286f54089a18e61d1874661e41febf590598cf6a))
* **desktop:** surface run errors via Sonner toasts ([9bb3a40](https://github.com/dormonbear/ultraforce-desktop/commit/9bb3a40d5385da7d8e0329ba076dbc6eff29b790))
* **desktop:** sync-result toast on delta index ([d15aadd](https://github.com/dormonbear/ultraforce-desktop/commit/d15aadd14ce0b940d447de955c3098c152d5f03d))
* **desktop:** syntax-highlighted, filterable debug log view ([5cc14de](https://github.com/dormonbear/ultraforce-desktop/commit/5cc14decb5d3893a848c51eaa188935ccd741a9c))
* **desktop:** top accent strip doubles as org-indexing progress bar ([56c7d74](https://github.com/dormonbear/ultraforce-desktop/commit/56c7d7479d7eec66b71df5dc732b32b6dae3d0de))
* **desktop:** wire debug-config row into the apex panel ([0a0d2d4](https://github.com/dormonbear/ultraforce-desktop/commit/0a0d2d49645bcaa63d06d82a8f8ff630fa891312))
* **desktop:** wire explorer + file-backed tabs into SOQL/Apex panels ([90341cb](https://github.com/dormonbear/ultraforce-desktop/commit/90341cba3832003b7d20ea20f2aef754b1befff4))
* **desktop:** wire SOQL field completion into the SOQL editor ([4ca1faf](https://github.com/dormonbear/ultraforce-desktop/commit/4ca1faf318f503c67a099a50b10c7adfe94af140))
* **desktop:** workspace root resolution + ensure-dir ([10d9878](https://github.com/dormonbear/ultraforce-desktop/commit/10d98789b943901d70c9e008832432e4252bfd38))
* **features:** add debug_config category model and presets ([6586c27](https://github.com/dormonbear/ultraforce-desktop/commit/6586c27472ed0e6154629e9ef2eb0aba2731739c))
* **features:** anonymous apex execution with compile/runtime/log view ([162d31f](https://github.com/dormonbear/ultraforce-desktop/commit/162d31f9cbc60530a770222d6c0d665f2c3590cd))
* **features:** debug log list/get/parse pipeline ([9258c7d](https://github.com/dormonbear/ultraforce-desktop/commit/9258c7df198e598d997a4735731e891b12ee1af5))
* **features:** detect org API version instead of hardcoding 60.0 ([5d78a32](https://github.com/dormonbear/ultraforce-desktop/commit/5d78a32e1299fb4a4be07301662666a6bde57bbc))
* **features:** diagnose SOQL literals inside Apex source ([5d729b3](https://github.com/dormonbear/ultraforce-desktop/commit/5d729b381bf775aab6812a3cf81a5f001604babe))
* **features:** full org index assembling stdlib + classes + sObjects ([d81871e](https://github.com/dormonbear/ultraforce-desktop/commit/d81871e4484449b46c65c02b49a682dd65f5de02))
* **features:** index_org uses batched composite describe ([d5ee793](https://github.com/dormonbear/ultraforce-desktop/commit/d5ee79315cf3b318e1a94086f6eb77b694320dd5))
* **features:** load index snapshot + offline-only apex completion ([f404563](https://github.com/dormonbear/ultraforce-desktop/commit/f4045631ac3b7614dbfc232490037b25e9dae6c9))
* **features:** on-demand sObject describe into the apex OST ([938c780](https://github.com/dormonbear/ultraforce-desktop/commit/938c780906eabc291a89b862900a7ddddadcde72))
* **features:** org-keyed OST cache + apex completion wiring ([29d90aa](https://github.com/dormonbear/ultraforce-desktop/commit/29d90aaf823ad094f35f4164d08d028224fae544))
* **features:** read running-user debug config via tooling SOQL ([66666d8](https://github.com/dormonbear/ultraforce-desktop/commit/66666d8e62a2da054f54c548bec350530da88817))
* **features:** resolve relationship-path schemas for SOQL completion + diagnostics ([a4ac813](https://github.com/dormonbear/ultraforce-desktop/commit/a4ac81393f522907e151110ec0e5e29a9aaf8657))
* **features:** SOQL field completion inside Apex literals ([1483ac3](https://github.com/dormonbear/ultraforce-desktop/commit/1483ac3e9d3b406d4a8a838ef8e642140fd5ee2a))
* **features:** SOQL query execution and table projection ([005a22f](https://github.com/dormonbear/ultraforce-desktop/commit/005a22ff7ac27981b6c92ca4b4f18609837f1a07))
* **features:** SOQL SELECT field completion for the standalone editor ([2ee8e6e](https://github.com/dormonbear/ultraforce-desktop/commit/2ee8e6ed4c39ae477480eb95e90e45b1c249a0b0))
* **features:** SOQL unknown-field diagnostics for the editor ([39acae6](https://github.com/dormonbear/ultraforce-desktop/commit/39acae63843b0f5bf0310a1fc486d2d4eba5e4eb))
* **features:** sync_org delta index (upsert changed + reconcile deletes) ([c274011](https://github.com/dormonbear/ultraforce-desktop/commit/c274011b2765d8ac77d822238604f727482da764))
* **features:** sync_org uses batched composite describe ([fda8c70](https://github.com/dormonbear/ultraforce-desktop/commit/fda8c7099f62675d928139bd2634b26347a90dad))
* **features:** synthesize common SObject instance methods ([6aa48e2](https://github.com/dormonbear/ultraforce-desktop/commit/6aa48e205e0467c8bfb932f681bf388e1399c8cb))
* **features:** thread optional target_org through soql/apex/debug_log ([11aeef1](https://github.com/dormonbear/ultraforce-desktop/commit/11aeef119faabfde0a59908592598373c4915d78))
* **features:** upsert DebugLevel and TraceFlag via tooling DML ([960d3c6](https://github.com/dormonbear/ultraforce-desktop/commit/960d3c68f481aff28f9c3a7bfcfd0ebf14e391e8))
* **features:** wire AST engine into live apex completion (Phase 6b) ([18d765c](https://github.com/dormonbear/ultraforce-desktop/commit/18d765cba52444c704b0aaa4267bfb80c2dbe389))
* **log-parser:** aggregate hotspots (top methods by self time) ([05ba41e](https://github.com/dormonbear/ultraforce-desktop/commit/05ba41e33eadc269f9783aef433b1036f6e72f34))
* **log-parser:** heap allocation tracking (self-heap per frame) ([f691d75](https://github.com/dormonbear/ultraforce-desktop/commit/f691d75f07ce1aad7025ca57e4e668deaa67458c))
* **log-parser:** pure Apex debug log parser crate ([21f9516](https://github.com/dormonbear/ultraforce-desktop/commit/21f9516a5b5447a8f65a608cbdaafd99bf6750aa))
* **log-parser:** self-time profiling in the execution tree (feature parity) ([6e27429](https://github.com/dormonbear/ultraforce-desktop/commit/6e2742967255dfe018ab781181d1e4d61648760e))
* **log-parser:** SOQL/DML statement extraction + row counts (N+1) ([caa83e5](https://github.com/dormonbear/ultraforce-desktop/commit/caa83e5d8329b00d11ea3fd896de6bb6c152caa3))
* **log:** event filter for the execution tree ([90d37a3](https://github.com/dormonbear/ultraforce-desktop/commit/90d37a34d525225c23818c53651f0f2295b1933e))
* **log:** open local .log file + save viewed log ([9a59698](https://github.com/dormonbear/ultraforce-desktop/commit/9a59698d84020ab8df49145e7da2e0759c947431))
* namespace/managed-package index scoping ([599f29c](https://github.com/dormonbear/ultraforce-desktop/commit/599f29c137b9c2416d94c20cedc6351d2f34ebe3))
* **sf-core:** implement SP0 foundation crate ([0fe3704](https://github.com/dormonbear/ultraforce-desktop/commit/0fe3704e6aac64e08f666a6a91e4d7d10e56b0a5))
* **sf-schema:** composite-REST batch describe primitive ([76f5386](https://github.com/dormonbear/ultraforce-desktop/commit/76f5386f93724d3a41bf2ece08c313eff4dcd0c2))
* **sf-schema:** on-demand object describe with disk+memory cache ([d9a8ffa](https://github.com/dormonbear/ultraforce-desktop/commit/d9a8ffa7439d8f278cc0d371e62b782b76810387))
* **sf-schema:** SchemaStore::get_or_fetch_many batched describe ([d6f57bc](https://github.com/dormonbear/ultraforce-desktop/commit/d6f57bc12d34f1b227a4b55d1f22e068498fe3b4))
* **soql-lang:** multi-hop relationship completion + WHERE operator diagnostics ([6a55051](https://github.com/dormonbear/ultraforce-desktop/commit/6a55051891e446ca19fd7f6c4963e23ca08074c9))
* **soql-lang:** pure SOQL completion and diagnostics thin slice ([96781e5](https://github.com/dormonbear/ultraforce-desktop/commit/96781e5e3e10cb8bf9dd445e0aab32c20b31763e))
* **soql:** All rows toggle (queryAll / --all-rows) ([7cd0247](https://github.com/dormonbear/ultraforce-desktop/commit/7cd0247c403ec6330647e70108876efd21fb8737))
* **soql:** child-subquery completion + diagnostics ([2ff5faf](https://github.com/dormonbear/ultraforce-desktop/commit/2ff5faf8b19a349699fb9532db7803ec052f7b1e))
* **soql:** date-literal completion in WHERE/HAVING ([538ff67](https://github.com/dormonbear/ultraforce-desktop/commit/538ff67511ed6cc220bfcfa964eaf2d52d0bb3c4))
* **soql:** export query results to CSV ([8c230f2](https://github.com/dormonbear/ultraforce-desktop/commit/8c230f2c7c34cc29916dee4816e5a7c9192cae65))
* **soql:** Format Document (one clause per line) ([3111da1](https://github.com/dormonbear/ultraforce-desktop/commit/3111da1a97f1e9a42cfd631ddbb4e919c5a82c35))
* **soql:** offer trailing clause keywords once the FROM object is named ([c55ded7](https://github.com/dormonbear/ultraforce-desktop/commit/c55ded7d2904cb2ae9838b2913edb9cfd6ab6399))
* **soql:** polymorphic relationship completion (union all referenceTo) ([13f63be](https://github.com/dormonbear/ultraforce-desktop/commit/13f63be08ddeca6b558fdd7fa5166d16b352fd5c))
* **soql:** query plan (EXPLAIN) with cost/cardinality ([985bb01](https://github.com/dormonbear/ultraforce-desktop/commit/985bb01f4a59443dd0c7df9961d4ad9876f632f3))
* **soql:** Tooling API toggle for queries ([f2664ad](https://github.com/dormonbear/ultraforce-desktop/commit/f2664ad4fcd07afc9c3465449116c12b15a97921))
* **soql:** TYPEOF (polymorphic SELECT) completion ([1c8f5f7](https://github.com/dormonbear/ultraforce-desktop/commit/1c8f5f700e2557214985af9aa9333cc41d60fc5d))
* **soql:** warn on missing LIMIT + add-LIMIT quickfix ([f898452](https://github.com/dormonbear/ultraforce-desktop/commit/f89845238bd02ecbb665a2354fba6d4ee8f22875))
* **ultraforce:** rebrand + richer completion, persistence, history, logging ([d8cd60c](https://github.com/dormonbear/ultraforce-desktop/commit/d8cd60c1b66a5b27aafd28eac3e463cae741ca86))


### Bug Fixes

* **apex-lang:** mark stdlib properties static so Type.CONST completes ([4b91218](https://github.com/dormonbear/ultraforce-desktop/commit/4b91218289a7bad8f5b4322c11db763233afd934))
* **apex:** complete members on `.` with an empty prefix ([c9214a9](https://github.com/dormonbear/ultraforce-desktop/commit/c9214a9c52f6d9d691474f1483634e45a3920415))
* **desktop:** history open-in-tab writes a scratch file and opens it ([a981c0a](https://github.com/dormonbear/ultraforce-desktop/commit/a981c0a7ec863c73ff10d74d1284641e1b920a32))
* **sf-core:** allow type_complexity on MockRunner handler to keep workspace lint green ([ee8fe1b](https://github.com/dormonbear/ultraforce-desktop/commit/ee8fe1b4e8f57eca833989d7a39fce09d6417481))
* **sf-schema:** describe_object passes --target-org ([085a4c9](https://github.com/dormonbear/ultraforce-desktop/commit/085a4c94d030f89505f9aaa7c4275091c909b28b))
* **soql-lang:** only treat item-start non-call idents as SELECT fields ([0f183e2](https://github.com/dormonbear/ultraforce-desktop/commit/0f183e2101a157ba3ad3abb0fbce714bb1cb2e6e))


### Performance Improvements

* **features:** concurrent sObject describes during org index ([11c4c10](https://github.com/dormonbear/ultraforce-desktop/commit/11c4c10c85472e44924165992bf5e427ed6e373e))
