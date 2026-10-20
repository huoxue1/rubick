#!/usr/bin/env node
/**
 * 把插件目录打包成 Rubick 本地插件包（.rubick / .zip）
 *
 * 插件包本质是 zip 容器，默认使用 Rubick 专属后缀 .rubick。
 *
 * 用法：
 *   node scripts/pack-plugin.js <插件目录> [输出文件]
 *   yarn plugin:pack ./my-plugin
 *   yarn plugin:pack ./my-plugin ./dist/my-plugin.rubick
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = process.argv.slice(2);
const sourceDir = args[0] ? path.resolve(args[0]) : '';
if (!sourceDir) {
  console.error(
    '用法：node scripts/pack-plugin.js <插件目录> [输出文件(.rubick|.zip)]'
  );
  process.exit(1);
}
if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
  console.error(`插件目录不存在：${sourceDir}`);
  process.exit(1);
}
const hasPluginJson = fs.existsSync(path.join(sourceDir, 'plugin.json'));
const hasPackageJson = fs.existsSync(path.join(sourceDir, 'package.json'));
if (!hasPluginJson && !hasPackageJson) {
  console.error(
    `插件目录中未找到 plugin.json 或 package.json：${sourceDir}\n` +
      '请先在插件目录中创建 plugin.json（格式参考 docs/local-plugin-package.md）'
  );
  process.exit(1);
}

/** 与 src/common/constans/pluginPackage.ts 保持一致 */
const PACKAGE_EXTENSIONS = ['.rubick', '.zip'];
const DEFAULT_PACKAGE_EXTENSION = '.rubick';
// 不指定输出文件时，默认放到插件目录同级，避免插件包被打进插件自身目录
const outFile = args[1]
  ? path.resolve(args[1])
  : path.join(
      path.dirname(sourceDir),
      `${path.basename(sourceDir)}${DEFAULT_PACKAGE_EXTENSION}`
    );
if (!PACKAGE_EXTENSIONS.includes(path.extname(outFile).toLowerCase())) {
  console.error(
    `输出文件后缀仅支持 ${PACKAGE_EXTENSIONS.join(' / ')}，当前为：${
      path.extname(outFile) || '(无后缀)'
    }`
  );
  process.exit(1);
}
const relativeOut = path.relative(sourceDir, outFile);
if (!relativeOut.startsWith('..') && !path.isAbsolute(relativeOut)) {
  console.error('输出文件不能放在插件目录内，否则会被一起打包');
  process.exit(1);
}
fs.mkdirSync(path.dirname(outFile), { recursive: true });
if (fs.existsSync(outFile)) fs.rmSync(outFile, { force: true });

console.log(`打包 ${sourceDir} -> ${outFile}`);
if (process.platform === 'win32') {
  // Compress-Archive 只接受 .zip 输出，先输出临时 zip 再重命名为 .rubick
  const tempZip = /\.rubick$/i.test(outFile)
    ? outFile.replace(/\.rubick$/i, '.zip')
    : outFile;
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Compress-Archive -Path '${path.join(
        sourceDir,
        '*'
      )}' -DestinationPath '${tempZip}' -Force`,
    ],
    { stdio: 'inherit' }
  );
  if (tempZip !== outFile && fs.existsSync(tempZip)) {
    fs.rmSync(outFile, { force: true });
    fs.renameSync(tempZip, outFile);
  }
} else {
  execFileSync(
    'zip',
    [
      '-qr',
      outFile,
      '.',
      '-x',
      '*/node_modules/*',
      'node_modules/*',
      '-x',
      '*.zip',
      '-x',
      '*.rubick',
      '-x',
      '*/.git/*',
      '-x',
      '.git/*',
      '-x',
      '*.DS_Store',
    ],
    { cwd: sourceDir, stdio: 'inherit' }
  );
}
console.log(`完成：${outFile}`);
