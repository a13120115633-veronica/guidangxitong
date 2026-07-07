<template>
  <div>
    <div class="page-header">
      <h1>公司资料统一归档系统</h1>
      <div class="sub">上传中心：搜索项目并上传资料</div>
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
      <h2><el-icon><Search /></el-icon> 项目搜索</h2>
      <div style="display: flex; gap: 8px; margin-bottom: 12px;">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索项目名称或编号"
          clearable
          @keyup.enter="handleSearch"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-button type="primary" @click="handleSearch">
          <el-icon><Search /></el-icon>
          <span>搜索</span>
        </el-button>
      </div>
      <div v-if="searchedOnce" class="text-sm" style="margin-bottom: 8px;">
        共 {{ projects.length }} 个匹配项目
      </div>
      <div v-if="searching" style="text-align: center; padding: 20px; color: #9ca3af;">
        <el-icon class="is-loading"><Loading /></el-icon> 搜索中...
      </div>
      <div v-else-if="searchedOnce && projects.length === 0" style="text-align: center; padding: 30px 0; color: #9ca3af;">
        没有找到匹配的项目，请尝试其他关键词
      </div>
      <div v-else-if="projects.length > 0">
        <div
          v-for="p in projects"
          :key="p.id"
          class="list-item"
          style="cursor: pointer;"
          @click="goProject(p.id)"
        >
          <div class="flex-row">
            <div class="flex-col" style="flex: 1; min-width: 0;">
              <div class="file-name" v-html="highlightText(p.root_name, searchKeyword)"></div>
              <div v-if="p.code || p.extra_info" class="text-sm text-muted" style="margin-top: 2px;">
                <span v-if="p.code">编号：{{ p.code }}</span>
                <span v-if="p.code && p.extra_info"> · </span>
                <span v-if="p.extra_info">{{ typeof p.extra_info === 'string' ? p.extra_info : JSON.stringify(p.extra_info).slice(0, 80) }}</span>
              </div>
            </div>
            <el-icon style="color: #9ca3af; flex-shrink: 0;"><CaretRight /></el-icon>
          </div>
        </div>
      </div>
      <div v-else style="text-align: center; padding: 20px 0; color: #9ca3af;">
        输入关键词搜索项目
      </div>
    </div>

    <div class="section-card">
      <h2><el-icon><Clock /></el-icon> 我的最近上传</h2>
      <el-form :model="uploaderForm" label-position="top" size="default">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <el-form-item label="上传人姓名">
            <el-input v-model="uploaderForm.uploader" placeholder="请输入您的姓名" @change="persistUploader" />
          </el-form-item>
          <el-form-item label="部门">
            <el-input v-model="uploaderForm.department" placeholder="请输入您的部门" @change="persistUploader" />
          </el-form-item>
        </div>
      </el-form>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <el-button link type="primary" @click="goRecent">查看全部上传记录 →</el-button>
        <el-button size="small" @click="loadRecentFiles" :loading="loadingRecent">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
      </div>
      <div v-if="loadingRecent" style="text-align: center; padding: 20px; color: #9ca3af;">
        <el-icon class="is-loading"><Loading /></el-icon> 加载中...
      </div>
      <div v-else-if="!uploaderForm.uploader" style="text-align: center; padding: 20px 0; color: #9ca3af;">
        请先填写上传人姓名以查看最近上传记录
      </div>
      <div v-else-if="recentFiles.length === 0" style="text-align: center; padding: 20px 0; color: #9ca3af;">
        暂无上传记录
      </div>
      <div v-else>
        <div v-for="f in recentFiles" :key="f.id" class="list-item">
          <div class="flex-col" style="gap: 6px;">
            <div class="flex-row" style="align-items: flex-start;">
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
            <div v-if="finalPathPreview(f)" class="path-preview" style="margin-top: 0;">
              <el-icon><Location /></el-icon>
              <span v-if="f.status === 'manually_uploaded'">归档路径：</span>
              <span v-else-if="f.status === 'ready_for_nas'">待上传路径：</span>
              <span v-else>推荐归档路径：</span>
              {{ finalPathPreview(f) }}
            </div>
            <div class="flex-row flex-wrap" style="gap: 8px;">
              <el-button
                link
                type="primary"
                size="small"
                v-if="resolveProjectName(f)"
                @click.stop="goProject(f.project_id)"
              >
                <el-icon><Folder /></el-icon> {{ resolveProjectName(f) }}
              </el-button>
              <span class="text-sm">
                <el-icon><Calendar /></el-icon> {{ formatTime(f.uploaded_at) }}
              </span>
              <span class="text-sm" v-if="f.size != null"><el-icon><Coin /></el-icon> {{ formatSize(f.size) }}</span>
              <a
                :href="fileApi.download(f.id)"
                style="color: #2563eb; text-decoration: none; font-size: 13px;"
              >
                <el-icon><Download /></el-icon> {{ downloadLabel(f.status) }}
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Search, CaretRight, Clock, Refresh, Loading, Document, Folder, FolderOpened, Calendar, Coin, Download, Location, Upload } from '@element-plus/icons-vue';
import { projectApi, fileApi } from '@/api/index.js';
import { statusLabel, statusClass, formatSize, highlightText, downloadLabel, displayFileName, isRenamed, finalPathPreview } from '@/utils/format.js';

const router = useRouter();

const activeTab = ref('upload');

function onTabChange(v) {
  if (v === 'download') router.push('/download');
}

const searchKeyword = ref('');
const projects = ref([]);
const searching = ref(false);
const searchedOnce = ref(false);

const recentFiles = ref([]);
const loadingRecent = ref(false);
const uploaderForm = reactive({
  uploader: '',
  department: ''
});

const projectNameCache = new Map();

onMounted(async () => {
  uploaderForm.uploader = localStorage.getItem('archive_uploader') || '';
  uploaderForm.department = localStorage.getItem('archive_department') || '';
  if (uploaderForm.uploader) {
    loadRecentFiles();
  }
});

watch(() => uploaderForm.uploader, (v) => {
  if (v) loadRecentFiles();
});

function persistUploader() {
  localStorage.setItem('archive_uploader', uploaderForm.uploader);
  localStorage.setItem('archive_department', uploaderForm.department);
}

async function handleSearch() {
  if (!searchKeyword.value.trim()) {
    ElMessage.warning('请输入搜索关键词');
    return;
  }
  searching.value = true;
  searchedOnce.value = true;
  try {
    const res = await projectApi.search(searchKeyword.value.trim());
    projects.value = Array.isArray(res) ? res : (res?.projects || res?.data || []);
  } catch (e) {
    ElMessage.error(e.message || '搜索失败');
    projects.value = [];
  } finally {
    searching.value = false;
  }
}

async function loadRecentFiles() {
  if (!uploaderForm.uploader) {
    recentFiles.value = [];
    return;
  }
  loadingRecent.value = true;
  try {
    const res = await fileApi.list({ uploader: uploaderForm.uploader, limit: 30 });
    const list = Array.isArray(res) ? res : (res?.files || res?.data || []);
    recentFiles.value = list;
    const missingIds = [...new Set(list.map(f => f.project_id).filter(id => id && !projectNameCache.has(id)))];
    for (const id of missingIds) {
      try {
        const detail = await projectApi.getDetail(id);
        const p = detail?.project || detail?.data?.project || detail;
        if (p) projectNameCache.set(id, p.root_name || p.name);
      } catch {}
    }
  } catch (e) {
    ElMessage.error(e.message || '加载最近上传失败');
  } finally {
    loadingRecent.value = false;
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

function goProject(id) {
  router.push({ path: `/project/${id}`, query: { mode: 'upload' } });
}

function goRecent() {
  router.push('/recent');
}
</script>
