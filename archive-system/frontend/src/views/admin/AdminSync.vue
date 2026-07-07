<template>
  <div>
    <div class="page-header">
      <h1><el-icon><DataAnalysis /></el-icon> 项目库同步状态</h1>
      <div class="sub">查看并管理项目库数据源同步状态与本地缓存</div>
    </div>

    <div class="section-card">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        style="margin-bottom: 12px;"
      >
        <template #title>
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <el-icon><InfoFilled /></el-icon>
            <span>提示：项目库接口临时不可用时，使用本地缓存数据</span>
          </div>
        </template>
      </el-alert>

      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;">
        <div class="text-sm">
          <el-icon><DataBoard /></el-icon>
          数据源总数：<b>{{ statusList.length }}</b>
        </div>
        <div style="display: flex; gap: 8px;">
          <el-button :icon="Refresh" @click="loadStatus">刷新状态</el-button>
          <el-button
            type="primary"
            :icon="RefreshRight"
            :loading="syncLoading"
            @click="handleSync"
          >
            刷新同步项目库
          </el-button>
        </div>
      </div>
    </div>

    <div class="section-card" v-if="loading">
      <el-skeleton :rows="4" animated />
    </div>

    <div v-else-if="statusList.length === 0" class="section-card" style="text-align: center; padding: 40px 16px;">
      <el-empty description="未配置任何项目库数据源" />
    </div>

    <div v-else>
      <div
        v-for="(item, idx) in statusList"
        :key="idx"
        class="section-card"
      >
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; margin-bottom: 10px;">
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <el-icon style="color: #2563eb; font-size: 22px;"><Coin /></el-icon>
            <div>
              <div style="font-weight: 600; font-size: 15px; color: #1e293b;">
                {{ item.source || ('数据源 ' + (idx + 1)) }}
              </div>
              <div v-if="item.sourceUrl" class="text-sm" style="margin-top: 2px; word-break: break-all;">
                <el-icon style="vertical-align: -2px;"><Link /></el-icon>
                {{ item.sourceUrl }}
              </div>
            </div>
          </div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            <el-tag
              v-if="item.lastError"
              type="danger"
              effect="light"
            >
              <el-icon><CircleCloseFilled /></el-icon>
              <span style="margin-left: 2px;">异常</span>
            </el-tag>
            <el-tag
              v-else-if="isRecent(item.lastSyncedAt)"
              type="success"
              effect="light"
            >
              <el-icon><CircleCheckFilled /></el-icon>
              <span style="margin-left: 2px;">已同步</span>
            </el-tag>
            <el-tag
              v-else
              type="warning"
              effect="light"
            >
              <el-icon><Clock /></el-icon>
              <span style="margin-left: 2px;">需更新</span>
            </el-tag>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-box">
            <div class="num" style="color: #2563eb;">
              {{ formatCount(item.count) }}
            </div>
            <div class="label">
              <el-icon><Files /></el-icon>
              远端项目总数
            </div>
          </div>
          <div class="stat-box">
            <div class="num" style="color: #059669;">
              {{ formatCount(item.localProjectCount) }}
            </div>
            <div class="label">
              <el-icon><FolderChecked /></el-icon>
              本地缓存项目数
            </div>
          </div>
          <div class="stat-box">
            <div class="num" :style="{ color: syncDeltaOk(item) ? '#059669' : '#d97706', fontSize: '16px' }" style="padding: 3px 0;">
              {{ syncDeltaText(item) }}
            </div>
            <div class="label">
              <el-icon><Sort /></el-icon>
              差异
            </div>
          </div>
          <div class="stat-box">
            <div class="num" style="font-size: 13px; color: #1e293b; padding: 4px 0; word-break: break-all;">
              {{ formatDate(item.lastSyncedAt) }}
            </div>
            <div class="label">
              <el-icon><Calendar /></el-icon>
              上次同步
            </div>
          </div>
        </div>

        <div
          v-if="item.lastError"
          style="margin-top: 8px; padding: 10px 12px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; display: flex; gap: 8px; align-items: flex-start;"
        >
          <el-icon style="color: #dc2626; margin-top: 2px;"><WarningFilled /></el-icon>
          <div style="flex: 1;">
            <div style="font-weight: 600; color: #991b1b; font-size: 13px; margin-bottom: 4px;">
              同步错误信息
            </div>
            <div style="font-size: 13px; color: #7f1d1d; white-space: pre-wrap; word-break: break-all;">
              {{ item.lastError }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  DataAnalysis, InfoFilled, DataBoard, Refresh, RefreshRight,
  Coin, Link, Clock, CircleCheckFilled, CircleCloseFilled,
  Files, FolderChecked, Sort, Calendar, WarningFilled
} from '@element-plus/icons-vue';
import { projectApi } from '@/api/index.js';

const loading = ref(false);
const syncLoading = ref(false);
const rawStatus = ref(null);

const statusList = computed(() => {
  const r = rawStatus.value;
  if (!r) return [];
  if (Array.isArray(r)) return r;
  if (Array.isArray(r.sources)) return r.sources;
  if (Array.isArray(r.list)) return r.list;
  if (Array.isArray(r.data)) return r.data;
  return [r];
});

function formatCount(n) {
  if (n == null || n === '') return '-';
  const num = Number(n);
  if (isNaN(num)) return String(n);
  return num.toLocaleString('zh-CN');
}

function formatDate(s) {
  if (!s) return '从未同步';
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}\n${hh}:${mm}`;
}

function isRecent(s) {
  if (!s) return false;
  const t = new Date(s).getTime();
  if (isNaN(t)) return false;
  return Date.now() - t < 24 * 60 * 60 * 1000;
}

function syncDeltaOk(item) {
  if (item.lastError) return false;
  if (item.count == null || item.localProjectCount == null) return true;
  return Number(item.count) === Number(item.localProjectCount);
}

function syncDeltaText(item) {
  if (item.count == null && item.localProjectCount == null) return '-';
  const c = Number(item.count) || 0;
  const l = Number(item.localProjectCount) || 0;
  const d = l - c;
  if (d === 0) return '一致 ✓';
  if (d > 0) return `本地多 ${d} 项`;
  return `远端多 ${Math.abs(d)} 项`;
}

async function loadStatus() {
  loading.value = true;
  try {
    const data = await projectApi.getSourceStatus();
    rawStatus.value = data?.status || data;
  } catch (e) {
    ElMessage.error(e.message || '加载同步状态失败');
  } finally {
    loading.value = false;
  }
}

async function handleSync() {
  try {
    await ElMessageBox.confirm(
      '即将触发项目库数据源的同步刷新，可能需要几秒钟时间。是否继续？',
      '确认同步项目库',
      {
        confirmButtonText: '开始同步',
        cancelButtonText: '取消',
        type: 'info',
        confirmButtonClass: 'el-button--primary'
      }
    );
  } catch {
    return;
  }
  syncLoading.value = true;
  try {
    const res = await projectApi.syncSource();
    ElMessage.success(res?.message || '同步已完成');
    await loadStatus();
  } catch (e) {
    ElMessage.error(e.message || '同步失败，请稍后重试');
  } finally {
    syncLoading.value = false;
  }
}

onMounted(loadStatus);
</script>

<style scoped>
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
@media (max-width: 480px) {
  .stats-grid { grid-template-columns: repeat(2, 1fr); }
}
.stat-box {
  text-align: center;
  padding: 10px 4px;
  border-radius: 8px;
  background: #f8fafc;
}
.stat-box .num {
  font-size: 22px;
  font-weight: 700;
  white-space: pre-line;
  line-height: 1.2;
  min-height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.stat-box .label {
  font-size: 12px;
  color: #6b7280;
  margin-top: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
}
.text-sm { font-size: 13px; color: #6b7280; }
</style>
