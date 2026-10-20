'use strict';
import electron, {
  app,
  globalShortcut,
  protocol,
  BrowserWindow,
} from 'electron';
import { main, guide } from './browsers';
import commonConst from '../common/utils/commonConst';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import API from './common/api';
import createTray from './common/tray';
import registerHotKey from './common/registerHotKey';
import localConfig from './common/initLocalConfig';
import {
  getSearchFiles,
  putFileToRubick,
  macBeforeOpen,
} from './common/getSearchFiles';

import '../common/utils/localPlugin';

import checkVersion from './common/versionHandler';
import registerSystemPlugin from './common/registerSystemPlugin';
import initPluginInstaller from './common/pluginInstaller';

class App {
  public windowCreator: { init: () => void; getWindow: () => BrowserWindow };
  private systemPlugins: any;

  constructor() {
    protocol.registerSchemesAsPrivileged([
      { scheme: 'app', privileges: { secure: true, standard: true } },
    ]);
    this.windowCreator = main();
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
      app.quit();
    } else {
      this.systemPlugins = registerSystemPlugin();
      this.beforeReady();
      this.onReady();
      this.onRunning();
      this.onQuit();
    }
  }
  beforeReady() {
    // 系统托盘
    if (commonConst.macOS()) {
      macBeforeOpen();
      if (commonConst.production() && !app.isInApplicationsFolder()) {
        app.moveToApplicationsFolder();
      } else {
        app.dock.hide();
      }
    } else {
      app.disableHardwareAcceleration();
    }
  }

  createWindow() {
    this.windowCreator.init();
  }
  onReady() {
    const readyFunction = async () => {
      checkVersion();
      await localConfig.init();
      const config = await localConfig.getConfig();
      if (!config.perf.common.guide) {
        guide().init();
        config.perf.common.guide = true;
        localConfig.setConfig(config);
      }
      this.createWindow();
      const mainWindow = this.windowCreator.getWindow();
      API.init(mainWindow);
      initPluginInstaller();
      createTray(this.windowCreator.getWindow());
      registerHotKey(this.windowCreator.getWindow());
      this.systemPlugins.triggerReadyHooks(
        Object.assign(electron, {
          mainWindow: this.windowCreator.getWindow(),
          API,
        })
      );
    };
    if (!app.isReady()) {
      app.on('ready', readyFunction);
    } else {
      readyFunction();
    }
  }

  onRunning() {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
      const files = getSearchFiles(commandLine, workingDirectory);
      const win = this.windowCreator.getWindow();
      // 当运行第二个实例时,将会聚焦到myWindow这个窗口
      // 如果有文件列表作为参数，说明是命令行启动
      if (win) {
        if (win.isMinimized()) {
          win.restore();
        }
        // Wayland 修复：不信任 isVisible()（在 Wayland 下半映射状态会误报），
        // 每次二次启动都无条件执行完整的 置顶→映射→聚焦 序列
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        win.setAlwaysOnTop(true);
        win.show();
        win.focus();
        win.webContents.focus();
        // 注意：不要取消 visibleOnAllWorkspaces，否则会触发工作区切换→blur→自动隐藏
        setTimeout(() => {
          // 保持 AlwaysOnTop 不取消： launcher 类窗口本就该置顶，且取消置顶可能触发焦点被 shell 抢走
          win.focus();
          win.webContents.focus();
          // DOM 级兜底聚焦：确保按键落在搜索输入框而不是 document.body
          win.webContents.executeJavaScript(
            `(function(){var el=document.querySelector('input')||document.querySelector('[contenteditable="true"]'); if(el){el.focus(); if(el.select)el.select();} })()`
          ).catch(() => {});
        }, 150);
        if (files.length > 0) {
          putFileToRubick(win.webContents, files);
        }
      }
    });
    app.on('activate', () => {
      if (!this.windowCreator.getWindow()) {
        this.createWindow();
      }
    });
    if (commonConst.windows()) {
      // app.setAppUserModelId(pkg.build.appId)
    }
  }

  onQuit() {
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('will-quit', () => {
      globalShortcut.unregisterAll();
    });

    if (commonConst.dev()) {
      if (process.platform === 'win32') {
        process.on('message', (data) => {
          if (data === 'graceful-exit') {
            app.quit();
          }
        });
      } else {
        process.on('SIGTERM', () => {
          app.quit();
        });
      }
    }
  }
}

export default new App();
