const { ipcRenderer, shell } = require('electron');
const { BrowserWindow, nativeTheme, screen, app } = require('@electron/remote');
const os = require('os');
const path = require('path');

const appPath = app.getPath('userData');

const baseDir = path.join(appPath, './rubick-plugins-new');

const ipcSendSync = (type, data) => {
  const returnValue = ipcRenderer.sendSync('msg-trigger', {
    type,
    data,
  });
  if (returnValue instanceof Error) throw returnValue;
  return returnValue;
};

const ipcSend = (type, data) => {
  ipcRenderer.send('msg-trigger', {
    type,
    data,
  });
};

window.rubick = {
  hooks: {},
  __event__: {},
  // 事件
  onPluginEnter(cb) {
    typeof cb === 'function' && (window.rubick.hooks.onPluginEnter = cb);
  },
  onPluginReady(cb) {
    typeof cb === 'function' && (window.rubick.hooks.onPluginReady = cb);
  },
  onPluginOut(cb) {
    typeof cb === 'function' && (window.rubick.hooks.onPluginOut = cb);
  },
  openPlugin(plugin) {
    ipcSendSync('loadPlugin', plugin);
  },
  /**
   * 从本地插件包（.rubick / .zip）安装插件
   * @param {string} filePath 插件包绝对路径
   * @param {{ overwrite?: boolean }} options
   * @returns {Promise<{ success: boolean, code?: string, message?: string, plugin?: object, requireRestart?: boolean }>}
   */
  installPluginFromZip(filePath, options = {}) {
    return ipcRenderer.invoke('rubick:install-plugin-zip', {
      filePath,
      overwrite: !!options.overwrite,
    });
  },
  /**
   * 从本地开发目录安装/刷新插件（不复制文件，直接引用源码目录，无需 npm link）
   * @param {string} sourceDir 插件源码目录绝对路径
   * @returns {Promise<{ success: boolean, code?: string, message?: string, plugin?: object, requireRestart?: boolean }>}
   */
  installDevPlugin(sourceDir) {
    return ipcRenderer.invoke('rubick:install-dev-plugin', { sourceDir });
  },
  /**
   * 把本地插件目录打包成插件包（.rubick / .zip）
   * @param {string} sourceDir 插件目录绝对路径
   * @param {string} [outputPath] 输出文件路径；不传时输出到插件目录同级的 <目录名>.rubick
   * @returns {Promise<{ success: boolean, code?: string, message?: string, filePath?: string, fileCount?: number, bytes?: number, warnings?: string[] }>}
   */
  packLocalPlugin(sourceDir, outputPath) {
    return ipcRenderer.invoke('rubick:pack-plugin', {
      sourceDir,
      outputPath,
    });
  },
  onShow(cb) {
    typeof cb === 'function' && (window.rubick.hooks.onShow = cb);
  },
  onHide(cb) {
    typeof cb === 'function' && (window.rubick.hooks.onHide = cb);
  },
  // 窗口交互
  hideMainWindow() {
    ipcSendSync('hideMainWindow');
  },
  showMainWindow() {
    ipcSendSync('showMainWindow');
  },
  showOpenDialog(options) {
    return ipcSendSync('showOpenDialog', options);
  },
  showSaveDialog(options) {
    return ipcSendSync('showSaveDialog', options);
  },

  setExpendHeight(height) {
    ipcSendSync('setExpendHeight', height);
  },
  setSubInput(onChange, placeholder = '', isFocus) {
    typeof onChange === 'function' &&
      (window.rubick.hooks.onSubInputChange = onChange);
    ipcSendSync('setSubInput', {
      placeholder,
      isFocus,
    });
  },
  removeSubInput() {
    delete window.rubick.hooks.onSubInputChange;
    ipcSendSync('removeSubInput');
  },
  setSubInputValue(text) {
    ipcSendSync('setSubInputValue', { text });
  },
  subInputBlur() {
    ipcSendSync('subInputBlur');
  },
  getPath(name) {
    return ipcSendSync('getPath', { name });
  },
  showNotification(body, clickFeatureCode) {
    ipcSend('showNotification', { body, clickFeatureCode });
  },
  copyImage(img) {
    return ipcSendSync('copyImage', { img });
  },
  copyText(text) {
    return ipcSendSync('copyText', { text });
  },
  copyFile: (file) => {
    return ipcSendSync('copyFile', { file });
  },
  db: {
    put: (data) => ipcSendSync('dbPut', { data }),
    get: (id) => ipcSendSync('dbGet', { id }),
    remove: (doc) => ipcSendSync('dbRemove', { doc }),
    bulkDocs: (docs) => ipcSendSync('dbBulkDocs', { docs }),
    allDocs: (key) => ipcSendSync('dbAllDocs', { key }),
    postAttachment: (docId, attachment, type) =>
      ipcSendSync('dbPostAttachment', { docId, attachment, type }),
    getAttachment: (docId) => ipcSendSync('dbGetAttachment', { docId }),
    getAttachmentType: (docId) => ipcSendSync('dbGetAttachmentType', { docId }),
  },
  dbStorage: {
    setItem: (key, value) => {
      const target = { _id: String(key) };
      const result = ipcSendSync('dbGet', { id: target._id });
      result && (target._rev = result._rev);
      target.value = value;
      const res = ipcSendSync('dbPut', { data: target });
      if (res.error) throw new Error(res.message);
    },
    getItem: (key) => {
      const res = ipcSendSync('dbGet', { id: key });
      return res && 'value' in res ? res.value : null;
    },
    removeItem: (key) => {
      const res = ipcSendSync('dbGet', { id: key });
      res && ipcSendSync('dbRemove', { doc: res });
    },
  },
  isDarkColors() {
    return false;
  },
  getFeatures() {
    return ipcSendSync('getFeatures');
  },
  setFeature(feature) {
    return ipcSendSync('setFeature', { feature });
  },
  screenCapture(cb) {
    typeof cb === 'function' &&
      (window.rubick.hooks.onScreenCapture = ({ data }) => {
        cb(data);
      });
    ipcSendSync('screenCapture');
  },
  removeFeature(code) {
    return ipcSendSync('removeFeature', { code });
  },

  // 系统
  shellOpenExternal(url) {
    shell.openExternal(url);
  },

  isMacOs() {
    return os.type() === 'Darwin';
  },

  isWindows() {
    return os.type() === 'Windows_NT';
  },

  isLinux() {
    return os.type() === 'Linux';
  },

  shellOpenPath(path) {
    shell.openPath(path);
  },

  getLocalId: () => ipcSendSync('getLocalId'),

  removePlugin() {
    ipcSend('removePlugin');
  },

  shellShowItemInFolder: (path) => {
    ipcSend('shellShowItemInFolder', { path });
  },

  redirect: (label, payload) => {
    // todo
  },

  shellBeep: () => {
    ipcSend('shellBeep');
  },

  getFileIcon: (path) => {
    return ipcSendSync('getFileIcon', { path });
  },

  getCopyedFiles: () => {
    return ipcSendSync('getCopyFiles');
  },

  simulateKeyboardTap: (key, ...modifier) => {
    ipcSend('simulateKeyboardTap', { key, modifier });
  },

  getCursorScreenPoint: () => {
    return screen.getCursorScreenPoint();
  },

  getDisplayNearestPoint: (point) => {
    return screen.getDisplayNearestPoint(point);
  },

  outPlugin: () => {
    return ipcSend('removePlugin');
  },

  createBrowserWindow: (url, options, callback) => {
    const winUrl = path.resolve(baseDir, 'node_modules', options.name);
    const winIndex = `file://${path.join(winUrl, './', url || '')}`;
    const preloadPath = path.join(
      winUrl,
      './',
      options.webPreferences.preload || ''
    );
    let win = new BrowserWindow({
      useContentSize: true,
      resizable: true,
      title: '拉比克',
      show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c28' : '#fff',
      ...options,
      webPreferences: {
        webSecurity: false,
        backgroundThrottling: false,
        contextIsolation: false,
        webviewTag: true,
        nodeIntegration: true,
        spellcheck: false,
        partition: null,
        ...(options.webPreferences || {}),
        preload: preloadPath,
      },
    });
    win.loadURL(winIndex);

    win.on('closed', () => {
      win = undefined;
    });
    win.once('ready-to-show', () => {
      win.show();
    });
    win.webContents.on('dom-ready', () => {
      callback && callback();
    });
    return win;
  },
};
