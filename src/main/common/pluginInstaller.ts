/**
 * 本地插件包（.rubick / .zip）安装的主进程入口：
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

export const LOCAL_PLUGIN_INSTALL_DIR = path.join(PLUGIN_INSTALL_DIR, 'local');

const INSTALL_PLUGIN_ZIP_CHANNEL = 'rubick:install-plugin-zip';

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
}
