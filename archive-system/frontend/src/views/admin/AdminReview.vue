<template>
  <div>
    <div class="page-header">
      <h1><el-icon><CircleCheck /></el-icon> 管理员审核</h1>
      <div class="sub">审核待处理的归档任务，确认整理结果或标记补充信息</div>
    </div>

    <div class="section-card">
      <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
        <el-input
          v-model="q"
          placeholder="搜索文件名、上传人、部门..."
          clearable
          style="flex: 1; min-width: 200px;"
          :prefix-icon="Search"
          @keyup.enter="loadList"
        />
        <el-checkbox v-model="lowConfidence">仅显示低置信度 (<60%)</el-checkbox>
        <el-button :icon="Refresh" @click="loadList">刷新</el-button>
      </div>
    </div>

    <div class="section-card" v-if="loading">
      <el-skeleton :rows="4" animated />
    </div>

    <div v-else-if="tasks.length === 0" class="section-card" style="text-align: center; padding: 40px 16px;">
      <el-empty description="暂无待审核任务" />
    </div>

    <div v-else class="section-card" style="padding: 8px 16px;">
      <el-collapse v-model="activeNames">
        <el-collapse-item
          v-for="task in tasks"
          :key="task.id"
          :name="String(task.id)"
        >
          <template #title>
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-right: 12px;">
              <span :class="['status-tag', statusClass(task.status)]">{{ statusLabel(task.status) }}</span>
              <el-tag
                v-if="task.extract_status"
                :type="extractStatusType(task.extract_status)"
                size="small"
                effect="plain"
                :class="['extract-tag', task.extract_status === 'extracting' ? 'extract-tag-pulse' : '']"
              >
                {{ extractStatusLabel(task.extract_status) }}
              </el-tag>
              <span class="file-name" style="flex: 1; min-width: 0;">{{ task.original_name }}</span>
              <el-tag
                v-if="task.ai_confidence != null"
                :type="task.ai_confidence < 0.6 ? 'danger' : task.ai_confidence < 0.8 ? 'warning' : 'success'"
                size="small"
                effect="light"
              >
                置信度 {{ (task.ai_confidence * 100).toFixed(0) }}%
                <span v-if="task.ai_basis === 'filename+content+ark'">·基于内容</span>
                <span v-else-if="task.ai_basis === 'filename+note'">·仅文件名</span>
              </el-tag>
              <span class="text-sm">{{ formatDate(task.uploaded_at) }}</span>
            </div>
          </template>

          <div class="review-detail">
            <div class="detail-section">
              <div class="detail-title">
                <el-icon><FolderOpened /></el-icon> 项目信息
              </div>
              <div class="detail-grid">
                <div class="detail-item">
                  <span class="detail-label">项目名称</span>
                  <span class="detail-value">{{ projectNames[task.project_id] || ('项目 #' + task.project_id) }}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">上传人</span>
                  <span class="detail-value">{{ task.uploader || '-' }}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">所属部门</span>
                  <span class="detail-value">{{ task.department || '-' }}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">设备来源</span>
                  <span class="detail-value">{{ task.device || '-' }}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">文件大小</span>
                  <span class="detail-value">{{ formatSize(task.size) }}</span>
                </div>
                <div class="detail-item">
                  <span class="detail-label">上传时间</span>
                  <span class="detail-value">{{ formatDate(task.uploaded_at) }}</span>
                </div>
                <div class="detail-item full-width" v-if="task.note">
                  <span class="detail-label">备注</span>
                  <span class="detail-value">{{ task.note }}</span>
                </div>
              </div>
              <div style="margin-top: 8px;">
                <el-button size="small" :icon="Download" @click="handleDownloadFile(task)">下载原始文件</el-button>
              </div>
            </div>

            <div class="detail-section">
              <div class="detail-title" style="justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <el-icon><MagicStick /></el-icon> AI 分析结果
                  <el-tag
                    v-if="task.ai_basis === 'filename+content+ark'"
                    type="success" size="small" effect="dark"
                  >内容已解析，推荐升级</el-tag>
                  <el-tag
                    v-else-if="task.extract_status === 'extract_failed'"
                    type="danger" size="small" effect="plain"
                  >解析失败，仅按文件名推荐</el-tag>
                  <el-tag
                    v-else-if="task.extract_status === 'extract_success' && task.ai_basis === 'filename+note'"
                    type="warning" size="small" effect="plain"
                  >解析完成 · 仅按文件名推荐</el-tag>
                  <el-tag
                    v-else
                    type="info" size="small" effect="plain"
                  >解析中… 按文件名临时推荐</el-tag>
                </div>
                <div style="display: flex; gap: 6px;">
                  <el-button size="small" :icon="View" @click="openContentDialog(task)">查看解析内容</el-button>
                  <el-button
                    size="small"
                    type="warning"
                    plain
                    :icon="RefreshRight"
                    :disabled="task.extract_status === 'extracting' || reExtracting[task.id]"
                    @click="runReExtract(task)"
                  >
                    {{ reExtracting[task.id] ? '重跑中…' : '重跑解析&命名' }}
                  </el-button>
                </div>
              </div>

              <div class="low-confidence-banner" v-if="task.ai_confidence != null && task.ai_confidence < 0.6">
                <el-icon><WarningFilled /></el-icon>
                <span>低置信度，建议人工重点核对</span>
              </div>

              <div class="recommend-compare">
                <div class="rec-card rec-card-filename">
                  <div class="rec-card-title">
                    <el-icon><Document /></el-icon>
                    <span>推荐 A（纯文件名+备注）</span>
                  </div>
                  <div class="rec-item">
                    <div class="rec-label">归档路径</div>
                    <div class="rec-value text-sm">{{ task.ai_filename_target_path || '-' }}</div>
                  </div>
                  <div class="rec-item">
                    <div class="rec-label">建议命名</div>
                    <div class="rec-value text-sm">{{ task.ai_filename_suggested_name || '-' }}</div>
                  </div>
                  <div class="rec-item">
                    <div class="rec-label">置信度</div>
                    <div class="rec-value">
                      <el-tag
                        size="small"
                        :type="(task.ai_filename_confidence||0) < 0.6 ? 'danger' : (task.ai_filename_confidence||0) < 0.8 ? 'warning' : 'success'"
                      >{{ ((task.ai_filename_confidence||0) * 100).toFixed(0) }}%</el-tag>
                    </div>
                  </div>
                  <div class="rec-item" v-if="task.ai_filename_reason">
                    <div class="rec-label">理由</div>
                    <div class="rec-value text-sm" style="white-space: pre-wrap;">{{ task.ai_filename_reason }}</div>
                  </div>
                </div>

                <div class="rec-card-arrow">
                  <el-icon v-if="task.ai_basis === 'filename+content+ark'" :size="26" color="#2563eb">Right</el-icon>
                </div>

                <div class="rec-card" :class="task.ai_content_suggestion ? 'rec-card-content' : 'rec-card-empty'">
                  <div class="rec-card-title">
                    <el-icon><Cpu /></el-icon>
                    <span>推荐 B（文档内容+OCR + 豆包大模型）</span>
                    <el-tag
                      v-if="task.ai_content_suggestion"
                      size="small"
                      type="success"
                      effect="dark"
                    >采纳为当前推荐</el-tag>
                  </div>
                  <template v-if="task.ai_content_suggestion">
                    <div class="rec-item">
                      <div class="rec-label">归档路径</div>
                      <div class="rec-value text-sm">{{ task.ai_content_suggestion.target_path || '-' }}</div>
                    </div>
                    <div class="rec-item">
                      <div class="rec-label">建议命名</div>
                      <div class="rec-value text-sm">{{ task.ai_content_suggestion.suggested_name || '-' }}</div>
                    </div>
                    <div class="rec-item">
                      <div class="rec-label">置信度</div>
                      <div class="rec-value">
                        <el-tag
                          size="small"
                          :type="(task.ai_content_suggestion.confidence||0) < 0.6 ? 'danger' : (task.ai_content_suggestion.confidence||0) < 0.8 ? 'warning' : 'success'"
                        >{{ ((task.ai_content_suggestion.confidence||0) * 100).toFixed(0) }}%</el-tag>
                      </div>
                    </div>
                    <div class="rec-item">
                      <div class="rec-label">文档类型</div>
                      <div class="rec-value text-sm">{{ task.ai_content_suggestion.doc_type || '-' }}</div>
                    </div>
                    <div class="rec-item">
                      <div class="rec-label">摘要</div>
                      <div class="rec-value text-sm" style="white-space: pre-wrap;">{{ task.ai_content_suggestion.content_summary || '-' }}</div>
                    </div>
                    <div class="rec-item" v-if="task.ai_content_suggestion.reason">
                      <div class="rec-label">证据与理由</div>
                      <div class="rec-value text-sm" style="white-space: pre-wrap;">{{ task.ai_content_suggestion.reason }}</div>
                    </div>
                    <div class="rec-item" v-if="task.ai_content_suggestion.model">
                      <div class="rec-label">模型</div>
                      <div class="rec-value text-sm">{{ task.ai_content_suggestion.model }}</div>
                    </div>
                  </template>
                  <div v-else class="rec-empty-hint">
                    <el-empty :image-size="80" description="内容解析尚未完成或失败，暂未生成大模型推荐。">
                      <template #image>
                        <el-icon :size="64" color="#cbd5e1"><Cpu /></el-icon>
                      </template>
                    </el-empty>
                  </div>
                </div>
              </div>

              <el-divider v-if="task.content_summary" content-position="left" style="margin: 10px 0;">
                <span style="font-size: 12px; color: #64748b;">文档内容摘要（豆包生成）</span>
              </el-divider>
              <div v-if="task.content_summary" class="content-summary-box">
                {{ task.content_summary }}
                <span v-if="task.doc_type" class="doc-type-chip">{{ task.doc_type }}</span>
              </div>
            </div>

            <div class="detail-section">
              <div class="detail-title">
                <el-icon><EditPen /></el-icon> 整理归档（可编辑）
              </div>

              <el-form label-position="top" size="default">
                <el-form-item label="归档目录" required>
                  <el-select
                    v-model="formMap[task.id].targetPath"
                    placeholder="请选择归档目录"
                    style="width: 100%;"
                    filterable
                    @change="() => markFormDirty(task.id)"
                  >
                    <el-option
                      v-for="opt in pathOptionsNormal"
                      :key="opt.value"
                      :label="opt.label"
                      :value="opt.value"
                    />
                    <el-option-group label="人工选择目录">
                      <el-option
                        v-for="opt in pathOptionsManual"
                        :key="opt.value"
                        :label="opt.label"
                        :value="opt.value"
                      />
                    </el-option-group>
                  </el-select>
                  <div v-if="isManualPath(formMap[task.id].targetPath)" class="manual-warn">
                    <el-icon><WarningFilled /></el-icon>
                    人工选择，不由 AI 自动推荐
                  </div>
                </el-form-item>

                <el-form-item label="最终文件名" required>
                  <el-input v-model="formMap[task.id].finalName" placeholder="请输入最终文件名主名，系统自动沿用原文件扩展名（如 .pdf/.docx）" @input="() => markFormDirty(task.id)" />
                </el-form-item>

                <el-form-item label="预览最终归档路径">
                  <div class="path-preview">
                    {{ projectNames[task.project_id] || ('项目#' + task.project_id) }}/{{ formMap[task.id].targetPath || '<未选择目录>' }}/{{ formMap[task.id].finalName || '<未填写文件名>' }}
                  </div>
                </el-form-item>
              </el-form>

              <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px;">
                <el-button
                  type="primary"
                  :icon="Check"
                  :disabled="!canApprove(task.id)"
                  @click="handleApprove(task)"
                >
                  确认整理结果，加入待上传 NAS
                </el-button>
                <el-button
                  :icon="Message"
                  @click="handleNeedsInfo(task)"
                >
                  标记需补充
                </el-button>
                <el-button
                  type="danger"
                  :icon="Close"
                  @click="handleReject(task)"
                >
                  拒绝归档
                </el-button>
              </div>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
    </div>

    <el-dialog
      v-model="contentDialogVisible"
      :title="contentDialogFile ? `内容解析详情 — ${contentDialogFile.original_name || ''}` : '内容解析详情'"
      width="860px"
      top="6vh"
      destroy-on-close
    >
      <div v-if="contentPayload" class="content-dialog">
        <el-descriptions :column="2" size="small" border style="margin-bottom: 14px;">
          <el-descriptions-item label="解析状态">
            <el-tag :type="extractStatusType(contentPayload.extract_status)" size="small">
              {{ extractStatusLabel(contentPayload.extract_status) }}
            </el-tag>
            <span v-if="contentPayload.extract_retry" style="margin-left: 8px; color:#6b7280; font-size:12px;">
              重试 {{ contentPayload.extract_retry }} 次
            </span>
          </el-descriptions-item>
          <el-descriptions-item label="解析方式">{{ contentPayload.extract_method || '-' }}</el-descriptions-item>
          <el-descriptions-item label="抽取字符">{{ contentPayload.extracted_chars || 0 }}</el-descriptions-item>
          <el-descriptions-item label="完成时间">{{ contentPayload.extracted_at || '-' }}</el-descriptions-item>
          <el-descriptions-item label="当前推荐依据">
            {{ contentPayload.current_suggestion?.basis === 'filename+content+ark' ? '正文+OCR+豆包大模型' :
               contentPayload.current_suggestion?.basis === 'filename+note' ? '仅文件名+备注' : '-'
            }}
          </el-descriptions-item>
          <el-descriptions-item label="使用模型">{{ contentPayload.ai_model_used || '-' }}</el-descriptions-item>
          <el-descriptions-item label="开始时间" v-if="contentPayload.extract_started_at">{{ contentPayload.extract_started_at }}</el-descriptions-item>
          <el-descriptions-item label="错误信息" v-if="contentPayload.extract_error">
            <span style="color: #dc2626; white-space: pre-wrap;">{{ contentPayload.extract_error }}</span>
          </el-descriptions-item>
        </el-descriptions>

        <el-tabs v-model="contentTab" type="border-card">
          <el-tab-pane label="电子文本抽取" name="text">
            <pre class="text-block">{{ contentPayload.extracted_text || '（未抽取到文本，或该文件是图片/扫描件，请切到 OCR 标签）' }}</pre>
          </el-tab-pane>
          <el-tab-pane label="OCR 识别结果" name="ocr">
            <pre class="text-block">{{ contentPayload.ocr_text || '（未执行 OCR，OCR 仅在图片或扫描件 PDF 上触发）' }}</pre>
          </el-tab-pane>
          <el-tab-pane label="推荐方案对比" name="suggest">
            <div class="rec-mini-grid">
              <div class="rec-mini-card">
                <div class="rec-mini-title">方案 A · 文件名规则</div>
                <div class="rec-mini-line"><b>归档路径：</b>{{ contentPayload.filename_suggestion?.target_path || '-' }}</div>
                <div class="rec-mini-line"><b>命名：</b>{{ contentPayload.filename_suggestion?.suggested_name || '-' }}</div>
                <div class="rec-mini-line">
                  <b>置信度：</b>
                  <el-tag size="small"
                    :type="(contentPayload.filename_suggestion?.confidence||0)<0.6?'danger':(contentPayload.filename_suggestion?.confidence||0)<0.8?'warning':'success'">
                    {{ ((contentPayload.filename_suggestion?.confidence||0)*100).toFixed(0) }}%
                  </el-tag>
                </div>
                <div class="rec-mini-line" v-if="contentPayload.filename_suggestion?.reason">
                  <b>理由：</b>{{ contentPayload.filename_suggestion.reason }}
                </div>
              </div>
              <div class="rec-mini-card" style="border-color: #3b82f6; background: #eff6ff;">
                <div class="rec-mini-title" style="color:#1d4ed8;">方案 B · 正文+大模型（当前采纳）</div>
                <template v-if="contentPayload.content_suggestion">
                  <div class="rec-mini-line"><b>归档路径：</b>{{ contentPayload.content_suggestion.target_path || '-' }}</div>
                  <div class="rec-mini-line"><b>命名：</b>{{ contentPayload.content_suggestion.suggested_name || '-' }}</div>
                  <div class="rec-mini-line">
                    <b>置信度：</b>
                    <el-tag size="small"
                      :type="(contentPayload.content_suggestion.confidence||0)<0.6?'danger':(contentPayload.content_suggestion.confidence||0)<0.8?'warning':'success'">
                      {{ ((contentPayload.content_suggestion.confidence||0)*100).toFixed(0) }}%
                    </el-tag>
                  </div>
                  <div class="rec-mini-line" v-if="contentPayload.content_suggestion.content_summary">
                    <b>摘要：</b>{{ contentPayload.content_suggestion.content_summary }}
                  </div>
                  <div class="rec-mini-line" v-if="contentPayload.content_suggestion.reason">
                    <b>理由：</b>{{ contentPayload.content_suggestion.reason }}
                  </div>
                </template>
                <el-empty v-else :image-size="60" description="尚未生成大模型推荐" />
              </div>
            </div>
          </el-tab-pane>
          <el-tab-pane label="员工备注" name="note">
            <pre class="text-block">{{ contentPayload.note || '（员工未填写备注）' }}</pre>
          </el-tab-pane>
        </el-tabs>
      </div>
      <template #footer>
        <el-button @click="contentDialogVisible = false">关闭</el-button>
        <el-button
          type="warning"
          :disabled="contentPayload?.extract_status === 'extracting'"
          @click="runReExtract(contentDialogFile, true)"
        >重跑解析&命名</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount, computed, watch, nextTick } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  CircleCheck, Search, Refresh, FolderOpened, Download,
  MagicStick, WarningFilled, EditPen, Check, Message, Close,
  View, RefreshRight, Document, Cpu, Right
} from '@element-plus/icons-vue';
import { archiveApi, projectApi, fileApi, reviewApi } from '@/api/index.js';
import { statusLabel, statusClass, formatSize, saveBlobFromResponse } from '@/utils/format.js';

const q = ref('');
const lowConfidence = ref(false);
const loading = ref(false);
const tasks = ref([]);
const activeNames = ref([]);
const projectNames = reactive({});
const pathOptions = ref([]);
const formMap = reactive({});
const reExtracting = reactive({});
const contentDialogVisible = ref(false);
const contentDialogFile = ref(null);
const contentPayload = ref(null);
const contentLoading = ref(false);
const contentTab = ref('text');
let pollTimer = null;

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

async function openContentDialog(task) {
  contentDialogFile.value = task;
  contentDialogVisible.value = true;
  contentTab.value = 'text';
  contentPayload.value = null;
  contentLoading.value = true;
  try {
    const r = await fileApi.getContent(task.id);
    contentPayload.value = r.file;
  } catch (e) {
    ElMessage.error(e.message || '读取内容失败');
  } finally {
    contentLoading.value = false;
  }
}

async function runReExtract(task, fromDialog) {
  if (!task) return;
  reExtracting[task.id] = true;
  try {
    const r = await fileApi.reExtract(task.id, '管理员');
    ElMessage.success(`已提交重跑：队列 ${r.queue?.pending || 0} 待处理 / ${r.queue?.running || 0} 运行中`);
    if (fromDialog) {
      if (r.file) contentPayload.value = r.file;
    }
    await nextTick();
    setTimeout(() => loadList(), 1200);
  } catch (e) {
    ElMessage.error(e.message || '重跑失败');
  } finally {
    reExtracting[task.id] = false;
  }
}

const pathOptionsNormal = computed(() =>
  pathOptions.value.filter(p => !p.isManual)
);
const pathOptionsManual = computed(() =>
  pathOptions.value.filter(p => p.isManual)
);

function isManualPath(val) {
  return pathOptionsManual.value.some(p => p.value === val);
}

function formatDate(s) {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function canApprove(id) {
  const f = formMap[id];
  if (!f) return false;
  return !!f.targetPath && !!f.finalName && !!f.finalName.trim();
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

function markFormDirty(id) {
  if (formMap[id]) formMap[id]._dirty = true;
}

async function loadList(opts = {}) {
  const { silent = false } = opts;
  if (!silent) loading.value = true;
  try {
    const data = await reviewApi.list({ q: q.value, lowConfidence: lowConfidence.value });
    const list = Array.isArray(data) ? data : (data?.list || data?.data || []);
    const newSorted = [...list].sort((a, b) => {
      const ta = new Date(a.uploaded_at || 0).getTime();
      const tb = new Date(b.uploaded_at || 0).getTime();
      return tb - ta;
    });

    const stripExt = (name) => {
      const s = String(name || '').trim();
      if (!s) return '';
      const idx = s.lastIndexOf('.');
      if (idx < 0) return s;
      const maybeExt = s.slice(idx + 1);
      if (/^[a-zA-Z0-9]{1,6}$/.test(maybeExt)) return s.slice(0, idx);
      return s;
    };

    if (silent) {
      const idMap = new Map(tasks.value.map(t => [String(t.id), t]));
      const seen = new Set();
      let changed = false;
      newSorted.forEach(newT => {
        const key = String(newT.id);
        seen.add(key);
        const old = idMap.get(key);
        if (!old) return;
        for (const k of Object.keys(newT)) {
          const ov = old[k];
          const nv = newT[k];
          if (typeof nv === 'object' && nv !== null && typeof ov === 'object' && ov !== null) {
            if (JSON.stringify(nv) !== JSON.stringify(ov)) {
              old[k] = nv;
              changed = true;
            }
          } else {
            if (ov !== nv) {
              old[k] = nv;
              changed = true;
            }
          }
        }
      });
      const hasNewOrDeleted = (newSorted.length !== tasks.value.length) || tasks.value.some(t => !seen.has(String(t.id)));
      if (hasNewOrDeleted) tasks.value = newSorted;
      else if (changed) tasks.value = [...tasks.value];
    } else {
      tasks.value = newSorted;
    }

    newSorted.forEach(t => {
      const origExt = (() => {
        const s = String(t.original_name || '').trim();
        const idx = s.lastIndexOf('.');
        if (idx < 0 || idx === s.length - 1) return '';
        const e = s.slice(idx + 1).trim();
        return /^[a-zA-Z0-9]{1,6}$/.test(e) ? `.${e.toLowerCase()}` : '';
      })();
      const contentSuggestion = t.ai_content_suggestion && typeof t.ai_content_suggestion === 'object'
        ? t.ai_content_suggestion
        : null;
      const useBSuggestion = !!(contentSuggestion && (contentSuggestion.target_path || contentSuggestion.suggested_name));
      const suggestedTargetPath = useBSuggestion
        ? (contentSuggestion.target_path || contentSuggestion.targetPath || t.ai_target_path || '')
        : (t.ai_target_path || '');
      const baseSuggestedName = useBSuggestion
        ? (contentSuggestion.suggested_name || contentSuggestion.suggestedName || t.ai_suggested_name || '')
        : (t.ai_suggested_name || '');
      const cleanBaseName = stripExt(baseSuggestedName || t.original_name || '');
      const finalName = cleanBaseName ? `${cleanBaseName}${origExt}` : (t.original_name || '');

      const existing = formMap[t.id];
      if (!existing) {
        formMap[t.id] = {
          targetPath: suggestedTargetPath,
          finalName,
          _origExt: origExt,
          _dirty: false
        };
      } else {
        existing._origExt = origExt;
        if (!existing._dirty) {
          if (existing.targetPath !== suggestedTargetPath) existing.targetPath = suggestedTargetPath;
          if (existing.finalName !== finalName) existing.finalName = finalName;
        }
      }
    });

    const pids = [...new Set(newSorted.map(t => t.project_id).filter(Boolean))];
    if (pids.length && !silent) {
      await Promise.allSettled(pids.map(async pid => {
        try {
          const p = await projectApi.getDetail(pid);
          if (p) projectNames[pid] = p.root_name || p.name || ('项目 #' + pid);
        } catch {}
      }));
    }
  } catch (e) {
    if (!silent) ElMessage.error(e.message || '加载失败');
  } finally {
    if (!silent) loading.value = false;
  }
}

async function loadPaths() {
  try {
    const data = await archiveApi.getPaths();
    const arr = Array.isArray(data) ? data : (data?.list || data?.data || data?.paths || []);
    const opts = [];
    let hasManual = false;
    arr.forEach(p => {
      const label = p.label || p.name || p.path || String(p.value || p);
      const value = p.value ?? p.path ?? label;
      const aiAuto = p.aiAutoArchive !== false && p.ai_auto_archive !== false;
      if (aiAuto) {
        opts.push({ label, value, isManual: false });
      } else {
        opts.push({ label, value, isManual: true });
        hasManual = true;
      }
    });
    if (!hasManual) {
      opts.push({ label: '4.成果资料', value: '4.成果资料', isManual: true });
    }
    pathOptions.value = opts;
  } catch (e) {
    pathOptions.value = [{ label: '4.成果资料', value: '4.成果资料', isManual: true }];
  }
}

function ensureFinalNameHasExt(taskId, finalNameRaw, fallbackOrigName) {
  const raw = String(finalNameRaw || '').trim();
  if (!raw) return raw;
  const hasExt = (() => {
    const idx = raw.lastIndexOf('.');
    if (idx < 0 || idx === raw.length - 1 || idx === 0) return false;
    const maybeExt = raw.slice(idx + 1);
    return /^[a-zA-Z0-9]{1,6}$/.test(maybeExt);
  })();
  if (hasExt) return raw;
  const fallback = String(fallbackOrigName || '').trim();
  const fbIdx = fallback.lastIndexOf('.');
  if (fbIdx < 0 || fbIdx === fallback.length - 1) return raw;
  const fbExt = fallback.slice(fbIdx + 1);
  if (!/^[a-zA-Z0-9]{1,6}$/.test(fbExt)) return raw;
  const f = formMap[taskId];
  const origExt = (f && f._origExt) ? f._origExt : `.${fbExt.toLowerCase()}`;
  return `${raw}${origExt}`;
}

async function handleApprove(task) {
  const f = formMap[task.id];
  if (!f || !f.targetPath || !f.finalName?.trim()) return;
  const finalName = ensureFinalNameHasExt(task.id, f.finalName.trim(), task.original_name);
  try {
    await reviewApi.approve(task.id, {
      targetPath: f.targetPath,
      finalName
    });
    ElMessage.success('已确认整理结果，加入待上传 NAS');
    loadList();
  } catch (e) {
    ElMessage.error(e.message || '操作失败');
  }
}

async function handleNeedsInfo(task) {
  try {
    const { value } = await ElMessageBox.prompt(
      '请输入需要补充的信息和原因',
      '标记需补充',
      {
        confirmButtonText: '提交',
        cancelButtonText: '取消',
        inputPlaceholder: '请填写原因（必填）',
        inputValidator: v => !!v?.trim() || '原因不能为空'
      }
    );
    await reviewApi.needsInfo(task.id, { comment: value.trim() });
    ElMessage.success('已标记需补充');
    loadList();
  } catch (e) {
    if (e !== 'cancel' && e?.message) ElMessage.error(e.message);
  }
}

async function handleReject(task) {
  try {
    const { value } = await ElMessageBox.prompt(
      '请输入拒绝归档的原因',
      '拒绝归档',
      {
        confirmButtonText: '确认拒绝',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
        inputPlaceholder: '请填写原因（必填）',
        inputValidator: v => !!v?.trim() || '原因不能为空'
      }
    );
    await reviewApi.reject(task.id, { comment: value.trim() });
    ElMessage.success('已拒绝归档');
    loadList();
  } catch (e) {
    if (e !== 'cancel' && e?.message) ElMessage.error(e.message);
  }
}

onMounted(async () => {
  await loadPaths();
  await loadList();
  if (!pollTimer) {
    pollTimer = setInterval(() => {
      const hasPending = tasks.value.some(t =>
        ['pending_extract', 'extracting', 'needs_ocr'].includes(t.extract_status)
      );
      if (hasPending) {
        loadList({ silent: true }).catch(() => {});
      }
      if (contentDialogVisible.value && contentDialogFile.value?.id) {
        fileApi.getContent(contentDialogFile.value.id).then(r => {
          if (r?.file) contentPayload.value = r.file;
        }).catch(() => {});
      }
    }, 7000);
  }
});

onBeforeUnmount(() => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
});
</script>

<style scoped>
.review-detail {
  padding: 4px 0 8px;
}
.detail-section {
  background: #f8fafc;
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 12px;
}
.detail-section:last-child { margin-bottom: 0; }
.detail-title {
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px 16px;
}
@media (max-width: 480px) {
  .detail-grid { grid-template-columns: 1fr; }
}
.detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.detail-item.full-width {
  grid-column: 1 / -1;
}
.detail-label {
  font-size: 12px;
  color: #94a3b8;
}
.detail-value {
  font-size: 13px;
  color: #1e293b;
  word-break: break-all;
}
.text-sm { font-size: 13px; color: #6b7280; }

.extract-tag-pulse {
  animation: extractPulse 1.4s infinite ease-in-out;
}
@keyframes extractPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}

.recommend-compare {
  display: grid;
  grid-template-columns: 1fr 44px 1fr;
  gap: 10px;
  margin-top: 6px;
  align-items: stretch;
}
@media (max-width: 720px) {
  .recommend-compare {
    grid-template-columns: 1fr;
  }
}
.rec-card {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 12px;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rec-card-filename {
  border-color: #cbd5e1;
  background: #f8fafc;
}
.rec-card-content {
  border: 2px solid #3b82f6;
  background: linear-gradient(180deg, #eff6ff 0%, #fff 100%);
  box-shadow: 0 2px 6px rgba(59, 130, 246, 0.08);
}
.rec-card-empty {
  background: repeating-linear-gradient(45deg, #f8fafc 0 10px, #fff 10px 20px);
}
.rec-card-title {
  font-weight: 600;
  font-size: 13px;
  color: #0f172a;
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 4px;
  border-bottom: 1px dashed #e2e8f0;
}
.rec-card-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
}
.rec-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rec-label {
  font-size: 12px;
  color: #94a3b8;
}
.rec-value {
  font-size: 13px;
  color: #0f172a;
  word-break: break-all;
}
.rec-empty-hint {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 140px;
}
.content-summary-box {
  background: #fff7ed;
  border: 1px dashed #fdba74;
  border-radius: 8px;
  padding: 10px 12px;
  color: #7c2d12;
  font-size: 13px;
  line-height: 1.7;
  position: relative;
  white-space: pre-wrap;
  word-break: break-word;
}
.doc-type-chip {
  display: inline-block;
  background: #ea580c;
  color: #fff;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  margin-left: 8px;
  vertical-align: middle;
}

.text-block {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 12px;
  max-height: 480px;
  overflow: auto;
  font-size: 13px;
  line-height: 1.7;
  color: #0f172a;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.rec-mini-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 640px) {
  .rec-mini-grid { grid-template-columns: 1fr; }
}
.rec-mini-card {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 12px;
  background: #fff;
}
.rec-mini-title {
  font-weight: 600;
  margin-bottom: 8px;
  padding-bottom: 4px;
  border-bottom: 1px dashed #e2e8f0;
  color: #1e293b;
  font-size: 13px;
}
.rec-mini-line {
  font-size: 12.5px;
  color: #334155;
  margin: 4px 0;
  word-break: break-all;
}
</style>
