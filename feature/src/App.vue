<template>
  <div class="main-container">
    <div class="left-menu">
      <a-menu
        @select="({ key }) => changeMenu(key)"
        :selectedKeys="active"
        mode="vertical"
      >
        <a-menu-item key="finder">
          <template #icon>
            <StarOutlined style="font-size: 16px" />
          </template>
          {{ $t('feature.market.explore') }}
        </a-menu-item>
        <a-menu-item key="worker">
          <template #icon>
            <SendOutlined style="transform: rotate(-45deg); font-size: 16px" />
          </template>
          {{ $t('feature.market.efficiency') }}
        </a-menu-item>
        <a-menu-item key="tools">
          <template #icon>
            <SearchOutlined style="font-size: 16px" />
          </template>
          {{ $t('feature.market.searchTool') }}
        </a-menu-item>
        <a-menu-item key="image">
          <template #icon>
            <FileImageOutlined style="font-size: 16px" />
          </template>
          {{ $t('feature.market.imageTool') }}
        </a-menu-item>
        <a-menu-item key="devPlugin">
          <template #icon>
            <CodeOutlined style="font-size: 16px" />
          </template>
          {{ $t('feature.market.developTool') }}
        </a-menu-item>
        <a-menu-item key="system">
          <template #icon>
            <DatabaseOutlined style="font-size: 16px" />
          </template>
          {{ $t('feature.market.systemTool') }}
        </a-menu-item>
        <a-menu-item key="localPlugin">
          <template #icon>
            <ApiOutlined style="font-size: 16px" />
          </template>
          {{ $t('feature.market.localPlugin') }}
        </a-menu-item>
        <a-sub-menu class="user-info">
          <template #icon>
            <a-avatar :size="32">
              <template #icon>
                <img :src="perf.custom.logo" />
              </template>
            </a-avatar>
          </template>
          <template #title>{{ perf.custom.username }}</template>
          <a-menu-item key="settings">
            <template #icon>
              <SettingOutlined />
            </template>
            {{ $t('feature.settings.title') }}
          </a-menu-item>
          <a-menu-item key="installed">
            <template #icon>
              <HeartOutlined />
            </template>
            {{ $t('feature.installed.title') }}
          </a-menu-item>
          <a-menu-item key="dev">
            <template #icon>
              <BugOutlined />
            </template>
            {{ $t('feature.dev.title') }}
          </a-menu-item>
        </a-sub-menu>
      </a-menu>
    </div>
    <div
      :class="
        [
          'finder',
          'result',
          'devPlugin',
          'image',
          'tools',
          'worker',
          'system',
          'localPlugin',
        ].includes(active[0])
          ? 'container'
          : 'more'
      "
    >
      <keep-alive>
        <router-view />
      </keep-alive>
    </div>
    <div v-if="draggingPlugin" class="plugin-drag-mask">
      <div class="plugin-drag-mask__inner">
        松开鼠标，安装插件包
        <span>支持 .rubick / .zip 格式的 Rubick 本地插件包</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { message } from 'ant-design-vue';
import {
  StarOutlined,
  SendOutlined,
  SearchOutlined,
  FileImageOutlined,
  DatabaseOutlined,
  CodeOutlined,
  SettingOutlined,
  HeartOutlined,
  BugOutlined,
  ApiOutlined,
} from '@ant-design/icons-vue';
import { useStore } from 'vuex';
import localConfig from '@/confOp';

const { webUtils } = window.require('electron');
const store = useStore();
const router = useRouter();
const active = computed(() => store.state.active);
const { perf } = localConfig.getConfig();

const changeMenu = (key: any) => {
  store.commit('commonUpdate', { active: [key] });
  router.push(key);
};

window.rubick.onPluginEnter(({ code }: { code: string }) => {
  code = code === '已安装插件' ? 'installed' : code;
  changeMenu(code);
  store.commit('commonUpdate', { active: [code] });
});

window.rubick.setSubInput((e: any) => {
  if (
    [
      'finder',
      'result',
      'devPlugin',
      'image',
      'tools',
      'worker',
      'system',
    ].includes(active.value[0])
  ) {
    if (e.text) {
      store.commit('setSearchValue', e.text);
      router.push('result');
    } else {
      store.commit('commonUpdate', { active: ['finder'] });
      router.push('finder');
    }
  }
}, '搜索插件');

// ==================== 本地插件包拖拽安装 ====================
const draggingPlugin = ref(false);
// 与 src/common/constans/pluginPackage.ts 保持一致（feature 子应用无法直接引用根工程路径）
const PLUGIN_PACKAGE_EXTENSIONS = ['.rubick', '.zip'];
const isPluginPackageFile = (filePath: string) => {
  const matched = /\.([^./\\]+)$/.exec(String(filePath || ''));
  return !!matched && PLUGIN_PACKAGE_EXTENSIONS.includes(`.${matched[1].toLowerCase()}`);
};

const getDroppedFilePaths = (event: DragEvent) =>
  Array.from(event.dataTransfer?.files || [])
    .map((file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch (e) {
        return '';
      }
    })
    .filter(Boolean);

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
      // 直接同步本地插件列表，避免离线环境下触发插件市场网络请求
      store.commit('commonUpdate', {
        localPlugins: window.market.getLocalPlugins(),
      });
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
  draggingPlugin.value = false;
  const filePaths = getDroppedFilePaths(event);
  if (!filePaths.length) return;
  // 阻止 Electron 把拖入的文件当作页面导航
  event.preventDefault();
  const packagePaths = filePaths.filter(isPluginPackageFile);
  if (!packagePaths.length) {
    // 非插件包交给页面内自己的 drop 逻辑（如本地启动页）
    return;
  }
  // 命中插件包时，阻止页面内其他 drop 逻辑继续处理
  event.stopPropagation();
  draggingPlugin.value = false;
  for (const packagePath of packagePaths) {
    // eslint-disable-next-line no-await-in-loop
    await installPluginZip(packagePath);
  }
};

onMounted(() => {
  // 使用捕获阶段，优先于页面内的 drop 处理器
  window.addEventListener('dragenter', onPluginDragEnter, true);
  window.addEventListener('dragover', onPluginDragOver, true);
  window.addEventListener('dragleave', onPluginDragLeave, true);
  window.addEventListener('drop', onPluginDrop, true);
});

onUnmounted(() => {
  window.removeEventListener('dragenter', onPluginDragEnter, true);
  window.removeEventListener('dragover', onPluginDragOver, true);
  window.removeEventListener('dragleave', onPluginDragLeave, true);
  window.removeEventListener('drop', onPluginDrop, true);
});

const init = () => store.dispatch('init');
init();
</script>
<style lang="less">
.ant-menu-submenu-popup {
  .ant-menu {
    background: var(--color-body-bg2) !important;
    height: 100%;
    border-right: none;
    .ant-menu-item,
    .ant-menu-submenu,
    .ant-menu-submenu-arrow {
      color: var(--color-text-content);
      &:active {
        background: none;
      }
    }
    .ant-menu-item-selected,
    .ant-menu-submenu-selected {
      background-color: var(--color-list-hover);
      color: var(--ant-primary-color);
      .ant-menu-submenu-arrow {
        color: var(--ant-primary-color);
      }
      &:after {
        display: none;
      }
    }
  }
}
</style>
<style lang="less" scoped>
@import '~@/assets/common.less';
* {
  margin: 0;
  padding: 0;
}
.main-container {
  -webkit-app-region: no-drag;
  display: flex;
  background: var(--color-body-bg);
  border-top: 1px solid var(--color-border-light);
  height: 100vh;
  box-sizing: border-box;
  align-items: flex-start;
  width: 100%;
  overflow: hidden;
  background: var(--color-menu-bg);
  .search {
    :deep(.ant-btn),
    :deep(.ant-input),
    :deep(.ant-input-group-addon) {
      color: var(--ant-primary-color) !important;
      background: var(--color-input-hover);
      border-color: var(--color-border-light);
    }
  }
  .container,
  .more {
    background: var(--color-body-bg);
    width: calc(~'100% - 183px');
    height: 100%;
    box-sizing: border-box;
    padding: 16px;
    position: relative;
    overflow: auto;
  }
  .more {
    background: var(--color-body-bg2);
  }
  .left-menu {
    padding: 16px;
    position: relative;
    height: 100vh;
    :deep(.ant-menu) {
      width: 100%;
    }
    :deep(.ant-menu-item) {
      padding-left: 12px !important;
      display: flex;
      align-items: center;
    }
    :deep(.ant-menu-item-selected),
    :deep(.ant-menu-submenu-selected) {
      background-color: var(--color-list-hover);
      border-radius: 6px;
      color: var(--ant-primary-color);
    }
    :deep(.user-info) {
      position: absolute;
      bottom: 16px;
      width: calc(100% - 32px);
      .ant-menu-submenu-title {
        padding: 0 32px 0 8px;
        .ant-menu-title-content {
          margin-left: 8px;
        }
      }
    }
    :deep(.ant-avatar) {
      background: transparent;
    }
  }
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
    font-size: 16px;
    font-weight: 500;
    color: var(--ant-primary-color, #ff4ea4);
    span {
      margin-top: 6px;
      font-size: 12px;
      font-weight: normal;
      color: var(--color-text-desc, #999);
    }
  }
}
</style>
