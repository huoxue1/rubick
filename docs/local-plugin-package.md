# 本地插件包（`.rubick` / `.zip`）安装

Rubick 除支持从插件市场通过 npm 安装插件外，也支持**把插件代码打包成插件包后直接拖拽安装**，适合以下场景：

- 内网 / 离线环境无法访问 npm registry；
- 自己开发的插件想快速分发给同事试用；
- 插件包需要打包后以文件形式归档、走审批流程。

插件包**本质是 zip 容器**：

- `.rubick`：Rubick 官方推荐后缀，便于和普通 zip 区分、做文件关联和分发；
- `.zip`：同样支持，方便使用系统自带压缩工具直接打包。

## 1. 插件包目录结构

插件包根目录（或根目录下唯一的一级子目录）就是插件目录，必须包含 `plugin.json`（推荐）或 `package.json`：

```
my-plugin/
├── plugin.json      # 插件元数据（必须，或使用 package.json）
├── index.html       # UI 插件入口
├── preload.js       # 可选，插件页面的 preload
├── logo.png         # 可选，插件图标
└── js/ css/ ...     # 插件构建产物
```

> 注意：插件包请勿包含 `node_modules`。本地安装**不会**执行 `npm install`，
> 依赖请提前打包进插件产物（webpack/vite 打包即可）。

### plugin.json 示例（UI 插件）

```json
{
  "name": "rubick-plugin-example",
  "pluginName": "示例插件",
  "description": "一个本地安装的示例插件",
  "author": "you",
  "version": "1.0.0",
  "pluginType": "ui",
  "main": "index.html",
  "preload": "preload.js",
  "logo": "logo.png",
  "features": [
    {
      "code": "example",
      "explain": "示例插件",
      "cmds": ["示例", "example"]
    }
  ]
}
```

- `name`：插件唯一标识，同时作为安装目录名，只允许字母、数字、`.`、`_`、`-`，不能以 `.` 开头；
- `pluginType`：`ui` 或 `system`，缺省按是否存在 `entry` 推断（无 `entry` 视为 `ui`）；
- `main`（UI 插件必须）：插件入口 HTML，相对于插件目录；
- `entry`（系统插件必须）：主进程入口 JS，相对于插件目录；
- `preload`：可选，插件页面预加载脚本，相对于插件目录；
- `logo`：可选，可以是 `https://`、`data:`、`file:`，也可以是插件目录内的相对路径；
- `features`：UI 插件必须，用于关键词搜索呼起；`code` 会通过 `onPluginEnter` 的 `ext.code` 传给插件。

### plugin.json 示例（系统插件）

```json
{
  "name": "rubick-system-example",
  "pluginName": "示例系统插件",
  "version": "1.0.0",
  "pluginType": "system",
  "entry": "main.js"
}
```

系统插件会在主进程中被 `require` 并执行，导出一个 `onReady(ctx)` 函数：

```js
module.exports = () => ({
  onReady(ctx) {
    // ctx: { mainWindow, API, ...electron }
  },
});
```

> 系统插件安装后需要**重启 Rubick** 才会生效。

## 2. 打包

### 方式一：Rubick 开发者页（推荐给插件作者）

打开插件市场 → 账户菜单 → **开发者** → 页面下方的「打包插件」：

1. 选择插件目录（目录内需有 `plugin.json` 或 `package.json`）；
2. 选择输出位置（默认输出到插件目录同级的 `<目录名>.rubick`）；
3. 点击「开始打包」，完成后可直接在文件夹中查看，拖入 Rubick 即可安装。

### 方式二：仓库脚本

如果插件目录里已经有 `plugin.json`，可以直接用仓库内置脚本打包（默认输出 `.rubick`）：

```bash
# 在 rubick 仓库根目录执行（默认输出到插件目录同级的 <目录名>.rubick）
yarn plugin:pack ./path/to/my-plugin
# 或指定输出文件（支持 .rubick / .zip）
yarn plugin:pack ./path/to/my-plugin ./dist/my-plugin.rubick

# 也可以在插件项目目录内直接调用脚本
node /path/to/rubick/scripts/pack-plugin.js .
```

### 方式三：手动打包

等价的手动打包方式（`.rubick` 和 `.zip` 都是 zip 容器，改后缀即可互换）：

macOS / Linux：

```bash
cd my-plugin
zip -r ../my-plugin.rubick . -x "*/node_modules/*" "*.zip" "*.rubick"
# 也可以先打成 zip，再重命名
zip -r ../my-plugin.zip . -x "*/node_modules/*"
mv ../my-plugin.zip ../my-plugin.rubick
```

Windows PowerShell：

```powershell
Compress-Archive -Path .\my-plugin\* -DestinationPath .\my-plugin.zip
# Compress-Archive 只支持 .zip 输出，打成 zip 后重命名即可
Rename-Item .\my-plugin.zip .\my-plugin.rubick
```

任何能生成标准 zip 的工具都可以，但插件包必须满足：

- 后缀为 `.rubick` 或 `.zip`；
- 单个插件包 ≤ 200MB，解压后 ≤ 500MB，文件数 ≤ 20000；
- 不允许包含软链接（符号链接）；
- 不允许路径穿越（`../` 等）。

> 想换用其他专属后缀（如 `.rpk`）时，修改 [src/common/constans/pluginPackage.ts](../src/common/constans/pluginPackage.ts)
> 中的 `PLUGIN_PACKAGE_EXTENSIONS`，并同步 `scripts/pack-plugin.js`、`feature/src/App.vue`、
> `feature/src/views/installed/index.vue` 中的同名常量即可。

## 3. 安装方式

### 方式一：拖拽安装（推荐）

把 `.rubick` 或 `.zip` 插件包拖到 Rubick 主窗口或插件市场窗口，出现「松开鼠标，安装插件包」提示后松手即可。

- 若同名插件已安装，会弹窗询问是否覆盖安装（覆盖会替换插件目录，插件数据仍保留在本地数据库中）；
- 若同名插件是通过插件市场（npm）安装的，会提示先卸载市场版本，避免两套安装方式冲突。

### 方式二：插件市场安装

打开插件市场 → 账户菜单 → **已安装** → 右上角「安装本地插件」，选择 `.rubick` 或 `.zip` 文件。

### 方式三：开发者调用

在任一 Rubick 渲染进程中（主窗口 / 插件页面 / 插件市场）：

```js
const result = await window.rubick.installPluginFromZip(
  '/absolute/path/my-plugin.rubick'
);
// result: { success, code?, message?, plugin?, requireRestart? }
```

> 方法名保留了历史命名 `installPluginFromZip`，但实际同时支持 `.rubick` / `.zip`。

## 4. 安装位置、更新与卸载

- 安装目录：`<userData>/rubick-plugins-new/local/<name>/`
  - Linux：`~/.config/rubick/rubick-plugins-new/local/<name>`
  - macOS：`~/Library/Application Support/rubick/rubick-plugins-new/local/<name>`
  - Windows：`%APPDATA%/rubick/rubick-plugins-new/local/<name>`
- 插件列表记录：`rubick-plugins-new/rubick-local-plugin.json`
- 更新：重新拖入新版本插件包（`.rubick` 或 `.zip`）并确认覆盖即可；
- 卸载：插件市场 → 已安装 → 选择插件 → 卸载（会删除本地插件目录）；
- 插件业务数据存放在 PouchDB 中，卸载 / 覆盖插件不会删除插件数据。

## 5. 安全提示

本地插件包与 npm 插件一样，运行在 `nodeIntegration: true` 的渲染进程 / 主进程中，
拥有完整的 Node.js 与系统权限（读写文件、执行命令等）。**只安装来源可信的插件包**。
Rubick 对插件包只做结构校验与路径安全校验，无法校验插件代码本身是否为恶意代码。
