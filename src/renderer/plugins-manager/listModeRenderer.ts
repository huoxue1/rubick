import { ipcRenderer } from 'electron';
import path from 'path';
import { PLUGIN_INSTALL_DIR as baseDir } from '@/common/constans/renderer';

interface ListModeItem {
  id?: string;
  icon?: string;
  title: string;
  description?: string;
  [key: string]: any;
}

interface ListModeArgs {
  enter?: (action: any, callbackSetList: (items: ListModeItem[]) => void) => void;
  search?: (action: any, searchWord: string, callbackSetList: (items: ListModeItem[]) => void) => void;
  select?: (action: any, itemData: ListModeItem, callbackSetList: (items: ListModeItem[]) => void) => void;
  placeholder?: string;
}

interface ListModePlugin {
  mode: 'list';
  args: ListModeArgs;
}

interface PluginExport {
  [featureCode: string]: ListModePlugin;
}

class ListModeRunner {
  private currentPlugin: any = null;
  private pluginModule: PluginExport | null = null;
  private currentList: ListModeItem[] = [];
  private action: any = null;
  private loaded = false;

  // 加载插件 preload.js
  async loadPlugin(plugin: any) {
    this.currentPlugin = plugin;
    this.loaded = false;

    const featureCode = plugin.feature?.code || plugin.features?.[0]?.code;
    if (!featureCode) return { list: [], placeholder: '搜索' };

    this.action = {
      code: featureCode,
      type: plugin.ext?.type || 'text',
      payload: plugin.ext?.payload || '',
    };

    // 获取 preload.js 路径
    const pluginPath = path.resolve(baseDir, 'node_modules', plugin.name);
    const preloadPath = plugin.preload
      ? path.join(pluginPath, plugin.preload)
      : path.join(pluginPath, 'preload.js');

    try {
      // 在渲染进程中 require preload.js
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pluginExports: PluginExport = window.require(preloadPath);
      this.pluginModule = pluginExports;

      const featurePlugin = pluginExports[featureCode];

      if (!featurePlugin || featurePlugin.mode !== 'list') {
        return { list: [], placeholder: '搜索' };
      }

      const placeholder = featurePlugin.args?.placeholder || '搜索';

      // 执行 enter 回调
      const list = await this.executeEnter(featurePlugin.args);

      this.loaded = true;
      return { list, placeholder };
    } catch (e) {
      console.error('Failed to load list mode plugin:', e);
      return { list: [], placeholder: '搜索' };
    }
  }

  async executeEnter(args: ListModeArgs): Promise<ListModeItem[]> {
    return new Promise((resolve) => {
      const callbackSetList = (items: ListModeItem[]) => {
        this.currentList = this.normalizeList(items);
        resolve(this.currentList);
      };

      if (args?.enter) {
        try {
          args.enter(this.action, callbackSetList);
        } catch (e) {
          console.error('Error executing enter:', e);
          resolve([]);
        }
      } else {
        resolve([]);
      }
    });
  }

  async executeSearch(searchWord: string): Promise<ListModeItem[]> {
    return new Promise((resolve) => {
      const callbackSetList = (items: ListModeItem[]) => {
        this.currentList = this.normalizeList(items);
        resolve(this.currentList);
      };

      if (!this.loaded || !this.pluginModule) {
        resolve([]);
        return;
      }

      const featureCode = this.currentPlugin?.feature?.code || this.currentPlugin?.features?.[0]?.code;
      const featurePlugin = this.pluginModule[featureCode];

      if (featurePlugin?.args?.search) {
        try {
          featurePlugin.args.search(this.action, searchWord, callbackSetList);
        } catch (e) {
          console.error('Error executing search:', e);
          resolve([]);
        }
      } else {
        // 没有 search 回调时，对当前列表进行简单过滤
        const filtered = this.currentList.filter(item =>
          !searchWord ||
          item.title?.includes(searchWord) ||
          item.description?.includes(searchWord)
        );
        resolve(filtered);
      }
    });
  }

  async executeSelect(itemData: ListModeItem): Promise<ListModeItem[]> {
    return new Promise((resolve) => {
      const callbackSetList = (items: ListModeItem[]) => {
        resolve(this.normalizeList(items));
      };

      if (!this.loaded || !this.pluginModule) {
        resolve([]);
        return;
      }

      const featureCode = this.currentPlugin?.feature?.code || this.currentPlugin?.features?.[0]?.code;
      const featurePlugin = this.pluginModule[featureCode];

      if (featurePlugin?.args?.select) {
        try {
          featurePlugin.args.select(this.action, itemData, callbackSetList);
        } catch (e) {
          console.error('Error executing select:', e);
          resolve([]);
        }
      } else {
        resolve([]);
      }
    });
  }

  // 标准化列表项格式
  private normalizeList(items: ListModeItem[]): ListModeItem[] {
    return items.map(item => ({
      ...item,
      icon: this.resolveIconPath(item.icon),
    }));
  }

  // 解析相对路径的 icon
  private resolveIconPath(iconPath?: string): string {
    if (!iconPath) return '';
    if (iconPath.startsWith('http://') || iconPath.startsWith('https://') || iconPath.startsWith('file://')) {
      return iconPath;
    }
    const pluginPath = path.resolve(baseDir, 'node_modules', this.currentPlugin?.name);
    return `file://${path.join(pluginPath, iconPath)}`;
  }

  getCurrentList(): ListModeItem[] {
    return this.currentList;
  }

  unloadPlugin() {
    this.currentPlugin = null;
    this.pluginModule = null;
    this.currentList = [];
    this.action = null;
    this.loaded = false;
  }
}

export default new ListModeRunner();
