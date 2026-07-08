<template>
  <div>
    <div class="page-header">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
        <el-button
          size="small"
          text
          style="color: white; padding: 4px 8px;"
          @click="goHome"
        >
          <el-icon><ArrowLeft /></el-icon>
          <span>返回</span>
        </el-button>
      </div>
      <h1>{{ project?.name || project?.root_name || '加载中...' }}</h1>
      <div class="sub" v-if="project?.root_name && project?.name && project.root_name !== project.name">
        {{ project.root_name }}
      </div>
      <div class="sub" v-else-if="project?.code">
        项目编号：{{ project.code }}
      </div>
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

    <div class="section-card" v-if="loadingDetail" style="text-align: center; padding: 40px;">
      <el-icon class="is-loading" style="font-size: 24px; color: #2563eb;"><Loading /></el-icon>
      <div style="margin-top: 8px; color: #6b7280;">加载项目详情...</div>
    </div>

    <template v-else-if="project">
      <div class="section-card">
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <el-button type="primary" @click="openUploadDialog">
            <el-icon><Upload /></el-icon>
            <span>上传资料到本项目</span>
          </el-button>
          <el-button @click="loadDetail" :loading="loadingDetail">
            <el-icon><Refresh /></el-icon>
            <span>刷新</span>
          </el-button>
        </div>
      </div>

      <div class="section-card" v-if="uploadSuccessCard">
        <div style="background: #ecfdf5; border: 1px solid #6ee7b7; border-radius: 8px; padding: 12px; display: flex; gap: 10px; align-items: flex-start;">
          <el-icon style="color: #059669; font-size: 20px; flex-shrink: 0;"><CircleCheck /></el-icon>
          <div style="flex: 1;">
            <div style="font-weight: 600; color: #065f46;">上传提交成功</div>
            <div style="font-size: 13px; color: #065f46; margin-top: 2px;">
              您的资料已提交，等待管理员审核。审核通过后将正式归档。
            </div>
          </div>
          <el-button size="small" text @click="uploadSuccessCard = false" style="color: #059669;">关闭</el-button>
        </div>
      </div>

      <div class="section-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h2 style="margin: 0;"><el-icon><FolderOpened /></el-icon> 项目资料列表</h2>
          <el-input
            v-model="fileFilter"
            placeholder="在本项目中搜索文件名"
            clearable
            size="small"
            style="max-width: 240px;"
          >
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
        </div>

        <div v-if="filteredFiles.length === 0" style="text-align: center; padding: 40px 20px; color: #6b7280;">
          <el-icon style="font-size: 36px; color: #d1d5db;"><Document /></el-icon>
          <div style="margin-top: 10px;">该项目还没有匹配资料。</div>
          <div style="margin-top: 4px; font-size: 13px;">
            点击 <span style="color: #2563eb;">"上传资料到本项目"</span> 提交文件，或调整本项目资料搜索词。
          </div>
        </div>

        <div v-else>
          <div v-for="f in filteredFiles" :key="f.id" class="list-item">
            <div class="flex-col" style="gap: 8px;">
              <div class="flex-row" style="align-items: flex-start; gap: 10px;">
                <div class="file-name" style="flex: 1; min-width: 0;">
                  <div style="display:flex;align-items:center;gap:6px;">
                    <el-icon style="color: #6b7280; flex-shrink:0;"><Document /></el-icon>
                    <span :title="displayFileName(f)">{{ displayFileName(f) }}</span>
                    <el-tag v-if="isRenamed(f)" size="small" type="success" effect="light" style="flex-shrink:0;">已重命名</el-tag>
                  </div>
                  <div v-if="isRenamed(f)" class="text-sm" style="color:#6b7280;margin-top:2px;padding-left:22px;">
                    原上传文件名：{{ f.original_name }}
                  </div>
                </div>
                <span :class="statusClass(f.status)" style="flex-shrink: 0;">{{ statusLabel(f.status) }}</span>
              </div>

              <div class="flex-row flex-wrap" style="gap: 6px 14px;">
                <span class="text-sm" v-if="f.uploader"><el-icon><User /></el-icon> {{ f.uploader }}</span>
                <span class="text-sm" v-if="f.department"><el-icon><OfficeBuilding /></el-icon> {{ f.department }}</span>
                <span class="text-sm"><el-icon><Calendar /></el-icon> {{ formatTime(f.uploaded_at) }}</span>
                <span class="text-sm" v-if="f.size != null"><el-icon><Coin /></el-icon> {{ formatSize(f.size) }}</span>
              </div>

              <div v-if="f.status === 'ready_for_nas'" class="manual-warn">
                <el-icon><Warning /></el-icon> 等待管理员上传，当前仍不是正式归档文件
              </div>

              <div v-if="(f.status === 'needs_info' || f.status === 'rejected') && f.review_comment" class="manual-warn"
                   :style="{ background: f.status === 'rejected' ? '#fef2f2' : '#fffbeb', borderColor: f.status === 'rejected' ? '#fecaca' : '#fde68a', color: f.status === 'rejected' ? '#991b1b' : '#92400e' }">
                <el-icon><ChatDotRound /></el-icon>
                {{ f.status === 'needs_info' ? '需要补充：' : '拒绝原因：' }}{{ f.review_comment }}
              </div>

              <div v-if="finalPathPreview(f)" class="path-preview">
                <el-icon><Location /></el-icon>
                <span v-if="f.status === 'manually_uploaded'">归档路径：</span>
                <span v-else-if="f.status === 'ready_for_nas'">待上传路径：</span>
                <span v-else>推荐归档路径：</span>
                {{ finalPathPreview(f) }}
              </div>

              <div v-if="f.extract_status" class="text-sm" style="margin-top: 2px;">
                <el-tag
                  :type="extractStatusType(f.extract_status)"
                  size="small"
                  effect="light"
                  :class="extractProcessing(f.extract_status) ? 'extract-tag-pulse' : ''"
                  style="margin-right: 6px;"
                >
                  {{ extractStatusLabel(f.extract_status) }}
                </el-tag>
                <span style="color:#64748b;" v-if="f.extract_status === 'extract_success' && f.extracted_chars">
                  已抽取 {{ f.extracted_chars.toLocaleString ? f.extracted_chars.toLocaleString() : f.extracted_chars }} 字符
                </span>
                <span style="color:#f43f5e;" v-if="f.extract_status === 'extract_failed' && f.extract_error">
                  · {{ f.extract_error }}
                </span>
              </div>

              <div v-if="f.content_suggestion?.content_summary" class="content-summary-box-employee">
                <el-icon style="color:#ea580c;"><MagicStick /></el-icon>
                <b>正文摘要：</b>{{ f.content_suggestion.content_summary }}
              </div>

              <div v-if="f.status === 'manually_uploaded' && f.final_name" class="text-sm" style="color: #065f46;">
                <el-icon><SuccessFilled /></el-icon> 归档名：{{ f.final_name }}
              </div>

              <div style="margin-top: 4px;">
                <span
                  @click="handleDownloadFile(f)"
                  style="display: inline-flex; align-items: center; gap: 4px; color: #2563eb; text-decoration: none; font-size: 13px; cursor: pointer;"
                >
                  <el-icon><Download /></el-icon> {{ downloadLabel(f.status) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="section-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h2 style="margin: 0;"><el-icon style="color: #6d28d9;"><FolderOpened /></el-icon> NAS 归档文件（项目文件夹）</h2>
          <div style="display: flex; gap: 8px;">
            <el-input
              v-model="nasFileFilter"
              placeholder="搜索 NAS 文件名"
              clearable
              size="small"
              style="max-width: 200px;"
            >
              <template #prefix><el-icon><Search /></el-icon></template>
            </el-input>
            <el-button size="small" @click="doScanNasProject(false)" :loading="nasLoading">
              <el-icon><Refresh /></el-icon>
              <span>扫描 NAS</span>
            </el-button>
          </div>
        </div>
        <div style="font-size: 12px; color: #6b7280; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
          <span v-if="nasAutoScanEnabled" style="display:inline-flex;align-items:center;gap:4px;">
            <span class="pulse-dot" style="display:inline-block;width:8px;height:8px;border-radius:9999px;background:#10b981;box-shadow:0 0 0 0 rgba(16,185,129,0.7);animation:pulse 2s infinite;"></span>
            自动扫描已开启（间隔 {{ (nasAutoScanIntervalMs/60000).toFixed(0) }} 分钟）
            <template v-if="nasNextScanAt">· 下次扫描约 <b>{{ nasCountdownText }}</b> 后</template>
          </span>
          <el-switch
            v-model="nasAutoScanEnabled"
            size="small"
            active-text="自动扫描开"
            inactive-text="自动扫描关"
            style="margin-left: auto;"
            @change="onNasAutoScanSwitch"
          />
        </div>

        <div v-if="nasLoading" style="text-align: center; padding: 40px 20px; color: #6b7280;">
          <el-icon class="is-loading" style="font-size: 24px; color: #6d28d9;"><Loading /></el-icon>
          <div style="margin-top: 8px;">正在扫描 NAS 项目文件夹...</div>
        </div>

        <div v-else-if="projectNasFiles.length === 0" style="text-align: center; padding: 40px 20px; color: #6b7280;">
          <el-icon style="font-size: 36px; color: #d1d5db;"><Folder /></el-icon>
          <div style="margin-top: 10px;">NAS 中暂未找到该项目的归档文件</div>
          <div style="margin-top: 4px; font-size: 13px;">
            点击右上角「扫描 NAS」刷新，或确认 NAS 上已按项目编号+名称创建文件夹
          </div>
        </div>

        <div v-else>
          <div style="font-size: 13px; color: #6b7280; margin-bottom: 10px;">
            共 {{ projectNasFiles.length }} 个文件 · NAS 项目目录匹配：
            <code style="background: #f3f4f6; padding: 1px 6px; border-radius: 4px;">
              {{ matchedNasProjectFolders.length ? matchedNasProjectFolders.join(' / ') : '（自动匹配）' }}
            </code>
          </div>
          <div v-for="sf in filteredNasFiles" :key="(sf.id || sf.relative_path) + '-nas'" class="list-item">
            <div class="flex-col" style="gap: 6px;">
              <div class="flex-row" style="align-items: flex-start; gap: 10px;">
                <div class="file-name" style="flex: 1; min-width: 0;">
                  <div style="display:flex;align-items:center;gap:6px;">
                    <el-icon style="color: #6d28d9; flex-shrink:0;"><FolderOpened /></el-icon>
                    <span :title="sf.file_name">{{ sf.file_name }}</span>
                    <el-tag v-if="sf.source === 'nas_only'" size="small" type="info" effect="light" style="flex-shrink:0;">仅 NAS</el-tag>
                    <el-tag v-else size="small" type="success" effect="light" style="flex-shrink:0;">已关联</el-tag>
                  </div>
                  <div class="text-sm" style="color:#6b7280;margin-top:2px;padding-left:22px;">
                    分类：<b>{{ sf.category_folder || '（未分类）' }}</b>
                  </div>
                </div>
                <span
                  @click="handleNasDownload(sf)"
                  style="display: inline-flex; align-items: center; gap: 4px; color: #6d28d9; text-decoration: none; font-size: 13px; flex-shrink: 0; cursor: pointer;"
                >
                  <el-icon><Download /></el-icon> 下载
                </span>
              </div>

              <div class="flex-row flex-wrap" style="gap: 6px 14px;">
                <span class="text-sm"><el-icon><Coin /></el-icon> {{ formatSize(sf.size) }}</span>
                <span class="text-sm"><el-icon><Calendar /></el-icon> {{ formatTime(sf.last_modified) }}</span>
                <span class="text-sm" style="color: #6b7280;" :title="sf.absolute_path">
                  <el-icon><Location /></el-icon> {{ sf.relative_path }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <el-dialog
      v-model="uploadDialogVisible"
      title="上传资料到本项目"
      width="95%"
      style="max-width: 560px;"
      :append-to-body="false"
      @closed="onUploadDialogClosed"
    >
      <el-form :model="uploadForm" label-position="top" size="default">
        <el-form-item label="上传人姓名" required>
          <el-input v-model="uploadForm.uploader" placeholder="请输入您的姓名" />
        </el-form-item>
        <el-form-item label="部门" required>
          <el-input v-model="uploadForm.department" placeholder="请输入您的部门" />
        </el-form-item>
        <el-form-item label="备注说明（可选）">
          <el-input
            v-model="uploadForm.note"
            type="textarea"
            :rows="3"
            placeholder="填写文件说明、版本信息等，方便管理员审核归档"
          />
        </el-form-item>
        <el-form-item label="选择文件（最多 20 个，单个不超过 1000MB）">
          <el-upload
            ref="uploadRef"
            multiple
            :limit="20"
            :auto-upload="false"
            :before-upload="beforeUpload"
            :on-exceed="onExceed"
            :on-remove="onFileRemove"
            :on-change="onFileChange"
            drag
            action=""
          >
            <el-icon style="font-size: 32px; color: #9ca3af;"><UploadFilled /></el-icon>
            <div style="margin-top: 6px;">拖拽文件到此处，或点击选择文件</div>
            <template #tip>
              <div style="color: #9ca3af; font-size: 12px; margin-top: 4px;">
                支持常见文档、PDF、图纸、压缩包等；选择后点击下方"确认上传"提交
              </div>
            </template>
          </el-upload>
        </el-form-item>
        <div v-if="invalidFiles.length > 0" style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 8px 12px; margin-bottom: 12px; color: #991b1b; font-size: 13px;">
          <el-icon><Warning /></el-icon> 以下文件超过 1000MB，已自动忽略：
          <div style="margin-top: 4px;">
            <span v-for="f in invalidFiles" :key="f.name" style="display: inline-block; margin-right: 10px;">{{ f.name }} ({{ formatSize(f.size) }})</span>
          </div>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="uploadDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="uploading"
          :disabled="!canSubmitUpload"
          @click="submitUpload"
        >
          <el-icon><Upload /></el-icon>
          <span>确认上传 ({{ uploadFileList.length }} 个文件)</span>
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, toRefs } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import {
  ArrowLeft, Loading, Upload, Refresh, CircleCheck, Folder, FolderOpened, Search, Document,
  User, OfficeBuilding, Calendar, Coin, Warning, ChatDotRound, Location, SuccessFilled,
  Download, UploadFilled, MagicStick
} from '@element-plus/icons-vue';
import { projectApi, fileApi } from '@/api/index.js';
import { statusLabel, statusClass, formatSize, downloadLabel, displayFileName, isRenamed, finalPathPreview, saveBlobFromResponse } from '@/utils/format.js';

const props = defineProps({
  id: { type: [String, Number], required: true }
});

const router = useRouter();
const route = useRoute();

const { id } = toRefs(props);

const _defaultTab = () => {
  const m = String(route.query?.mode || 'upload').toLowerCase();
  return m === 'download' ? 'download' : 'upload';
};
const activeTab = ref(_defaultTab());

function onTabChange(v) {
  if (v === 'upload') router.push('/');
  else if (v === 'download') router.push('/download');
}

async function handleDownloadFile(f) {
  if (!f) return;
  try {
    const resp = await fileApi.downloadById(f.id);
    const fallbackName = f.final_name || f.original_name || (f.file_name ? f.file_name : `file-${f.id}`);
    await saveBlobFromResponse(resp, fallbackName);
    ElMessage.success({ message: `已开始下载：${fallbackName}`, duration: 2000 });
  } catch (e) {
    const msg = e && e.response && e.response.data && e.response.data.error
      ? String(e.response.data.error)
      : (e && e.message ? e.message : '下载失败，请稍后重试');
    ElMessage.error({ message: msg, duration: 5000, showClose: true });
  }
}

async function handleNasDownload(sf) {
  if (!sf) return;
  try {
    const scanRoot = lastNasScanResult.value && String(lastNasScanResult.value?.mount_root || '').trim()
      ? String(lastNasScanResult.value.mount_root).trim()
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

const loadingDetail = ref(false);
const project = ref(null);
const files = ref([]);
const stats = ref({ archived: 0, pending: 0, needsInfo: 0, rejected: 0 });
const fileFilter = ref('');
const uploadSuccessCard = ref(false);
const nasLoading = ref(false);
const nasAllScannedFiles = ref([]);
const projectNasFiles = ref([]);
const matchedNasProjectFolders = ref([]);
const nasFileFilter = ref('');
const lastNasScanResult = ref(null);
let pollTimer = null;

const NAS_DEFAULT_AUTO_SCAN_MS = 20 * 60 * 1000;
const nasAutoScanEnabled = ref(true);
const nasAutoScanIntervalMs = ref(NAS_DEFAULT_AUTO_SCAN_MS);
const nasNextScanAt = ref(null);
let nasScanTimer = null;
let nasCountdownTimer = null;
let isNasScanningRunning = false;

const nasCountdownText = computed(() => {
  if (!nasNextScanAt.value) return '-';
  const diff = Math.max(0, nasNextScanAt.value - Date.now());
  const totalSec = Math.ceil(diff / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(m)}:${pad(s)}`;
});

function startNasCountdownTimer() {
  stopNasCountdownTimer();
  nasCountdownTimer = setInterval(() => {
    if (!nasNextScanAt.value) stopNasCountdownTimer();
  }, 1000);
}
function stopNasCountdownTimer() {
  if (nasCountdownTimer) {
    clearInterval(nasCountdownTimer);
    nasCountdownTimer = null;
  }
}
function scheduleNextNasScan() {
  stopNasScanTimer();
  if (!nasAutoScanEnabled.value) return;
  const delay = Math.max(1000, nasAutoScanIntervalMs.value);
  nasNextScanAt.value = Date.now() + delay;
  startNasCountdownTimer();
  nasScanTimer = setTimeout(async () => {
    try {
      await doScanNasProject(true);
    } finally {
      scheduleNextNasScan();
    }
  }, delay);
}
function stopNasScanTimer() {
  if (nasScanTimer) {
    clearTimeout(nasScanTimer);
    nasScanTimer = null;
  }
  nasNextScanAt.value = null;
  stopNasCountdownTimer();
}
function onNasAutoScanSwitch(v) {
  if (v) {
    scheduleNextNasScan();
    ElMessage.success(`已开启项目 NAS 自动扫描（每 ${(nasAutoScanIntervalMs.value / 60000).toFixed(0)} 分钟一次）`);
  } else {
    stopNasScanTimer();
    ElMessage.info('已关闭项目 NAS 自动扫描');
  }
}
async function doScanNasProject(isAuto = false) {
  if (isNasScanningRunning) return;
  isNasScanningRunning = true;
  try {
    await loadNasFiles();
  } finally {
    isNasScanningRunning = false;
  }
}

function extractStatusLabel(s) {
  switch (s) {
    case 'pending_extract': return '等待解析';
    case 'extracting': return '解析中…';
    case 'needs_ocr': return 'OCR 识别中…';
    case 'extract_success': return '解析完成';
    case 'extract_failed': return '解析失败';
    default: return s ? String(s).replace(/_/g, ' ') : '-';
  }
}
function extractStatusType(s) {
  switch (s) {
    case 'pending_extract': return 'info';
    case 'extracting': return 'primary';
    case 'needs_ocr': return 'warning';
    case 'extract_success': return 'success';
    case 'extract_failed': return 'danger';
    default: return 'info';
  }
}
function extractProcessing(s) {
  return ['pending_extract', 'extracting', 'needs_ocr'].includes(s);
}

const uploadDialogVisible = ref(false);
const uploading = ref(false);
const uploadRef = ref(null);
const uploadFileList = ref([]);
const invalidFiles = ref([]);
const uploadForm = reactive({
  uploader: '',
  department: '',
  note: ''
});

const filteredFiles = computed(() => {
  const q = fileFilter.value.trim().toLowerCase();
  if (!q) return files.value;
  return files.value.filter((f) => {
    const inName = String(f.original_name || '').toLowerCase().includes(q);
    const inFinal = String(f.final_name || '').toLowerCase().includes(q);
    const inUploader = String(f.uploader || '').toLowerCase().includes(q);
    const inDept = String(f.department || '').toLowerCase().includes(q);
    const inPath = `${String(f.ai_target_path || '')} ${String(f.final_path || '')}`.toLowerCase().includes(q);
    const inNote = String(f.note || '').toLowerCase().includes(q);
    return inName || inFinal || inUploader || inDept || inPath || inNote;
  });
});

const canSubmitUpload = computed(() => {
  return uploadForm.uploader.trim() && uploadForm.department.trim() && uploadFileList.value.length > 0 && !uploading.value;
});

const filteredNasFiles = computed(() => {
  const q = nasFileFilter.value.trim().toLowerCase();
  if (!q) return projectNasFiles.value;
  return projectNasFiles.value.filter((sf) => {
    const inName = String(sf.file_name || '').toLowerCase().includes(q);
    const inRel = String(sf.relative_path || '').toLowerCase().includes(q);
    const inCat = String(sf.category_folder || '').toLowerCase().includes(q);
    const inProj = String(sf.project_folder || '').toLowerCase().includes(q);
    return inName || inRel || inCat || inProj;
  });
});

function nasDownloadUrl(scannedFile) {
  if (!scannedFile) return '#';
  return fileApi.nasDownloadUrl({
    relativePath: scannedFile.relative_path,
    absolutePath: scannedFile.absolute_path,
    downloadName: scannedFile.file_name
  });
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
    let localPayload = null;
    let localMount = '';
    try {
      const raw = localStorage.getItem('archive_system_nas_settings_v1');
      if (raw) {
        localPayload = JSON.parse(raw || '{}');
        if (typeof localPayload?.autoScanIntervalMinutes === 'number') {
          const min = Math.max(1, Math.min(1440, Number(localPayload.autoScanIntervalMinutes)));
          nasAutoScanIntervalMs.value = min * 60 * 1000;
        }
        localMount = String(localPayload?.mountRoot || '').trim() || '';
      }
    } catch (_) {}
    let remote = null;
    try { remote = await fileApi.nasConfig(); } catch (_) { remote = null; }
    if (remote && typeof remote?.autoScanIntervalMinutes === 'number') {
      const min = Math.max(1, Math.min(1440, Number(remote.autoScanIntervalMinutes)));
      nasAutoScanIntervalMs.value = min * 60 * 1000;
    }
    const remoteMount = (remote && remote?.mountRoot && String(remote.mountRoot).trim()) ? String(remote.mountRoot).trim() : '';
    const finalCopyMode = remote?.copyMode === 'move' ? 'move' : (localPayload?.copyMode === 'move' ? 'move' : 'copy');
    const finalOverwrite = remote && typeof remote.overwrite === 'boolean' ? remote.overwrite : !!localPayload?.overwriteExisting;
    const finalInterval = Math.round(nasAutoScanIntervalMs.value / 60000) || 20;
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

function _normalizeMatchText(s) {
  return String(s || '').trim()
    .replace(/[\s\-_\u3000\.·・,，。、（）()【】\[\]《》"'`]/g, '')
    .replace(/^[0-9]+/g, '')
    .toLowerCase();
}

function _coreMatch(a, b) {
  const na = _normalizeMatchText(a);
  const nb = _normalizeMatchText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  let overlap = 0;
  const aChars = new Set(na.split(''));
  const bChars = new Set(nb.split(''));
  for (const c of aChars) if (bChars.has(c)) overlap++;
  const minLen = Math.min(aChars.size, bChars.size);
  return minLen >= 3 && (overlap / minLen) >= 0.7;
}

async function loadNasFiles() {
  if (!project.value) return;
  nasLoading.value = true;
  try {
    await ensureNasSettingsFromServer();
    const mount = getSavedNasMountRoot();
    const data = await fileApi.nasScan({
      mount_root: mount || undefined,
      limit: 500
    });
    lastNasScanResult.value = data || null;
    nasAllScannedFiles.value = data?.files || [];
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
    const p = project.value;
    const projectIdentifiers = [];
    if (p.root_name) projectIdentifiers.push(String(p.root_name).trim());
    if (p.code) projectIdentifiers.push(String(p.code).trim());
    if (p.name) projectIdentifiers.push(String(p.name).trim());
    const uniqIdentifiers = Array.from(new Set(projectIdentifiers.filter(Boolean)));
    const matchedFolderSet = new Set();
    const matched = (nasAllScannedFiles.value || []).filter((sf) => {
      const pf = String(sf.project_folder || '').trim();
      let matchedThis = false;
      for (const ident of uniqIdentifiers) {
        if (!ident) continue;
        if (pf === ident || pf.includes(ident) || ident.includes(pf)) { matchedThis = true; break; }
        if (_coreMatch(pf, ident)) { matchedThis = true; break; }
      }
      if (!matchedThis && sf.matched_file_id && files.value.some(f => String(f.id) === String(sf.matched_file_id))) {
        matchedThis = true;
      }
      if (!matchedThis && sf._project?.id && String(p.id) && String(sf._project.id) === String(p.id)) {
        matchedThis = true;
      }
      if (!matchedThis && pf) {
        const relPath = String(sf.relative_path || '');
        for (const ident of uniqIdentifiers) {
          if (!ident) continue;
          if (relPath.includes(ident) || _coreMatch(relPath, ident)) { matchedThis = true; break; }
        }
      }
      if (matchedThis && pf) matchedFolderSet.add(pf);
      return matchedThis;
    });
    projectNasFiles.value = matched.sort((a, b) => {
      const ca = String(a.category_folder || '');
      const cb = String(b.category_folder || '');
      if (ca !== cb) return ca.localeCompare(cb, 'zh-CN');
      return String(a.file_name || '').localeCompare(String(b.file_name || ''), 'zh-CN');
    });
    matchedNasProjectFolders.value = Array.from(matchedFolderSet).sort();
  } catch (e) {
    projectNasFiles.value = [];
    matchedNasProjectFolders.value = [];
  } finally {
    nasLoading.value = false;
  }
}

onMounted(() => {
  loadDetail();
  doScanNasProject(false).catch(() => {});
  scheduleNextNasScan();
  if (!pollTimer) {
    pollTimer = setInterval(() => {
      const hasPending = files.value.some(f =>
        ['pending_extract', 'extracting', 'needs_ocr'].includes(f.extract_status)
      );
      if (hasPending) loadDetail({ silent: true }).catch(() => {});
    }, 7000);
  }
});

onBeforeUnmount(() => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  stopNasScanTimer();
  stopNasCountdownTimer();
});

async function loadDetail(opts = {}) {
  const { silent = false } = opts;
  if (!silent) loadingDetail.value = true;
  try {
    const res = await projectApi.getDetail(id.value);
    const newProject = res?.project || res?.data?.project || res;
    const rawFiles = res?.files || res?.data?.files || [];
    const newFiles = Array.isArray(rawFiles) ? rawFiles : [];
    const rawStats = res?.stats || res?.data?.stats || {};
    const newStats = {
      archived: rawStats.archived ?? rawStats.manually_uploaded ?? 0,
      pending: rawStats.pending ?? rawStats.pending_review ?? 0,
      needsInfo: rawStats.needsInfo ?? rawStats.needs_info ?? 0,
      rejected: rawStats.rejected ?? 0
    };
    if (silent) {
      let changed = false;
      if (JSON.stringify(project.value || {}) !== JSON.stringify(newProject || {})) {
        project.value = newProject;
        changed = true;
      }
      if (newFiles.length !== files.value.length ||
          newFiles.some((nf, i) => {
            const of = files.value[i];
            if (!of) return true;
            return JSON.stringify(nf) !== JSON.stringify(of);
          })) {
        files.value = newFiles;
        changed = true;
      }
      const s = stats.value || {};
      if (s.archived !== newStats.archived || s.pending !== newStats.pending ||
          s.needsInfo !== newStats.needsInfo || s.rejected !== newStats.rejected) {
        stats.value = newStats;
        changed = true;
      }
      if (changed) files.value = [...files.value];
    } else {
      project.value = newProject;
      files.value = newFiles;
      stats.value = newStats;
      loadNasFiles().catch(() => {});
    }
  } catch (e) {
    if (!silent) ElMessage.error(e.message || '加载项目详情失败');
  } finally {
    if (!silent) loadingDetail.value = false;
  }
}

function goHome() {
  router.push('/');
}

function openUploadDialog() {
  uploadForm.uploader = localStorage.getItem('archive_uploader') || '';
  uploadForm.department = localStorage.getItem('archive_department') || '';
  uploadForm.note = '';
  uploadFileList.value = [];
  invalidFiles.value = [];
  uploadSuccessCard.value = false;
  uploadDialogVisible.value = true;
}

function onUploadDialogClosed() {
  uploadFileList.value = [];
  invalidFiles.value = [];
  if (uploadRef.value) {
    try { uploadRef.value.clearFiles(); } catch {}
  }
}

function beforeUpload(file) {
  const max = 1000 * 1024 * 1024;
  if (file.size > max) {
    invalidFiles.value.push({ name: file.name, size: file.size });
    ElMessage.warning(`文件 ${file.name} 超过 1000MB，已忽略`);
    return false;
  }
  return true;
}

function onFileChange(file, fileList) {
  uploadFileList.value = fileList.filter((f) => {
    if (f.size && f.size > 1000 * 1024 * 1024) {
      if (!invalidFiles.value.find(x => x.name === f.name)) {
        invalidFiles.value.push({ name: f.name, size: f.size });
      }
      return false;
    }
    return true;
  });
}

function onFileRemove(file, fileList) {
  uploadFileList.value = fileList.filter((f) => !(f.size && f.size > 1000 * 1024 * 1024));
}

function onExceed() {
  ElMessage.warning('最多只能上传 20 个文件');
}

async function submitUpload() {
  if (!uploadForm.uploader.trim()) { ElMessage.warning('请填写上传人姓名'); return; }
  if (!uploadForm.department.trim()) { ElMessage.warning('请填写部门'); return; }
  if (uploadFileList.value.length === 0) { ElMessage.warning('请至少选择一个文件'); return; }

  localStorage.setItem('archive_uploader', uploadForm.uploader);
  localStorage.setItem('archive_department', uploadForm.department);

  uploading.value = true;
  try {
    const formData = new FormData();
    formData.append('projectId', id.value);
    formData.append('uploader', uploadForm.uploader.trim());
    formData.append('department', uploadForm.department.trim());
    if (uploadForm.note.trim()) formData.append('note', uploadForm.note.trim());
    for (const item of uploadFileList.value) {
      const raw = item.raw || item;
      formData.append('file', raw);
    }
    await fileApi.upload(formData);
    ElMessage.success('上传成功，等待管理员审核');
    uploadDialogVisible.value = false;
    uploadSuccessCard.value = true;
    await loadDetail();
  } catch (e) {
    ElMessage.error(e.message || '上传失败');
  } finally {
    uploading.value = false;
  }
}

function formatTime(t) {
  if (!t) return '-';
  const d = new Date(t);
  if (isNaN(d.getTime())) return String(t);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
</script>

<style scoped>
.extract-tag-pulse {
  animation: extractPulse 1.4s infinite ease-in-out;
}
@keyframes extractPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
  70% { box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
  100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
}
.content-summary-box-employee {
  background: #fff7ed;
  border: 1px dashed #fdba74;
  border-radius: 8px;
  padding: 8px 10px;
  color: #7c2d12;
  font-size: 12.5px;
  line-height: 1.7;
  margin-top: 4px;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ========== 上传对话框：修复上传区域"显示突出"问题 ==========
 * 根因（共 4 层，层层叠加导致视觉突出）：
 *  1. Element Plus el-dialog 默认 append-to-body=true → teleport 到 body，脱离组件树
 *     → scoped :deep 命中不了 → 修复：L270 加 :append-to-body="false"，让 dialog 渲染在组件内
 *  2. el-form-item__content 默认 display:flex（即使 label-position=top）
 *     → 导致唯一子项 .el-upload 被 flex-shrink 收缩到内容宽度 382px，width:100% 无效
 *     → 修复：:deep(.el-form-item--label-top > .el-form-item__content { display:block })
 *  3. el-upload 默认 inline-block，不撑满父容器
 *     → 修复：:deep(.el-upload { width:100%; display:block })
 *  4. el-upload-dragger 默认 padding 40px 10px（上下过厚）+ tip 与 dragger 间距松散
 *     → 修复：padding 20px 16px + margin-top 8px，比例协调、视觉整体
 * 范围：全部 :deep() + Element Plus 官方 class（带 --label-top 后缀），零泄漏、零功能影响
 */
:deep(.el-form-item--label-top > .el-form-item__content) {
  display: block;
}
:deep(.el-upload) {
  width: 100%;
  display: block;
}
:deep(.el-upload-dragger) {
  width: 100%;
  padding: 20px 16px;
}
:deep(.el-upload__tip) {
  margin-top: 8px !important;
  padding-left: 4px;
}
:deep(.el-upload-list) {
  width: 100%;
}
</style>
