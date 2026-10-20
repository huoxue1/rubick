/**
 * 从本地开发目录安装/刷新插件。
 *
 * 与 npm link 方式不同，这里不注册全局包、不复制文件：
 * 直接把插件记录的 localPath 指向开发者选择的目录，
 * 修改插件代码后重新「刷新」即可重新读取元数据并生效。
 *
 * 不依赖 electron，方便单独测试。
 */
import path from 'path';
import fs from 'fs';
import { parsePluginMetadata, resolveLogo } from './installLocalPlugin';

export type InstallDevPluginErrorCode =
  | 'INVALID_ARGS'
  | 'INVALID_METADATA'
  | 'PLUGIN_CONFLICT';

export interface InstallDevPluginResult {
  success: boolean;
  code?: InstallDevPluginErrorCode;
  message?: string;
  plugin?: Record<string, any>;
}

const failure = (
  code: InstallDevPluginErrorCode,
  message: string
): InstallDevPluginResult => ({ success: false, code, message });

const isDirectory = (target: string): boolean => {
  try {
    return fs.statSync(target).isDirectory();
  } catch (e) {
    return false;
  }
};

/**
 * 校验开发目录并生成插件记录。
 * @param sourceDirInput 插件源码目录
 * @param knownPlugins 已登记插件，用于判断同名来源冲突
 */
export const installDevPluginFromDir = (
  sourceDirInput: string,
  knownPlugins: Array<Record<string, any>> = []
): InstallDevPluginResult => {
  if (!sourceDirInput || typeof sourceDirInput !== 'string') {
    return failure('INVALID_ARGS', '缺少插件目录');
  }
  const sourceDir = path.resolve(sourceDirInput.trim());
  if (!isDirectory(sourceDir)) {
    return failure('INVALID_ARGS', `插件目录不存在或不是目录：${sourceDir}`);
  }

  let parsed;
  try {
    parsed = parsePluginMetadata(sourceDir);
  } catch (e: any) {
    return failure(
      e && e.code ? e.code : 'INVALID_METADATA',
      e && e.message ? e.message : String(e)
    );
  }

  const existing = knownPlugins.find((plugin) => plugin.name === parsed.name);
  if (existing && existing.source !== 'dev') {
    return failure(
      'PLUGIN_CONFLICT',
      `已存在同名插件 ${parsed.name}（来源：${
        existing.source === 'zip' ? '本地插件包' : '插件市场'
      }），请先在「已安装」中卸载后再用目录方式安装`
    );
  }

  const info = parsed.pluginInfo;
  const plugin: Record<string, any> = {
    name: parsed.name,
    pluginName: info.pluginName || parsed.name,
    description: info.description || '',
    author: info.author || '',
    version: info.version || '0.0.0',
    pluginType: parsed.pluginType,
    features: parsed.features,
    logo: resolveLogo(sourceDir, parsed.logo),
    source: 'dev',
    isDev: true,
    localPath: sourceDir,
    installedAt: new Date().toISOString(),
  };
  if (parsed.pluginType === 'ui' && parsed.main) plugin.main = parsed.main;
  if (parsed.pluginType === 'system') {
    plugin.entry = parsed.entry;
    if (info.main) plugin.main = info.main;
  } else if (info.entry) {
    plugin.entry = info.entry;
  }
  if (parsed.preload) plugin.preload = parsed.preload;
  if (parsed.pluginSetting) plugin.pluginSetting = parsed.pluginSetting;
  if (parsed.platform) plugin.platform = parsed.platform;
  if (info.development) plugin.development = info.development;
  if (info.homepage) plugin.homepage = info.homepage;

  return { success: true, plugin };
};
