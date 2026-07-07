<template>
  <div class="app-container">
    <nav v-if="!isAdminLogin" class="nav-tabs">
      <el-tabs v-model="activeTab" class="main-tabs" @tab-change="onTabChange">
        <el-tab-pane label="员工端" name="employee">
          <template #label>
            <span><el-icon><User /></el-icon> 员工端</span>
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
      <el-button size="small" @click="goAdmin('review')" :type="adminPage==='review'?'primary':''">待审核</el-button>
      <el-button size="small" :icon="Upload" @click="setNasModeAndGo('jobs')" :type="(adminPage==='nas' && nasCurrentMode==='jobs')?'primary':''">待上传（推送 NAS）</el-button>
      <el-button size="small" :icon="FolderOpened" @click="setNasModeAndGo('browse')" :type="(adminPage==='nas' && nasCurrentMode==='browse')?'primary':''">NAS 归档浏览（下载）</el-button>
      <el-button size="small" @click="goAdmin('logs')" :type="adminPage==='logs'?'primary':''">操作记录</el-button>
      <el-button size="small" @click="goAdmin('standard')" :type="adminPage==='standard'?'primary':''">归档规范</el-button>
      <el-button size="small" @click="goAdmin('sync')" :type="adminPage==='sync'?'primary':''">项目库同步</el-button>
      <el-button size="small" text @click="exitAdmin">退出管理员</el-button>
    </div>
    <router-view v-if="!isAdminLogin" />
    <AdminReview v-else-if="adminPage==='review'" />
    <AdminNas v-else-if="adminPage==='nas'" />
    <AdminAuditLogs v-else-if="adminPage==='logs'" />
    <AdminStandard v-else-if="adminPage==='standard'" />
    <AdminSync v-else-if="adminPage==='sync'" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import { User, Setting, Upload, FolderOpened } from '@element-plus/icons-vue';
import AdminReview from './views/admin/AdminReview.vue';
import AdminNas from './views/admin/AdminNas.vue';
import AdminAuditLogs from './views/admin/AdminAuditLogs.vue';
import AdminStandard from './views/admin/AdminStandard.vue';
import AdminSync from './views/admin/AdminSync.vue';

const router = useRouter();
const route = useRoute();
const activeTab = ref('employee');
const isAdminLogin = ref(false);
const adminPage = ref('review');
const nasCurrentMode = ref('jobs');
const NAS_MODE_KEY = 'archive_admin_nas_mode';

onMounted(() => {
  const saved = localStorage.getItem('archive_uploader');
  if (!saved) localStorage.setItem('archive_uploader', '');
  const savedMode = localStorage.getItem(NAS_MODE_KEY);
  if (savedMode === 'browse' || savedMode === 'jobs') nasCurrentMode.value = savedMode;
});

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
function exitAdmin() { isAdminLogin.value = false; }
</script>

<style scoped>
.main-tabs :deep(.el-tabs__header) { margin: 0; }
.main-tabs :deep(.el-tabs__nav-wrap::after) { display: none; }
</style>
