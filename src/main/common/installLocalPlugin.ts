/**
 * 本地插件包安装器
 *
 * 与 npm 安装的插件不同，这里的插件不经过 npm registry：
 * 插件包（`.rubick` / `.zip`，本质都是 zip 容器）解压后直接放到
 * PLUGIN_INSTALL_DIR/local/<name> 目录，由 LOCAL_PLUGINS 记录元数据，
 * 再由主进程 / 渲染进程按 localPath 加载。
 *
 * 该模块只负责「解压 + 校验 + 落盘」，不依赖 electron，方便单独测试。
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import extract from 'extract-zip';
import {
  isPluginPackagePath,
  PLUGIN_PACKAGE_EXTENSIONS,
} from '@/common/constans/pluginPackage';

export type LocalPluginInstallErrorCode =
  | 'INVALID_ARGS'
  | 'INVALID_ZIP'
  | 'INVALID_METADATA'
  | 'PLUGIN_EXISTS'
  | 'PLUGIN_CONFLICT'
  | 'INSTALL_FAILED';

export interface LocalPluginInstallOptions {
  /** 本地插件安装根目录，最终会安装到 <installRoot>/<pluginName> */
  installRoot: string;
  /** 是否允许覆盖已安装的同名本地插件 */
  overwrite?: boolean;
  /** 已登记的插件列表，用于冲突 / 覆盖判断 */
  knownPlugins?: Array<Record<string, any>>;
  /** 通过 npm 安装的插件名称，zip 插件不允许与其重名 */
  npmPluginNames?: string[];
}

export interface LocalPluginInstallResult {
  success: boolean;
  code?: LocalPluginInstallErrorCode;
  message?: string;
  plugin?: Record<string, any>;
}

/** 单个压缩包大小上限 200MB */
const MAX_ZIP_BYTES = 200 * 1024 * 1024;
/** 压缩包内文件数量上限 */
const MAX_ENTRY_COUNT = 20000;
/** 解压后总大小上限 500MB */
const MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
/** 插件名只允许作为安全的目录名使用，同时避免 npm scope（@scope/name） */
const PLUGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,80}$/i;
const RESERVED_NAMES = new Set(['rubick-system-feature']);
const METADATA_FILES = ['plugin.json', 'package.json'];
const TEMP_DIR_PREFIX = '.install-';
/** zip 中符号链接的 unix mode 类型位 */
const UNIX_LINK_MASK = 0xf000;
const UNIX_LINK_TYPE = 0xa000;

class InstallError extends Error {
  public code: LocalPluginInstallErrorCode;

  constructor(code: LocalPluginInstallErrorCode, message: string) {
    super(message);
    this.name = 'InstallError';
    this.code = code;
  }
}

const failure = (
  code: LocalPluginInstallErrorCode,
  message: string
): LocalPluginInstallResult => ({
  success: false,
  code,
  message,
});

const isFile = (target: string): boolean => {
  try {
    return fs.statSync(target).isFile();
  } catch (e) {
    return false;
  }
};

const isDirectory = (target: string): boolean => {
  try {
    return fs.statSync(target).isDirectory();
  } catch (e) {
    return false;
  }
};

const removeDir = (target: string): void => {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (e) {
    // 清理失败不影响安装结果，留待下次启动时清理
  }
};

/**
 * 防止 zip 内路径穿越：解析后的路径必须位于 root 目录内
 */
const resolveInside = (root: string, target: string, field: string): string => {
  const normalizedTarget = String(target || '').replace(/\\/g, '/');
  if (normalizedTarget.startsWith('/') || /^[a-zA-Z]:/.test(normalizedTarget)) {
    throw new InstallError(
      'INVALID_METADATA',
      `插件元数据字段 ${field} 不能是绝对路径：${target}`
    );
  }
  const resolved = path.resolve(root, normalizedTarget);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new InstallError(
      'INVALID_METADATA',
      `插件元数据字段 ${field} 存在路径穿越：${target}`
    );
  }
  return resolved;
};

const readJson = (filePath: string, field: string): Record<string, any> => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e: any) {
    throw new InstallError(
      'INVALID_METADATA',
      `解析 ${field} 失败：${e && e.message ? e.message : e}`
    );
  }
};

const hasMetadataFile = (dir: string): boolean =>
  METADATA_FILES.some((file) => isFile(path.join(dir, file)));

/**
 * 允许两种压缩包布局：
 * 1. 压缩包根目录直接是插件目录（plugin.json/package.json 在根目录）
 * 2. 压缩包根目录下只有一个插件目录（常见的「右键压缩文件夹」产物）
 */
const findMetadataRoot = (extractDir: string): string => {
  if (hasMetadataFile(extractDir)) return extractDir;

  let children: string[] = [];
  try {
    children = fs
      .readdirSync(extractDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.name.startsWith('.') &&
          entry.name !== '__MACOSX'
      )
      .map((entry) => path.join(extractDir, entry.name))
      .filter((dir) => hasMetadataFile(dir));
  } catch (e) {
    throw new InstallError('INVALID_ZIP', '读取解压目录失败');
  }

  if (children.length === 0) {
    throw new InstallError(
      'INVALID_METADATA',
      '插件包中未找到 plugin.json 或 package.json，请检查包根目录结构'
    );
  }
  if (children.length > 1) {
    throw new InstallError(
      'INVALID_METADATA',
      '插件包根目录下存在多个插件目录，请只打包一个插件'
    );
  }
  return children[0];
};

/** 校验解压产物中不存在软链接，避免通过软链接把文件写到插件目录外 */
const assertNoSymlink = (dir: string): void => {
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop() as string;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new InstallError(
          'INVALID_ZIP',
          `插件包中不允许包含软链接：${path.relative(dir, target)}`
        );
      }
      if (entry.isDirectory()) stack.push(target);
    }
  }
};

const normalizeFeatures = (features: any): Array<Record<string, any>> => {
  if (!Array.isArray(features)) return [];
  return features.filter((feature) => feature && typeof feature === 'object');
};

export interface ParsedPlugin {
  name: string;
  pluginType: 'ui' | 'system';
  main?: string;
  entry?: string;
  preload?: string;
  logo?: string;
  features: Array<Record<string, any>>;
  pluginSetting?: Record<string, any>;
  platform?: string[];
  pluginInfo: Record<string, any>;
}

/**
 * 读取并校验插件元数据。
 * plugin.json 优先，没有时回退到 package.json；两者都存在时以 plugin.json 为准。
 */
export const parsePluginMetadata = (root: string): ParsedPlugin => {
  const pluginJsonPath = path.join(root, 'plugin.json');
  const packageJsonPath = path.join(root, 'package.json');
  const pluginJson = isFile(pluginJsonPath)
    ? readJson(pluginJsonPath, 'plugin.json')
    : {};
  const packageJson = isFile(packageJsonPath)
    ? readJson(packageJsonPath, 'package.json')
    : {};
  const meta = { ...packageJson, ...pluginJson };

  const name = String(meta.name || packageJson.name || '').trim();
  if (!name) {
    throw new InstallError('INVALID_METADATA', '插件元数据缺少 name 字段');
  }
  if (!PLUGIN_NAME_PATTERN.test(name) || name.includes('..')) {
    throw new InstallError(
      'INVALID_METADATA',
      `插件名不合法：${name}（仅支持字母、数字、点、下划线、短横线，且不能以点开头）`
    );
  }
  if (RESERVED_NAMES.has(name)) {
    throw new InstallError(
      'PLUGIN_CONFLICT',
      `插件名 ${name} 为 Rubick 内置插件保留名，不能用于本地插件`
    );
  }

  const pluginType = String(
    meta.pluginType || (meta.entry ? 'system' : 'ui')
  ).trim();
  if (pluginType !== 'ui' && pluginType !== 'system') {
    throw new InstallError(
      'INVALID_METADATA',
      `不支持的插件类型：${pluginType}，本地插件仅支持 ui / system`
    );
  }

  const features = normalizeFeatures(meta.features);
  let main: string | undefined;
  let entry: string | undefined;
  let preload: string | undefined;

  if (pluginType === 'ui') {
    if (!meta.main || typeof meta.main !== 'string') {
      throw new InstallError(
        'INVALID_METADATA',
        'UI 插件必须在 plugin.json/package.json 中声明 main（插件入口 HTML）'
      );
    }
    main = String(meta.main).trim();
    const mainPath = resolveInside(root, main, 'main');
    if (!isFile(mainPath)) {
      throw new InstallError(
        'INVALID_METADATA',
        `UI 插件入口文件不存在：${main}`
      );
    }
    if (!features.length) {
      throw new InstallError(
        'INVALID_METADATA',
        'UI 插件必须声明 features，否则无法通过关键词呼起'
      );
    }
    for (const feature of features) {
      if (!feature || typeof feature.code !== 'string' || !feature.code) {
        throw new InstallError(
          'INVALID_METADATA',
          '插件 features 中缺少 code 字段'
        );
      }
      if (!Array.isArray(feature.cmds) || !feature.cmds.length) {
        throw new InstallError(
          'INVALID_METADATA',
          `插件 feature ${feature.code} 缺少 cmds 呼起命令`
        );
      }
    }
  } else {
    const entryField = meta.entry || meta.main;
    if (!entryField || typeof entryField !== 'string') {
      throw new InstallError(
        'INVALID_METADATA',
        '系统插件必须在 plugin.json/package.json 中声明 entry/main（主进程入口）'
      );
    }
    entry = String(entryField).trim();
    if (!isFile(resolveInside(root, entry, 'entry'))) {
      throw new InstallError(
        'INVALID_METADATA',
        `系统插件入口文件不存在：${entry}`
      );
    }
  }

  if (meta.preload !== undefined) {
    if (typeof meta.preload !== 'string' || !meta.preload.trim()) {
      throw new InstallError('INVALID_METADATA', 'preload 必须是文件路径');
    }
    preload = meta.preload.trim();
    if (!isFile(resolveInside(root, preload, 'preload'))) {
      throw new InstallError(
        'INVALID_METADATA',
        `插件 preload 文件不存在：${preload}`
      );
    }
  }

  let logo: string | undefined;
  if (typeof meta.logo === 'string' && meta.logo.trim()) {
    logo = meta.logo.trim();
  }

  return {
    name,
    pluginType: pluginType as 'ui' | 'system',
    main,
    entry,
    preload,
    logo,
    features,
    pluginSetting: meta.pluginSetting,
    platform: Array.isArray(meta.platform) ? meta.platform : undefined,
    pluginInfo: meta,
  };
};

/** 相对路径的 logo 转成 file:// URL，绝对/远端/data URL 保持不变 */
export const resolveLogo = (pluginDir: string, logo?: string): string | undefined => {
  if (!logo) return undefined;
  if (/^(https?:|data:|file:)/i.test(logo)) return logo;
  try {
    const logoPath = resolveInside(pluginDir, logo, 'logo');
    return isFile(logoPath) ? pathToFileURL(logoPath).href : undefined;
  } catch (e) {
    return undefined;
  }
};

const buildPluginRecord = (
  parsed: ParsedPlugin,
  finalDir: string,
  zipPath: string
): Record<string, any> => {
  const info = parsed.pluginInfo;
  const plugin: Record<string, any> = {
    name: parsed.name,
    pluginName: info.pluginName || parsed.name,
    description: info.description || '',
    author: info.author || '',
    version: info.version || '0.0.0',
    pluginType: parsed.pluginType,
    features: parsed.features,
    logo: resolveLogo(finalDir, parsed.logo),
    source: 'zip',
    localPath: finalDir,
    installedAt: new Date().toISOString(),
    originZip: path.basename(zipPath),
  };
  if (parsed.pluginType === 'ui' && parsed.main) plugin.main = parsed.main;
  if (parsed.pluginType === 'system') {
    plugin.entry = parsed.entry;
    // 系统插件如果同时提供了 UI 入口，也保留下来
    if (info.main) plugin.main = info.main;
  } else if (info.entry) {
    plugin.entry = info.entry;
  }
  if (parsed.preload) plugin.preload = parsed.preload;
  if (parsed.pluginSetting) plugin.pluginSetting = parsed.pluginSetting;
  if (parsed.platform) plugin.platform = parsed.platform;
  if (info.homepage) plugin.homepage = info.homepage;
  return plugin;
};

/** 清理目录中残留的 .install-* 临时目录（安装中断 / 进程崩溃导致） */
export const cleanupStaleTempDirs = (installRoot: string): void => {
  try {
    if (!isDirectory(installRoot)) return;
    const now = Date.now();
    for (const entry of fs.readdirSync(installRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(TEMP_DIR_PREFIX)) {
        continue;
      }
      const target = path.join(installRoot, entry.name);
      try {
        const stat = fs.statSync(target);
        if (now - stat.mtimeMs > 60 * 60 * 1000) removeDir(target);
      } catch (e) {
        // ignore
      }
    }
  } catch (e) {
    // ignore
  }
};

/**
 * 从本地插件包（`.rubick` / `.zip`）安装插件。
 * 成功时返回插件记录（含 localPath / source），由调用方写入 LOCAL_PLUGINS。
 */
export const installLocalPluginFromZip = async (
  zipPath: string,
  options: LocalPluginInstallOptions
): Promise<LocalPluginInstallResult> => {
  if (!zipPath || typeof zipPath !== 'string') {
    return failure('INVALID_ARGS', '缺少插件包路径');
  }
  if (!isPluginPackagePath(zipPath)) {
    return failure(
      'INVALID_ARGS',
      `仅支持 ${PLUGIN_PACKAGE_EXTENSIONS.join(' / ')} 格式的插件包`
    );
  }
  if (!isFile(zipPath)) {
    return failure('INVALID_ARGS', `插件包不存在：${zipPath}`);
  }
  const installRoot = path.resolve(options.installRoot);
  const overwrite = !!options.overwrite;
  const knownPlugins = options.knownPlugins || [];
  const npmPluginNames = new Set(options.npmPluginNames || []);

  let zipStat;
  try {
    zipStat = fs.statSync(zipPath);
  } catch (e) {
    return failure('INVALID_ARGS', `插件包不可读：${zipPath}`);
  }
  if (zipStat.size > MAX_ZIP_BYTES) {
    return failure(
      'INVALID_ZIP',
      `插件包过大（上限 ${MAX_ZIP_BYTES / 1024 / 1024}MB）`
    );
  }

  try {
    fs.mkdirSync(installRoot, { recursive: true });
  } catch (e) {
    return failure('INSTALL_FAILED', `创建插件安装目录失败：${installRoot}`);
  }

  let tempDir = '';
  let finalDir = '';
  try {
    tempDir = fs.mkdtempSync(path.join(installRoot, TEMP_DIR_PREFIX));

    let entryCount = 0;
    let uncompressedBytes = 0;
    try {
      await extract(zipPath, {
        dir: tempDir,
        onEntry: (entry: any) => {
          entryCount += 1;
          if (entryCount > MAX_ENTRY_COUNT) {
            throw new InstallError(
              'INVALID_ZIP',
              `插件包文件数量过多（上限 ${MAX_ENTRY_COUNT}）`
            );
          }
          uncompressedBytes +=
            typeof entry.uncompressedSize === 'number'
              ? entry.uncompressedSize
              : 0;
          if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
            throw new InstallError(
              'INVALID_ZIP',
              `插件包解压后体积过大（上限 ${
                MAX_UNCOMPRESSED_BYTES / 1024 / 1024
              }MB）`
            );
          }
          const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
          if ((mode & UNIX_LINK_MASK) === UNIX_LINK_TYPE) {
            throw new InstallError(
              'INVALID_ZIP',
              `插件包中不允许包含软链接：${entry.fileName}`
            );
          }
        },
      });
    } catch (e: any) {
      if (e instanceof InstallError) throw e;
      // extract-zip 对路径穿越（../、软链接逃逸）会抛出 Out of bound path
      const message = e && e.message ? e.message : String(e);
      if (/out of bound|invalid relative path|absolute path/i.test(message)) {
        throw new InstallError(
          'INVALID_ZIP',
          '插件包中包含非法路径，请勿使用 ../ 等方式打包'
        );
      }
      throw new InstallError(
        'INVALID_ZIP',
        `解压插件包失败：${message}`
      );
    }

    const metadataRoot = findMetadataRoot(tempDir);
    assertNoSymlink(metadataRoot);
    const parsed = parsePluginMetadata(metadataRoot);

    // 与 npm 安装的插件重名时直接拒绝，避免两套加载路径互相覆盖
    if (npmPluginNames.has(parsed.name)) {
      return failure(
        'PLUGIN_CONFLICT',
        `插件 ${parsed.name} 已通过插件市场（npm）安装，请先在「已安装」中卸载后再安装本地版本`
      );
    }
    const existing = knownPlugins.find((plugin) => plugin.name === parsed.name);
    if (existing && existing.source !== 'zip' && !existing.localPath) {
      return failure(
        'PLUGIN_CONFLICT',
        `插件 ${parsed.name} 已通过其他方式安装，请先卸载后再安装本地版本`
      );
    }
    if (existing && !overwrite) {
      return failure(
        'PLUGIN_EXISTS',
        `插件 ${parsed.name} 已安装，如需更新请确认覆盖安装`
      );
    }

    finalDir = path.join(installRoot, parsed.name);
    const finalDirExists = isDirectory(finalDir) || isFile(finalDir);
    if (finalDirExists && !overwrite) {
      return failure(
        'PLUGIN_EXISTS',
        `插件目录已存在：${parsed.name}，如需更新请确认覆盖安装`
      );
    }

    let backupDir = '';
    if (finalDirExists) {
      backupDir = `${finalDir}.backup-${Date.now()}`;
      fs.renameSync(finalDir, backupDir);
    }
    try {
      fs.renameSync(metadataRoot, finalDir);
    } catch (e) {
      // 回滚旧版本
      if (backupDir && !fs.existsSync(finalDir)) {
        try {
          fs.renameSync(backupDir, finalDir);
        } catch (restoreError) {
          // ignore
        }
      }
      throw new InstallError(
        'INSTALL_FAILED',
        `安装插件文件失败：${e && (e as any).message ? (e as any).message : e}`
      );
    }
    if (backupDir) removeDir(backupDir);

    return {
      success: true,
      plugin: buildPluginRecord(parsed, finalDir, zipPath),
    };
  } catch (e: any) {
    if (e instanceof InstallError) {
      return failure(e.code, e.message);
    }
    return failure(
      'INSTALL_FAILED',
      `插件安装失败：${e && e.message ? e.message : e}`
    );
  } finally {
    if (tempDir && fs.existsSync(tempDir) && tempDir !== finalDir) {
      removeDir(tempDir);
    }
  }
};
