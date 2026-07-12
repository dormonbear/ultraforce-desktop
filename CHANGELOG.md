# Changelog

## [0.3.12](https://github.com/dormonbear/ultraforce-desktop/compare/v0.3.11...v0.3.12) (2026-07-12)


### Features

* **desktop:** faint background highlight for SOQL subquery ranges ([e7c3e8f](https://github.com/dormonbear/ultraforce-desktop/commit/e7c3e8f5af364167fc8dc6d6b55e3bde0a9090fe))
* **desktop:** field where-used command with sqlite cache ([d581ba2](https://github.com/dormonbear/ultraforce-desktop/commit/d581ba2cbd9a5f405a9f1ad6f22e949d250dba63))
* **desktop:** field where-used panel ([c602c49](https://github.com/dormonbear/ultraforce-desktop/commit/c602c49459dfaa21cca973bf4149adedcb4393d8))
* **desktop:** fjord audit pass — empty states, selection bars, text tiers (phase 4) ([4783aae](https://github.com/dormonbear/ultraforce-desktop/commit/4783aae92ba0b28efaca3a3f49193d3c7d522358))
* **desktop:** fjord dark theme tokens (phase 1) ([e6b34cc](https://github.com/dormonbear/ultraforce-desktop/commit/e6b34cc68e33000ccddad81623a0310e8947d910))
* **desktop:** fjord data-layer table standards (phase 3) ([5f0954f](https://github.com/dormonbear/ultraforce-desktop/commit/5f0954f019664f0e2df4fa99201678c837483148))
* **desktop:** fjord design system, SOQL formatting, indexing fixes ([cf0a0df](https://github.com/dormonbear/ultraforce-desktop/commit/cf0a0dfb252bce21cc36897f4e080d3c30fa2292))
* **desktop:** fjord motion tokens + unified press feedback (phase 2) ([93544e2](https://github.com/dormonbear/ultraforce-desktop/commit/93544e2ef25dc40d3c04aa2579b59e45760edefc))
* **desktop:** in-tab schema deep search ([cf44723](https://github.com/dormonbear/ultraforce-desktop/commit/cf44723f3e3beafe6cbc8f7c1c3d76a095cd2486))
* **desktop:** loading indicator on first label-mode toggle ([598177e](https://github.com/dormonbear/ultraforce-desktop/commit/598177e423e737158fd143e51be1080b444f7318))
* **desktop:** per-org config (api version/timeout/alias/color) + org switcher modal ([80f4d2d](https://github.com/dormonbear/ultraforce-desktop/commit/80f4d2db83f9afe2269a5c55e0dceb2815f7db51))
* **desktop:** rename file from tab context menu ([986811c](https://github.com/dormonbear/ultraforce-desktop/commit/986811c9ccdb282bb4c5527a58d2927bbd1d3fcf))
* **desktop:** schema browse and search commands ([6144c89](https://github.com/dormonbear/ultraforce-desktop/commit/6144c891d401cb1bd8dd64fedfd808e4e0ed22b3))
* **desktop:** schema browser + field where-used ([8fd501b](https://github.com/dormonbear/ultraforce-desktop/commit/8fd501be273d71750786277c22d40d2e7c3d6886))
* **desktop:** schema browser three-pane tab ([12fd2b1](https://github.com/dormonbear/ultraforce-desktop/commit/12fd2b19821cf5ef8c8913237943f7bae20d3e09))
* **desktop:** schema ipc wrappers and types ([20bdb28](https://github.com/dormonbear/ultraforce-desktop/commit/20bdb280f29c6bc4cabb6fc10492238e00f0acc2))
* **features:** field where-used via tooling dependency api ([478fbc4](https://github.com/dormonbear/ultraforce-desktop/commit/478fbc43d7c25152c763cb8681855cb4cdc1e3f5))
* **schema:** add inlineHelpText to field model ([0fd0c1a](https://github.com/dormonbear/ultraforce-desktop/commit/0fd0c1af4e0c365b3a9bacb0851b2c9c5c99ca34))
* **schema:** deep FTS (picklists/help/formula) + field-deps cache, schema v3 ([a88ceba](https://github.com/dormonbear/ultraforce-desktop/commit/a88ceba5e33555c0ae8bf10a1d3a65963e806954))
* **schema:** fts search api with snippets ([0dcc174](https://github.com/dormonbear/ultraforce-desktop/commit/0dcc174f893b57219c71d3edc3d13891a5f37e52))
* **soql:** align wrapped fields under first SELECT field ([d5d9590](https://github.com/dormonbear/ultraforce-desktop/commit/d5d9590e2f4669f63698277831d325ec3b4e3b71))
* **soql:** block-expand long subqueries with fit-based inline threshold ([4b0b84f](https://github.com/dormonbear/ultraforce-desktop/commit/4b0b84f7ab5fca2096b97186a31c508bfe15c6a1))
* **soql:** fill-wrap long SELECT field lists at 80 cols ([5a136c2](https://github.com/dormonbear/ultraforce-desktop/commit/5a136c23c0929a43ea285937542ef14b552e1bcd))
* **soql:** wrap long WHERE/HAVING before top-level AND/OR ([3a404a5](https://github.com/dormonbear/ultraforce-desktop/commit/3a404a5890d11b8435723ed758575efd1a89beab))


### Bug Fixes

* **apex-lang:** index apex_members(type_id) to fix quadratic snapshot load ([b590c84](https://github.com/dormonbear/ultraforce-desktop/commit/b590c842be72c66951b26d86f9fed7560efed0ce))
* **desktop:** gate stale where-used responses and widen disclaimer ([a449436](https://github.com/dormonbear/ultraforce-desktop/commit/a449436f0413d5582cab24cbd2adfb2342bd03eb))
* **desktop:** guard schema browse reads behind shared schema version ([7cd85d5](https://github.com/dormonbear/ultraforce-desktop/commit/7cd85d571f35a3031cd953359f015534e3d5e35e))
* **desktop:** hide reindex button while indexing ([a7c9e55](https://github.com/dormonbear/ultraforce-desktop/commit/a7c9e5598c84ba875338142390fb04e3cad07652))
* **desktop:** scope schema detail cache per org ([218b58d](https://github.com/dormonbear/ultraforce-desktop/commit/218b58d631ce888189c4629cb90984db445eca58))
* **desktop:** single spinner during org indexing ([3398ad7](https://github.com/dormonbear/ultraforce-desktop/commit/3398ad789b475b8bb5fd8fd11b0740ec3ef1258c))
* **desktop:** stable result-grid column widths via table-fixed + one-time auto-fit ([9fee7b8](https://github.com/dormonbear/ultraforce-desktop/commit/9fee7b8538e3df0fee521f9a36025955e0c1a8f5))
* **desktop:** stop native text selection leaking into result grid ([8f65070](https://github.com/dormonbear/ultraforce-desktop/commit/8f65070e488ffee6115b64dcb8ba8742e2085e65))
* **desktop:** trim subquery highlight to text, skip indentation ([cc62d4e](https://github.com/dormonbear/ultraforce-desktop/commit/cc62d4e427f0a8e7b8d62cc8c44517941d98eed7))
* **index:** keep snapshot on api-version detection fallback, trace indexing path ([3462740](https://github.com/dormonbear/ultraforce-desktop/commit/3462740d3dc370c56b85faac9da033b6b1a3e262))
* **schema:** make replace_field_deps atomic ([d658c99](https://github.com/dormonbear/ultraforce-desktop/commit/d658c99844c82747e8a05e0534b177c523bca614))


### Performance Improvements

* **desktop:** eliminate page-switch jank ([0632871](https://github.com/dormonbear/ultraforce-desktop/commit/0632871110065250c102baaf62581bd4f00d9eee))

## [0.3.11](https://github.com/dormonbear/ultraforce-desktop/compare/v0.3.10...v0.3.11) (2026-07-11)


### Features

* **desktop:** advanced filter builder UI (react-querybuilder, pinned 8.20.2) ([d575421](https://github.com/dormonbear/ultraforce-desktop/commit/d5754215cb0d88ac49e986f6b66abdffe6213b24))
* **desktop:** Astryx design system migration (phases 1-5) ([e11ca7b](https://github.com/dormonbear/ultraforce-desktop/commit/e11ca7bc1e3e997e6fa4d0929d1c93ce11303b94))
* **desktop:** child-table lookup + stable row identity in ResultTable ([e5e19c7](https://github.com/dormonbear/ultraforce-desktop/commit/e5e19c7f38a15ad677f412005698e9954a369254))
* **desktop:** default trace flag window ([f67f3db](https://github.com/dormonbear/ultraforce-desktop/commit/f67f3db280fd0304cd98d1c070f750fcbd311bab))
* **desktop:** export button defaults to csv, context menu for formats ([a2d0ba0](https://github.com/dormonbear/ultraforce-desktop/commit/a2d0ba0b56689af831727d1a451055e2b29b82e0))
* **desktop:** export/copy SOQL results as flattened projection of visible rows ([da095b7](https://github.com/dormonbear/ultraforce-desktop/commit/da095b756996e55541b2120cde370b422d875b82))
* **desktop:** flatten view toggle with rel[i].col projection ([d96e849](https://github.com/dormonbear/ultraforce-desktop/commit/d96e8495df8f88ae89524bc47d1765624a4a6b45))
* **desktop:** get/set_telemetry_config commands ([e1489d0](https://github.com/dormonbear/ultraforce-desktop/commit/e1489d0f4de9e3b22aec31e2608626bbe50564cc))
* **desktop:** grouped column visibility for flattened relationships ([18786f6](https://github.com/dormonbear/ultraforce-desktop/commit/18786f6973a1769fb277df6216110bd4b0850938))
* **desktop:** header context menu with quick child-presence filter ([4d30610](https://github.com/dormonbear/ultraforce-desktop/commit/4d30610d608b4a680221e97df607f58aaba69323))
* **desktop:** horizontal column virtualization for wide flattened results ([bd4926a](https://github.com/dormonbear/ultraforce-desktop/commit/bd4926a82b671ddd414ab087604b87305aff9e32))
* **desktop:** inline expandable subquery grids in SOQL results ([0ae87ff](https://github.com/dormonbear/ultraforce-desktop/commit/0ae87ffeddc0df1e81a4c61b52759beab0820115))
* **desktop:** migrate badge/input/tooltip primitives to Astryx ([1251918](https://github.com/dormonbear/ultraforce-desktop/commit/12519189890b67948c8890a57959c7842adb41e0))
* **desktop:** migrate EntityCombobox to Astryx Typeahead, drop shadcn command/dialog ([651de44](https://github.com/dormonbear/ultraforce-desktop/commit/651de442b946fd16028356419cca4f3e741dade7))
* **desktop:** migrate log detail toggle group to SegmentedControl, drop shadcn toggle ([f04fff5](https://github.com/dormonbear/ultraforce-desktop/commit/f04fff58792a8186ddd935c373d9b7bedcb0c7be))
* **desktop:** migrate low-risk surfaces to Astryx with app token bridge ([88b32db](https://github.com/dormonbear/ultraforce-desktop/commit/88b32dba4f44e6580354fbb7a1de365f82e85909))
* **desktop:** migrate menus to Astryx, finish phase 5 leaf migration ([b477ca7](https://github.com/dormonbear/ultraforce-desktop/commit/b477ca72f8e3edab0ff2eb29dcaac075143a09a2))
* **desktop:** migrate OrgSelector to Astryx ([aa5ffec](https://github.com/dormonbear/ultraforce-desktop/commit/aa5ffec26c03e6b5643396ffdfc8b2b5ba0fe7a1))
* **desktop:** migrate remaining shadcn buttons to Astryx ([92e360a](https://github.com/dormonbear/ultraforce-desktop/commit/92e360a65dfb81c076f97bfd4631c7af203bee3b))
* **desktop:** move cell copy to context menu and drop hover tooltip ([3cd4fec](https://github.com/dormonbear/ultraforce-desktop/commit/3cd4fec11e4097f63e99311de0fa2b39c74bcfb4))
* **desktop:** nested child tables in soql projection ([e0dead6](https://github.com/dormonbear/ultraforce-desktop/commit/e0dead665a6250eb02e4f93bc2dea475bf9d0228))
* **desktop:** open exported file from success toast ([c50a013](https://github.com/dormonbear/ultraforce-desktop/commit/c50a01307b69763f377f739c8e243cd555a6654e))
* **desktop:** refine trace flag and timeline UX ([56cf132](https://github.com/dormonbear/ultraforce-desktop/commit/56cf132b9bf997a3e8c2ca9e63500191d66357a1))
* **desktop:** ship typed childTables sidecar over IPC, drop unused tree ([c97adb4](https://github.com/dormonbear/ultraforce-desktop/commit/c97adb4e285a0f90a68f453c71d6f18b48a1d6c1))
* **desktop:** subquery side detail panel replaces inline row expansion ([85dd260](https://github.com/dormonbear/ultraforce-desktop/commit/85dd260bd2225c6fad056034284db7730172364a))
* **desktop:** tab context menu with close operations ([87aad12](https://github.com/dormonbear/ultraforce-desktop/commit/87aad128315fc813ab16c6790a4ba303ac85d236))
* **desktop:** telemetry opt-in toggles + privacy disclosure in Settings ([e6983bc](https://github.com/dormonbear/ultraforce-desktop/commit/e6983bceba031bf2f3ade120cd66c364222733f7))
* **desktop:** toggle result columns between api names and labels ([f881944](https://github.com/dormonbear/ultraforce-desktop/commit/f8819440dff0f9fb53b478b9bf5b85939d7b775d))
* **desktop:** typed child-record filter evaluation wired into SOQL results ([0596f97](https://github.com/dormonbear/ultraforce-desktop/commit/0596f9756ea9087a743435418e6cdf100b2847e3))
* **desktop:** vertical record cards in subquery detail panel ([eaeb9a9](https://github.com/dormonbear/ultraforce-desktop/commit/eaeb9a96bed2d0f352fef2f5ac06e6fcc6b776b6))
* **features:** shared telemetry.json config (local/remote, default off) ([498adb2](https://github.com/dormonbear/ultraforce-desktop/commit/498adb28fd34019dcf23c9f5972d41dd8daa92d9))
* **features:** single-record REST DML + generic rest_request helper ([d87ce19](https://github.com/dormonbear/ultraforce-desktop/commit/d87ce196cd68909870b49aab20441cca267d59d0))
* **features:** typed child-table projection for SOQL subqueries ([9ee7878](https://github.com/dormonbear/ultraforce-desktop/commit/9ee787807583f9da16163f37bd1908577ebd4880))
* headless ost-index bin (offline OST + rich describe per org) ([6e3d8f0](https://github.com/dormonbear/ultraforce-desktop/commit/6e3d8f0983760d425dafdb0c9df71cc13e52cefd))
* headless ost-index bin (offline OST + rich describe per org) ([e080ccd](https://github.com/dormonbear/ultraforce-desktop/commit/e080ccd4a85e4c01925ed48f5b6367536d6280e8))
* **index:** activate schema-version guard for the OST index ([0f84261](https://github.com/dormonbear/ultraforce-desktop/commit/0f84261e3fea981048a0d0921fab341842e979b3))
* **index:** capture Tier-1 field detail (formula, dependencies, record types) ([317df59](https://github.com/dormonbear/ultraforce-desktop/commit/317df5979c2d88a977e79cd6b74d6227c575aee5))
* **mcp:** publish @ultraforce/mcp npm wrapper for uf-ost binary ([d1ef0e0](https://github.com/dormonbear/ultraforce-desktop/commit/d1ef0e08342edd7b2c91a80ba1e3e83b17749392))
* **release:** publish uf-ost MCP binary + ost skill from this repo ([1b40dbc](https://github.com/dormonbear/ultraforce-desktop/commit/1b40dbcdef18c678691892c5e25620dd6e8ef7e2))
* **release:** publish uf-ost MCP binary + ost skill from this repo ([e913e7c](https://github.com/dormonbear/ultraforce-desktop/commit/e913e7ce03acd749e5a446067089047ae04e4eba))
* SOQL subquery display + child-record filtering (sync local main) ([1bfc2c0](https://github.com/dormonbear/ultraforce-desktop/commit/1bfc2c0c96129749337ca5be8c85b274f7079501))
* **soql-lang:** break long select-list subqueries into indented lines ([87f2def](https://github.com/dormonbear/ultraforce-desktop/commit/87f2defec744775bbc1578bdd1e92979f91ce52d))
* **soql-lang:** rank common fields first after SELECT and retrigger after subquery SELECT ([bf3dba7](https://github.com/dormonbear/ultraforce-desktop/commit/bf3dba754034e71c4090d4d1c52c9da7df4e824e))
* SQLite index.db replaces JSON snapshot storage ([a9d9399](https://github.com/dormonbear/ultraforce-desktop/commit/a9d93997934777afb1d6cceed156212229448532))
* SQLite index.db replaces JSON snapshot storage ([8633b8e](https://github.com/dormonbear/ultraforce-desktop/commit/8633b8e39a7f177e93aa18bda595ce844555cde5))
* subquery side detail panel, label toggle, and result-table UX overhaul ([db262e8](https://github.com/dormonbear/ultraforce-desktop/commit/db262e837b72272b5aea9e049a2780e7951d8250))
* uf-ost MCP server crate (Phase 2) ([2597819](https://github.com/dormonbear/ultraforce-desktop/commit/2597819957141f95399877c04fb7e711a44ecaa4))
* uf-ost MCP server crate (Phase 2) ([b81cc37](https://github.com/dormonbear/ultraforce-desktop/commit/b81cc37870b19275dfcf9a04edfde3cc9b7e226c))
* **uf-ost:** apex_run live tool — structured result, distilled debug log ([5fc574c](https://github.com/dormonbear/ultraforce-desktop/commit/5fc574c1270b226d1af9981b5c4cd92bd08bc3ab))
* **uf-ost:** compact ost_object output + offline ost_soql validation ([704b19a](https://github.com/dormonbear/ultraforce-desktop/commit/704b19ad9f83ae691033959ab11818655e9037a8))
* **uf-ost:** gate local telemetry on config; pin field-value redaction ([57a7415](https://github.com/dormonbear/ultraforce-desktop/commit/57a741564eb6a011ce04037629e9111480474faa))
* **uf-ost:** LiveCtx — cached auth, fail-safe prod detection, write gate ([2c3df6f](https://github.com/dormonbear/ultraforce-desktop/commit/2c3df6fc1af82a4f4698f7156e261558994ea9b6))
* **uf-ost:** opt-in Aptabase remote sink (scrubbed props only) ([e44abde](https://github.com/dormonbear/ultraforce-desktop/commit/e44abde5971177a62f215a235292ab137e4c3750))
* **uf-ost:** record CRUD live tools behind prod confirm gate ([b104697](https://github.com/dormonbear/ultraforce-desktop/commit/b104697b71368d6e04a40e1544f3afed2c089cb9))
* **uf-ost:** rest_request escape hatch with write gating ([75aafba](https://github.com/dormonbear/ultraforce-desktop/commit/75aafba27e0279c081e857e58f9bc48aa5c00850))
* **uf-ost:** soql_query live tool — offline pre-validation + row cap ([f89ab25](https://github.com/dormonbear/ultraforce-desktop/commit/f89ab25f98c189fc7e33228531667aa645503566))
* **uf-ost:** surface Tier-1 detail — ost_fields, ost_recordtype, ost_object tags ([1c498c4](https://github.com/dormonbear/ultraforce-desktop/commit/1c498c4e55728c3351be1a454d821869a1640c3f))
* **uf-ost:** telemetry on every tool call + live-tool server instructions ([f08b7b8](https://github.com/dormonbear/ultraforce-desktop/commit/f08b7b8c57dea7fd06d317f0d224c65418796417))
* **uf-ost:** telemetry store — tool_log + org prod-detection cache ([c687e1e](https://github.com/dormonbear/ultraforce-desktop/commit/c687e1efad09202ae027ff5ae0869b6aafad5a76))


### Bug Fixes

* **desktop:** add @types/node so node: builtins type-check in tsc ([7213b16](https://github.com/dormonbear/ultraforce-desktop/commit/7213b1655bc00fa6c6848cf8481fcca31f0e30af))
* **desktop:** add ctrl+arrow word-move keybindings in monaco (macOS) ([d8adcfc](https://github.com/dormonbear/ultraforce-desktop/commit/d8adcfc66d87873665186820aaf687bd37a39f89))
* **desktop:** align filter builder Not checkbox with its label ([4615b4b](https://github.com/dormonbear/ultraforce-desktop/commit/4615b4bf496c9f3a16b6f429a1992cfc9ced2d9b))
* **desktop:** center and enlarge filter builder remove buttons ([950803c](https://github.com/dormonbear/ultraforce-desktop/commit/950803cb86305b7eddee0232d105fbe7fb7b3d9e))
* **desktop:** correct telemetry disclosure — scope cloud-never vs local-only accurately ([37f9616](https://github.com/dormonbear/ultraforce-desktop/commit/37f96163ecb8110b60a80d9ee247062689f23d94))
* **desktop:** flush pending store writes on window close; remove dead code ([49e4a19](https://github.com/dormonbear/ultraforce-desktop/commit/49e4a1930f1dffdd45a28d1bcf59667557b362d9))
* **desktop:** flush-on-close + dead-code cleanup; new e2e coverage ([ec74033](https://github.com/dormonbear/ultraforce-desktop/commit/ec74033b7420b27336a0b96ec385112de450cc7a))
* **desktop:** keep quick child filter working while filter panel is open ([8a5ce91](https://github.com/dormonbear/ultraforce-desktop/commit/8a5ce91114b517f5de8f15b17321df0b96e023c2))
* **desktop:** left-align all result table headers ([d836762](https://github.com/dormonbear/ultraforce-desktop/commit/d8367627985e356a9dfcaa019f2975387051e313))
* **desktop:** migrate telemetry toggles to Astryx Switch after main merge ([0ca3674](https://github.com/dormonbear/ultraforce-desktop/commit/0ca3674b54e7726fe4513842bf6bb885c66738c4))
* **desktop:** resolve labels for flattened child columns ([13289ed](https://github.com/dormonbear/ultraforce-desktop/commit/13289eda25cea9bc04c4bc9d8a922c3cd4afab53))
* **desktop:** scope monaco run shortcuts to their own editor instance ([95b7a9f](https://github.com/dormonbear/ultraforce-desktop/commit/95b7a9f9de42aaadfe9303d558679c93240a1daa))
* **desktop:** size record card field-name column to content ([fd72a32](https://github.com/dormonbear/ultraforce-desktop/commit/fd72a327d85d695db543ff66f8b98cdca56b977f))
* **desktop:** stretch result columns to fill container width ([fb63fe5](https://github.com/dormonbear/ultraforce-desktop/commit/fb63fe5db644b1a1d9e38e51cf94f41401efcbca))
* **desktop:** swap relationship column header in label mode ([7c9e24a](https://github.com/dormonbear/ultraforce-desktop/commit/7c9e24ae896976f49ba1b33f866ba181d1a88203))
* **desktop:** use lucide X icon for filter remove buttons ([ab3f42d](https://github.com/dormonbear/ultraforce-desktop/commit/ab3f42d62e062fe8a22e10e3af99e7dd9b8855ca))
* **features:** map REST errors to SfError::Command, matching soql precedent ([1e84e93](https://github.com/dormonbear/ultraforce-desktop/commit/1e84e93966a1c186f2df458aef1c6de8087dba4b))
* fetch_apex_symbols carries its own 300s timeout ([bfb01ef](https://github.com/dormonbear/ultraforce-desktop/commit/bfb01ef3cf3a81460e76829135d88aa052b43d65))
* fetch_apex_symbols carries its own 300s timeout ([e636f61](https://github.com/dormonbear/ultraforce-desktop/commit/e636f61582ea761c41ec45742c77f677e0736d79))
* monaco word-move keybindings (macOS) + subquery SELECT completion ([e33392f](https://github.com/dormonbear/ultraforce-desktop/commit/e33392fa58afc60fa803e3cf2fe651b75ffaf898))
* ost-index — 300s invoker timeout for heavy ApexClass SymbolTable query ([3336b6e](https://github.com/dormonbear/ultraforce-desktop/commit/3336b6ec945a215303ebc2b156a5d3fb61430505))
* ost-index — 300s invoker timeout for heavy ApexClass SymbolTable query ([87d6fff](https://github.com/dormonbear/ultraforce-desktop/commit/87d6fff89039c45355a0d6a99b874756eaf8eb9c))
* **soql-lang:** offer SELECT keyword inside select-list parens instead of object names ([3509ca7](https://github.com/dormonbear/ultraforce-desktop/commit/3509ca7802800a949d75595bcbcb42dd10df1a5f))
* **soql-lang:** use rfind instead of filter().next_back() (clippy) ([c80fc39](https://github.com/dormonbear/ultraforce-desktop/commit/c80fc396fdb3c510d6530c7bbdfec3b6f1b76949))
* **uf-ost:** allow dead_code on telemetry until live tools consume it ([02e7858](https://github.com/dormonbear/ultraforce-desktop/commit/02e7858756e6698e24d6854e74148a341846acce))
* **uf-ost:** reject dot-segment path traversal in rest_request ([1fca5ac](https://github.com/dormonbear/ultraforce-desktop/commit/1fca5acfa65cd9c19f1d4d194198e7eec33163e7))
* **uf-ost:** resolve clippy 1.97 lints (question_mark, bool_assert_comparison, deprecated rmcp alias) ([973d846](https://github.com/dormonbear/ultraforce-desktop/commit/973d846078bd96e4c197c44c88f3f8f6ad94d658))
* **uf-ost:** soql_query truncation — detect single-page row-cap overflow ([295f96a](https://github.com/dormonbear/ultraforce-desktop/commit/295f96ab1f3c15be5a815675d57f7f1705bb1903))
* **uf-ost:** sync no longer reconcile-deletes expanded Apex types ([e13c908](https://github.com/dormonbear/ultraforce-desktop/commit/e13c9083d23d5e1d4f822722a127fb3be8d86df3))
* **uf-ost:** sync no longer reconcile-deletes expanded Apex types ([7d9ce22](https://github.com/dormonbear/ultraforce-desktop/commit/7d9ce2245acc06a5d9be001372d0fee8b784de68))
* **ui:** dark-mode scrollbars — declare color-scheme and style uf-scroll track ([2a571f7](https://github.com/dormonbear/ultraforce-desktop/commit/2a571f7d8327cdd9970b05c66431dc931a3ac3a8))

## [0.3.10](https://github.com/dormonbear/ultraforce-desktop/compare/v0.3.9...v0.3.10) (2026-07-02)


### Features

* **apex-complete:** carry detail and params through the completion wire ([2da673a](https://github.com/dormonbear/ultraforce-desktop/commit/2da673a521c6510f4b1ae1cbeb1579a69294caf9))
* **apex-complete:** constructor kind after new — call-paren snippets ([d2683a5](https://github.com/dormonbear/ultraforce-desktop/commit/d2683a5c8067d6e993568595f2b0b5cc17bb1c57))
* **apex-lang:** inherited member resolution via parentClass chain ([099afb4](https://github.com/dormonbear/ultraforce-desktop/commit/099afb409971f37970d2a220c7f1798980381f3f))
* **apex-lang:** signature-help engine — enclosing call, overloads, active parameter ([ded53e1](https://github.com/dormonbear/ultraforce-desktop/commit/ded53e1feecbe7ebec4a7f29cc8bab3cfb98f953))
* **apex-lang:** walk parentClass chain and interfaces for inherited member resolution ([db8db59](https://github.com/dormonbear/ultraforce-desktop/commit/db8db5915c9b30a31f444423d0cda50195365d3d))
* **apex:** confirm before running anonymous Apex ([ad7346c](https://github.com/dormonbear/ultraforce-desktop/commit/ad7346ce79b072dd88bcb8dc81c94538073909f5))
* **editor:** Apex signature help — engine command, Monaco provider, post-accept trigger ([1fa3428](https://github.com/dormonbear/ultraforce-desktop/commit/1fa342875260b12fffcf965c00a6f1fccb478cc2))
* **editor:** method call snippets, keyword blocks and Apex language configuration in Monaco ([60e177d](https://github.com/dormonbear/ultraforce-desktop/commit/60e177d2046f83a089eceb4796ba2cde1ad34d9f))
* **editor:** pure Apex insert-text builder — call snippets, void semicolon, keyword blocks ([16612b8](https://github.com/dormonbear/ultraforce-desktop/commit/16612b8dbc5075bf158c09c97ec65e6e6968f320))
* **explorer:** migrate the file tree to headless-tree ([14593cb](https://github.com/dormonbear/ultraforce-desktop/commit/14593cb335698ba6b4ad90521891a17506b24b4c))
* **explorer:** right-click blank area to create file/folder at root ([964cf57](https://github.com/dormonbear/ultraforce-desktop/commit/964cf57ced1e6ff393558d1b58678a79b2fe3906))
* **logs:** explain missing ApexLog access instead of the raw SOQL error ([a23a7cd](https://github.com/dormonbear/ultraforce-desktop/commit/a23a7cd7a4aeebde33f58477b39266c2baf0c015))


### Bug Fixes

* **apex-complete:** default own-class method detail to void for the semicolon snippet ([a1ccad4](https://github.com/dormonbear/ultraforce-desktop/commit/a1ccad44cbaaf532ac7f942e269e711d2a65717b))
* **apex-lang:** satisfy clippy 1.96 (repeat_n; drop unused test import) ([#36](https://github.com/dormonbear/ultraforce-desktop/issues/36)) ([36d0aab](https://github.com/dormonbear/ultraforce-desktop/commit/36d0aab25979bd9c1d6dc9afa660cd6ffaee2c55))
* **explorer:** expand target dir after create so new folders are visible, toast fs errors ([00c4374](https://github.com/dormonbear/ultraforce-desktop/commit/00c437475bb368b99ae311bdd533f8431625100f))
* **explorer:** keep autofocus on name input after context menu closes ([7f2f9e9](https://github.com/dormonbear/ultraforce-desktop/commit/7f2f9e98c8c766bab9cfb94f57bf778f0475c590))
* **logs:** table cell spacing, minimap wheel zoom, rename sf theme label ([d7665e4](https://github.com/dormonbear/ultraforce-desktop/commit/d7665e4fc99746638e400e3f5f7b076e7b16791c))
* **timeline:** hide the spurious horizontal scrollbar ([675ce46](https://github.com/dormonbear/ultraforce-desktop/commit/675ce462ab358156afd02e934896b6ad0b537210))


### Miscellaneous Chores

* release 0.3.10 ([a2051fb](https://github.com/dormonbear/ultraforce-desktop/commit/a2051fba5d560a5eff20fb8dc2a6e524df5b3a55))

## [0.3.9](https://github.com/dormonbear/ultraforce-desktop/compare/v0.3.8...v0.3.9) (2026-07-01)


### Features

* **settings:** add a GitHub repo link in About ([4bb414c](https://github.com/dormonbear/ultraforce-desktop/commit/4bb414c0df939de18fbaf1e58c9b1cbe85c79bc7))
* **settings:** add a GitHub repo link in About ([cc7b164](https://github.com/dormonbear/ultraforce-desktop/commit/cc7b1643be80966c290c615cca8e5a39694eb4b4))

## [0.3.8](https://github.com/dormonbear/ultraforce-desktop/compare/v0.3.7...v0.3.8) (2026-07-01)


### Features

* **editor:** selectable syntax highlighting schemes with live preview ([f5b4cb5](https://github.com/dormonbear/ultraforce-desktop/commit/f5b4cb5bea08d0c2218b1c471110750ec3ef39f8))
* **log:** add start_ns to frontend ExecNodeDto type ([64e7e71](https://github.com/dormonbear/ultraforce-desktop/commit/64e7e71b4a16bd2dc475d8b6ea2eb52a376dd628))
* **log:** configure logging inline in the panel; format trace-flag dates ([2124b4c](https://github.com/dormonbear/ultraforce-desktop/commit/2124b4cb39c7c3cc0d8fc742f58ba27cdd6179a5))
* **log:** drag the timeline minimap to scrub the viewport ([9286581](https://github.com/dormonbear/ultraforce-desktop/commit/92865819cc25b2dd35c0b3891d785450487abc49))
* **log:** drag-drop to open logs, right-click to save; disable source nav for org-less logs ([71be24e](https://github.com/dormonbear/ultraforce-desktop/commit/71be24ebeefbd339a6915b9b483fcdf9c774d6b6))
* **log:** expose start_ns on ExecNodeDto for flame chart ([4ecc19a](https://github.com/dormonbear/ultraforce-desktop/commit/4ecc19a179d9e2b591a8f1efc7067bd68ceb44fc))
* **log:** flame layout + geometry helpers ([915b2cd](https://github.com/dormonbear/ultraforce-desktop/commit/915b2cd29b35ca2c42ed1136f5c05157b095613b))
* **log:** flame-chart timeline tab (base render) ([093bed7](https://github.com/dormonbear/ultraforce-desktop/commit/093bed7a0b6abc2d2e9b073396ecedea7bb5c872))
* **log:** flameColor helper ([28bcbae](https://github.com/dormonbear/ultraforce-desktop/commit/28bcbae011d4dd7203c44935bdf6dffa4b63cbc9))
* **log:** one-click 30-minute self-trace button ([1a2ca1a](https://github.com/dormonbear/ultraforce-desktop/commit/1a2ca1ad0f3cc63e3107c0070d646d87a39760fd))
* **log:** only mark source-resolvable raw lines as clickable ([6bee501](https://github.com/dormonbear/ultraforce-desktop/commit/6bee50138fe6c8922edd842d80c4c32e26b24114))
* **log:** query-family bars via fingerprinting in queries view ([5edd8c1](https://github.com/dormonbear/ultraforce-desktop/commit/5edd8c16d2e08140bc8cfc6ac4f9d5ad4d01f2ca))
* **log:** remove debug tab (USER_DEBUG still visible in raw) ([05499aa](https://github.com/dormonbear/ultraforce-desktop/commit/05499aad6bd69c1f69bf51c5f64adf9733c277ec))
* **log:** remove execution-tree tab (superseded by timeline flame chart) ([08c1bba](https://github.com/dormonbear/ultraforce-desktop/commit/08c1bbafb6b2d81157c2b1e59f34d7183785ccca))
* **log:** searchable trace-flag pickers, org debug-level presets & self-trace countdown ([8f89b51](https://github.com/dormonbear/ultraforce-desktop/commit/8f89b51da8cb83186e7cad2a3e4aaa0c6234d812))
* **log:** self-time share bars in hotspots view ([4031ad2](https://github.com/dormonbear/ultraforce-desktop/commit/4031ad2010f720e449a9aafe268e00ccb62034ac))
* **log:** soqlFingerprint + query-family grouping ([e580eff](https://github.com/dormonbear/ultraforce-desktop/commit/e580effcc78b0448bc92992b7169c5a42cf04a4d))
* **log:** time-breakdown stacked bar in analysis panel ([900f5b2](https://github.com/dormonbear/ultraforce-desktop/commit/900f5b2ded054cb80875865aed184c4f57a9be07))
* **log:** timeBreakdown data module ([bb7a6da](https://github.com/dormonbear/ultraforce-desktop/commit/bb7a6da1ad4358aa51b31cde3d506b9c36633c8c))
* **log:** timeline click-to-source ([05fb340](https://github.com/dormonbear/ultraforce-desktop/commit/05fb3402ed00899c7cbd0818642608071aa8857a))
* **log:** timeline hover tooltip ([662b131](https://github.com/dormonbear/ultraforce-desktop/commit/662b13144091b228a521cca9e78b32c354653d67))
* **log:** timeline minimap with viewport lens ([1582d6d](https://github.com/dormonbear/ultraforce-desktop/commit/1582d6df4bf1752373234c754bfecb9641dbbc72))
* **log:** timeline shift-drag measure ([5531468](https://github.com/dormonbear/ultraforce-desktop/commit/553146852507528a91e3f178e5749babda46f26b))
* **log:** timeline zoom and pan ([692de19](https://github.com/dormonbear/ultraforce-desktop/commit/692de19f835093d707551f6da4728d4dc624880c))
* **log:** trace-flag UX, org presets, syntax themes & UI polish ([4535d4c](https://github.com/dormonbear/ultraforce-desktop/commit/4535d4ca57792d44985ac17affe2b1eda6a12485))
* **settings:** add Settings entry to command palette ([b05f9a7](https://github.com/dormonbear/ultraforce-desktop/commit/b05f9a7a5fe8399906da86baa52982cc53d1bae1))
* **settings:** add SettingsPage with appearance, workspace, indexing, about ([c297821](https://github.com/dormonbear/ultraforce-desktop/commit/c297821f6fb370f835004e4bdd260e8f8e278965))
* **settings:** dedicated Settings page in bottom-left rail ([662b57a](https://github.com/dormonbear/ultraforce-desktop/commit/662b57a0a3480f6de525f9a36673f284450ef21a))
* **settings:** move config to bottom-rail Settings page, drop top-bar gear and theme buttons ([2bde828](https://github.com/dormonbear/ultraforce-desktop/commit/2bde8280fd3891a34cc59b2b0b82d76f26f34a99))
* **soql:** drop tree view, inline query options, explain highlight + loading ([671ad48](https://github.com/dormonbear/ultraforce-desktop/commit/671ad4898aaea9b3311e46e55ab9bcd873683c32))
* **ui:** brand Lottie loader, unified native-select skin, clearer dark scrollbar ([71b8af9](https://github.com/dormonbear/ultraforce-desktop/commit/71b8af9a826c37bdf363a782c1a939fd7ce3faf1))
* **ui:** Salesforce-blue theme, frameless title bar, export & Apex history, jobs-aesthetic polish ([577b693](https://github.com/dormonbear/ultraforce-desktop/commit/577b69388c1ff707aa9e79112b5e2b5cb316a856))


### Bug Fixes

* **log:** drop Monaco Command Palette from read-only source viewer ([c0e4aa3](https://github.com/dormonbear/ultraforce-desktop/commit/c0e4aa3115e9556a98767f2f3dbdab6213f7b72a))
* **log:** redraw flame canvas on resize so labels don't scale with width ([98ceaf9](https://github.com/dormonbear/ultraforce-desktop/commit/98ceaf909e9e83874e5e40000292189c369e3b9b))
* **log:** statement/method column fills width in queries & hotspots tables ([c66b813](https://github.com/dormonbear/ultraforce-desktop/commit/c66b8135277665144514d349c2c0fc7b1ae645e3))
* **log:** timeline hit-test scroll offset, measure-vs-click, passive wheel; drop dead query exports ([175f3f1](https://github.com/dormonbear/ultraforce-desktop/commit/175f3f11601777996307f33e991941976c95ec08))
* **settings:** keep tool panels mounted behind Settings; fix reindex success toast on failure ([9acbf0e](https://github.com/dormonbear/ultraforce-desktop/commit/9acbf0e4f21b2bb488fc3e54c741a9bfc3a46d95))

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
