# mdlight

> **轻量、流畅的 Markdown 阅读与转换器。** 打开大型 Markdown 文档依然流畅不卡；完整渲染
> **所有常见数学公式格式**（LaTeX / AsciiMath / MathML）；支持**导出 PDF / LaTeX**，也支持
> **一键导入 PDF / LaTeX** 并直接转换为可编辑的 Markdown。
> A lightweight, smooth Markdown viewer & converter: large docs stay responsive,
> all major math dialects (LaTeX / AsciiMath / MathML) render fully, with
> PDF/LaTeX **export** and one-click **PDF/LaTeX → Markdown import**.

**背景**：本项目的架构思想来自业界广泛使用的本地服务器 + WebView 壳 + SSE 热重载 +
行号定位的**公开工程模式**。所有代码从零编写，全部组件开源（MIT）。同类软件的常见缺陷，
在这里逐条修复。

## 快速开始

```bash
# 方式零：开箱即用（免安装 Node）—— 单个 6.8 MB 的 mdlight.exe
mdlight.exe 论文.md      # 命令行用法与下面完全一致
# 双击 mdlight.exe → 弹出文件选择框，选中 .md 即开
# 把 .md 拖到 mdlight.exe 上 → 直接打开

# 方式一：开发运行（需要本仓库 + npm install）
node mdlight.mjs 论文.md

# 方式二：发行版（dist/ 三件套拷到任何有 Node 的机器）
node dist/mdlight.mjs 论文.md

# Windows 双击（优先用 dist\native\mdlight.exe，没有才回落 Node）
bin\mdlight.bat 论文.md
```

**`dist/native/mdlight.exe` 是自足的**：它是一个 C# 原生窗口宿主，UI、浏览器渲染器、
KaTeX（含 20 个字体）、highlight.js 样式、以及整个 mermaid 按需包**全部内嵌在这一个 exe 里**
（`pack.bin` 资源包，133 个文件 / 5.86 MB）。运行时不需要 Node、不需要 `node_modules`、
不需要任何同目录文件。测试会把它**单独**拷进一个空目录、并从另一个工作目录启动它，
逐项验证所有资源、渲染、编辑器、热重载和导出。

```bash
npm run build:native     # 构建 dist/native/mdlight.exe（6.8 MB）
```

> 为什么这么小：不打包浏览器内核，而是用系统自带的 **WebView2**（Win11 内置；Win10 一般
> 已随 Edge 安装，缺了会提示一次下载地址）。C# 宿主本身只做「窗口 + 本地 HTTP 服务 +
> 文件监听 + 磁盘读写」，渲染全部交给 WebView2 里的 JS。

首次启动自动弹出 **Edge 无边框窗口**（`--app` 模式，无地址栏，观感即原生应用）；
没有 Edge 则回落默认浏览器。

## 命令行

```
mdlight <file.md>                     预览（保存即热重载）
mdlight <file.md> --export [out.html] 导出单文件 HTML（约400KB，双击即开，离线可看；不含图表引擎）
mdlight <file.md> -p 8080             固定端口（默认随机，仅监听 127.0.0.1）
mdlight <file.md> --no-window         无窗口模式（脚本/CI）
mdlight.exe                           无参数：弹出文件选择框（仅 exe；自动化用 MDLIGHT_PICK=<path> 跳过对话框）
```

## 快捷键与环境变量

| 键 | 功能 |
|---|---|
| `F2` / ✎ | 在外部编辑器打开，跳到**当前视口对应源码行** |
| `Ctrl+Shift+E` / ✍ | **直接编辑（WYSIWYG）**：点预览段就地改字，工具栏加粗/标题/列表/公式等，Ctrl+S 保存即重载 |
| `Ctrl+E` / 工具栏"源码" | 编辑态里切到 **markdown 源码视图**（textarea），Ctrl+S 保存；用于精确改复杂表格/嵌套 |
| `Ctrl+T` / ☰ | 目录侧栏开关 |
| `Ctrl+D` / ◐ | 主题循环：自动 → 亮 → 暗 → 羊皮纸 |
| `Ctrl+P` / ⎙ | 打印 |
| （选中公式 + Ctrl+C） | 复制公式时按**原格式**：剪贴板拿到的是 LaTeX 源码（如 `E = mc^2`、`\alpha + \beta`），不是渲染后的显示文本。公式右上角悬停也会出现 ⧉ 复制按钮，一键复制源码 |
| （右键菜单） | 任意位置右键打开快捷菜单：首项 🎨 **外观**（16 种皮肤模式 / 正文字体 / 字号 A±），往下是主题循环、目录、查找、双栏分屏、大纲脑图、源码视图、直接编辑、外部编辑器、打印、导出 CSV、导出 PDF、设置、语言切换 |
| TeX 按钮 | 一键将 Markdown 导出为 LaTeX (.tex)，标题 → section、表格 → tabular、代码 → verbatim、公式通过、mermaid → 注释 |
| ⇣PDF / ⇣TeX 按钮 | **一键导入** PDF 或 LaTeX 文件，自动转换成 Markdown 并立即打开为可编辑文档（`/api/import-md`） |
| ⟳ 检查更新 | exe 打开时**后台自动检查更新**；发现新版本弹出提示，可一键下载并重启更新；亦可在右键菜单 →「检查更新」手动触发，或命令行 `mdlight.exe --update-check` |
| 🔗 绑定 .md | exe 打开即可把 **`.md` 文件绑定到 mdlight**（双击 .md 默认用 mdlight 打开 + 右键「用 mdlight 打开」）；右键菜单随时绑定/解绑。绑定点在 HKCU，无需管理员 |
| （自动） | **多格式公式**：同一份文档里 `$...$`（LaTeX）、`` `x^2+1` ``（AsciiMath）、`<math>…</math>`（MathML）三种数学写法全部渲染为 KaTeX 高质量公式 |
| （自动） | ` ```mermaid ` 图表：仅当文档含图表时才下载引擎，且只取用到的类型 |

```bat
set MD_EDITOR=code --goto "{file}:{line}"
```

`{file}`/`{line}` 模板替换；未设置时依次探测 code → code-insiders → subl → notepad++ → notepad。
若都找不到，点 ✍ 进入直接编辑，再点工具栏"源码"（或 `Ctrl+E`）切到源码面板修改并保存：
保存时会对比 sha256，若文件在编辑期间被外部修改，会提示“覆盖 / 重新加载 / 取消”，避免误覆盖。

`MDLIGHT_PICK=<path>` 仅用于自动化：让 `mdlight.exe` 的无参数启动跳过文件选择对话框，
直接使用给定路径（路径不存在时等同于“用户取消”，安静退出 0）。

**更新检查**：exe 默认查询 GitHub Releases（`https://api.github.com/repos/lm846802297-bit/mdlight/releases/latest`，
需仓库公开）比较版本。可用环境变量或 `config.json`（`%APPDATA%\mdlight\config.json`）覆盖更新源：
`MDLIGHT_UPDATE_URL` / config `updateUrl`（JSON 文档，含 `tag_name` 与 `assets[]` 的
`browser_download_url`）、config `updateDownloadUrl` + `updateVersion`（直接静态下载地址 + 版本号）、
config `updateCheckOnStart`（默认 true，改为 false 关闭启动自动检查）。

**自定义外观**：把覆盖样式写进 `%APPDATA%\mdlight\custom.css` 或 md 文件旁的
`custom.css`，保存即时热重载（导出时也会自动内联）。主题变量见 `ui/app.css` 开头的
`:root` 定义（`--bg`、`--fg`、`--accent`、`--code-bg` 等）。

**外观面板**：顶栏 🎨（或右键菜单首项，或 `Ctrl+D` 循环主题）弹出——**16 种皮肤模式**
（自动/亮/暗/羊皮纸/北欧/日光/德古拉/矩阵/复古/海洋/森林/玫瑰松/猫猫/赛博朋克/东京夜/Monokai，
每张卡用 3 色块预览）+ **正文字体**（13 款 + 当前）+ **正文字号**（A- / 数值 / A+，12–28px）。
选择会**同时写入** `%APPDATA%\mdlight\config.json` 并即时生效；深色皮肤（nord/德古拉/矩阵/复古/海洋/森林/
玫瑰松/猫猫/赛博朋克/东京夜/Monokai）会把 `mermaid` 引擎同步切到深色主题。同一份皮肤/字体/字号在顶栏 🎨、
右键菜单、⚙ 设置窗口三处完全一致。

**右键菜单**：在正文任意位置（输入框/编辑器/脑图等除外，保留系统原生右键以便粘贴）右键，
弹出 mdlight 快捷菜单——首项是折叠的 🎨 外观子面板（16 种皮肤卡 + 字体下拉 + 字号 A±，就地换不用跳窗），
往下是主题循环 `Ctrl+D`、目录 `Ctrl+T`、查找 `Ctrl+F`、双栏分屏 `F3`、大纲脑图 `Ctrl+Shift+M`、
源码视图 `Ctrl+E`、直接编辑 `Ctrl+Shift+E`、外部编辑器 `F2`、打印 `Ctrl+P`、导出 CSV、导出 PDF、
设置、中文/English 切换。`Esc` 或点击别处关闭。

## 特性 → 同类软件常见缺陷对照

| # | 同类软件的常见缺陷 | mdlight 的修复 | 验证 |
|---|---|---|---|
| 1 | 代码块里的 `$` 被误判为公式 | CommonMark 分层解析：代码 token 在结构上不可能进公式管线 | `test/smoke.mjs` "fence $ stays literal" |
| 2 | 公式渲染失败只整坨标红，不说明原因 | **公式错误卡片**：源码 + 具体报错（如 `Undefined control sequence: \badcommand`）+ 点击复制 | smoke "error card shows message" |
| 2b | 公式含中文 → KaTeX 报错标红 | **CJK 自动包裹**：中文连续段自动包进 `\text{}` 后重试 | smoke "CJK math auto-wrapped" |
| 2c | 不支持 `\newcommand` 宏 | 提取定义进文档级宏表，`$$…$$` 定义块渲染为空不占位；带参数宏 `#1`/`#2` 完整展开 | `test/macro-check.mjs` |
| 7 | **AI 方言定界符 `\(...\)`/`\[...\]` 完全不认**（反斜杠被转义吃掉，连公式节点都不生成；AI 生成的审稿文档全部失效） | 解析器级支持：inline 规则插在 escape 之前截住、block 规则接独立显示块；代码块/行内代码内保持字面 | smoke "AI dialect" 组（6 项断言） |
| 4 | KaTeX/高亮引擎首用需联网下载 | **全离线**：引擎+20 字体内置，断网可用 | dist 独立目录 E2E |
| 5 | 遥测上报设备指纹/赞助状态到 ml-smarttech.com | **零遥测**：无相关代码；服务器仅监听环回 | 代码审计 |
| 6 | 导出 HTML 带 `utm_source=export` 跟踪参数 | 导出零跟踪参数、单文件、双击即开 | 导出产物 grep |
| 6b | 编辑器探测绕注册表（HKLM+HKCU 多路径） | 一行环境变量 `MD_EDITOR` 直达 | `--help` 文档 |
| 新 | 用户没有外部编辑器（无 VS Code/Notepad++ 等） | **源码视图（v0.7.1，`Ctrl+E`）**：并入"直接编辑"工具栏，点"源码"或 `Ctrl+E` 切到 markdown 源码面板（textarea），Ctrl+S 保存；sha256 冲突检测防止误覆盖，保存后预览自动刷新。用于 WYSIWYG 序列化不可靠的复杂表格/嵌套结构。与 ✍ 是**同一文件的两个视图**，不再占独立顶栏按钮 | `GET /api/source` + `POST /api/save`（11 接口断言全通过） |
| 新 | 同类软件的 F2 live-edit（所见即所得）是付费会员卖点 | **直接编辑（WYSIWYG，v0.7.0）**：`Ctrl+Shift+E` 或 ✍ 进入，点段落就地改字；工具栏 16 个按钮（撤销/重做/标题/粗斜删除线/行内代码/列表/引用/公式/链接/图片/表格）；`ui/mdserial.js` 把 DOM 序列化回 markdown 且**保留公式/代码/mermaid/callout 块**；Ctrl+S 保存 → 预览自动重载 | `test/wysiwyg-check.mjs` 29 项真实浏览器断言，含编辑→保存→磁盘落盘→重载往返 |
| 9 | 不支持 mermaid 图表（` ```mermaid ` 当普通代码块） | **按需 mermaid 图表**：识别 37 种图表类型，只加载文档真正用到的那几种；渲染失败显示源码+报错，不出现空白框 | `test/mermaid-check.mjs` 25 项 + `test/mermaid-browser.mjs` 19 项（真实浏览器） |
 | 新 | 没有 PPT 演示模式，幻灯片文档只能逐行滚动阅读 | **PPT 演示模式（Marp，v0.8.0）**：文档 YAML frontmatter 写 `marp: true` 后按 `---` 自动分页；F5 全屏放映（顶栏 ▶ 按钮同样进入），方向键/空格翻页，页脚支持 `{title}/{page}/{total}/{date}` 宏，演讲者计时器，Esc 退出；阅读模式显示全部幻灯片且可正常跳转 | `test/marp-check.mjs` 24 项（含无头 Edge 端到端） |

另附原生能力：显示/行内公式、**AI 方言定界符 `\(...\)` / `\[...\]`**（ChatGPT/Claude/Pandoc
的输出即贴即渲染，两种方言自由混用）、**AsciiMath**（`` `x^2+1` `` 反引号数学）、**MathML**
（`<math>…</math>`，含 display block、分数/上下标/根号等基础结构）、mhchem 化学式、`\newcommand` 宏（含带参数宏）、callout（6 类）、
任务列表、`[[双链]]`（点击复制语法）、表格对齐、TOC（滚动高亮）、行号定位（F2）、
**源码视图（Ctrl+E，编辑态里的源码切换）**、**直接编辑（Ctrl+Shift+E，所见即所得）**、
**按需 mermaid 图表**、**PPT 演示模式（Marp，F5）**、
**导出 PDF / LaTeX**、**一键导入 PDF / LaTeX → Markdown**（`/api/import-md`）、
**超大文档懒渲染**（>200 块时 IntersectionObserver 按需绘制 + Web Worker 离线程渲染）、
保存即热重载（**保持滚动位置**）、亮/暗/羊皮纸主题、打印样式。

## mermaid 图表：为什么“按需”很重要

mermaid 全量非常大，但**阅读一份文档并不需要全部**。实测（mermaid 12.2.0）：

| 口径 | 大小 | 说明 |
|---|---|---|
| `node_modules` 解包 | 199 MB | 含依赖树；`dist` 里约一半是 `.map` |
| npm 包本身 | 117 MB / 1333 文件 | registry `unpackedSize` 122 MB |
| 一次性打进单文件（minify） | 5.01 MB | 静态 `import mermaid` 无法 tree-shake |
| 同上 gzip | 1.42 MB | 比 mdlight 现在的导出（约 417KB）大 3.4 倍 |

如果按“全量塞进去”做，一份**完全没有图表**的文档也要多背 1.4 MB —— 这跟“轻量离线”直接冲突。
所以 mdlight 的做法是**运行时按需**：

1. 服务端解析 markdown 时，把 ` ```mermaid ` 围栏换成 `<x-mermaid>` 占位符（**不渲染**：mermaid 需要 DOM）。
2. 浏览器加载页面后，**只有当页面上真的存在 `<x-mermaid>`** 时才 `import` 图表引擎。
3. 引擎按图表类型拆成 106 个 chunk；只有文档里出现的类型对应的 chunk 会被下载。

实测效果（真实浏览器，Edge headless）：

| 文档内容 | 下载的 mermaid 资源 |
|---|---|
| 没有 mermaid | **0 个请求，0 字节** |
| 1 个 flowchart + 1 个 sequenceDiagram | entry + 共用运行时 + 这 2 种 chunk（共 32 个文件） |
| 文档里有 pie 图但你没写 | **不会下载** pie / c4 / architecture 等未使用的 chunk |

代价：文档一旦有图表，至少要多下约 700KB 的共用运行时（d3/dagre 等）。这是 mermaid 本身的
结构性开销，无法再省。**没有图表就完全不受影响**，这是本方案的关键取舍。

离线导出（`--export`）**不含图表引擎**：单文件导出会把 mermaid 的闭包全内联进去（+1.4MB），
那样就违背了导出的定位。导出文件里保留图表源码并标注说明，用 mdlight 打开原 `.md` 即可渲染。

自定义图表主题：图表跟随页面主题（亮/暗/羊皮纸）自动重渲染。

## 架构（1 图）

```
mdlight.mjs (CLI+HTTP+SSE)                    ← Node 版（开发 / 发行版）
 ├─ core/renderer.mjs   渲染管线：md-it 解析 → 宏提取 → KaTeX(服务端) → hljs
 │                       mermaid 围栏 → <x-mermaid> 占位（不在服务端渲染）
 ├─ readAsset()         统一取件层：项目根 / dist/ 目录走磁盘，build.mjs 做路径重写
 ├─ ui/                 前端壳：TOC/主题/热重载/错误卡片交互/内置源码编辑器
 │                       按需加载 mermaid：检测图表类型 → 只 import 对应 chunk
 ├─ API                GET /api/source、POST /api/save（sha256 冲突检测）
 │                     GET /assets/mermaid/*（按需图表 chunk）
 ├─ dist/mermaid/       构建产物：106 个懒加载 chunk（文档无图表则永不请求）
 └─ assets              KaTeX CSS+字体、hljs CSS

native/*.cs (C# 原生宿主)                     ← exe 版（开箱即用）
 ├─ Program.cs          命令行 / 双击选文件 / 无参数行为
 ├─ NativeWindow.cs     WinForms 窗口 + WebView2 控件
 ├─ Server.cs           HttpListener 本地服务，路由与 Node 版逐条对齐
 ├─ Assets.cs           pack.bin 资源包读取（构建期内嵌）
 ├─ Exporter.cs         单文件 HTML 导出（内联 CSS/字体/图片/渲染器）
 └─ Page.cs             页面模板拼装（clientRender 模式）

core/renderer.mjs 同时被两边使用：
 · Node 版：在服务端跑（KaTeX 出静态 HTML）
 · exe 版： 用 esbuild 打成浏览器 bundle（renderer.js, 609 KB），在 WebView2 里跑
   两种构建产出的 HTML **逐字节相同**（见 test/parity-check.mjs）
```

## 打包成单文件 exe（两条路线）

### 主路线：C# + WebView2（6.8 MB）

`tools/build-native.mjs` 用 **Windows 自带的 csc.exe** 编译，不需要安装任何工具链：

1. 用 esbuild 把 `core/renderer.mjs` 打成浏览器 IIFE（`renderer.js`，609 KB）。
2. 把 ui/assets/mermaid/renderer.js 共 133 个文件打成 `pack.bin`（5.86 MB）。
3. `csc.exe /target:winexe` 编译 `native/*.cs`，引用 WebView2 的托管 DLL
   （WebView2Loader 为 x64 原生 DLL，运行时从资源释放到临时目录）。
4. 把 `pack.bin` 作为内嵌资源塞进 exe。
5. 用 `-win32icon:` 把 `assets/mdlight.ico` 嵌进 exe（图标由
   `tools/make-icon.py` 用 Pillow 矢量绘制生成；若 ico 缺失，构建会自动调用
   `python tools/make-icon.py` 重新生成）。

> 体积的关键：**不打包浏览器内核**。渲染引擎是系统已有的 WebView2（Win11 内置），
> 所以 6.8 MB 里主要是我们自己的代码、KaTeX 字体和 mermaid 按需包。


## 测试

```bash
node test/smoke.mjs            # 51 项渲染断言
node test/macro-check.mjs      # 宏展开验证
node test/mermaid-check.mjs    # 25 项：占位、kinds.json、按需 chunk 路由、目录穿越防护
node test/dist-standalone.mjs  # 17 项：dist/ 无 node_modules 独立运行
node test/parity-check.mjs     # 12 项：Node 服务端渲染 vs native 浏览器渲染逐字节一致
node test/native-check.mjs     # 45 项：exe 资源包/渲染/编辑器/SSE 重载/导出（CDP 真实浏览器）
node test/wysiwyg-check.mjs    # 26 项：所见即所得编辑（真实浏览器）
node test/eqserial-check.mjs   # 6 项：公式序列化
node test/config-check.mjs     # 11 项：配置读写与应用（MDLIGHT_CONFIG_DIR 隔离）
node test/harden-check.mjs     # 22 项：安全加固回归（同源校验/并发保存/CSV 覆盖/port 吞参/Node API）
node test/feat-check.mjs       # 94 项：缺失功能端到端（含右键菜单、复制公式 LaTeX，CDP 真实浏览器）
node test/mathfmts-check.mjs  # 43 项：多格式数学（AsciiMath / MathML → LaTeX）
node test/latex2md-check.mjs  # 52 项：LaTeX → Markdown 转换
node test/pdf2md-check.mjs    # 18 项：纯 JS PDF 文本提取 + Markdown 化
node test/import-check.mjs    # 15 项：一键导入管线（/api/import-md + 多格式数学渲染）
node test/mermaid-browser.mjs  # 19 项：真实浏览器验证懒加载（需 Edge，可选）
node tools/build.mjs           # 构建 dist/（含 mermaid 按需包）
npm test                       # 上面除 browser 外的全部
```

exe 测试特别验证「自足」这一点：把 `mdlight.exe` **单独**拷进一个空临时目录
（没有 `dist/`、没有 `ui/`、没有 `node_modules`），再从**另一个工作目录**启动它，
断言页面、内嵌 `app.js`/`app.css`、KaTeX（20 个 woff2 已 base64 内联）、hljs 样式、
`kinds.json`、mermaid entry/loader/共享 chunk、`/api/source` 全部可用，导出仍是自包含单文件。

也可以让真实浏览器测试跑在 exe 上：

```bash
MDLIGHT_LAUNCHER=dist/mdlight.exe node test/mermaid-browser.mjs
# → 19/19：图表真的渲染成 SVG，且只拉了 32 个文件（未用的 pie/c4/architecture chunk 不下载）
```

内置编辑器的接口（`GET /api/source`、`POST /api/save`）另经 11 项断言验证：
正常保存、返回新 sha、陈旧 base → 409 冲突、`force=true` 强制覆盖、磁盘内容核对。

### 安全加固（v0.7.1，`test/harden-check.mjs` 22 项）

本地服务只监听 `127.0.0.1`，但**同机的任意网页仍能向它发请求**。为此所有 `/api/*`
与 `/events` 统一做同源校验：`Sec-Fetch-Site` 必须是 `same-origin`/`none`，
带 `Origin` 时必须等于自己的 `http://127.0.0.1:<port>`，否则 403 —— 无关页面
（`file://`、其他端口、任意站点）无法再改写正在打开的文档、写入 `assets/` 或拉起对话框。

同轮修掉的其他问题（每条都有回归断言）：

| 严重度 | 问题 | 修法 |
| --- | --- | --- |
| HIGH | 两个并发保存可能**删掉磁盘上的文档**（固定 tmp 名 + `File.Replace` 失败时先删原件再 move） | `Doc.Save` 全程加锁；tmp 名带随机 GUID；覆盖失败时改用复制、**永不先删原件** |
| HIGH | 任意站点可 POST `/api/save` 改写文档（CORS 简单请求无预检） | 同源校验（见上） |
| MED | 配置写失败仍回 `ok:true`，并发写互相覆盖（固定 tmp + 异常被吞） | `Config.Set` 加锁 + 复制后改 + 临时文件带 GUID，失败回滚 |
| MED | 每个开着的页面永久占一个线程池线程（SSE ping 死循环） | SSE 改专用后台线程 + 每客户端独立锁 + 广播先快照再写 |
| MED | `--export` 无输出路径时可能用 HTML **覆盖 markdown 源文件** | 输出路径等于源路径 / `.md` 后缀 → 拒绝并报错 |
| MED | 导出时缺资源仍报成功（产出白屏文件） | 缺 `app.css`/`app.js`/`renderer.js`/katex 直接 throw |
| MED | 导出 PDF 的失败完全不可观测（`Task` 没 await） | `async` + `await PrintToPdfAsync` + 成功提示 |
| MED | `--port` 吞掉下一个参数（`--port 文件名` 打不开文档）；越界端口崩启动 | 只在解析成功且 1..65535 时消费 token；`Prefixes.Add` 挪进 try |
| LOW | 负坐标显示器上窗口左边缘被当右边缘（`& 0xFFFF` 把符号扩展撑回 0..65535） | 截断修正为 `(short)` 直接转换 |
| LOW | 首次启动两个实例同时解压 WebView2 DLL → 一方报"初始化失败" | 临时文件 + `File.Move`，冲突视为对方先赢 |
| LOW | CSV 导出接受任意文件名（`?name=paper.md` 会覆盖文档） | 必须 `.csv` 后缀 + 拒绝设备名 + 不得等于源文档 |
| LOW | `Json.FindValue` 把字符串**值**当 key → 可能写坏文档 | 检查前一个非空白字符是 `{`/`,` 且后一个是 `:` |
| LOW | `--install` 覆盖用户原有 `.md` 关联，卸载时清成空串 | 安装时把旧关联存 `PrevDefault`，卸载时还原 |
| LOW | 正文编辑器经 `cmd /c start` 打开，`%VAR%` 被展开导致打开错文件 | 改直启进程（不走 cmd） |

Node 模式（`node mdlight.mjs`）此前缺少 4 个 API（`/api/config`、`/api/settings`、
`/api/export-csv`、`/api/upload-asset`，全部 404），现已补齐并同样受同源校验保护 ——
harden-check 对两条运行路线都断言。

> **真实浏览器验证很重要**：CDP 驱动 Edge 的测试发现了两个仅在 DOM 环境下才暴露的缺陷 ——
> `index.html` 里 `<script src="app.js">` 排在编辑器标记**之前**，导致 `getElementById`
> 返回 null 并抛异常，**整个页面所有交互全部失效**（含 v0.3.0 刚做的内置编辑器）；
> 以及 ☰ 目录 / ◐ 主题两个按钮**从未绑定 click 事件**（只能用快捷键）。
> 两者都已修复。只测 HTTP 接口是发现不了这类问题的。

## 网络行为声明（隐私）

- 运行时**零联网**：无更新检查、无遥测、无数据上报。
- 唯一网络监听：`127.0.0.1` 随机端口上的本地 HTTP（仅本机可见）。
- 导出文件完全自包含（字体/样式/图片 base64 内联），`file://` 直接打开。

## 许可

MIT（见 [LICENSE](LICENSE)）。内嵌组件 markdown-it / KaTeX / highlight.js / mhchem
各自 MIT。所有代码从零编写，不含任何第三方闭源代码。

### v0.8.1 新增：效率与排版增强

| 功能 | 说明 |
| --- | --- |
| mermaid SVG 缓存 | 按 FNV-1a 内容指纹 + 主题存 localStorage，同文档二次打开图表 0 等待 |
| 字体枚举 | `document.fonts.check()` 探测系统已装字体，字体下拉框优先列出可用项 |
| PDF 页眉页脚宏 | 导出 PDF 支持 `{title}/{page}/{total}/{date}` 宏 + 出版级分页规则（防孤行/孤字、标题不压页尾） |
| 自定义快捷键 | 集中管理面板（Ctrl+K）改任意功能键，一键恢复默认 |
| 拖拽打开 | 桌面拖 .md 文件进窗口直接打开 |
| 单实例 CLI 热发送 | 已运行 mdlight 时再开同一文件会转发给已有实例（Named Pipe），不另起窗口 |
| 多文档标签页 | 顶栏标签条，多个 .md 并排，随时切换 |
| 母版版式 | 流式 / A4 / 幻灯片 三种排版模板，设置面板切换 |
| 虚拟滚动 | 超长文档（>200 块）懒渲染，滚动到才画图 |
