import path from 'path';
import fs from 'fs';
import { PluginHandler } from '@/core';
import { PLUGIN_INSTALL_DIR as baseDir } from '@/common/constans/main';
import API from '@/main/common/api';

const configPath = path.join(baseDir, './rubick-local-plugin.json');

let registry;
let pluginInstance;
(async () => {
  try {
    const res = await API.dbGet({
      data: {
        id: 'rubick-localhost-config',
      },
    });

    registry = res && res.data.register;
    pluginInstance = new PluginHandler({
      baseDir,
      registry,
    });
  } catch (e) {
    pluginInstance = new PluginHandler({
      baseDir,
      registry,
    });
  }
})();

global.LOCAL_PLUGINS = {
  PLUGINS: [],
  async downloadPlugin(plugin) {
    await pluginInstance.install([plugin.name], { isDev: plugin.isDev });
    if (plugin.isDev) {
      // 获取 dev 插件信息
      const pluginPath = path.resolve(baseDir, 'node_modules', plugin.name);
      const pluginInfo = JSON.parse(
        fs.readFileSync(path.join(pluginPath, './package.json'), 'utf8')
      );
      plugin = {
        ...plugin,
        ...pluginInfo,
      };
    }
    global.LOCAL_PLUGINS.addPlugin(plugin);
    return global.LOCAL_PLUGINS.PLUGINS;
  },
  refreshPlugin(plugin) {
    // 获取 dev 插件信息
    const pluginPath = path.resolve(baseDir, 'node_modules', plugin.name);
    const pluginInfo = JSON.parse(
      fs.readFileSync(path.join(pluginPath, './package.json'), 'utf8')
    );
    plugin = {
      ...plugin,
      ...pluginInfo,
    };
    // 刷新
    let currentPlugins = global.LOCAL_PLUGINS.getLocalPlugins();

    currentPlugins = currentPlugins.map((p) => {
      if (p.name === plugin.name) {
        return plugin;
      }
      return p;
    });

    // 存入
    global.LOCAL_PLUGINS.PLUGINS = currentPlugins;
    fs.writeFileSync(configPath, JSON.stringify(currentPlugins));
    return global.LOCAL_PLUGINS.PLUGINS;
  },
  getLocalPlugins() {
    try {
      if (!global.LOCAL_PLUGINS.PLUGINS.length) {
        global.LOCAL_PLUGINS.PLUGINS = JSON.parse(
          fs.readFileSync(configPath, 'utf-8')
        );
      }
      const plugins = global.LOCAL_PLUGINS.PLUGINS || [];
      // 清理已被手动删除的本地插件包记录
      const validPlugins = plugins.filter((plugin) => {
        if (!plugin || typeof plugin !== 'object') return false;
        if (plugin.source === 'zip' || plugin.localPath) {
          return !!plugin.localPath && fs.existsSync(plugin.localPath);
        }
        return true;
      });
      if (validPlugins.length !== plugins.length) {
        global.LOCAL_PLUGINS.PLUGINS = validPlugins;
        fs.writeFileSync(configPath, JSON.stringify(validPlugins));
      }
      return global.LOCAL_PLUGINS.PLUGINS;
    } catch (e) {
      global.LOCAL_PLUGINS.PLUGINS = [];
      return global.LOCAL_PLUGINS.PLUGINS;
    }
  },
  addPlugin(plugin) {
    let has = false;
    const currentPlugins = global.LOCAL_PLUGINS.getLocalPlugins();
    currentPlugins.some((p) => {
      has = p.name === plugin.name;
      return has;
    });
    if (!has) {
      currentPlugins.unshift(plugin);
      global.LOCAL_PLUGINS.PLUGINS = currentPlugins;
      fs.writeFileSync(configPath, JSON.stringify(currentPlugins));
    }
  },
  updatePlugin(plugin) {
    global.LOCAL_PLUGINS.PLUGINS = global.LOCAL_PLUGINS.PLUGINS.map(
      (origin) => {
        if (origin.name === plugin.name) {
          return plugin;
        }
        return origin;
      }
    );
    fs.writeFileSync(configPath, JSON.stringify(global.LOCAL_PLUGINS.PLUGINS));
  },
  async deletePlugin(plugin) {
    if (plugin && plugin.source === 'dev') {
      // 开发目录安装：只移除插件记录，绝不删除开发者的源码目录
    } else if (plugin && plugin.source === 'zip' && plugin.localPath) {
      // 本地插件包由安装器直接管理目录，不经过 npm uninstall
      const pluginDir = path.resolve(plugin.localPath);
      const safeRoot = path.resolve(baseDir) + path.sep;
      if (pluginDir.startsWith(safeRoot) && fs.existsSync(pluginDir)) {
        fs.rmSync(pluginDir, { recursive: true, force: true });
      }
    } else {
      await pluginInstance.uninstall([plugin.name], { isDev: plugin.isDev });
    }
    global.LOCAL_PLUGINS.PLUGINS = global.LOCAL_PLUGINS.PLUGINS.filter(
      (p) => plugin.name !== p.name
    );
    fs.writeFileSync(configPath, JSON.stringify(global.LOCAL_PLUGINS.PLUGINS));
    return global.LOCAL_PLUGINS.PLUGINS;
  },
};
