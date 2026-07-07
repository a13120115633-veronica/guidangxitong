<template>
  <div>
    <div class="page-header">
      <h1>公司资料统一归档系统</h1>
      <div class="sub">下载中心：浏览 NAS 归档资料</div>
    </div>

    <div class="section-card" style="padding: 8px 16px;">
      <el-radio-group v-model="activeTab" size="default" @change="onTabChange">
        <el-radio-button value="upload">
          <span style="display:inline-flex;align-items:center;gap:6px;">
            <el-icon><Upload /></el-icon> 上传中心
          </span>
        </el-radio-button>
        <el-radio-button value="download">
          <span style="display:inline-flex;align-items:center;gap:6px;">
            <el-icon><FolderOpened /></el-icon> 下载中心
          </span>
        </el-radio-button>
      </el-radio-group>
    </div>

    <div class="section-card">
      <h2><el-icon style="color: #6d28d9;"><FolderOpened /></el-icon> NAS 归档浏览（全库）</h2>
      <div style="display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; align-items: center;">
        <el-input
          v-model="nasSearchKeyword"
          placeholder="搜索文件名 / 项目 / 路径"
          clearable
          style="max-width: 360px; flex: 1;"
          @keyup.enter="doScanNas(false)"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-button type="primary" @click="doScanNas(false)" :loading="nasLoading">
          <el-icon><Refresh /></el-icon>
          <span>开始扫描 NAS</span>
        </el-button>
        <span v-if="nasScannedResult?.scanned_at" class="text-sm text-muted" style="margin-left: auto;">
          扫描于 {{ formatTime(nasScannedResult.scanned_at) }} · 共 {{ nasScannedResult?.total ?? 0 }} 个文件
        </span>
      </div>
      <div style="font-size: 12px; color: #6b7280; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
        <span v-if="autoScanEnabled" style="display:inline-flex;align-items:center;gap:4px;">
          <span class="pulse-dot" style="display:inline-block;width:8px;height:8px;border-radius:9999px;background:#10b981;box-shadow:0 0 0 0 rgba(16,185,129,0.7);animation:pulse 2s infinite;"></span>
          自动扫描已开启（间隔 {{ (autoScanIntervalMs/60000).toFixed(0) }} 分钟）
          <template v-if="nextScanAt">· 下次扫描约 <b>{{ countdownText }}</b> 后</template>
        </span>
        <el-switch
          v-model="autoScanEnabled"
          size="small"
          active-text="自动扫描开"
          inactive-text="自动扫描关"
          style="margin-left: auto;"
          @change="onAutoScanSwitch"
        />
      </div>
      <div v-if="nasLoading" style="text-align: center; padding: 30px 0; color: #9ca3af;">
        <el-icon class="is-loading"><Loading /></el-icon> 扫描 NAS 中...
      </div>
      <div v-else-if="!nasSearchKeyword.trim()" style="text-align: center; padding: 40px 20px; color: #6b7280;">
        <el-icon style="font-size: 36px; color: #d1d5db;"><Search /></el-icon>
        <div style="margin-top: 10px; font-weight: 500;">请先在上方输入<b style="color:#6d28d9;">项目名称 / 编号</b>或<b style="color:#6d28d9;">文件关键词</b></div>
        <div style="margin-top: 4px; font-size: 13px;">再点击「开始扫描 NAS」查看该项目下的归档文件内容，默认不展示全库文件夹列表。</div>
      </div>
      <div v-else-if="!nasScannedResult || (nasScannedResult.total ?? 0) === 0" style="text-align: center; padding: 30px 0; color: #9ca3af;">
        <el-icon style="font-size: 32px; color: #d1d5db;"><Folder /></el-icon>
        <div style="margin-top: 8px;">尚未扫描或 NAS 中暂无匹配「{{ nasSearchKeyword }}」的文件，请点击「开始扫描 NAS」</div>
      </div>
      <div v-else>
        <div v-if="groupedNasProjects.length === 0" style="text-align: center; padding: 20px; color: #9ca3af;">
          没有匹配「{{ nasSearchKeyword }}」的结果
        </div>
        <div v-for="grp in groupedNasProjects" :key="grp.project_folder || grp.id" style="margin-bottom: 18px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding: 4px 0;">
            <el-icon style="color: #6d28d9;"><Folder /></el-icon>
            <h3 style="margin: 0; font-size: 15px;">{{ grp._project?.name || grp.project_folder || '（未分类项目）' }}</h3>
            <el-tag size="small" type="info" effect="light" v-if="grp.project_folder">NAS 目录：{{ grp.project_folder }}</el-tag>
            <el-tag size="small" effect="plain">共 {{ grp.total }} 个文件</el-tag>
            <el-button
              v-if="grp._project?.id"
              link
              type="primary"
              size="small"
              @click="goProject(grp._project.id)"
              style="margin-left: auto;"
            >
              查看项目详情 →
            </el-button>
          </div>
          <div v-for="sf in grp.files" :key="(sf.id || sf.relative_path) + '-dl'" class="list-item" style="padding: 10px 14px;">
            <div class="flex-row" style="align-items: flex-start; gap: 10px;">
              <div class="file-name" style="flex: 1; min-width: 0;">
                <div style="display:flex;align-items:center;gap:6px;">
                  <el-icon style="color: #6d28d9; flex-shrink:0;"><FolderOpened /></el-icon>
                  <span :title="sf.file_name">{{ sf.file_name }}</span>
                  <el-tag v-if="sf.source === 'nas_only'" size="small" type="info" effect="light">仅 NAS</el-tag>
                </div>
                <div class="flex-row flex-wrap text-sm text-muted" style="margin-top: 4px; padding-left: 22px; gap: 6px 14px;">
                  <span v-if="sf.category_folder">分类：<b>{{ sf.category_folder }}</b></span>
                  <span><el-icon><Coin /></el-icon> {{ formatSize(sf.size) }}</span>
                  <span><el-icon><Calendar /></el-icon> {{ formatTime(sf.last_modified) }}</span>
                </div>
              </div>
              <span
                @click="handleNasDownload(sf)"
                style="display: inline-flex; align-items: center; gap: 4px; color: #6d28d9; text-decoration: none; font-size: 13px; flex-shrink: 0; cursor: pointer;"
              >
                <el-icon><Download /></el-icon> 下载
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Upload, Search, Refresh, Loading, Folder, FolderOpened, Calendar, Coin, Download } from '@element-plus/icons-vue';
import { projectApi, fileApi } from '@/api/index.js';
import { statusLabel, statusClass, formatSize, highlightText, downloadLabel, displayFileName, isRenamed, finalPathPreview, extractFilenameFromHeaders, saveBlobFromResponse } from '@/utils/format.js';
import '../../style.css';
const router = useRouter();
const route = useRoute();

const DEFAULT_AUTO_SCAN_INTERVAL_MS = 20 * 60 * 1000;
const activeTab = ref('download');

function onTabChange(v) {
  if (v === 'upload') router.push('/');
}

const projectNameCache = new Map();

const nasLoading = ref(false);
const nasSearchKeyword = ref('');
const nasScannedResult = ref(null);

const autoScanEnabled = ref(true);
const autoScanIntervalMs = ref(DEFAULT_AUTO_SCAN_INTERVAL_MS);
const nextScanAt = ref(null);
let scanTimer = null;
let countdownTimer = null;
let isScanningRunning = false;

const countdownText = computed(() => {
  if (!nextScanAt.value) return '-';
  const diff = Math.max(0, nextScanAt.value - Date.now());
  const totalSec = Math.ceil(diff / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(m)}:${pad(s)}`;
});

function startCountdownTimer() {
  stopCountdownTimer();
  countdownTimer = setInterval(() => {
    // 仅触发 computed 重新计算即可，不需要显式 set
    if (!nextScanAt.value) {
      stopCountdownTimer();
    }
  }, 1000);
}
function stopCountdownTimer() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function scheduleNextScan() {
  stopScanTimer();
  if (!autoScanEnabled.value) return;
  const delay = Math.max(1000, autoScanIntervalMs.value);
  nextScanAt.value = Date.now() + delay;
  startCountdownTimer();
  scanTimer = setTimeout(async () => {
    try {
      await doScanNas(true);
    } finally {
      scheduleNextScan();
    }
  }, delay);
}

function stopScanTimer() {
  if (scanTimer) {
    clearTimeout(scanTimer);
    scanTimer = null;
  }
  nextScanAt.value = null;
  stopCountdownTimer();
}

function onAutoScanSwitch(v) {
  if (v) {
    scheduleNextScan();
    ElMessage.success(`已开启自动扫描（每 ${(autoScanIntervalMs.value / 60000).toFixed(0)} 分钟一次）`);
  } else {
    stopScanTimer();
    ElMessage.info('已关闭自动扫描');
  }
}

async function doScanNas(isAuto = false) {
  if (isScanningRunning) return;
  const q = nasSearchKeyword.value.trim();
  if (!q) {
    if (!isAuto) {
      ElMessage.warning('请先输入项目名称 / 编号 或 文件关键词，再点击扫描。');
    }
    return;
  }
  isScanningRunning = true;
  try {
    await loadNasBrowse();
  } finally {
    isScanningRunning = false;
  }
}

const groupedNasProjects = computed(() => {
  const q = nasSearchKeyword.value.trim().toLowerCase();
  if (!q) return [];
  const files = nasScannedResult.value?.files || [];
  if (!Array.isArray(files) || files.length === 0) return [];
  const filtered = files.filter((sf) => {
    const inName = String(sf.file_name || '').toLowerCase().includes(q);
    const inRel = String(sf.relative_path || '').toLowerCase().includes(q);
    const inProj = String(sf.project_folder || '').toLowerCase().includes(q);
    const inCat = String(sf.category_folder || '').toLowerCase().includes(q);
    const inProjName = String(sf._project?.name || '').toLowerCase().includes(q);
    return inName || inRel || inProj || inCat || inProjName;
  });
  const byProj = new Map();
  for (const sf of filtered) {
    const key = sf.project_folder || sf._project?.id || '__uncategorized__';
    if (!byProj.has(key)) {
      byProj.set(key, {
        id: key,
        project_folder: sf.project_folder || '',
        _project: sf._project || null,
        files: [],
        total: 0
      });
    }
    const grp = byProj.get(key);
    grp.files.push(sf);
    grp.total++;
  }
  return Array.from(byProj.values()).sort((a, b) => {
    const na = a._project?.name || a.project_folder || '';
    const nb = b._project?.name || b.project_folder || '';
    return na.localeCompare(nb, 'zh-CN');
  });
});

function formatTime(t) {
  if (!t) return '-';
  const d = new Date(t);
  if (isNaN(d.getTime())) return String(t);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function resolveProjectName(file) {
  if (!file?.project_id) return '';
  if (projectNameCache.has(file.project_id)) return projectNameCache.get(file.project_id);
  const p = file.project || null;
  const name = p?.name || p?.root_name || (p ? (p.code || '') : '');
  if (name) projectNameCache.set(file.project_id, name);
  return name;
}

function goProject(id) {
  if (!id) return;
  router.push({ path: `/project/${id}`, query: { mode: 'download' } });
}

async function handleNasDownload(sf) {
  if (!sf) return;
  try {
    const scanRoot = nasScannedResult.value && String(nasScannedResult.value?.mount_root || '').trim()
      ? String(nasScannedResult.value.mount_root).trim()
      : '';
    const mount = scanRoot || getSavedNasMountRoot() || undefined;
    const resp = await fileApi.downloadNas({
      mountRoot: mount,
      relativePath: sf.relative_path,
      absolutePath: sf.absolute_path,
      downloadName: sf.file_name
    });
    await saveBlobFromResponse(resp, sf.file_name || 'archive-file');
    ElMessage.success({ message: `已开始下载：${sf.file_name || '文件'}`, duration: 2000 });
  } catch (e) {
    const msg = e && e.response && e.response.data && e.response.data.error
      ? String(e.response.data.error)
      : (e && e.message ? e.message : '下载失败，请稍后重试');
    ElMessage.error({ message: msg, duration: 5000, showClose: true });
  }
}

function getSavedNasMountRoot() {
  try {
    const raw = localStorage.getItem('archive_system_nas_settings_v1');
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    return String(parsed?.mountRoot || '').trim() || '';
  } catch (_) { return ''; }
}

async function ensureNasSettingsFromServer() {
  try {
    let localInterval = null;
    let localMount = '';
    let localPayload = null;
    try {
      const raw = localStorage.getItem('archive_system_nas_settings_v1');
      if (raw) {
        localPayload = JSON.parse(raw || '{}');
        if (typeof localPayload?.autoScanIntervalMinutes === 'number') {
          localInterval = Math.max(1, Math.min(1440, Number(localPayload.autoScanIntervalMinutes)));
          autoScanIntervalMs.value = localInterval * 60 * 1000;
        }
        localMount = String(localPayload?.mountRoot || '').trim() || '';
      }
    } catch (_) {}
    let remote = null;
    try { remote = await fileApi.nasConfig(); } catch (_) { remote = null; }
    if (remote && typeof remote?.autoScanIntervalMinutes === 'number') {
      const min = Math.max(1, Math.min(1440, Number(remote.autoScanIntervalMinutes)));
      autoScanIntervalMs.value = min * 60 * 1000;
    }
    const remoteMount = (remote && remote?.mountRoot && String(remote.mountRoot).trim()) ? String(remote.mountRoot).trim() : '';
    const finalCopyMode = remote?.copyMode === 'move' ? 'move' : (localPayload?.copyMode === 'move' ? 'move' : 'copy');
    const finalOverwrite = remote && typeof remote.overwrite === 'boolean' ? remote.overwrite : !!localPayload?.overwriteExisting;
    const finalInterval = Math.round(autoScanIntervalMs.value / 60000) || Math.round(DEFAULT_AUTO_SCAN_INTERVAL_MS / 60000);
    if (remoteMount) {
      try {
        const payload = {
          mountRoot: remoteMount,
          copyMode: finalCopyMode,
          overwriteExisting: !!finalOverwrite,
          autoScanIntervalMinutes: finalInterval
        };
        localStorage.setItem('archive_system_nas_settings_v1', JSON.stringify(payload));
      } catch (_) {}
      return remoteMount;
    }
    if (localMount && localMount.trim()) return localMount;
    return '';
  } catch (_) {
    return getSavedNasMountRoot();
  }
}

async function loadNasBrowse() {
  nasLoading.value = true;
  try {
    await ensureNasSettingsFromServer();
    const mount = getSavedNasMountRoot();
    const data = await fileApi.nasScan({
      mount_root: mount || undefined,
      limit: 500
    });
    nasScannedResult.value = data || null;
    if (data && data.mount_root && String(data.mount_root).trim()) {
      const effectiveRoot = String(data.mount_root).trim();
      const saved = getSavedNasMountRoot();
      if (effectiveRoot && effectiveRoot !== saved) {
        try {
          const raw = localStorage.getItem('archive_system_nas_settings_v1');
          const prev = raw ? (JSON.parse(raw) || {}) : {};
          const merged = {
            ...(prev && typeof prev === 'object' ? prev : {}),
            mountRoot: effectiveRoot
          };
          localStorage.setItem('archive_system_nas_settings_v1', JSON.stringify(merged));
        } catch (_) {}
      }
    }
  } catch (e) {
    nasScannedResult.value = { files: [], total: 0, nas_only_count: 0, nas_and_db_count: 0 };
  } finally {
    nasLoading.value = false;
  }
}

onMounted(async () => {
  await ensureNasSettingsFromServer();
  scheduleNextScan();
});

onBeforeUnmount(() => {
  stopScanTimer();
  stopCountdownTimer();
});
</script>

<style scoped>
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
  70% { box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
  100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
}
</style>
