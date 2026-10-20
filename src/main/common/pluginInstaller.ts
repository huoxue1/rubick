/**
 * 本地插件安装的主进程入口：
 * - 本地插件包（.rubick / .zip）安装
 * - 本地开发目录安装/刷新（替代 npm link 的开发者流程）
 * - 注册 ipcMain handler，供渲染进程（主窗口 / 插件市场）调用
 * - 安装成功后将插件记录写入 global.LOCAL_PLUGINS（与 npm 插件共用一份列表）
 */
import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import { PLUGIN_INSTALL_DIR } from '@/common/constans/main';
import {
  cleanupStaleTempDirs,
  installLocalPluginFromZip,
} from './installLocalPlugin';
import { installDevPluginFromDir } from './installDevPlugin';

export const LOCAL_PLUGIN_INSTALL_DIR = path.join(PLUGIN_INSTALL_DIR, 'local');

const INSTALL_PLUGIN_ZIP_CHANNEL = 'rubick:install-plugin-zip';
const INSTALL_DEV_PLUGIN_CHANNEL = 'rubick:install-dev-plugin';

/** 读取 npm 插件安装目录的 package.json，拿到通过市场安装的插件名 */
const getNpmPluginNames = (): string[] => {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(PLUGIN_INSTALL_DIR, 'package.json'), 'utf8')
    );
    return Object.keys(packageJson.dependencies || {});
  } catch (e) {
    return [];
  }
};

const getLocalPlugins = (): Array<Record<string, any>> => {
  const localPlugins = (global as any).LOCAL_PLUGINS;
  if (!localPlugins || typeof localPlugins.getLocalPlugins !== 'function') {
    return [];
  }
  return localPlugins.getLocalPlugins() || [];
};

export default function initPluginInstaller(): void {
  cleanupStaleTempDirs(LOCAL_PLUGIN_INSTALL_DIR);

  ipcMain.handle(
    INSTALL_PLUGIN_ZIP_CHANNEL,
    async (_event, payload: Record<string, any> = {}) => {
      const filePath = payload.filePath;
      const overwrite = !!payload.overwrite;
      if (typeof filePath !== 'string' || !filePath.trim()) {
        return {
          success: false,
          code: 'INVALID_ARGS',
          message: '缺少插件包路径',
        };
      }

      const result = await installLocalPluginFromZip(filePath, {
        installRoot: LOCAL_PLUGIN_INSTALL_DIR,
        overwrite,
        knownPlugins: getLocalPlugins(),
        npmPluginNames: getNpmPluginNames(),
      });
      if (!result.success || !result.plugin) {
        return result;
      }

      const plugin = result.plugin;
      const localPlugins = (global as any).LOCAL_PLUGINS;
      try {
        const exists = getLocalPlugins().some(
          (item) => item.name === plugin.name
        );
        if (exists) {
          localPlugins.updatePlugin(plugin);
        } else {
          localPlugins.addPlugin(plugin);
        }
      } catch (e: any) {
        return {
          success: false,
          code: 'INSTALL_FAILED',
          message: `安装成功但写入插件配置失败：${
            e && e.message ? e.message : e
          }`,
        };
      }

      return {
        success: true,
        plugin,
        requireRestart: plugin.pluginType === 'system',
        message:
          plugin.pluginType === 'system'
            ? '系统插件安装成功，需要重启 Rubick 后生效'
            : '插件安装成功',
      };
    }
  );

  // 从本地开发目录安装/刷新插件（无需 npm link，直接引用源码目录）
  ipcMain.handle(
    INSTALL_DEV_PLUGIN_CHANNEL,
    async (_event, payload: Record<string, any> = {}) => {
      const sourceDir = payload.sourceDir;
      if (typeof sourceDir !== 'string' || !sourceDir.trim()) {
        return {
          success: false,
          code: 'INVALID_ARGS',
          message: '缺少插件目录',
        };
      }
      const result = installDevPluginFromDir(sourceDir, getLocalPlugins());
      if (!result.success || !result.plugin) {
        return result;
      }

      const plugin = result.plugin;
      const previous = getLocalPlugins().find(
        (item) => item.name === plugin.name
      );
      try {
        const localPlugins = (global as any).LOCAL_PLUGINS;
        if (previous) {
          localPlugins.updatePlugin(plugin);
        } else {
          localPlugins.addPlugin(plugin);
        }
      } catch (e: any) {
        return {
          success: false,
          code: 'INSTALL_FAILED',
          message: `插件元数据读取成功但写入插件配置失败：${
            e && e.message ? e.message : e
          }`,
        };
      }

      return {
        success: true,
        plugin,
        requireRestart: plugin.pluginType === 'system',
        message: previous
          ? '插件已刷新（重新读取了目录中的元数据）'
          : '插件已从本地目录安装，无需 npm link',
      };
    }
  );
}
