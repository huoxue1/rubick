/**
 * 把本地插件目录打包成插件包（`.rubick` / `.zip`，zip 容器）。
 *
 * 与 scripts/pack-plugin.js 的区别：
 * - 这里运行在 Rubick 主进程内，供插件市场「开发者」页直接调用，不依赖系统 zip 命令；
 * - 使用 Node 内置 zlib 做 deflate 压缩，跨平台可用；
 * - 不依赖 electron，方便单独测试。
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import {
  DEFAULT_PLUGIN_PACKAGE_EXTENSION,
  isPluginPackagePath,
  PLUGIN_PACKAGE_EXTENSIONS,
} from '@/common/constans/pluginPackage';

export type PackLocalPluginErrorCode =
  | 'INVALID_ARGS'
  | 'NOTHING_TO_PACK'
  | 'PACK_FAILED';

export interface PackLocalPluginResult {
  success: boolean;
  code?: PackLocalPluginErrorCode;
  message?: string;
  filePath?: string;
  fileCount?: number;
  bytes?: number;
  warnings?: string[];
}

interface SourceFile {
  absPath: string;
  relativePath: string;
  size: number;
  mtime: Date;
}

/** 与 zip 安装器保持一致的限制 */
const MAX_FILE_COUNT = 20000;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;
const MAX_SINGLE_FILE_BYTES = 200 * 1024 * 1024;
const EXCLUDED_DIRS = new Set(['node_modules', '.git']);
const EXCLUDED_FILES = new Set(['.DS_Store']);
const EXCLUDED_EXTENSIONS = new Set(['.zip', '.rubick']);
const METADATA_FILES = ['plugin.json', 'package.json'];

class PackError extends Error {
  public code: PackLocalPluginErrorCode;

  constructor(code: PackLocalPluginErrorCode, message: string) {
    super(message);
    this.name = 'PackError';
    this.code = code;
  }
}

const failure = (
  code: PackLocalPluginErrorCode,
  message: string
): PackLocalPluginResult => ({ success: false, code, message });

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

/** 写入完整 buffer（fs.writeSync 可能只写入部分数据） */
const writeAll = (fd: number, buffer: Buffer): void => {
  let offset = 0;
  while (offset < buffer.length) {
    offset += fs.writeSync(fd, buffer, offset, buffer.length - offset, null);
  }
};

/** 递归收集需要打包的文件，跳过 node_modules / .git / 已有插件包等 */
const collectFiles = (sourceDir: string): { files: SourceFile[]; warnings: string[] } => {
  const files: SourceFile[] = [];
  const warnings: string[] = [];
  const walk = (currentDir: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (e) {
      warnings.push(`无法读取目录：${path.relative(sourceDir, currentDir)}`);
      return;
    }
    for (const entry of entries) {
      const absPath = path.join(currentDir, entry.name);
      const relativePath = path
        .relative(sourceDir, absPath)
        .split(path.sep)
        .join('/');
      if (entry.isSymbolicLink()) {
        warnings.push(`已跳过软链接：${relativePath}`);
        continue;
      }
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        walk(absPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (EXCLUDED_FILES.has(entry.name)) continue;
      if (EXCLUDED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }
      let stat: fs.Stats;
      try {
        stat = fs.statSync(absPath);
      } catch (e) {
        warnings.push(`已跳过不可读文件：${relativePath}`);
        continue;
      }
      files.push({
        absPath,
        relativePath,
        size: stat.size,
        mtime: stat.mtime,
      });
    }
  };
  walk(sourceDir);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return { files, warnings };
};

// ------------------------------ ZIP 写入实现 ------------------------------

let crcTable: Uint32Array | null = null;

const getCrcTable = (): Uint32Array => {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
};

const crc32 = (buffer: Buffer): number => {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = table[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

/** 转换成 zip 使用的 DOS 时间/日期 */
const getDosDateTime = (mtime: Date): { time: number; date: number } => {
  const year = Math.max(1980, mtime.getFullYear());
  return {
    time:
      ((mtime.getHours() & 0x1f) << 11) |
      ((mtime.getMinutes() & 0x3f) << 5) |
      (Math.floor(mtime.getSeconds() / 2) & 0x1f),
    date:
      (((year - 1980) & 0x7f) << 9) |
      (((mtime.getMonth() + 1) & 0x0f) << 5) |
      (mtime.getDate() & 0x1f),
  };
};

const buildLocalFileHeader = (
  name: Buffer,
  crc: number,
  compressedSize: number,
  uncompressedSize: number,
  method: number,
  dos: { time: number; date: number }
): Buffer => {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); // signature
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0x0800, 6); // 文件名使用 UTF-8
  header.writeUInt16LE(method, 8);
  header.writeUInt16LE(dos.time, 10);
  header.writeUInt16LE(dos.date, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressedSize, 18);
  header.writeUInt32LE(uncompressedSize, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28); // extra field length
  return Buffer.concat([header, name]);
};

const buildCentralDirectoryHeader = (
  name: Buffer,
  crc: number,
  compressedSize: number,
  uncompressedSize: number,
  method: number,
  dos: { time: number; date: number },
  localHeaderOffset: number
): Buffer => {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0); // signature
  header.writeUInt16LE(20, 4); // version made by
  header.writeUInt16LE(20, 6); // version needed
  header.writeUInt16LE(0x0800, 8); // 文件名使用 UTF-8
  header.writeUInt16LE(method, 10);
  header.writeUInt16LE(dos.time, 12);
  header.writeUInt16LE(dos.date, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(compressedSize, 20);
  header.writeUInt32LE(uncompressedSize, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30); // extra field length
  header.writeUInt16LE(0, 32); // comment length
  header.writeUInt16LE(0, 34); // disk number start
  header.writeUInt16LE(0, 36); // internal attrs
  header.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs
  header.writeUInt32LE(localHeaderOffset, 42);
  return Buffer.concat([header, name]);
};

const buildEndOfCentralDirectory = (
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number
): Buffer => {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // disk number
  end.writeUInt16LE(0, 6); // central directory disk
  end.writeUInt16LE(entryCount, 8);
  end.writeUInt16LE(entryCount, 10);
  end.writeUInt32LE(centralDirectorySize, 12);
  end.writeUInt32LE(centralDirectoryOffset, 16);
  end.writeUInt16LE(0, 20); // comment length
  return end;
};

/**
 * 把插件目录打包成 `.rubick` / `.zip`。
 * @param sourceDir 插件目录
 * @param outputPath 输出文件路径；不传时输出到插件目录同级的 `<目录名>.rubick`
 */
export const packLocalPlugin = (
  sourceDirInput: string,
  outputPathInput?: string
): PackLocalPluginResult => {
  if (!sourceDirInput || typeof sourceDirInput !== 'string') {
    return failure('INVALID_ARGS', '缺少插件目录');
  }
  const sourceDir = path.resolve(sourceDirInput);
  if (!isDirectory(sourceDir)) {
    return failure('INVALID_ARGS', `插件目录不存在或不是目录：${sourceDir}`);
  }
  if (!METADATA_FILES.some((file) => isFile(path.join(sourceDir, file)))) {
    return failure(
      'INVALID_ARGS',
      '插件目录中未找到 plugin.json 或 package.json，请先补全插件元数据'
    );
  }

  const outputPath = outputPathInput
    ? path.resolve(outputPathInput)
    : path.join(
        path.dirname(sourceDir),
        `${path.basename(sourceDir)}${DEFAULT_PLUGIN_PACKAGE_EXTENSION}`
      );
  if (!isPluginPackagePath(outputPath)) {
    return failure(
      'INVALID_ARGS',
      `输出文件仅支持 ${PLUGIN_PACKAGE_EXTENSIONS.join(' / ')} 格式`
    );
  }
  if (isDirectory(outputPath)) {
    return failure('INVALID_ARGS', `输出路径是一个目录：${outputPath}`);
  }
  const relativeOutput = path.relative(sourceDir, outputPath);
  if (!relativeOutput.startsWith('..') && !path.isAbsolute(relativeOutput)) {
    return failure('INVALID_ARGS', '输出文件不能放在插件目录内，否则会被打进包里');
  }

  const { files, warnings } = collectFiles(sourceDir);
  if (!files.length) {
    return failure('NOTHING_TO_PACK', '插件目录中没有可打包的文件');
  }
  if (files.length > MAX_FILE_COUNT) {
    return failure(
      'INVALID_ARGS',
      `文件数量过多（上限 ${MAX_FILE_COUNT}），请检查是否把 node_modules 等目录放进了插件目录`
    );
  }
  let totalBytes = 0;
  for (const file of files) {
    if (file.size > MAX_SINGLE_FILE_BYTES) {
      return failure(
        'INVALID_ARGS',
        `单个文件过大：${file.relativePath}（上限 ${
          MAX_SINGLE_FILE_BYTES / 1024 / 1024
        }MB）`
      );
    }
    totalBytes += file.size;
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    return failure(
      'INVALID_ARGS',
      `插件总大小过大（上限 ${MAX_TOTAL_BYTES / 1024 / 1024}MB）`
    );
  }

  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  } catch (e) {
    return failure('PACK_FAILED', `创建输出目录失败：${outputPath}`);
  }

  let fd = 0;
  try {
    fd = fs.openSync(outputPath, 'w');
    let offset = 0;
    const centralDirectory: Buffer[] = [];

    for (const file of files) {
      const raw = fs.readFileSync(file.absPath);
      if (raw.length > MAX_SINGLE_FILE_BYTES) {
        throw new PackError(
          'INVALID_ARGS',
          `单个文件过大：${file.relativePath}`
        );
      }
      const crc = crc32(raw);
      let method = 8; // deflate
      let data = zlib.deflateRawSync(raw);
      if (data.length >= raw.length) {
        // 压缩后反而更大时直接存储
        method = 0;
        data = raw;
      }
      const name = Buffer.from(file.relativePath, 'utf8');
      const dos = getDosDateTime(file.mtime);
      const localHeader = buildLocalFileHeader(
        name,
        crc,
        data.length,
        raw.length,
        method,
        dos
      );
      writeAll(fd, localHeader);
      writeAll(fd, data);
      centralDirectory.push(
        buildCentralDirectoryHeader(
          name,
          crc,
          data.length,
          raw.length,
          method,
          dos,
          offset
        )
      );
      offset += localHeader.length + data.length;
    }

    const centralDirectoryOffset = offset;
    for (const entry of centralDirectory) {
      writeAll(fd, entry);
      offset += entry.length;
    }
    writeAll(
      fd,
      buildEndOfCentralDirectory(
        centralDirectory.length,
        offset - centralDirectoryOffset,
        centralDirectoryOffset
      )
    );
    fs.closeSync(fd);
    fd = 0;

    return {
      success: true,
      filePath: outputPath,
      fileCount: files.length,
      bytes: offset,
      warnings,
    };
  } catch (e: any) {
    if (fd) {
      try {
        fs.closeSync(fd);
      } catch (closeError) {
        // ignore
      }
    }
    try {
      if (fs.existsSync(outputPath) && !isDirectory(outputPath)) {
        fs.rmSync(outputPath, { force: true });
      }
    } catch (removeError) {
      // ignore
    }
    if (e instanceof PackError) return failure(e.code, e.message);
    return failure(
      'PACK_FAILED',
      `打包失败：${e && e.message ? e.message : e}`
    );
  }
};
