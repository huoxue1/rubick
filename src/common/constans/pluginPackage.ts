/**
 * 本地插件包格式定义。
 *
 * 插件包本质是 zip 容器，使用 `.rubick` 作为 Rubick 专属后缀，
 * 同时兼容 `.zip`，方便手动打包或从其他渠道分发。
 * 注意：feature 子应用无法引用本文件（独立 tsconfig），
 * 修改后缀列表时需同步 feature/src/App.vue、feature/src/views/installed/index.vue。
 */
export const PLUGIN_PACKAGE_EXTENSIONS = ['.rubick', '.zip'];

/** 打包脚本默认使用的插件包后缀 */
export const DEFAULT_PLUGIN_PACKAGE_EXTENSION = '.rubick';

/** 取文件路径的小写扩展名（不依赖 node path，方便渲染进程使用） */
const getExtension = (filePath: string): string => {
  const result = /\.([^./\\]+)$/.exec(String(filePath || ''));
  return result ? `.${result[1].toLowerCase()}` : '';
};

/** 判断一个文件路径是否是受支持的插件包 */
export const isPluginPackagePath = (filePath: string): boolean =>
  PLUGIN_PACKAGE_EXTENSIONS.includes(getExtension(filePath));
