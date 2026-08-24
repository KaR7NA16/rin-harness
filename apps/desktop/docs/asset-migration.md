# 品牌资产迁移清单（@rin/desktop）

> 执行人：**主线程**。本文件是「源路径 → 目标路径」对照表 + 处置/状态标注。
> 二进制资产（图标/字体/图片）由主线程 Copy-Item 迁移；本子任务只写清单与引用路径。
>
> 注：任务描述里写的是 `public/`，但本仓库脚手架实际用 `assets/` 作静态资产目录
> （子任务 1 的 `frontendDist` 尚未接线，`assets/` 是当前落盘约定）。本文按**实际落盘**
> 的 `assets/` 写目标路径。

## 源 / 目标根

| | 路径 |
|---|---|
| 源根（旧项目） | `<旧项目根>\desktop` |
| 目标根（本仓库） | `rin\gui\gui`（本仓库相对路径） |

> 只迁「源根」下的 `src-tauri/` 与 `assets/`（旧项目叫 `public/`）品牌资产；
> **不迁** `dist/`（构建产物副本）、`src-tauri/target/`（编译缓存）、`src/`（旧前端源码，重写不搬）。

状态图例：✅ 已迁移（主线程已完成） / ⬜ 待迁移 / ⚠️ 待迁移且需重命名 / 🚫 建议弃用或重绘。

## 1. 平台图标 —— src-tauri/icons/ → src-tauri/icons/（✅ 已迁移）

全部**二进制 PNG/ICO/ICNS**，Copy-Item 原样（文件名不变）。这是旧「海豹」图标集：
决策 9 允许迁移海豹 app-icon；若品牌/法律审慎，从 `app-icon.svg` 重绘为 rin 自有图形后重导。

核心集（Tauri bundle.icon 引用，必需）：

| 源 | 目标 | 处置 | 状态 |
|---|---|---|---|
| icon.png | icon.png | 二进制 | ✅ |
| 32x32.png | 32x32.png | 二进制 | ✅ |
| 64x64.png | 64x64.png | 二进制 | ✅ |
| 128x128.png | 128x128.png | 二进制 | ✅ |
| 128x128@2x.png | 128x128@2x.png | 二进制 | ✅ |
| icon.ico | icon.ico | 二进制 | ✅ |
| icon.icns | icon.icns | 二进制 | ✅ |

Windows Store / UWP 方块（Square*/StoreLogo）与 `ios/`、`android/` 平台子目录均已随核心集一起迁移（✅）。

## 2. 图标源矢量 —— src-tauri/ → src-tauri/（⬜ 待迁移，可选）

| 源 | 目标 | 类型 | 处置 | 状态 |
|---|---|---|---|---|
| app-icon.svg | app-icon.svg | 文本（SVG） | Copy-Item 原样（重导整套图标的母本） | ⬜ |
| app-icon-macos.svg | app-icon-macos.svg | 文本（SVG） | Copy-Item 原样 | ⬜ |

## 3. app 图标 —— assets/ → assets/

| 源 | 目标 | 类型 | 处置 | 状态 |
|---|---|---|---|---|
| public/app-icon.svg | assets/app-icon.svg | 文本（SVG） | Copy-Item 原样（web-ui favicon/品牌引用） | ✅ |
| public/app-icon.png | assets/app-icon.png | 二进制 | Copy-Item 原样 | ⬜ |

## 4. 字体 —— assets/fonts/ → assets/fonts/（5 款，✅ 已迁移）

全部**二进制**，Copy-Item 原样：Geist-Variable.woff2、GeistMono-Variable.woff2、
jetbrains-mono-latin-ext.woff2、jetbrains-mono-latin.woff2、codicon.woff2。
Archivo 与 Material Symbols 字体已从 web-ui 移除（无代码引用）。

## 5. 模型供应商图标 —— assets/provider-icons/ → assets/provider-icons/

| 源 | 目标 | 类型 | 处置 | 状态 |
|---|---|---|---|---|
| official/openai-blossom.svg | official/openai-blossom.svg | 文本（SVG） | Copy-Item 原样 | ✅ |
| official/google-gemini.png | official/google-gemini.png | 二进制 | Copy-Item 原样 | ✅ |
| styled/rin-*.png | styled/rin-*.png | 二进制 | Copy-Item 原样 | ✅ |

根目录的旧 `.ico` / `.png` 供应商图标已从 web-ui 移除（ProviderLogo 统一使用 `official/` 与 `styled/` 路径）。
| zhipuglm.png | zhipuglm.png | 二进制 | Copy-Item 原样 | ✅ |
| official/google-gemini.png | official/google-gemini.png | 二进制 | Copy-Item 原样 | ✅ |
| official/openai-blossom.svg | official/openai-blossom.svg | 文本（SVG） | Copy-Item 原样 | ✅ |
| official/README.md | official/README.md | 文本 | Copy-Item 原样 | ✅ |
| styled/<旧品牌>-claude.png | styled/rin-claude.png | 二进制 | **重命名**（<旧品牌>- → rin-） | ⚠️ |
| styled/<旧品牌>-deepseek.png | styled/rin-deepseek.png | 二进制 | **重命名** | ⚠️ |
| styled/<旧品牌>-glm.png | styled/rin-glm.png | 二进制 | **重命名** | ⚠️ |
| styled/<旧品牌>-kimi.png | styled/rin-kimi.png | 二进制 | **重命名** | ⚠️ |
| styled/<旧品牌>-lmstudio.png | styled/rin-lmstudio.png | 二进制 | **重命名** | ⚠️ |
| styled/<旧品牌>-mimo.png | styled/rin-mimo.png | 二进制 | **重命名** | ⚠️ |
| styled/<旧品牌>-minimax.png | styled/rin-minimax.png | 二进制 | **重命名** | ⚠️ |
| styled/<旧品牌>-ollama.png | styled/rin-ollama.png | 二进制 | **重命名** | ⚠️ |

> `styled/` 的旧品牌前缀统一改 `rin-` 前缀。第三方厂商 logo
> （Claude/DeepSeek/GLM/Kimi/LM Studio/MiMo/MiniMax/Ollama/Gemini/OpenAI）为商标，仅引用，不重绘。

## 6. 第三方图标 —— assets/icons/ → assets/icons/（✅ 已迁移）

github.svg、bilibili.svg、douyin.svg、xiaohongshu.svg —— 文本（SVG），Copy-Item 原样。

## 7. agent 图标 —— assets/agent-icons/ → assets/agent-icons/（⬜ 可选）

claude-code.png / codex.png / cursor.png / hermes-agent.png / openclaw.png（二进制）+ codewhale.svg + README.md。
仅当 GUI/web-ui 要展示外部 agent 迁移来源图标时才需要；MVP 未接 agent-migration，可后置。

## 8. 品牌 wordmark —— assets/brand/ → assets/brand/（🚫 旧品牌残留）

| 源 | 目标 | 类型 | 处置 | 状态 |
|---|---|---|---|---|
| <旧品牌>-wordmark-long-flat-v4.png | rin-wordmark-long-flat-v4.png | 二进制 | **重命名 + 旧品牌残留** | 🚫 |
| <旧品牌>-wordmark-long-flat-v4-4x.png | rin-wordmark-long-flat-v4-4x.png | 二进制 | **重命名 + 旧品牌残留** | 🚫 |

> **旧品牌残留**：两个 png 内拼写「旧品牌名」，改名只改文件名、改不了图内文字——
> **建议弃用或重绘为 rin wordmark**，不要直接作为 rin 品牌资产发布。

## 需重命名汇总

| 规则 | 说明 |
|---|---|
| `styled/<旧品牌>-*.png` → `styled/rin-*.png` | provider 图标去旧品牌前缀（8 个文件） |
| `brand/<旧品牌>-wordmark-*.png` → `brand/rin-wordmark-*.png` | wordmark 文件名去旧品牌；图内文字仍是旧品牌名，建议弃用/重绘 |

## 旧品牌残留汇总

| 资产 | 残留性质 | 处置建议 |
|---|---|---|
| `assets/brand/<旧品牌>-wordmark-*.png` | 图内拼写旧品牌名文字 | 弃用或重绘为 rin wordmark，不随发布 |
| `src-tauri/icons/*`（海豹图标集） | 旧「海豹」图形 | 决策 9 允许迁移；若审慎，从 app-icon.svg 重绘后重导 |
| `assets/app-icon.svg/png`（海豹） | 旧「海豹」图形 | 同上，决策 9 允许迁移 |

## 主线程 Copy-Item 参考脚本（PowerShell，仅示例；✅ 项已完成，可跳过）

```powershell
$ErrorActionPreference = 'Stop'
$src = '<旧项目根>\desktop'
$dst = '<本仓库根>\rin\gui\gui'

# —— 已迁移（✅）：src-tauri/icons/、assets/fonts/、assets/icons/、
#    assets/provider-icons/ 基础集、assets/app-icon.svg —— 无需重复执行 ——

# —— 待迁移（⬜/⚠️）——
# 图标源矢量（可选）
Copy-Item "$src\src-tauri\app-icon.svg"       "$dst\src-tauri\app-icon.svg"       -Force
Copy-Item "$src\src-tauri\app-icon-macos.svg" "$dst\src-tauri\app-icon-macos.svg" -Force
# app-icon.png（.svg 已就位）
Copy-Item "$src\public\app-icon.png"          "$dst\assets\app-icon.png"          -Force
# provider-icons styled/（先复制再重命名）
Copy-Item "$src\public\provider-icons\styled" "$dst\assets\provider-icons\styled" -Recurse -Force
Get-ChildItem "$dst\assets\provider-icons\styled" -Filter '<旧品牌>-*.png' | ForEach-Object {
  Rename-Item $_.FullName ($_.Name -replace '^<旧品牌>-', 'rin-')
}
# agent-icons（可选）
Copy-Item "$src\public\agent-icons" "$dst\assets\agent-icons" -Recurse -Force
# brand wordmark（旧品牌残留，建议弃用/重绘；若仍要搬则先复制再重命名）
Copy-Item "$src\public\brand" "$dst\assets\brand" -Recurse -Force
Rename-Item "$dst\assets\brand\<旧品牌>-wordmark-long-flat-v4.png"    'rin-wordmark-long-flat-v4.png'
Rename-Item "$dst\assets\brand\<旧品牌>-wordmark-long-flat-v4-4x.png" 'rin-wordmark-long-flat-v4-4x.png'
```

## 校验（主线程执行 Copy-Item 后）

- ✅ `src-tauri/icons/` 核心 7 件（icon.png/32/64/128/128@2x/icon.ico/icon.icns）就位（cargo tauri build 打包图标必需）。
- ⬜ `assets/app-icon.png` + `assets/provider-icons/styled/rin-*.png`（8 个）就位（补齐后 web-ui 品牌/供应商图标完整）。
- ✅ `assets/fonts/` 7 款、`assets/icons/github.svg`、`assets/provider-icons/` 基础集就位。
- 🚫 无旧品牌文件名残留（provider-icons 已全部为 rin-*）；wordmark 已弃用或重绘为 rin。
