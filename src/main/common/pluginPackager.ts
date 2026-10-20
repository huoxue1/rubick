/**
 * 插件打包的主进程 IPC 入口，供插件市场「开发者」页调用。
 */
import { ipcMain } from 'electron';
import { packLocalPlugin } from './packLocalPlugin';

const PACK_PLUGIN_CHANNEL = 'rubick:pack-plugin';

export default function initPluginPackager(): void {
  ipcMain.handle(
    PACK_PLUGIN_CHANNEL,
    async (_event, payload: Record<string, any> = {}) => {
      const sourceDir = payload.sourceDir;
      const outputPath = payload.outputPath;
      if (typeof sourceDir !== 'string' || !sourceDir.trim()) {
        return {
          success: false,
          code: 'INVALID_ARGS',
          message: '缺少插件目录',
        };
      }
      if (
        outputPath !== undefined &&
        outputPath !== null &&
        (typeof outputPath !== 'string' || !outputPath.trim())
      ) {
        return {
          success: false,
          code: 'INVALID_ARGS',
          message: '输出路径不合法',
        };
      }
      return packLocalPlugin(
        sourceDir.trim(),
        typeof outputPath === 'string' && outputPath.trim()
          ? outputPath.trim()
          : undefined
      );
    }
  );
}
