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
          <span>返回首页</span>
        </el-button>
      </div>
      <h1>我的最近上传</h1>
      <div class="sub">按上传人姓名和部门筛选，最多显示 30 条记录</div>
    </div>

    <div class="section-card">
      <el-form :model="filterForm" label-position="top" size="default">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <el-form-item label="上传人姓名">
            <el-input v-model="filterForm.uploader" placeholder="请输入上传人姓名" @change="persistFilter" />
          </el-form-item>
          <el-form-item label="部门">
            <el-input v-model="filterForm.department" placeholder="请输入部门（可选）" @change="persistFilter" />
          </el-form-item>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 8px;">
          <el-button @click="resetFilter">重置</el-button>
          <el-button type="primary" @click="loadList" :loading="loading">
            <el-icon><Search /></el-icon>
            <span>查询</span>
          </el-button>
        </div>
      </el-form>
    </div>

    <div class="section-card">
      <h2><el-icon><Clock /></el-icon> 上传记录 <span class="text-sm text-muted" style="margin-left: 8px; font-weight: normal;">(最多 30 条)</span></h2>

      <div v-if="loading" style="text-align: center; padding: 40px;">
        <el-icon class="is-loading" style="font-size: 24px; color: #2563eb;"><Loading /></el-icon>
        <div style="margin-top: 8px; color: #6b7280;">加载中...</div>
      </div>

      <div v-else-if="!filterForm.uploader" style="text-align: center; padding: 30px 20px; color: #6b7280;">
        <el-icon style="font-size: 36px; color: #d1d5db;"><User /></el-icon>
        <div style="margin-top: 10px;">请填写上传人姓名后点击"查询"</div>
      </div>

      <div v-else-if="recordList.length === 0" style="text-align: center; padding: 30px 20px; color: #6b7280;">
        <el-icon style="font-size: 36px; color: #d1d5db;"><Document /></el-icon>
        <div style="margin-top: 10px;">没有找到匹配的上传记录</div>
      </div>

      <div v-else>
        <div class="list-item" style="display: none;"></div>
        <el-table
          :data="recordList"
          stripe
          size="small"
          style="width: 100%;"
          empty-text="暂无数据"
        >
          <el-table-column prop="original_name" label="文件名" min-width="200">
            <template #default="{ row }">
              <div style="word-break: break-all;">
                <div style="display:flex;align-items:center;gap:6px;">
                  <el-icon style="color: #6b7280; flex-shrink:0;"><Document /></el-icon>
                  <span :title="displayFileName(row)">{{ displayFileName(row) }}</span>
                  <el-tag v-if="isRenamed(row)" size="small" type="success" effect="light" style="flex-shrink:0;">已重命名</el-tag>
                </div>
                <div v-if="isRenamed(row)" class="text-sm" style="color:#6b7280;margin-top:2px;padding-left:22px;">
                  原上传：{{ row.original_name }}
                </div>
                <div v-if="finalPathPreview(row)" class="text-sm" style="color:#475569;margin-top:2px;padding-left:22px;">
                  <el-icon><Location /></el-icon> {{ finalPathPreview(row) }}
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="项目" min-width="160">
            <template #default="{ row }">
              <el-button
                v-if="resolveProjectName(row)"
                link
                type="primary"
                size="small"
                @click="goProject(row.project_id)"
              >
                <el-icon><Folder /></el-icon>
                <span style="max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; vertical-align: middle;">
                  {{ resolveProjectName(row) }}
                </span>
              </el-button>
              <span v-else class="text-muted" style="font-size: 13px;">-</span>
            </template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="120">
            <template #default="{ row }">
              <span :class="statusClass(row.status)">{{ statusLabel(row.status) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="上传时间" width="150">
            <template #default="{ row }">
              <span class="text-sm"><el-icon><Calendar /></el-icon> {{ formatTime(row.uploaded_at) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="下载" width="130" fixed="right">
            <template #default="{ row }">
              <span
                @click="handleDownloadFile(row)"
                style="color: #2563eb; text-decoration: none; font-size: 13px; cursor: pointer;"
              >
                <el-icon><Download /></el-icon> {{ downloadLabel(row.status) }}
              </span>
            </template>
          </el-table-column>
        </el-table>

        <div v-if="recordList.length > 0" style="margin-top: 16px;">
          <div style="font-weight: 600; margin-bottom: 8px; font-size: 14px;">卡片视图（移动设备友好）</div>
          <div v-for="f in recordList" :key="f.id" class="list-item">
            <div class="flex-col" style="gap: 6px;">
              <div class="flex-row" style="align-items: flex-start; gap: 8px;">
                <div class="file-name" style="flex: 1; min-width: 0;">
                  <div style="display:flex;align-items:center;gap:6px;">
                    <el-icon style="color: #6b7280; flex-shrink:0;"><Document /></el-icon>
                    <span :title="displayFileName(f)">{{ displayFileName(f) }}</span>
                    <el-tag v-if="isRenamed(f)" size="small" type="success" effect="light" style="flex-shrink:0;">已重命名</el-tag>
                  </div>
                  <div v-if="isRenamed(f)" class="text-sm" style="color:#6b7280;margin-top:2px;padding-left:22px;">
                    原上传：{{ f.original_name }}
                  </div>
                </div>
                <span :class="statusClass(f.status)" style="flex-shrink: 0;">{{ statusLabel(f.status) }}</span>
              </div>
              <div v-if="finalPathPreview(f)" class="path-preview" style="margin-top:0;">
                <el-icon><Location /></el-icon>
                <span v-if="f.status === 'manually_uploaded'">归档路径：</span>
                <span v-else-if="f.status === 'ready_for_nas'">待上传路径：</span>
                <span v-else>推荐归档路径：</span>
                {{ finalPathPreview(f) }}
              </div>
              <div class="flex-row flex-wrap" style="gap: 6px 14px;">
                <el-button
                  v-if="resolveProjectName(f)"
                  link
                  type="primary"
                  size="small"
                  @click="goProject(f.project_id)"
                >
                  <el-icon><Folder /></el-icon> {{ resolveProjectName(f) }}
                </el-button>
                <span class="text-sm"><el-icon><Calendar /></el-icon> {{ formatTime(f.uploaded_at) }}</span>
                <span class="text-sm" v-if="f.size != null"><el-icon><Coin /></el-icon> {{ formatSize(f.size) }}</span>
                <span
                  @click="handleDownloadFile(f)"
                  style="color: #2563eb; text-decoration: none; font-size: 13px; cursor: pointer;"
                >
                  <el-icon><Download /></el-icon> {{ downloadLabel(f.status) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import {
  ArrowLeft, Search, Clock, Loading, Document, Folder, Calendar, Coin, Download, User, Location
} from '@element-plus/icons-vue';
import { projectApi, fileApi } from '@/api/index.js';
import { statusLabel, statusClass, formatSize, downloadLabel, displayFileName, isRenamed, finalPathPreview, saveBlobFromResponse } from '@/utils/format.js';

const router = useRouter();

const loading = ref(false);
const recordList = ref([]);
const projectNameCache = new Map();

const filterForm = reactive({
  uploader: '',
  department: ''
});

onMounted(() => {
  filterForm.uploader = localStorage.getItem('archive_uploader') || '';
  filterForm.department = localStorage.getItem('archive_department') || '';
  if (filterForm.uploader) {
    loadList();
  }
});

function persistFilter() {
  localStorage.setItem('archive_uploader', filterForm.uploader);
  localStorage.setItem('archive_department', filterForm.department);
}

function resetFilter() {
  filterForm.uploader = localStorage.getItem('archive_uploader') || '';
  filterForm.department = localStorage.getItem('archive_department') || '';
}

async function loadList() {
  if (!filterForm.uploader.trim()) {
    ElMessage.warning('请输入上传人姓名');
    return;
  }
  persistFilter();
  loading.value = true;
  try {
    const params = { uploader: filterForm.uploader.trim(), limit: 30 };
    if (filterForm.department.trim()) params.department = filterForm.department.trim();
    const res = await fileApi.list(params);
    const list = Array.isArray(res) ? res : (res?.files || res?.data || []);
    recordList.value = list;
    const missingIds = [...new Set(list.map(f => f.project_id).filter(id => id && !projectNameCache.has(id)))];
    for (const pid of missingIds) {
      try {
        const detail = await projectApi.getDetail(pid);
        const p = detail?.project || detail?.data?.project || detail;
        if (p) projectNameCache.set(pid, p.root_name || p.name);
      } catch {}
    }
  } catch (e) {
    ElMessage.error(e.message || '加载上传记录失败');
  } finally {
    loading.value = false;
  }
}

function resolveProjectName(f) {
  if (f.project_name) return f.project_name;
  if (f.project_id && projectNameCache.has(f.project_id)) return projectNameCache.get(f.project_id);
  return '';
}

function formatTime(t) {
  if (!t) return '-';
  const d = new Date(t);
  if (isNaN(d.getTime())) return String(t);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function goHome() {
  router.push('/');
}

function goProject(pid) {
  if (pid) router.push(`/project/${pid}`);
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
</script>
