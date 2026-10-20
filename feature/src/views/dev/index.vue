<template>
  <div class="dev">
    <div class="view-title">{{ $t('feature.dev.title') }}</div>
    <div class="view-container">
      <a-alert
        style="margin-bottom: 40px"
        :message="$t('feature.dev.tips')"
        type="warning"
      />
      <a-form
        ref="formRef"
        :model="formState"
        :rules="rules"
        :label-col="labelCol"
        :wrapper-col="wrapperCol"
      >
        <a-form-item :label="$t('feature.dev.pluginName')" name="name">
          <a-input v-model:value="formState.name" />
        </a-form-item>

        <a-form-item :wrapper-col="{ span: 14, offset: 4 }">
          <a-button :loading="loading" type="primary" @click="onSubmit">
            {{ $t('feature.dev.install') }}
          </a-button>
          <a-button @click="refresh" style="margin-left: 10px">
            {{ $t('feature.dev.refreshPlugins') }}
          </a-button>
        </a-form-item>
      </a-form>

      <a-divider />
      <div class="section-title">打包插件</div>
      <p class="section-desc">
        选择一个本地插件目录（需包含 plugin.json 或 package.json），打包成
        <code>.rubick</code> / <code>.zip</code> 插件包，可直接拖入 Rubick
        安装，或分发给其他人。
      </p>
      <a-form :label-col="labelCol" :wrapper-col="wrapperCol">
        <a-form-item label="插件目录">
          <div class="path-row">
            <a-input
              :value="packState.sourceDir"
              readonly
              placeholder="请选择插件目录"
            />
            <a-button @click="chooseSourceDir">选择目录</a-button>
          </div>
        </a-form-item>
        <a-form-item label="输出文件">
          <div class="path-row">
            <a-input
              :value="packState.outputPath"
              readonly
              placeholder="默认输出到插件目录同级的 &lt;目录名&gt;.rubick"
            />
            <a-button :disabled="!packState.sourceDir" @click="chooseOutputPath">
              选择位置
            </a-button>
          </div>
        </a-form-item>
        <a-form-item :wrapper-col="{ span: 14, offset: 4 }">
          <a-button
            type="primary"
            :loading="packing"
            :disabled="!packState.sourceDir"
            @click="onPack"
          >
            开始打包
          </a-button>
          <a-button
            v-if="packedFile"
            style="margin-left: 10px"
            @click="showPackedFile"
          >
            在文件夹中显示
          </a-button>
        </a-form-item>
      </a-form>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { message } from 'ant-design-vue';
import { useI18n } from 'vue-i18n';
const { t } = useI18n();
const path = window.require('path');

const formRef = ref();
const formState = reactive({
  name: undefined,
});
const rules = {
  name: {
    required: true,
    message: 'Please input name',
  },
};
const onSubmit = () => {
  formRef.value.validate().then(() => {
    downloadPlugin(formState.name);
  });
};

const loading = ref(false);
const downloadPlugin = async (pluginName) => {
  loading.value = true;
  await window.market.downloadPlugin({
    name: pluginName,
    isDev: true,
  });
  message.success(t('feature.dev.installSuccess', { pluginName: pluginName }));
  loading.value = false;
};

const refresh = () => {
  formRef.value.validate().then(() => {
    window.market.refreshPlugin({
      name: formState.name,
    });
    message.success(
      t('feature.dev.refreshSuccess', { pluginName: formState.name })
    );
  });
};

// ==================== 插件打包 ====================
const DEFAULT_PACKAGE_EXTENSION = '.rubick';
const packing = ref(false);
const packedFile = ref('');
const packState = reactive({
  sourceDir: '',
  outputPath: '',
});

const getDefaultOutputPath = (sourceDir) =>
  path.join(
    path.dirname(sourceDir),
    `${path.basename(sourceDir)}${DEFAULT_PACKAGE_EXTENSION}`
  );

const chooseSourceDir = () => {
  const result = window.rubick.showOpenDialog({
    title: '选择插件目录',
    properties: ['openDirectory'],
  });
  const sourceDir = Array.isArray(result) ? result[0] : '';
  if (!sourceDir) return;
  packState.sourceDir = sourceDir;
  packState.outputPath = getDefaultOutputPath(sourceDir);
  packedFile.value = '';
};

const ensurePackageExtension = (filePath) =>
  /\.(rubick|zip)$/i.test(filePath) ? filePath : `${filePath}.rubick`;

const chooseOutputPath = () => {
  const defaultPath =
    packState.outputPath ||
    (packState.sourceDir ? getDefaultOutputPath(packState.sourceDir) : '');
  const result = window.rubick.showSaveDialog({
    title: '保存插件包',
    defaultPath,
    filters: [{ name: 'Rubick 插件包', extensions: ['rubick', 'zip'] }],
  });
  if (typeof result === 'string' && result) {
    packState.outputPath = ensurePackageExtension(result);
  }
};

const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${unitIndex === 0 ? value : value.toFixed(1)} ${units[unitIndex]}`;
};

const onPack = async () => {
  if (!packState.sourceDir) {
    message.warning('请先选择插件目录');
    return;
  }
  packing.value = true;
  try {
    const result = await window.rubick.packLocalPlugin(
      packState.sourceDir,
      packState.outputPath || undefined
    );
    if (result && result.success) {
      packState.outputPath = result.filePath;
      packedFile.value = result.filePath;
      const warnings = result.warnings || [];
      if (warnings.length) {
        console.warn('打包时跳过的文件：', warnings);
      }
      message.success(
        `打包成功：${result.fileCount} 个文件，${formatBytes(result.bytes)}${
          warnings.length ? `（跳过 ${warnings.length} 个文件）` : ''
        }`
      );
    } else {
      message.error((result && result.message) || '打包失败');
    }
  } catch (e) {
    message.error(`打包失败：${e && e.message ? e.message : e}`);
  } finally {
    packing.value = false;
  }
};

const showPackedFile = () => {
  if (packedFile.value) {
    window.rubick.shellShowItemInFolder(packedFile.value);
  }
};

const labelCol = { span: 4 };
const wrapperCol = { span: 14 };
</script>

<style lang="less" scoped>
.dev {
  box-sizing: border-box;
  width: 100%;
  overflow-x: hidden;
  height: calc(~'100vh - 34px');
  .view-title {
    font-size: 16px;
    font-weight: 500;
    margin-bottom: 16px;
    color: var(--color-text-primary);
  }
  .view-container {
    padding: 10px;
    box-sizing: border-box;
    border-radius: 8px;
    background: var(--color-body-bg);
    overflow: auto;
    height: calc(~'100vh - 84px');
  }
  .section-title {
    font-size: 15px;
    font-weight: 500;
    margin-bottom: 8px;
    color: var(--color-text-primary);
  }
  .section-desc {
    margin-bottom: 20px;
    font-size: 13px;
    line-height: 1.7;
    color: var(--color-text-desc);
    code {
      padding: 0 4px;
      border-radius: 3px;
      background: var(--color-input-hover);
      color: var(--color-text-content);
    }
  }
  .path-row {
    display: flex;
    align-items: center;
    gap: 8px;
    .ant-input {
      flex: 1;
    }
  }
  :deep(label) {
    color: var(--color-text-content);
  }
  :deep(.ant-input) {
    background: var(--color-input-hover) !important;
    color: var(--color-text-content);
  }
}
</style>
