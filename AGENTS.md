# AGENTS.md — Rubick 插件开发指南

> 本文件是仓库级 `AGENTS.md`，同时面向**插件开发者**与**在本仓库工作的 AI Agent**。
> 内容覆盖：Rubick 插件怎么写、插件可用的 `window.rubick` API、以及如何打包/分发。
>
> 修改插件协议（`plugin.json` 字段）、`window.rubick` API、插件加载/安装逻辑时，
> 请同步更新本文件，以及 [public/preload.js](public/preload.js)、[src/main/common/api.ts](src/main/common/api.ts)。

---

## 0. 项目速览

Rubick 是一个基于 Electron + Vue 3 的**插件化桌面效率启动器**（类 uTools / Raycast）：
全局快捷键呼出主窗口 → 输入关键词搜索插件命令/本地应用 → 插件以 `BrowserView` 或主进程扩展的形式运行。

| 模块 | 位置 | 说明 |
|---|---|---|
| 主进程入口 | [src/main/index.ts](src/main/index.ts) | 单实例、窗口、托盘、快捷键、插件安装 |
| 插件宿主 | [src/main/browsers/runner.ts](src/main/browsers/runner.ts) | 用 BrowserView 加载 UI 插件页面 |
| 主进程 API | [src/main/common/api.ts](src/main/common/api.ts) | 渲染进程 `msg-trigger` IPC 的实现 |
| 插件 preload | [public/preload.js](public/preload.js) | 暴露 `window.rubick` 给插件页面 |
| 插件管理器 | [src/core/plugin-handler/index.ts](src/core/plugin-handler/index.ts) | npm 安装/更新/卸载 |
| 插件包安装器 | [src/main/common/installLocalPlugin.ts](src/main/common/installLocalPlugin.ts) | 本地插件包（`.rubick` / `.zip`）解压与校验 |
| 插件市场 | [feature/](feature/) | 市场、已安装、偏好设置等（内置插件 `rubick-system-feature`） |

常用命令：

```bash
yarn install                 # 安装主工程依赖
yarn electron:serve          # 开发模式启动 Rubick（主进程 + 主窗口）
yarn feature:dev             # 单独启动插件市场前端（dev 端口 8081，需与 electron:serve 配合）
yarn plugin:pack <dir> [out] # 把插件目录打成可拖拽安装的 .rubick（兼容 .zip）
yarn electron:build          # 打包安装包（需要先构建 feature 等子应用）
```

> Node 版本：仓库 `package.json` 的 Volta 字段钉的是 Node 16；当前依赖（Electron 33 + webpack 4）
> 在 Node 17+ 上执行构建/开发服务器时可能需要 `NODE_OPTIONS=--openssl-legacy-provider`。

---

## 1. 插件是怎么运行的

### 1.1 三类 `pluginType`

| 类型 | 用途 | 入口 | 运行位置 |
|---|---|---|---|
| `ui` | 绝大多数插件，有独立界面 | `main`（HTML） | `BrowserView`（主窗口内） |
| `system` | 深度集成：注册主进程能力、全局事件、原生 API | `entry`（JS） | **主进程**（`require` 加载） |
| `app` | 不是分发包；由 Rubick 扫描系统应用或用户拖入文件生成 | `action` | 由主进程 `exec` 启动 |

本文档主要讲 `ui` 和 `system`。`app` 类型只用于「本地应用/文件快捷启动」，不需要也无法作为插件包分发。

### 1.2 安装位置与数据

- npm 市场插件：`<userData>/rubick-plugins-new/node_modules/<name>/`
- 本地插件包（`.rubick` / `.zip`）：`<userData>/rubick-plugins-new/local/<name>/`
- 插件记录：`<userData>/rubick-plugins-new/rubick-local-plugin.json`
- 插件业务数据：PouchDB（`<userData>/default`），可由 WebDAV 多端同步

`userData` 目录（Electron `app.getPath('userData')`）：

| 平台 | 路径 |
|---|---|
| Linux | `~/.config/rubick` |
| macOS | `~/Library/Application Support/rubick` |
| Windows | `%APPDATA%/rubick` |

### 1.3 运行环境（很重要）

插件页面运行在一个**没有沙箱**的 Electron 渲染进程里：

```js
// 插件页面里可以直接用 Node / Electron
const fs = require('fs');
const { shell } = require('electron');
const remote = require('@electron/remote');
```

`webSecurity: false`、`nodeIntegration: true`、`contextIsolation: false`，因此：

- ✅ 可以随便用 Node 模块、读文件、起子进程；
- ⚠️ 插件代码 = 当前用户权限的任意代码。**只安装/运行可信插件**；
- ⚠️ 不要把不可信的远端 HTML 直接渲染进插件页面。

`window.rubick` 由 preload 注入（见 [public/preload.js](public/preload.js)），插件页面加载完成即可使用。

---

## 2. 写一个 UI 插件

### 2.1 最小目录结构

```
my-plugin/
├── package.json     # 供 npm 分发；不需要 npm 时也要有 name（插件包安装器要求 plugin.json 或 package.json 二选一）
├── plugin.json      # 插件元数据（推荐，插件包安装/本地加载以此为准）
├── index.html       # 插件页面入口（main 指向它）
├── main.js          # 页面脚本（可用任意前端框架/纯 JS）
├── preload.js       # 可选：插件自己的 preload
└── logo.png         # 可选：插件图标
```

`index.html` 通过 `file://` 加载，页面里的相对路径资源可以直接引用：

```html
<!DOCTYPE html>
<html>
  <body>
    <div id="app"></div>
    <script src="./main.js"></script>
  </body>
</html>
```

### 2.2 `plugin.json` 字段

```json
{
  "name": "rubick-plugin-hello",
  "pluginName": "Hello 插件",
  "description": "演示插件",
  "author": "you",
  "version": "1.0.0",
  "logo": "logo.png",
  "pluginType": "ui",
  "main": "index.html",
  "preload": "preload.js",
  "platform": ["darwin", "win32", "linux"],
  "pluginSetting": { "height": 600 },
  "features": [
    {
      "code": "hello",
      "explain": "打个招呼",
      "cmds": ["你好", "hello", "hi"]
    }
  ]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | ✅ | 插件唯一标识，同时用作安装目录名；建议与 npm 包名一致。仅允许字母/数字/`.`/`_`/`-`，不能以 `.` 开头 |
| `pluginName` | 推荐 | 展示名（安装列表、通知标题、独立窗口标题） |
| `description` / `author` / `version` | 推荐 | 展示信息 |
| `logo` | 推荐 | 图标；可为 `https://`、`data:`、`file:`，或插件目录内相对路径（本地安装时自动转 `file://`） |
| `pluginType` | ✅ | `ui` / `system`。缺省时：有 `entry` 视为 `system`，否则 `ui` |
| `main` | `ui` 必填 | 插件页面入口 HTML（相对插件目录，可带子目录） |
| `entry` | `system` 必填 | 主进程入口 JS（相对插件目录） |
| `preload` | 可选 | 插件页面追加的 preload，相对插件目录 |
| `features` | `ui` 必填 | 可被搜索/呼起的命令列表，见 2.3 |
| `pluginSetting.height` | 可选 | 打开插件时主窗口高度（默认 600，主窗口收起态 60） |
| `platform` | 可选 | 允许运行的系统：`darwin` / `win32` / `linux` 子集；不匹配会提示「插件不支持当前系统」 |
| `development` | 仅开发 | 开发模式（Rubick 以 `electron:serve` 启动）下页面加载的 URL，如 `http://localhost:8080` |

> 本地插件包安装时，安装器会额外写入 `source: "zip"`、`localPath`、`installedAt`、`originZip` 等字段（`source` 为历史字段名，表示本地安装），
> 这些由 Rubick 管理，**不要在 `plugin.json` 里手写**。

### 2.3 `features` 与命令（`cmds`）

一个 `feature` 对应一组可被搜索命令；`feature.code` 会在进入插件时通过 `ext.code` 传给你。

```json
{
  "code": "translate",
  "explain": "翻译",
  "cmds": [
    "翻译",
    { "label": "翻译选中文本", "type": "over" },
    { "label": "翻译剪贴板图片", "type": "img" },
    { "label": "打开 Markdown", "type": "file", "match": "\\.(md|markdown)$" },
    { "label": "打开链接", "type": "regex", "match": "^https?://" }
  ]
}
```

| `cmds` 项 | 出现在哪里 | `ext.type` / `ext.payload` |
|---|---|---|
| 字符串（如 `"翻译"`） | 关键词搜索（支持拼音/缩写匹配） | `text` / 当前搜索词字符串 |
| `{ type: "text", label }` | 同上（建议字符串命令即可） | `text` / 搜索词 |
| `{ type: "regex", label, match }` | 输入内容匹配 `match` 正则时出现 | `text` / 搜索词 |
| `{ type: "over", label }` | 任何搜索词下都会出现（慎用，适合常驻功能） | `text` / 搜索词 |
| `{ type: "file", label, match }` | 复制文件后呼出主窗口，扩展名匹配 `match` 时出现 | `file` / 文件信息数组 |
| `{ type: "img", label }` | 复制图片后呼出主窗口时出现 | `img` / 图片 dataURL |

补充：

- 命令的 `label` 是展示名；没有 `label` 的对象型命令在结果列表里展示不友好，建议必填。
- `feature.code` 建议全局唯一（每个插件内唯一），运行时用来区分用户触发了哪个功能。
- 从「已安装」页/插件市场菜单直接执行命令时，`ext = { code, type: "text", payload: null }`。
- 排序与权重由主窗口搜索逻辑控制（`label` 匹配、拼音匹配等），插件侧无需关心。

### 2.4 生命周期 Hooks

```js
// main.js
window.rubick.onPluginEnter((ext) => {
  // ext = { code, type, payload }
  console.log('插件被呼起', ext.code, ext.type, ext.payload);
  document.getElementById('app').textContent = `payload: ${ext.payload}`;
});

window.rubick.onPluginReady(() => {
  // 视图就绪（进入插件后触发）
});

window.rubick.onPluginOut(() => {
  // 插件即将退出（收尾：清定时器、取消请求、保存状态）
});

window.rubick.onShow(() => {
  // 主窗口显示时（插件仍打开）
});

window.rubick.onHide(() => {
  // 主窗口隐藏时（插件仍打开）
});
```

| Hook | 触发时机 | 回调参数 |
|---|---|---|
| `onPluginEnter(cb)` | 插件被打开/切换功能时 | `ext` |
| `onPluginReady(cb)` | 插件页面 `dom-ready` 后 | 无 |
| `onPluginOut(cb)` | 插件关闭/切换到其他插件前 | 无 |
| `onShow(cb)` | 主窗口 `show` | 无 |
| `onHide(cb)` | 主窗口 `hide` | 无 |
| `setSubInput(onChange, placeholder)` | 插件占用主搜索框做二级搜索 | `onChange({ text })` |
| `screenCapture(cb)` | 截图完成 | `cb(dataURL)` |

`onPluginEnter` 的 `ext`：

```ts
{
  code: string;   // feature.code
  type: string;   // 'text' | 'img' | 'file' | ...
  payload: any;   // 见 2.3 表格
}
```

### 2.5 完整示例：Hello 插件

`index.html`

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: system-ui; }
      button { margin: 8px; }
    </style>
  </head>
  <body>
    <h3>Hello Rubick</h3>
    <p id="out"></p>
    <button id="copy">复制一段文字</button>
    <button id="db">保存到插件数据库</button>
    <script src="./main.js"></script>
  </body>
</html>
```

`main.js`

```js
const app = {
  count: 0,
};

window.rubick.onPluginEnter(({ code, type, payload }) => {
  app.count += 1;
  document.getElementById('out').textContent =
    `${code} / ${type} / ${String(payload)} (第 ${app.count} 次打开)`;
});

window.rubick.onPluginOut(() => {
  // 清理资源
});

document.getElementById('copy').onclick = () => {
  window.rubick.copyText('来自 Hello 插件的问候');
};

document.getElementById('db').onclick = async () => {
  await window.rubick.db.put({
    _id: 'rubick-plugin-hello/records',
    data: { savedAt: Date.now() },
  });
  window.rubick.showNotification('已保存');
};
```

`plugin.json` 见 2.2；`package.json` 至少包含：

```json
{
  "name": "rubick-plugin-hello",
  "version": "1.0.0"
}
```

---

## 3. `window.rubick` API 参考

> 所有 API 均注入在插件页面的 `window.rubick` 上（实现见 [public/preload.js](public/preload.js)，
> 主进程实现见 [src/main/common/api.ts](src/main/common/api.ts)）。
> 除特别说明外，返回值为「同步返回」（内部走 `ipcRenderer.sendSync`）；插件页面调用时请注意不要在大数据量/高频场景阻塞 UI。

### 3.1 生命周期 / 事件

| API | 说明 |
|---|---|
| `rubick.onPluginEnter(cb)` | 插件进入，参数 `ext` |
| `rubick.onPluginReady(cb)` | 插件页面就绪 |
| `rubick.onPluginOut(cb)` | 插件退出 |
| `rubick.onShow(cb)` / `rubick.onHide(cb)` | 主窗口显示/隐藏 |

### 3.2 窗口与主搜索框

| API | 说明 |
|---|---|
| `rubick.hideMainWindow()` | 隐藏主窗口（插件保持打开） |
| `rubick.showMainWindow()` | 显示主窗口 |
| `rubick.setExpendHeight(height)` | 调整主窗口高度（px）；插件视图会自动跟随 |
| `rubick.setSubInput(onChange, placeholder?, isFocus?)` | 把主窗口搜索框变成插件的二级输入框；用户输入时回调 `onChange({ text })`。`isFocus` 当前版本未使用 |
| `rubick.setSubInputValue(text)` | 以代码方式设置主搜索框的值（会触发 `onSubInputChange`） |
| `rubick.removeSubInput()` | 移除二级输入框，恢复默认搜索 |
| `rubick.subInputBlur()` | 让主搜索框失焦，把焦点交还给插件视图 |

`setSubInput` 示例：

```js
window.rubick.setSubInput(({ text }) => {
  // 用户在顶部搜索框输入时实时回调
  renderResults(text);
}, '在插件内搜索');

window.rubick.setSubInputValue('默认值');
```

### 3.3 对话框与系统能力

| API | 说明 |
|---|---|
| `rubick.showOpenDialog(options)` | 打开文件选择框（`dialog.showOpenDialogSync`），返回路径数组或 `undefined` |
| `rubick.showSaveDialog(options)` | 保存文件对话框，返回路径或 `undefined` |
| `rubick.showNotification(body, clickFeatureCode?)` | 系统通知；标题/图标取当前插件；`clickFeatureCode` 当前版本未使用 |
| `rubick.shellOpenExternal(url)` | 用默认程序打开 URL |
| `rubick.shellOpenPath(path)` | 用默认程序打开文件/目录 |
| `rubick.shellShowItemInFolder(path)` | 在文件管理器中显示文件 |
| `rubick.shellBeep()` | 系统提示音 |
| `rubick.getPath(name)` | `app.getPath(name)`，如 `home` / `userData` / `temp` / `downloads` / `desktop` |
| `rubick.getFileIcon(path)` | 返回文件图标的 dataURL |
| `rubick.getCursorScreenPoint()` | 鼠标屏幕坐标 |
| `rubick.getDisplayNearestPoint(point)` | 最近的显示器信息 |
| `rubick.getLocalId()` | 当前设备标识（`encodeURIComponent(home)`） |

### 3.4 剪贴板

| API | 说明 |
|---|---|
| `rubick.copyText(text)` | 写文本 |
| `rubick.copyImage(dataURL)` | 写图片 |
| `rubick.copyFile(filePathOrPaths)` | 以「文件」形式写剪贴板（macOS/Windows 支持；Linux 返回 `false`） |
| `rubick.getCopyedFiles()` | 读取剪贴板中的文件列表；无文件时返回 `null`，否则返回 `[{ isFile, isDirectory, name, path }]`（注意拼写是 `Copyed`） |

### 3.5 数据存储（PouchDB）

插件数据由主进程统一管理；**所有插件共享同一个数据库 namespace**，因此建议在自己所有 `_id` 前加插件名前缀，避免冲突。

#### `rubick.db`

| API | 说明 |
|---|---|
| `db.put(doc)` | 写入/更新文档：`{ _id, data }`（更新时带上 `_rev`）；返回 `{ ok, id, rev }` 或 `{ error: true, name, message }` |
| `db.get(id)` | 读取文档；不存在返回 `null` |
| `db.remove(docOrId)` | 删除文档 |
| `db.bulkDocs(docs)` | 批量写入 |
| `db.allDocs(key?)` | 不传参数 → 所有插件文档（共享 namespace）；传字符串 → 以该前缀查询；传数组 → 按 `_id` 列表查询；返回文档数组 |
| `db.postAttachment(docId, buffer, contentType)` | 写附件（≤20MB），建立/更新以 `docId` 为 id 的附件文档 |
| `db.getAttachment(docId)` | 读附件（Buffer） |
| `db.getAttachmentType(docId)` | ⚠️ 当前实现有 bug，始终返回 `null`，暂不建议使用 |

限制：

- 单文档 ≤ 2MB（超过返回 `{ error: true, message: 'doc max size 2 M' }`）；
- 单附件 ≤ 20MB；
- WebDAV 导出会**排除附件文档**；
- 建议结构：`{ _id: 'rubick-plugin-hello/settings', data: {...} }`。

#### `rubick.dbStorage`（简单 key-value 封装）

```js
window.rubick.dbStorage.setItem('hello/settings', { theme: 'light' });
const value = window.rubick.dbStorage.getItem('hello/settings'); // 不存在返回 null
window.rubick.dbStorage.removeItem('hello/settings');
```

> `dbStorage` 的 key 同样建议带插件名前缀；写入失败会抛错。

### 3.6 截图

```js
window.rubick.screenCapture((dataURL) => {
  if (!dataURL) return; // 用户取消
  // dataURL 是 PNG 的 data:image/png;base64,...
});
```

- macOS：`screencapture -i -r -c`
- Windows：内置 `ScreenCapture.exe`
- **Linux 暂不支持**（会弹通知提示）

### 3.7 插件控制 / 动态命令

| API | 说明 |
|---|---|
| `rubick.openPlugin(plugin)` | 打开另一个插件（传入完整插件对象，会替换当前插件视图） |
| `rubick.removePlugin()` / `rubick.outPlugin()` | 退出当前插件，回到主搜索窗口（等价） |
| `rubick.getFeatures()` | 读取当前插件在运行时的 `features` |
| `rubick.setFeature(feature)` | 动态添加命令（`{ code, explain, cmds }`），会立即反映到主窗口搜索 |
| `rubick.removeFeature(code)` | 动态移除命令 |

> 动态 `feature` 主要面向从 uTools 等平台迁移的插件；普通插件把命令写在 `plugin.json` 里即可。

### 3.8 平台信息与主题

| API / 属性 | 说明 |
|---|---|
| `rubick.isMacOs()` / `isWindows()` / `isLinux()` | 平台判断 |
| `rubick.theme` | `'dark'` / `'light'`；暗色时插件页面 `<body>` 会被加上 `dark` 类 |
| `rubick.isDarkColors()` | ⚠️ 当前实现始终返回 `false`，请改用 `rubick.theme` 或 `document.body.classList.contains('dark')` |

### 3.9 高级 / 应用级 API

| API | 说明 |
|---|---|
| `rubick.createBrowserWindow(url, options, callback)` | 由插件创建独立 BrowserWindow。`options.name` 用来定位插件目录（目前按 npm 插件目录解析），`options.webPreferences.preload` 必填；`callback` 在 `dom-ready` 时调用。**本地插件包安装的插件暂不支持此 API**（找不到 `node_modules/<name>`），可改用 Node 的 `@electron/remote` 自行创建窗口 |
| `rubick.installPluginFromZip(filePath, options?)` | 从插件包（`.rubick` / `.zip`）安装插件（应用级能力，返回 Promise；普通插件一般不需要） |
| `rubick.installDevPlugin(sourceDir)` | 从本地插件源码目录安装/刷新插件（不复制、无需 npm link；插件市场「开发者」页使用） |
| `rubick.packLocalPlugin(sourceDir, outputPath?)` | 把本地插件目录打包成 `.rubick` / `.zip`（应用级能力，返回 Promise；插件市场「开发者」页使用） |
| `rubick.redirect(label, payload)` | ⚠️ 尚未实现（todo） |

`createBrowserWindow` 示例：

```js
const win = window.rubick.createBrowserWindow(
  'sub.html',
  {
    name: 'rubick-plugin-hello', // npm 包名
    width: 800,
    height: 600,
    webPreferences: { preload: 'sub-preload.js' },
  },
  () => {
    // 子窗口 dom-ready
  }
);
```

### 3.10 Node / Electron 直连

插件页面有完整 Node 权限，可以：

```js
const fs = require('fs');
const path = require('path');
const { ipcRenderer, shell } = require('electron');
const remote = require('@electron/remote');

// 打开当前插件页面的 DevTools
require('@electron/remote').getCurrentWebContents().openDevTools();
```

> `window.rubick` 是推荐入口；直接使用 Electron/Node 时请自行处理跨平台、安全与兼容性。

---

## 4. 系统插件（`pluginType: "system"`）

系统插件在主进程运行，适合做「插件市场本身」这类深度集成能力。

### 4.1 目录与元数据

```
my-system-plugin/
├── package.json
├── plugin.json
└── main.js
```

```json
{
  "name": "rubick-system-example",
  "pluginName": "示例系统插件",
  "version": "1.0.0",
  "pluginType": "system",
  "entry": "main.js"
}
```

### 4.2 入口约定

`entry` 在**主进程**中被 `require`，调用后应返回 hooks 对象：

```js
// main.js
module.exports = () => ({
  onReady(ctx) {
    // ctx 是 electron 模块对象，并额外注入了：
    //   ctx.mainWindow：主窗口 BrowserWindow
    //   ctx.API：主进程 API 实例（内部能力，慎用）
    const { app, ipcMain, mainWindow, API } = ctx;
    console.log('系统插件已就绪', app.getVersion());
  },
});
```

- 系统插件在 Rubick 启动时加载，**安装/更新后需要重启 Rubick 才生效**；
- 系统插件拥有主进程权限，能力最强，风险也最大；
- 系统插件如果同时提供 `main` 字段，也可以作为 UI 插件被呼起（可选）。

### 4.3 安装方式

- 插件市场（npm）：`pluginType: "system"` 分类；
- 本地插件包：`plugin.json` 中写 `"pluginType": "system"`、`"entry": "main.js"`，拖拽安装后重启。

---

## 5. 本地开发与调试

### 5.1 快速测试（插件包方式，推荐给独立插件项目）

```bash
# 在 Rubick 仓库根目录执行，把插件目录打成插件包（默认输出到插件目录同级的 <目录名>.rubick）
yarn plugin:pack /path/to/my-plugin

# 或者直接使用脚本（可在插件项目目录内执行）
node /path/to/rubick/scripts/pack-plugin.js .
```

然后：

1. 启动 Rubick（开发模式 `yarn electron:serve`，或用已安装的 Rubick）；
2. 把 `.rubick`（或 `.zip`）插件包拖到 Rubick 主窗口 / 插件市场；
3. 输入 `plugin.json` 里配置的命令词即可打开插件；
4. 修改代码后重新 `plugin:pack` 并再拖一次（会询问是否覆盖）。

### 5.2 开发者页方式（本地目录 / npm link）

仓库内置「开发者」入口：插件市场 → 账户菜单 → 开发者。

**方式一：从本地目录安装（推荐，无需 npm link）**

1. 点击「选择目录」，选中插件源码目录（需含 `plugin.json` 或 `package.json`）；
2. 点击「安装 / 刷新插件」：Rubick 直接引用该目录（不复制文件、不注册全局 npm 包）；
3. 修改插件代码或元数据后，再次点击「安装 / 刷新插件」即可重新读取并生效；
4. 记录为 `source: "dev"` + `localPath`，卸载时只移除插件记录，**不会删除开发者源码目录**。

**方式二：npm link（可选）**

1. 插件项目目录执行 `npm link`（把本地包链接到全局）；
2. 打开 Rubick → 插件市场 → 开发者 → 输入 `package.json` 的 `name` → 安装；
3. 修改代码后点「刷新插件」（会重新读取插件 `package.json`）；
4. 这种方式安装的插件记录带 `isDev`，不经过 npm registry。

开发者页最下方还有「打包插件」功能：选择本地插件目录 → 选择输出位置（默认 `<目录名>.rubick`）
→ 点击「开始打包」，即可生成可直接拖入 Rubick 安装的插件包，无需依赖命令行 / 系统 zip。

### 5.3 前端热更新（`development` 字段）

在 Rubick 以开发模式（`yarn electron:serve`）启动时，插件元数据里配置：

```json
{ "development": "http://localhost:8080" }
```

插件页面会直接加载该 URL，配合你的 Vite/Webpack dev server 可实现热更新。
生产打包时不要保留该字段（或保持 Rubick 非 dev 模式即可忽略）。

### 5.4 调试技巧

```js
// 插件页面内打开 DevTools
require('@electron/remote').getCurrentWebContents().openDevTools();

// 主窗口/插件页面报错可看：
// - 插件页 DevTools Console
// - `yarn electron:serve` 终端（主进程 console）
```

常见问题：

| 现象 | 排查 |
|---|---|
| 插件安装成功但搜不到 | `plugin.json` 是否有 `features` 且 `cmds` 非空；`pluginType` 是否为 `ui` |
| 打开插件白屏 | `main` 路径是否正确；页面资源是否用相对路径；看 DevTools |
| preload 没生效 | `preload` 相对路径是否正确；本地插件包中是否包含该文件 |
| 命令词冲突/不出现 | 换一个唯一的 `feature.code` 和更明确的关键词 |
| 数据读写冲突 | `_id` 是否加了插件名前缀；文档是否超过 2MB |
| 系统插件没反应 | 是否重启了 Rubick；`entry` 是否导出返回 hooks 的函数 |

---

## 6. 打包与分发

### 6.1 打包成本地插件包（`.rubick` / `.zip`，拖拽/离线分发）

> `.rubick` 是推荐的专属后缀，`.zip` 同样支持；两者本质都是 zip 容器，可以互相改名。
> 想换其他后缀（如 `.rpk`）时，同步修改
> [src/common/constans/pluginPackage.ts](src/common/constans/pluginPackage.ts)、[scripts/pack-plugin.js](scripts/pack-plugin.js)、
> [feature/src/App.vue](feature/src/App.vue)、[feature/src/views/installed/index.vue](feature/src/views/installed/index.vue)。

**方式一：Rubick 开发者页**

插件市场 → 账户菜单 → 开发者 → 「打包插件」→ 选择插件目录 → 开始打包。

**方式二：仓库脚本**

```bash
yarn plugin:pack ./path/to/my-plugin
yarn plugin:pack ./path/to/my-plugin ./dist/my-plugin.rubick
```

脚本实现见 [scripts/pack-plugin.js](scripts/pack-plugin.js)：默认输出 `.rubick`，自动排除 `node_modules`、`.git`、`.zip`、`.rubick`、`.DS_Store`。

**方式三：手动打包**

```bash
# macOS / Linux（.rubick / .zip 本质都是 zip，改后缀即可）
cd my-plugin
zip -r ../my-plugin.rubick . -x "*/node_modules/*" "node_modules/*" "*.zip" "*.rubick"

# Windows PowerShell（Compress-Archive 输出 .zip，之后可重命名为 .rubick）
Compress-Archive -Path .\my-plugin\* -DestinationPath .\my-plugin.zip
Rename-Item .\my-plugin.zip .\my-plugin.rubick
```

**插件包要求**（由 [installLocalPlugin.ts](src/main/common/installLocalPlugin.ts) 校验）：

- 必须是 `.rubick` 或 `.zip`（zip 容器）；
- 根目录或「唯一一级子目录」下包含 `plugin.json` 或 `package.json`；
- ≤ 200MB；解压后 ≤ 500MB；文件数 ≤ 20000；
- 不允许软链接（symlink）；
- 不允许路径穿越（`../`、绝对路径）；
- **不要包含 `node_modules`**：本地安装不会执行 `npm install`，依赖请提前打包进产物；
- 发布前确认 `main` / `preload` / `logo` 路径相对正确。

### 6.2 安装、更新、卸载（`.rubick` / `.zip`）

- 安装：拖拽 `.rubick` / `.zip` 插件包到主窗口/插件市场，或「已安装 → 安装本地插件」；
- 更新：把新版本打成同名插件包再拖入，确认覆盖即可（会替换插件目录，插件数据保留）；
- 卸载：插件市场 → 已安装 → 卸载（只删除插件目录与记录，PouchDB 数据保留）；
- 安装位置：`<userData>/rubick-plugins-new/local/<name>/`。

### 6.3 通过插件市场分发（npm）

插件市场本质是「npm 包 + 市场元数据」：

1. 插件项目提供 `package.json`（`name` / `version`）与构建后的静态产物；
2. 发布到 npm（或企业内网 registry）：
   ```bash
   npm publish --registry=https://registry.npmmirror.com
   ```
3. 在插件市场数据库中登记插件元数据（`pluginName`、`logo`、`main`、`preload`、`pluginType`、`features` 等），
   同一个插件可出现在市场列表/分类中；
4. 用户在市场中点击安装，Rubick 会在插件目录执行 `npm install <name>`，记录元数据后即可搜索使用；
5. 更新版本：`npm version patch && npm publish`，用户打开插件时会检测更新（根据 `package.json.dependencies`）。

内网部署：插件市场 → 偏好设置 → 内网部署，可配置 npm registry 和插件数据库 URL
（配置项实现见 [localhost.vue](feature/src/views/settings/localhost.vue)）。

### 6.4 发布前检查清单

- [ ] `plugin.json` 中 `name` 稳定且唯一，`pluginName`/`logo`/`description` 完整；
- [ ] `features[].cmds` 能搜到，`feature.code` 有意义且唯一；
- [ ] `main` 页面在 `file://` 下可正常加载，资源使用相对路径；
- [ ] `preload` 路径正确，且不依赖外部未打包文件；
- [ ] 没有把 `node_modules`、测试文件、`.git` 打进去；
- [ ] 数据 key 带插件名前缀，文档大小 < 2MB；
- [ ] 需要 Node/系统权限时，在 README 里明确告知用户（插件拥有完整 Node 权限）；
- [ ] 系统插件验证「重启后生效」；
- [ ] 需要兼容多平台时，检查 `platform` 字段与平台专属 API（截图、剪贴板文件复制等）。

---

## 7. API 速查表

```text
hooks:      onPluginEnter | onPluginReady | onPluginOut | onShow | onHide
窗口:        hideMainWindow | showMainWindow | setExpendHeight | setSubInput |
             setSubInputValue | removeSubInput | subInputBlur
对话框:      showOpenDialog | showSaveDialog | showNotification
系统:        shellOpenExternal | shellOpenPath | shellShowItemInFolder | shellBeep |
             getPath | getFileIcon | getCursorScreenPoint | getDisplayNearestPoint | getLocalId
剪贴板:      copyText | copyImage | copyFile | getCopyedFiles
数据:        db.put | db.get | db.remove | db.bulkDocs | db.allDocs |
             db.postAttachment | db.getAttachment | db.getAttachmentType(bug) |
             dbStorage.setItem | dbStorage.getItem | dbStorage.removeItem
截图:        screenCapture
插件控制:    openPlugin | removePlugin | outPlugin | getFeatures | setFeature | removeFeature
平台/主题:   isMacOs | isWindows | isLinux | theme | isDarkColors(bug)
高级:        createBrowserWindow | installPluginFromZip | installDevPlugin | packLocalPlugin | redirect(todo)
```

已知限制（当前版本）：

- `isDarkColors()` 恒为 `false`，用 `rubick.theme` 代替；
- `db.getAttachmentType()` 恒为 `null`；
- `createBrowserWindow` 只按 npm 插件目录解析，本地插件包安装的插件不支持；
- `showNotification` 的 `clickFeatureCode`、`redirect` 未实现；
- Linux 不支持截图和文件粘贴（`copyFile`/`screenCapture`）；
- 所有 `db`/窗口 API 走同步 IPC，密集调用时注意性能。

---

## 8. 维护约定

- 修改 `plugin.json` 字段 / 插件生命周期 / `window.rubick` API 时，同步更新本文件；
- 相关实现位置：
  - preload API：[public/preload.js](public/preload.js)
  - 主进程 API 实现：[src/main/common/api.ts](src/main/common/api.ts)
  - 插件加载：[src/main/browsers/runner.ts](src/main/browsers/runner.ts)
  - 系统插件：[src/main/common/registerSystemPlugin.ts](src/main/common/registerSystemPlugin.ts)
  - npm 插件管理：[src/core/plugin-handler/index.ts](src/core/plugin-handler/index.ts)
  - 插件包安装：[src/main/common/installLocalPlugin.ts](src/main/common/installLocalPlugin.ts)、[src/main/common/pluginInstaller.ts](src/main/common/pluginInstaller.ts)
  - 插件打包：[src/main/common/packLocalPlugin.ts](src/main/common/packLocalPlugin.ts)、[src/main/common/pluginPackager.ts](src/main/common/pluginPackager.ts)
  - 本地目录安装/刷新：[src/main/common/installDevPlugin.ts](src/main/common/installDevPlugin.ts)、[feature/src/views/dev/index.vue](feature/src/views/dev/index.vue)
  - 本地插件包使用说明：[docs/local-plugin-package.md](docs/local-plugin-package.md)
