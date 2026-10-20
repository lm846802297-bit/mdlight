# mdlight — 方案定稿

> **定位**：轻量流畅的 Markdown 阅读与转换器 —— 大文档流畅不卡、全格式数学、
> PDF/LaTeX 双向互换。
> **状态：✅ 已实现并通过验证** —
> 多格式数学（AsciiMath / MathML）、PDF/LaTeX → MD 一键导入已合入。
> 一个从零实现的开源本地 Markdown 阅读器。架构思想参考业界公开工程模式
> （本地服务器 + WebView 壳 + 内嵌前端资源 + SSE 热重载 + 行号埋点），**不包含任何
> 闭源第三方代码**——所有组件开源、所有代码从零编写。零遥测、零联网运行时、无授权锁。

## 1. 决策记录

| 决策点 | 结论 | 理由 |
|---|---|---|
| 运行时 | **Node.js ≥18，单文件分发** | 本机工具链实情：node 24 在，cargo/dotnet 没有。零原生依赖 = `npx mdlight file.md` 即用 |
| 窗口形态 | **浏览器 + Edge `--app` 模式** | Windows 必有 Edge；`--app` 无地址栏，视觉上就是原生窗口。不做 Rust/wry 原生壳（无工具链），留作后续增强 |
| 渲染核心 | **markdown-it 14**（MIT） | CommonMark 严格模式：代码块内不解析任何 span/inline——**从解析器层面根除"代码块里的 `$` 被误判成公式"**（同类软件常见缺陷 #1） |
| 公式 | **KaTeX 0.16.22 + mhchem**，**服务端渲染** | 引擎与 20 个 woff2 字体全部离线内置（同类软件常见缺陷 #4：首用需联网下载）。服务端渲染 = 打印/导出/无 JS 环境都正确 |
| 高亮 | **highlight.js 11**（MIT），服务端 | 同上，离线 |
| 定制语法 | 重写，不做兼容复制 | callout（`> [!NOTE]` 系）、任务列表、上标 `^x^`、插入 `++x++`、`==标记==`、`[[wikilink]]`（Ctrl+点击复制链接语法）、**mermaid 图表按需加载**（v0.4.0，见 §5 的实测与取舍） |
| 目录路由 | 仅 `/`、`/assets/*`（含 `/assets/mermaid/*`）、`/api/source`、`/api/save`、`/api/open-editor`、`/events`（SSE） | 同类软件动辄 70+ 路由，这里精简 94%：没有遥测/授权/支付/反馈路由——**缺陷修复 #5：零遥测、零联网运行时**。v0.3.0 新增的 `/api/source`+`/api/save` 与 v0.4.0 的 mermaid chunk 路由都只服务本机页面，不产生任何外发流量 |
| 行号定位 | `<!--MDL:line-->` 埯点 → `data-mdl-line` 属性 | 借鉴业界通用的行号埋点模式（公开工程实践），实现方式自研：仅对**非围栏内**的行埋点 |
| 导出 | `--export` 单文件 HTML，图片→base64 内联 | 借鉴业界通用导出思路；样式/字体全内联，单文件到处发（同类软件同理，但我们的不带 utm 跟踪参数——缺陷修复 #6） |
| 缺陷修复对照 | 见 §3 | 逐条对应同类软件的常见缺陷 |
| 内置源码编辑器 / **直接编辑** | 源码视图（`Ctrl+E`，**v0.7.1 并入 WYSIWYG 工具栏**）+ **WYSIWYG 直接编辑（v0.7.0，✍ / `Ctrl+Shift+E`）** | 先质疑"没有外部编辑器怎么办" → 做源码面板（textarea + `POST /api/save` + sha256 冲突检测）。用户随后追问"能不能直接编辑"，发现传统方案那 14 文件的复杂度主要来自**光标保持 + 自建撤销栈 + 精确 DOM↔源码双向映射**，而我们可裁掉：不维护渲染状态，只用 `contenteditable` + 工具栏 DOM 命令 + 一次"DOM → markdown"序列化（`ui/mdserial.js`）+ 一次 save。工程量从"再造半个 mdlight"降到一个小模块，于是真做了（而非永远"留作后续"）。**v0.7.1 收敛**：源码编辑器原本独占顶栏"源码"按钮，与 ✍ 是两个改同一文件的入口，语义混淆 → 去掉顶栏独立按钮，源码降级为 WYSIWYG 工具栏里的"源码"视图切换（`data-cmd="source"`），复杂公式/表格在 WYSIWYG 里不可靠时切过去精确改。顶栏编辑入口从 2 并成 1（✍） |
| 保存冲突 | **sha256 比对 → 409 询问** | 编辑器打开期间文件被外部改过（另一窗口/同步盘/工具）：`base` 与磁盘当前 sha 不符时拒绝写入，前端弹"覆盖 / 重新加载 / 取消"，避免静默覆盖用户的外部改动 |
| mermaid 加载时机 | **运行时按需**，不做构建期全量内联 | 全量内联 1.42 MB gzip，**且没有任何图表的文档也要背这个成本** —— 与"轻量离线"直接冲突。改为：服务端出占位 → 浏览器仅在页面存在 `<x-mermaid>` 时才 import 引擎 → 引擎按图表类型切成 106 chunk，只取用到的。无图表的文档零成本。代价是"有图表时至少要下约 700 KB 共用运行时"，属 mermaid 结构性开销 |
| mermaid 渲染位置 | **客户端渲染**，服务端只出占位 | `mermaid.render()` 在 Node 下抛 `document is not defined`。服务端渲染 SVG 需要 jsdom（额外依赖 + 与真实浏览器渲染有差异），不值得 |
| mermaid 渲染失败 | 显示源码 + 具体报错，并**关掉 mermaid 自己的报错图** | 与缺陷 #2 同一原则：失败要说明原因，不允许出现空白框。另外 mermaid 默认会在文档末尾追加一张 "Syntax error" 炸弹 SVG，与我们的错误卡片重复且观感像崩了 —— 截图检查才发现，已用 `suppressErrorRendering: true` 关闭，并加断言"页面无游离报错 SVG" |
| 前端测试方式 | **CDP 驱动真实 Edge**，不只测 HTTP 接口 | 这个决定抓到了两个接口测试永远发现不了的缺陷：① `<script src>` 排在编辑器标记之前 → `getElementById` 为 null 抛异常 → **整页交互全死**（含刚做完的内置编辑器）；② ☰/◐ 按钮从未绑定 click。教训：DOM 环境必须真跑浏览器 |
| 资源访问（Node 版） | **统一 `readAsset(key)` 取件层**，全部走磁盘 | 两种运行布局（项目根 / dist 目录）用同一个函数收敛。`tools/build.mjs` 会把磁盘回退路径里的 `join(__dirname, 'node_modules', ...)` 静态替换成 `__here('assets/...')`，让 dist 布局也能从 `dist/assets/` 找到字体 |
| exe 无参数行为 | **弹原生文件选择框**，不打印帮助 | 双击 exe 时没有参数，原逻辑会打印帮助并退出 1 —— 对双击用户等于"什么都没发生"。改为弹 WinForms `OpenFileDialog`（PowerShell 内置，零依赖）；拖拽 `.md` 到 exe 上由 Windows 直接传参，同样可用。`MDLIGHT_PICK=<path>` 供自动化跳过对话框 |
| 原生窗口（v0.6.0） | **C# + WebView2**，替代 Rust/wry | cargo/dotnet CLI 本机不可用，但 **`csc.exe`（.NET Framework 编译器）随 Windows 自带、WebView2 运行时 Win11 内置/Win10 一般已装**——两者都不需要额外安装，也无 Rust 工具链门槛。C# 只做"窗口 + HttpListener + 文件监听 + 磁盘 I/O"，渲染仍走 JS → 产物体积 6.8 MB |
| 渲染位置双轨（v0.6.0） | **Node 版服务端渲染 / native 版浏览器端渲染，产出必须逐字节一致** | 同一份 `core/renderer.mjs`：Node 路线在服务端跑，native 路线用 esbuild 打成浏览器 bundle（`renderer.js` 609 KB）在 WebView2 里跑。两条路共享同一套 KaTeX/hljs/mermaid 语义，若出现分歧会让"同一文档两种打开方式结果不同"。`test/parity-check.mjs` 用同一 headless 浏览器读取两路 DOM 断言结构与统计全同（12 项全绿）——过程中修过一处服务端统计子串匹配 bug（`x-equation` 误数闭标签 ×2、`mdl-math-error` 命中 4 个类名 ×4），对齐到客户端的 DOM 计数 |
| 安全加固（v0.7.1） | **同源校验守全部 `/api/*` + `/events`**，保存/配置写入加锁 | `127.0.0.1` 只挡住远端，挡不住**同机任意网页**发起的 CORS 简单请求（`text/plain` 无预检）——此前任何站点都能 POST `/api/save` 覆盖用户正开着的文档。校验规则：`Sec-Fetch-Site` 必须 `same-origin`/`none`，带 `Origin` 时必须等于自己的端口，否则 403。同轮修的 `Doc.Save` 并发（固定 tmp 名 + 先删原件的 fallback 可能真删掉文档）改为加锁 + GUID tmp + 永不先删原件；`Config.Set` 同理。每条都有 `test/harden-check.mjs` 回归（22 项，覆盖 Node/native 两条路线） |
| native 渲染性能（v0.7.1） | **Web Worker 离线程渲染 + 渐进占位**，主线程不被 KaTeX 阻塞 | native 端无 Node，只能靠浏览器渲染——文档一大会卡死主线程（白屏、无法滚动）。把整条管线（markdown-it + KaTeX `renderToString` + hljs）搬进 Web Worker：这些全是**纯字符串工作、不碰 DOM**，天然能在后台线程跑。先往 `<pre class="mdl-source-preview">` 塞 markdown 原文让浏览器 paint 一帧（用户立刻看到文档已加载），再异步跑 Worker、`innerHTML` 替换。**实测（745 KB / 12000 公式，native exe + headless Edge）**：渲染 5.6 s 期间主线程 37 帧、36 帧 <20 ms（可滚动可交互），而同步渲染全程 0 帧白屏；剩的约 967 ms 单次长帧是浏览器解析 27 MB 渲染结果的硬成本。实现：`ui/renderer-worker.js`（`importScripts` 加载 `renderer.js`，esbuild IIFE 的 `MDLRenderer` 全局在 Worker 里同样成立）+ `app.js` 的 `renderInWorker()`（**缓存 Worker 复用**、请求 ID 丢弃过期响应、60 s 超时回退同步）。file:// 导出的单文件因 CORS 无法用 Worker，`data-live` 为假时直接走同步渲染 |
| PPT 演示模式（v0.8.0） | **Marp 语法：frontmatter `marp: true` + `---` 分页**，F5 全屏放映 + 演讲者 HUD | 同类软件把幻灯片做成独立渲染管线（Typst/PDFium）。我们只做最薄的一层：复用同一渲染器，frontmatter 声明后按 `---` 切页，阅读模式显示全部页，放映模式全屏逐页 + 页脚宏 + 计时器。不引入任何新依赖 |
| 多格式数学（v0.9.0） | **LaTeX / AsciiMath / MathML 三写法全部渲染为 KaTeX** | 定位"完整渲染所有数学公式、兼容多种格式"。在 markdown-it 解析前加一道同步预处理器 `preprocessMathSync`（`core/mathfmts.mjs`）：AsciiMath（反引号`` `x^2+1` ``）→ LaTeX、MathML（`<math>…</math>`，含 display block / 分数 / 上下标 / 根号）→ `$$...$$` / `$...$`。反引号内若含 `\(`/`\)`/`\[`/`\]`/`$` 视为代码不转换，保住"代码永不误判为公式"（缺陷 #1）。零新运行时依赖（asciimath-to-latex 仅 Node 开发期用，浏览器回退内置子集） |
| 一键导入 PDF/LaTeX（v0.9.0） | **⇣PDF / ⇣TeX 转 Markdown**（`/api/import-md`） | 定位"支持一键导入 PDF 和 LaTeX 直接转 md"。转换在客户端完成：LaTeX→MD 用 `core/latex2md.mjs`，PDF→MD 用 **零依赖纯 JS PDF 文本提取器** `core/pdf2md.mjs`（对象表扫描 + FlateDecode + 文本算子 Tj/TJ/Td/Tm，不打包 36MB 的 pdfjs-dist，保住 7MB 单 exe 轻量定位）。转换结果 POST 到 `/api/import-md` 写入 doc 目录并立即交换为当前文档。中文 identity-H/CID 字体系抽取边界，给出 warnings 而非崩溃 |
| 自更新（v0.9.0） | **exe 启动后台检查更新 + 右键「检查更新」+ `--update-check`**（`native/Updater.cs`） | 定位"用 exe 打开就能检查/自动更新"。默认查询 GitHub Releases API 比较版本（`tag_name` + `assets[].browser_download_url`），`.NET Framework 4` 需显式 `ServicePointManager` 启用 TLS 1.2。发现新版 → 页面确认 → `/api/update-apply` 下载新 exe → 写 .cmd 等待进程退出后替换并重启（Windows 不允许覆盖正在运行的 exe）。更新源可经 `updateUrl`/`updateDownloadUrl`+`updateVersion` 配置（私有仓库/内网）。启动自动检查用 `updateCheckOnStart`（默认 true）开关 |
| .md 绑定（v0.9.0） | **exe 内一键绑定/解绑 .md 文件**（`/api/bind`/`/api/unbind` → `Shell.Install/Unbind`） | 定位"也做 mdview 的 md 绑定功能"。`Shell.cs` 已有 HKCU 免管理员注册（`.md` 默认关联 + 右键「用 mdlight 打开」+ `PrevDefault` 记忆旧关联回滚）；此次把 CLI 能力接进 UI：右键菜单「绑定/解绑 .md」+ 独立路由，双击 `.md` 默认用 mdlight 打开 |


## 2. 架构

```
┌──────────────┐    启动     ┌─────────────────────────────┐
│ mdlight.mjs  │ ──────────▶ │ http://127.0.0.1:随机端口/  │  ← 仅监听环回
│ CLI 入口      │   Edge --app│  ┌───────────────────────┐  │
└──────────────┘   或浏览器    │  │ renderer.mjs          │  │  ← 服务端渲染管线
                               │  │  1. 读文件 UTF-8(带BOM检测)│
                               │  │  2. 行号埋点(非围栏行)     │
                               │  │  3. markdown-it 解析     │
                               4. CJK-in-math 包裹 \text{}  │
                               5. KaTeX 服务端渲染 x-equation │
                               6. hljs 高亮代码块           │
                               └───────────┬───────────┘  │
                                           │ HTML         │
┌──────────────┐  fs.watch    ┌────────────▼───────────┐  │
│ watcher.mjs  │ ──────────▶ │ /events (SSE) 广播 reload│  │
└──────────────┘              └────────────────────────┘  │
前端: /assets/app.css + app.js（TOC 折叠/主题切换/打印/
      滚动保持/F2 打开外部编辑器 ${file}:{line}/公式错误卡片/
      内置源码编辑器 Ctrl+E → GET /api/source → Ctrl+S → POST /api/save）
      native 端：app.js 把 markdown 原文先渲染进 <pre> 占位，再把整条
      渲染管线交给 /assets/renderer-worker.js（Web Worker）后台跑，
      完成后 innerHTML 替换——主线程不被 KaTeX 阻塞。
```

三种等价入口（同一份渲染内核，靠 `readAsset()` / `Assets.cs` 收敛资源访问）：

```
node mdlight.mjs 论文.md        开发：读项目根的 ui/ + node_modules/；服务端渲染
node dist/mdlight.mjs 论文.md   发行：读 dist/ui + dist/assets + dist/mermaid（1.2 MB）；服务端渲染
dist/native/mdlight.exe 论文.md 开箱即用（主路线，6.8 MB）：C# 原生窗口宿主，
   └─ 资源全部内嵌（ui/assets/mermaid/renderer.js）；WebView2 里浏览器端渲染
```

**渲染位置**：Node 两条路线在服务端用 `core/renderer.mjs` 渲染出 HTML 再下发；
native 路线把同一份 renderer 用 esbuild 打成浏览器 bundle（`renderer.js`，609 KB），
页面由 WebView2 里的 JS 渲染（`clientRender`）。两路产出**逐字节一致**——
由 `test/parity-check.mjs` 断言（同一 headless 浏览器读取两路 DOM，结构与统计全同）。

## 3. 同类软件常见缺陷 → 修复设计（核心交付）

| # | 同类软件的常见缺陷 | mdlight 修复 |
|---|---|---|
| 1 | `$…$` 在代码块/行内代码里仍被 md4x 误判为公式 | **CommonMark 分层解析**：代码块（fenced/indented/inline code）内容在 token 层就是 code type，公式插件仅处理非 code token——结构性根除 |
| 2 | 公式渲染失败只整坨标红显示源码，不告诉原因 | **公式错误卡片**：粉色卡片显示原始公式源码（等宽）+ KaTeX 具体报错（如 "Undefined control sequence: \fg"）+ 一键复制，红线标注"Error: ..." |
| 2b | 公式内中文导致 KaTeX 报错标红 | **CJK 自动包裹**：预扫描公式源里的 CJK 字符，整体包进 `\text{}`（显示模式部分进一步处理），包裹后重试渲染；仍失败才显示错误卡片 |
| 2c | 无 \newcommand 等宏定义支持（同类软件普遍没做） | 公式源预扫描 `\newcommand/\renewcommand/\def`，提取后 strip 掉再渲染，宏名进入 KaTeX 厽令白名单（有限的、内存宏表） |
| 3 | 会员/编辑器功能通过 HMAC 授权锁 + 镜像恢复逻辑 | 无会员、无授权、无 Pro——全部功能直接可用 |
| 4 | KaTeX/Mermaid/highlight 首次使用需联网下载引擎 | **全离线**：引擎 + 字体 + 高亮全部内置于单文件；断网可用 |
| 5 | 遥测上报设备指纹/赞助状态/篡改标志到 ml-smarttech.com | **零遥测、零运行时联网**：没有相关代码；README 明示网络行为 |
| 6 | 导出 HTML 带 utm_source=export 跟踪参数 | 导出文件零跟踪参数 |
| 6b | 导出依赖网络字体（KaTeX 未内嵌时） | 导出把 KaTeX CSS + 字体全量 base64 内嵌 → 单文件离线打开（常见实现仅图片内联） |
| 7 | **AI 方言定界符 `\(...\)` / `\[...\]` 完全不认**（反斜杠被转义吃掉，连公式节点都不生成；AI 生成的审稿文档全部失效） | 解析器级支持：inline 规则插在 `escape` 之前截住、block 规则接独立显示块；代码块/行内代码内保持字面 | 
| 8 | 用户没有外部编辑器（无 VS Code/Notepad++ 等），F2 的探测链终点只有记事本 | **内置源码编辑器**（v0.3.0）：`Ctrl+E` 打开源码面板直接编辑；`GET /api/source` + `POST /api/save`；sha256 冲突检测 → 409 询问"覆盖 / 重新加载 / 取消"，绝不静默覆盖外部改动。**v0.7.0 再加 WYSIWYG 直接编辑**（✍ / `Ctrl+Shift+E`）：点预览段就地改字、16 按钮工具栏（撤销/重做/标题/粗斜删除线/行内代码/列表/引用/公式/链接/图片/表格）、`ui/mdserial.js` 把 DOM 序列化回 markdown 且**保留公式/代码/mermaid/callout 块**、Ctrl+S 保存即重载 |
| 9 | mermaid 图表完全不被识别，` ```mermaid ` 只当普通代码块 | **按需 mermaid**（v0.4.0）：识别 37 种图表类型；文档无图表则**零额外下载**，有图表只取对应 chunk；服务端出占位、客户端渲染（`render()` 需 DOM）；渲染失败显示源码 + 具体报错，不出现空白框（与缺陷 #2 同一原则） |

## 4. 文件规划

```
mdlight/
├── mdlight.mjs          # CLI 入口 + HTTP 服务器 + SSE + /api/source + /api/save
│                        #   + /assets/mermaid/*（按需图表 chunk，带目录穿越防护）
│                        #   + readAsset() 取件层（项目根 / dist/ 走磁盘，build.mjs 做路径重写）
├── core/
│   └── renderer.mjs     # 渲染管线（行号埋点→md-it→宏提取→KaTeX→hljs）
│                        #   ` ```mermaid ` → <x-mermaid> 占位（服务端不渲染 SVG）
├── ui/
│   ├── index.html       # 单页壳（TOC 侧栏/文章区/顶栏/源码编辑面板）
│   ├── app.js           # 前端行为（SSE 重载/滚动保持/主题/打印/F2/内置编辑器）
│   │                    #   + 按需 mermaid：仅页面有占位时才 import，主题切换重渲染
│   └── app.css          # 全部主题样式（亮/暗/打印/编辑面板/图表与错误卡片）
├── bin/
│   └── mdlight.bat      # Windows 启动器（优先 dist\mdlight.exe，无则回落 Node）
├── native/
│   ├── Program.cs        # 入口：CLI 解析 / 附加控制台 / export / 双击文件选择
│   ├── NativeWindow.cs   # WinForms + WebView2 窗口（profile 存 %LOCALAPPDATA%\mdlight）
│   ├── Server.cs         # HttpListener 环回服务：/api/doc /api/source /api/save(sha256 冲突)
│   │                    #   /api/export /events(SSE) /assets/* /assets/mermaid/* 图片服务
│   ├── Assets.cs         # pack.bin 读取器（MAGIC+index+payload，全资源内嵌）
│   ├── Page.cs           # 页面模板（clientRender:true）
│   ├── Doc.cs            # 保存：File.Replace 原子落盘
│   ├── Exporter.cs       # 单文件 HTML 导出（内联 renderer/字体/图片）
│   └── Util.cs           # sha256 / JSON 转义 / MIME / BOM 读取
├── test/
│   ├── smoke.mjs            # 51 项渲染断言
│   ├── macro-check.mjs      # 宏展开验证
│   ├── mermaid-check.mjs    # 25 项：占位/kinds.json/按需 chunk 路由/穿越防护
│   ├── mermaid-browser.mjs  # 19 项：CDP 驱动 Edge 验证懒加载真的生效（可选）
│   │                        #   MDLIGHT_LAUNCHER=dist/native/mdlight.exe 可跑在 exe 上
│   ├── dist-standalone.mjs  # 17 项：dist/ 无 node_modules 独立运行
│   ├── native-check.mjs     # 45 项：exe 资源/渲染/编辑器/SSE 重载/导出（CDP 真实浏览器）
│   ├── parity-check.mjs     # 12 项：Node 服务端渲染 vs native 浏览器渲染逐字节一致
│   ├── fixtures/        # E2E 演示文档 smoke.md、mermaid.md
│   └── out/             # smoke.mjs 生成的临时用例
├── tools/
│   ├── build.mjs        # esbuild 打包 → dist/mdlight.mjs 单文件
│   ├── build-mermaid.mjs# mermaid 按需包 → dist/mermaid/（splitting + kinds.json）
│   ├── build-native.mjs # 主路线：renderer.js bundle + pack.bin → csc 编译 → dist/native/mdlight.exe
│   ├── fetch-webview2.mjs # 构建期从 NuGet 拉 WebView2 SDK（仅开发机需要，不进发行包）
│   └── shot-mermaid.mjs # 截图工具：渲染 mermaid.md 并截图（视觉验证图形/错误卡片）
└── dist/                # 发行版：单文件启动器 + assets/ + ui/ + mermaid/ + native/mdlight.exe
```

构建顺序：`npm run build:mermaid && npm run build && npm run build:native`（build-native
内部会重新打 renderer.js bundle、打包 pack.bin、调 csc 编译并嵌入资源）。构建期不需要
任何 npm 依赖（esbuild 之外）；最终用户拿到的 `mdlight.exe` 不依赖任何外部包。

## 5. 范围外（诚实声明）

- **mermaid 图表**：**已实现（v0.4.0）**，采用**运行时按需**方案。实测数据（mermaid 12.2.0，2026-10-18）：

  | 口径 | 实测 |
  |---|---|
  | `node_modules` 解包 | 198.7 MB |
  | mermaid 包本体 | 116.7 MB（其中 116.6 MB 是 `dist/`，含 ~50% `.map`） |
  | **全量 esbuild 打包（minify）** | **5.01 MB** |
  | **全量打包（gzip）** | **1.42 MB** |
  | 41 个 diagram chunk（未压缩合计） | 2.12 MB |
  | 单个 flowchart chunk 独立打包 | 3.18 MB minify / 937 KB gzip |

  结论修正：早期写的"~84MB"是错的（真实磁盘占用 122–199 MB，取决于是否计入依赖树）。但**全量打包在阅读场景下仍然偏重**——1.42 MB gzip 是现有 417 KB 导出件的 3.4 倍，而且**一份完全没有图表的文档也要背这个成本**，这才是真正的冲突点。

  **最终采用的方案**（把"要不要 mermaid"从构建期决策变成运行期决策）：

  1. `tools/build-mermaid.mjs` 用 esbuild `splitting: true` 产出 **106 个 chunk**：入口静态闭包 20 文件/696 KB（d3/dagre 等共用运行时），**57 个图表 chunk 全部是动态 import，0 个进入静态闭包** —— 实测确认所有图表类型都是真懒加载。
  2. 构建时从 `mermaid.core.mjs` 里**抓取 37 个插件的 detector 正则与 loader 路径**，写进 `kinds.json`。
  3. 服务端把 ` ```mermaid ` 围栏渲染成 `<x-mermaid>` 占位符（**不渲染 SVG** —— `mermaid.render()` 在 Node 下抛 `document is not defined`，必须客户端渲染）。
  4. 浏览器端：**只有页面真的存在 `<x-mermaid>` 时才 `import` 引擎**；chunk 之间是普通相对 `./chunk-*.js` 引用，浏览器原生解析，无需再打包。

  实测（Edge headless + CDP）：无图表的文档 → **0 个 mermaid 请求**；1 个 flowchart + 1 个 sequenceDiagram → 32 个文件；未使用的 pie/c4/architecture chunk 均未下载。代价是文档一旦有图表，至少要下约 700 KB 共用运行时——这是 mermaid 的结构性开销，无法再省。

  **构建管线里踩到的坑**（值得记录）：抓 detector 的正则最初写成 `var id(\d+) = "..."`，导致只匹配到 36/37 个插件——**c4 的声明没有数字后缀**（`var id = "c4"; var detector = ...`），于是 c4 被静默漏掉。改成 `var id(\d*)`（后缀可选）后 37/37 全中。

  另：`dist/diagrams/` 与 `dist/diagram-api/` 里**只有 `.d.ts`**，不存在"按图表类型的 JS 入口"；`registerExternalDiagrams([], {lazyLoad:false})` 会一次性注册 **39 种**图表，即官方 API 没有选择性加载的入口。所以只能靠 esbuild splitting + 自行解析 detector 来实现按需。

  **导出（`--export`）不含图表引擎**：内联 mermaid 闭包会让单文件 +1.4 MB，违背导出定位。导出文件保留图表源码块并显式说明原因。
- **所见即所得编辑**（同类软件 F2 live-edit 的 14 文件子系统）：起初划为超范围，但 v0.7.0 **已实现**（✍ / `Ctrl+Shift+E`）。同时保留 F2 → 外部编辑器（`MD_EDITOR` 环境变量，模板 `{file}:{line}`）——常见编辑器探测链被简化为环境变量一行。
  - **为什么这次能做**：常见实现把复杂度集中在"维护一份与渲染状态同步的内部 AST、光标在其间保持、自建撤销栈、精确双向映射"。我们**不做这些**——只用浏览器原生的 `contenteditable` + 工具栏 DOM 命令（execCommand/Selection），保存时跑一次"DOM → markdown"序列化（`ui/mdserial.js`，`walkNode` 按标签分发），复杂度从"再造半个 mdlight"降到一个小模块。代价：不支持撤销跨命令栈（依赖 execCommand 原生撤销）、复杂表格/嵌套公式就地编辑不可靠（这些仍去源码面板改）。
- **Rust 原生窗口版**：工具链限制不做，改用 **C# + WebView2**（v0.6.0，主路线）。理由：C# 自带 `csc.exe`（Windows 内置 .NET Framework 编译器）+ 系统 WebView2 运行时，**不需要 Rust 工具链也不需要捆绑浏览器内核**，产出的 `dist/native/mdlight.exe` 只有 6.8 MB（内含全部 UI/渲染器/mermaid 资源）。窗口与磁盘 I/O 在 C#，渲染在 WebView2 里的 JS——分工与 Node 版完全同构，渲染结果逐字节一致（parity-check 保证）。
- **Node SEA 版已移除（v0.7.0）**：原作为"不装 Node + 不装 WebView2"的兜底路线保留，但用户决定**专注轻量版**——SEA 版 95.6 MB（89 MB 是未压缩的 node.exe 本身），与"轻量"定位冲突，且 WebView2 在 Win11 内置 / Win10 已随 Edge 安装，兜底场景实际很少。因此删除 `dist/mdlight.exe`、`tools/build-exe.mjs`、`test/exe-check.mjs`、`postject` 依赖及全部 SEA 相关代码。当前唯一 exe 路线是 `dist/native/mdlight.exe`（6.8 MB，需 WebView2）。

## 6. 许可与伦理

- 所有依赖 MIT：markdown-it、KaTeX、highlight.js、esbuild（esbuild 仅构建时）。
- 所有代码从零编写，不含任何闭源第三方代码；同类软件的公开行为研究仅用于**理解常见缺陷与工程模式**。
- 软件本身 MIT，可自由分发。

## feat14: Markdown → LaTeX 导出

### 背景
用户需要将 mdlight 预览的 Markdown 文档直接导出为可编译的 .tex 文件。

### 实现
`core/renderer.mjs` 增加 `mdToLatex(src)` 纯函数：
- 标题 → section / subsection / subsubsection
- **bold** / *italic* / `code` / ~~strike~~ → 	extbf / 	extit / 	exttt / 纯文本
- 表格 → egin{tabular} + hline
- 目录列表 → egin{itemize} / egin{enumerate}
- 引用 → egin{quote}
- 图片 → includegraphics[width=linewidth]
- 代码块 → egin{verbatim}
- $math$ 通过、[link](url) → href
- mermaid 图 → % 注释块

客户端流程：TeX 按钮 → fetch /api/source → mdToLatex() → POST /api/export-latex?name=X.tex → 服务端写写文档目录。
单一文件导出场景（无服务器）时 TeX 按钮显示 no-service 提示。
