<template>
  <div class="app-container">
    <nav v-if="!isAdminLogin" class="nav-tabs">
      <el-tabs v-model="activeTab" class="main-tabs" @tab-change="onTabChange">
        <el-tab-pane label="商务端" name="employee">
          <template #label>
            <span><el-icon><User /></el-icon> 商务端</span>
          </template>
        </el-tab-pane>
        <el-tab-pane label="管理员端" name="admin-switch">
          <template #label>
            <span><el-icon><Setting /></el-icon> 管理员端</span>
          </template>
        </el-tab-pane>
      </el-tabs>
    </nav>
    <div v-else style="padding: 10px 16px 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
      <el-button size="small" @click="goAdmin('review')" :type="adminPage==='review'?'primary':''">待审核归档</el-button>
      <el-button size="small" :icon="Upload" @click="setNasModeAndGo('jobs')" :type="(adminPage==='nas' && nasCurrentMode==='jobs')?'primary':''">待上传（推送 NAS）</el-button>
      <el-button size="small" :icon="FolderOpened" @click="setNasModeAndGo('browse')" :type="(adminPage==='nas' && nasCurrentMode==='browse')?'primary':''">NAS 归档浏览（下载）</el-button>
      <el-button size="small" :icon="Reading" @click="goAdmin('report')" :type="adminPage==='report'?'primary':''">智能报告生成</el-button>
      <el-button size="small" :icon="Tools" @click="goAdmin('workbench')" :type="adminPage==='workbench'?'primary':''">管理员工作台</el-button>
      <el-button size="small" text @click="exitAdmin">退出管理员</el-button>
    </div>

    <router-view v-if="!isAdminLogin" />
    <AdminReview v-else-if="adminPage==='review'" />
    <AdminNas v-else-if="adminPage==='nas'" />
    <AdminReportGenerator v-else-if="adminPage==='report'" />

    <div v-else-if="adminPage==='workbench'" class="workbench-wrap">
      <div class="page-header">
        <h1><el-icon><Tools /></el-icon> 管理员工作台</h1>
        <div class="sub">操作记录 · 归档规范 · 项目库同步 — 三项管理功能统一入口</div>
      </div>
      <div class="workbench-tabs">
        <div
          v-for="tab in workbenchTabs"
          :key="tab.key"
          :class="['wb-tab', { active: workbenchSub === tab.key }]"
          @click="workbenchSub = tab.key"
        >
          <el-icon style="vertical-align:-2px;margin-right:4px;"><component :is="tab.icon" /></el-icon>
          {{ tab.label }}
        </div>
      </div>
      <AdminAuditLogs v-if="workbenchSub==='logs'" />
      <AdminStandard v-else-if="workbenchSub==='standard'" />
      <AdminSync v-else-if="workbenchSub==='sync'" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { User, Setting, Upload, FolderOpened, List, DocumentCopy, DataAnalysis, Tools, Reading } from '@element-plus/icons-vue';
import AdminReview from './views/admin/AdminReview.vue';
import AdminNas from './views/admin/AdminNas.vue';
import AdminReportGenerator from './views/admin/AdminReportGenerator.vue';
import AdminAuditLogs from './views/admin/AdminAuditLogs.vue';
import AdminStandard from './views/admin/AdminStandard.vue';
import AdminSync from './views/admin/AdminSync.vue';

const router = useRouter();
const route = useRoute();
const activeTab = ref('employee');
const isAdminLogin = ref(false);
const adminPage = ref('review');
const nasCurrentMode = ref('jobs');
const workbenchSub = ref('logs');
const NAS_MODE_KEY = 'archive_admin_nas_mode';

const workbenchTabs = [
  { key: 'logs',     icon: List,         label: '操作记录' },
  { key: 'standard', icon: DocumentCopy, label: '归档规范' },
  { key: 'sync',     icon: DataAnalysis, label: '项目库同步' }
];

onMounted(() => {
  const saved = localStorage.getItem('archive_uploader');
  if (!saved) localStorage.setItem('archive_uploader', '');
  const savedMode = localStorage.getItem(NAS_MODE_KEY);
  if (savedMode === 'browse' || savedMode === 'jobs') nasCurrentMode.value = savedMode;
  try {
    if (localStorage.getItem(ADMIN_LOGIN_KEY) === '1') {
      isAdminLogin.value = true;
    }
  } catch (_) {}
});

const ADMIN_LOGIN_KEY = 'archive_admin_logged_in';
function onTabChange(name) {
  if (name === 'admin-switch') {
    activeTab.value = 'employee';
    ElMessageBox.prompt('请输入管理员口令（第一阶段试运行默认：admin123）', '管理员登录', {
      confirmButtonText: '登录',
      cancelButtonText: '取消',
      inputType: 'password',
      inputValidator: (v) => v === 'admin123' || '口令错误'
    }).then(() => {
      isAdminLogin.value = true;
      adminPage.value = 'review';
      try { localStorage.setItem(ADMIN_LOGIN_KEY, '1'); } catch (_) {}
    }).catch(() => {});
  } else {
    router.push('/');
  }
}
function goAdmin(page) { adminPage.value = page; }
function setNasModeAndGo(mode) {
  nasCurrentMode.value = mode;
  try { localStorage.setItem(NAS_MODE_KEY, mode); } catch (_) {}
  adminPage.value = 'nas';
}
function exitAdmin() {
  isAdminLogin.value = false;
  try { localStorage.removeItem(ADMIN_LOGIN_KEY); } catch (_) {}
}
</script>

<style scoped>
.main-tabs :deep(.el-tabs__header) { margin: 0; }
.main-tabs :deep(.el-tabs__nav-wrap::after) { display: none; }

.workbench-wrap { padding: 0; }
.workbench-wrap .page-header {
  padding: 16px 20px 4px;
}
.workbench-tabs {
  display: flex;
  gap: 4px;
  padding: 10px 20px 0;
  margin: 0 0 14px 0;
  border-bottom: 1px solid #e5e7eb;
  flex-wrap: wrap;
}
.wb-tab {
  padding: 9px 20px;
  font-size: 14px;
  font-weight: 500;
  color: #6b7280;
  cursor: pointer;
  border-radius: 8px 8px 0 0;
  border: 1px solid transparent;
  border-bottom: none;
  transition: all 0.18s ease;
  user-select: none;
}
.wb-tab:hover {
  color: #2563eb;
  background: #eff6ff;
}
.wb-tab.active {
  color: #1d4ed8;
  background: #fff;
  border-color: #e5e7eb;
  border-bottom-color: #fff;
  font-weight: 600;
  position: relative;
  top: 1px;
  box-shadow: 0 -2px 5px rgba(0,0,0,0.02);
}
.wb-tab.active::after {
  content: '';
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 0;
  height: 2px;
  background: linear-gradient(90deg, #3b82f6, #2563eb);
  border-radius: 2px 2px 0 0;
}
.page-header {
  margin-bottom: 10px;
}
.page-header h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #0f172a;
  display: flex;
  align-items: center;
  gap: 6px;
}
.page-header .sub {
  margin-top: 4px;
  font-size: 13px;
  color: #6b7280;
}
</style>
