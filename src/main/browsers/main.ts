import { app, BrowserWindow, protocol, nativeTheme } from 'electron';
import path from 'path';
import { createProtocol } from 'vue-cli-plugin-electron-builder/lib';
// import versonHandler from '../common/versionHandler';
import localConfig from '@/main/common/initLocalConfig';
import {
  WINDOW_HEIGHT,
  WINDOW_MIN_HEIGHT,
  WINDOW_WIDTH,
} from '@/common/constans/common';
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('@electron/remote/main').initialize();

export default () => {
  let win: any;
  let lastShowTime = 0;

  const init = () => {
    createWindow();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('@electron/remote/main').enable(win.webContents);
  };

  const createWindow = async () => {
    win = new BrowserWindow({
      height: WINDOW_HEIGHT,
      minHeight: WINDOW_MIN_HEIGHT,
      useContentSize: true,
      resizable: true,
      width: WINDOW_WIDTH,
      frame: false,
      title: '拉比克',
      show: false,
      skipTaskbar: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c28' : '#fff',
      webPreferences: {
        webSecurity: false,
        backgroundThrottling: false,
        contextIsolation: false,
        webviewTag: true,
        nodeIntegration: true,
        preload: path.join(__static, 'preload.js'),
        spellcheck: false,
      },
    });
    if (process.env.WEBPACK_DEV_SERVER_URL) {
      // Load the url of the dev server if in development mode
      win.loadURL(process.env.WEBPACK_DEV_SERVER_URL as string);
    } else {
      createProtocol('app');
      // Load the index.html when not in development
      win.loadURL('app://./index.html');
    }
    protocol.interceptFileProtocol('image', (req, callback) => {
      const url = req.url.substr(8);
      callback(decodeURI(url));
    });
    win.on('closed', () => {
      win = undefined;
    });

    win.on('show', () => {
      lastShowTime = Date.now();
      (win as any).__lastShowTime = lastShowTime;
      // 触发主窗口的 onShow hook
      win.webContents.executeJavaScript(
        `window.rubick && window.rubick.hooks && typeof window.rubick.hooks.onShow === "function" && window.rubick.hooks.onShow()`
      );
      // versonHandler.checkUpdate();
      // win.webContents.openDevTools();
    });

    win.on('hide', () => {
      // 触发主窗口的 onHide hook
      win.webContents.executeJavaScript(
        `window.rubick && window.rubick.hooks && typeof window.rubick.hooks.onHide === "function" && window.rubick.hooks.onHide()`
      );
    });

    // 判断失焦是否隐藏
    // 失焦处理：不主动抢焦点（抢焦点会拦阻用户点击其他应用）。
    // 失焦后延迟 1.2 秒裁决：期间若扩展把焦点夺回（判定为 Shell 误抢）则取消隐藏；
    // 否则说明是用户点了其他应用，正常隐藏。
    let pendingHide: any = null;
    win.on('focus', () => {
      if (pendingHide) {
        clearTimeout(pendingHide);
        pendingHide = null;
      }
    });
    win.on('blur', async () => {
      const config = await localConfig.getConfig();
      if (!config.perf.common.hideOnBlur) return;
      if (Date.now() - lastShowTime < 8000) {
        if (pendingHide) clearTimeout(pendingHide);
        pendingHide = setTimeout(() => {
          pendingHide = null;
          if (win && !win.isDestroyed() && !win.isFocused()) win.hide();
        }, 1200);
        return;
      }
      win.hide();
    });
  };

  const getWindow = () => win;

  return {
    init,
    getWindow,
  };
};
