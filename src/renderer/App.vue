<template>
  <div id="components-layout" @mousedown="onMouseDown">
    <Search
      :currentPlugin="currentPlugin"
      @changeCurrent="changeIndex"
      @onSearch="onSearch"
      @openMenu="openMenu"
      @changeSelect="changeSelect"
      :searchValue="searchValue"
      :placeholder="placeholder"
      :pluginLoading="pluginLoading"
      :pluginHistory="pluginHistory"
      :clipboardFile="clipboardFile || []"
      @choosePlugin="choosePlugin"
      @focus="searchFocus"
      @clear-search-value="clearSearchValue"
      @clearClipbord="clearClipboardFile"
      @readClipboardContent="readClipboardContent"
    />
    <Result
      :pluginHistory="pluginHistory"
      :currentPlugin="currentPlugin"
      :searchValue="searchValue"
      :currentSelect="currentSelect"
      :options="options"
      :clipboardFile="clipboardFile || []"
      @setPluginHistory="setPluginHistory"
      @choosePlugin="choosePlugin"
    />
    <div v-if="draggingPlugin" class="plugin-drag-mask">
      <div class="plugin-drag-mask__inner">
        松开鼠标，安装插件压缩包
        <span>支持 .zip 格式的 Rubick 本地插件包</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { watch, ref, toRaw, onMounted, onUnmounted } from 'vue';
import { exec } from 'child_process';
import Result from './components/result.vue';
import Search from './components/search.vue';
import getWindowHeight from '../common/utils/getWindowHeight';
import createPluginManager from './plugins-manager';
import useDrag from '../common/utils/dragWindow';
import { getGlobal } from '@electron/remote';
import { PLUGIN_HISTORY } from '@/common/constans/renderer';
import { message } from 'ant-design-vue';
import localConfig from './confOp';

const { onMouseDown } = useDrag();
const remote = window.require('@electron/remote');
const { webUtils } = window.require('electron');

const {
  initPlugins,
  getPluginInfo,
  options,
  onSearch,
  searchValue,
  changeSelect,
  openPlugin,
  currentPlugin,
  placeholder,
  pluginLoading,
  searchFocus,
  clipboardFile,
  setSearchValue,
  clearClipboardFile,
  readClipboardContent,
  pluginHistory,
  setPluginHistory,
  changePluginHistory,
} = createPluginManager();

initPlugins();

const currentSelect = ref(0);
const menuPluginInfo: any = ref({});

const config: any = ref(localConfig.getConfig());

getPluginInfo({
  pluginName: 'feature',
  // eslint-disable-next-line no-undef
  pluginPath: `${__static}/feature/package.json`,
}).then((res) => {
  menuPluginInfo.value = res;
  remote.getGlobal('LOCAL_PLUGINS').addPlugin(res);
});

watch(
  [options, pluginHistory, currentPlugin],
  () => {
    currentSelect.value = 0;
    if (currentPlugin.value.name) return;
    window.rubick.setExpendHeight(
      getWindowHeight(
        options.value,
        pluginLoading.value || !config.value.perf.common.history
          ? []
          : pluginHistory.value
      )
    );
  },
  {
    immediate: true,
  }
);

const changeIndex = (index) => {
  const len = options.value.length || pluginHistory.value.length;
  if (!len) return;
  if (currentSelect.value + index > len - 1) {
    currentSelect.value = 0;
  } else if (currentSelect.value + index < 0) {
    currentSelect.value = len - 1;
  } else {
    currentSelect.value = currentSelect.value + index;
  }
};

const openMenu = (ext) => {
  openPlugin({
    ...toRaw(menuPluginInfo.value),
    feature: menuPluginInfo.value.features[0],
    cmd: '插件市场',
    ext,
    click: () => openMenu(ext),
  });
};

window.rubick.openMenu = openMenu;

const choosePlugin = (plugin) => {
  if (options.value.length) {
    const currentChoose = options.value[currentSelect.value];
    currentChoose.click();
  } else {
    const localPlugins = getGlobal('LOCAL_PLUGINS').getLocalPlugins();
    const currentChoose = plugin || pluginHistory.value[currentSelect.value];
    let hasRemove = true;
    if (currentChoose.pluginType === 'app') {
      hasRemove = false;
      changePluginHistory(currentChoose);
      exec(currentChoose.action);
      return;
    }
    localPlugins.find((plugin) => {
      if (plugin.name === currentChoose.originName) {
        hasRemove = false;
        return true;
      }
      return false;
    });
    if (hasRemove) {
      const result = window.rubick.db.get(PLUGIN_HISTORY) || {};
      const history = result.data.filter(
        (item) => item.originName !== currentChoose.originName
      );
      setPluginHistory(history);
      return message.warning('插件已被卸载！');
    }
    changePluginHistory(currentChoose);
    window.rubick.openPlugin(
      JSON.parse(
        JSON.stringify({
          ...currentChoose,
          ext: {
            code: currentChoose.feature.code,
            type: currentChoose.cmd.type || 'text',
            payload: null,
          },
        })
      )
    );
  }
};

const clearSearchValue = () => {
  setSearchValue('');
};

// ==================== 本地 zip 插件拖拽安装 ====================
const draggingPlugin = ref(false);

const isZipFile = (filePath: string) =>
  /\.zip$/i.test(String(filePath || '').trim());

const installPluginZip = async (filePath: string, overwrite = false) => {
  try {
    const result = await window.rubick.installPluginFromZip(filePath, {
      overwrite,
    });
    if (result && result.success) {
      const pluginName =
        (result.plugin && (result.plugin.pluginName || result.plugin.name)) ||
        '插件';
      message.success(result.message || `插件「${pluginName}」安装成功`);
      return;
    }
    if (result && result.code === 'PLUGIN_EXISTS') {
      if (window.confirm(`${result.message}\n\n是否覆盖安装？`)) {
        await installPluginZip(filePath, true);
      }
      return;
    }
    message.error((result && result.message) || '插件安装失败');
  } catch (e: any) {
    message.error(`插件安装失败：${e && e.message ? e.message : e}`);
  }
};

const hasDraggedFiles = (event: DragEvent) => {
  try {
    return Array.from(event.dataTransfer?.types || []).includes('Files');
  } catch (e) {
    return false;
  }
};

const onPluginDragEnter = (event: DragEvent) => {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  draggingPlugin.value = true;
};

const onPluginDragOver = (event: DragEvent) => {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  draggingPlugin.value = true;
};

const onPluginDragLeave = (event: DragEvent) => {
  if (event.relatedTarget === null) draggingPlugin.value = false;
};

const onPluginDrop = async (event: DragEvent) => {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  draggingPlugin.value = false;
  const files = Array.from(event.dataTransfer?.files || []);
  const filePaths = files
    .map((file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch (e) {
        return '';
      }
    })
    .filter(Boolean);
  const zipPaths = filePaths.filter(isZipFile);
  if (!zipPaths.length) {
    message.warning('仅支持拖入 .zip 格式的插件压缩包');
    return;
  }
  for (const zipPath of zipPaths) {
    // 逐个安装，避免多个压缩包同时解压时 UI 反馈错乱
    // eslint-disable-next-line no-await-in-loop
    await installPluginZip(zipPath);
  }
};

onMounted(() => {
  window.addEventListener('dragenter', onPluginDragEnter);
  window.addEventListener('dragover', onPluginDragOver);
  window.addEventListener('dragleave', onPluginDragLeave);
  window.addEventListener('drop', onPluginDrop);
});

onUnmounted(() => {
  window.removeEventListener('dragenter', onPluginDragEnter);
  window.removeEventListener('dragover', onPluginDragOver);
  window.removeEventListener('dragleave', onPluginDragLeave);
  window.removeEventListener('drop', onPluginDrop);
});
</script>

<style lang="less">
@import './assets/var.less';
#components-layout {
  height: 100vh;
  overflow: hidden;
  background: var(--color-body-bg);
  ::-webkit-scrollbar {
    width: 0;
  }
  &.drag {
    -webkit-app-region: drag;
  }
  .plugin-drag-mask {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    box-sizing: border-box;
    border: 2px dashed var(--ant-primary-color, #ff4ea4);
    border-radius: 8px;
    background: rgba(255, 78, 164, 0.08);
    &__inner {
      display: flex;
      flex-direction: column;
      align-items: center;
      font-size: 14px;
      font-weight: 500;
      color: var(--ant-primary-color, #ff4ea4);
      span {
        margin-top: 4px;
        font-size: 12px;
        font-weight: normal;
        color: var(--color-text-desc, #999);
      }
    }
  }
}
</style>
