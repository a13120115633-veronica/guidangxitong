<template>
  <div>
    <div class="page-header">
      <h1><el-icon><List /></el-icon> 操作记录</h1>
      <div class="sub">查看系统所有操作审计日志（最多显示最近 500 条）</div>
    </div>

    <div class="section-card" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
      <div class="text-sm">
        共 <b>{{ logs.length }}</b> 条记录
        <span v-if="filterAction" style="margin-left: 8px;">
          · 筛选：<el-tag size="small" effect="plain" closable @close="filterAction = ''">{{ filterAction }}</el-tag>
        </span>
      </div>
      <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <el-select
          v-model="filterAction"
          placeholder="筛选操作类型"
          clearable
          size="default"
          style="width: 180px;"
        >
          <el-option
            v-for="a in actionTypes"
            :key="a"
            :label="a"
            :value="a"
          />
        </el-select>
        <el-button :icon="Refresh" @click="loadLogs">刷新</el-button>
      </div>
    </div>

    <div class="section-card" v-if="loading">
      <el-skeleton :rows="6" animated />
    </div>

    <div v-else-if="displayLogs.length === 0" class="section-card" style="text-align: center; padding: 40px 16px;">
      <el-empty description="暂无操作记录" />
    </div>

    <div v-else class="section-card" style="padding: 0; overflow: hidden;">
      <el-table
        :data="displayLogs"
        stripe
        style="width: 100%;"
        size="default"
        empty-text="暂无记录"
      >
        <el-table-column prop="created_at" label="时间" width="170" fixed="left">
          <template #default="{ row }">
            <div style="display: flex; align-items: center; gap: 6px; font-size: 13px;">
              <el-icon style="color: #2563eb;"><Clock /></el-icon>
              <span>{{ formatDate(row.created_at) }}</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column prop="actor" label="操作人" width="120">
          <template #default="{ row }">
            <div style="display: flex; align-items: center; gap: 6px;">
              <el-avatar :size="24" style="background: #dbeafe; color: #1e40af;">
                <el-icon><User /></el-icon>
              </el-avatar>
              <span>{{ row.actor || '-' }}</span>
            </div>
          </template>
        </el-table-column>

        <el-table-column prop="action" label="操作类型" width="180">
          <template #default="{ row }">
            <el-tag
              :type="actionTagType(row.action)"
              size="small"
              effect="light"
              style="cursor: pointer;"
              @click="filterAction = row.action"
            >
              <el-icon><component :is="actionIcon(row.action)" /></el-icon>
              <span style="margin-left: 2px;">{{ row.action || '-' }}</span>
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column prop="detail" label="详情内容" min-width="280">
          <template #default="{ row }">
            <div class="audit-detail">
              <template v-if="typeof row.detail === 'string'">
                {{ row.detail }}
              </template>
              <template v-else-if="row.detail && typeof row.detail === 'object'">
                <div v-for="(v, k) in row.detail" :key="k" class="audit-detail-row">
                  <span class="audit-detail-key">{{ k }}</span>
                  <span class="audit-detail-val">{{ stringify(v) }}</span>
                </div>
              </template>
              <span v-else class="text-muted">-</span>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import {
  List, Refresh, Clock, User, Upload,
  CircleCheck, Close, EditPen, Warning,
  Setting, Document, DataAnalysis
} from '@element-plus/icons-vue';
import { adminApi } from '@/api/index.js';

const loading = ref(false);
const logs = ref([]);
const filterAction = ref('');

const actionTypes = computed(() => {
  const s = new Set();
  logs.value.forEach(l => { if (l.action) s.add(l.action); });
  return [...s].sort();
});

const displayLogs = computed(() => {
  if (!filterAction.value) return logs.value;
  return logs.value.filter(l => l.action === filterAction.value);
});

function formatDate(s) {
  if (!s) return '-';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function stringify(v) {
  if (v == null) return '-';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function actionTagType(action) {
  if (!action) return 'info';
  const a = action.toLowerCase();
  if (a.includes('upload') || a.includes('上') || a.includes('创建')) return 'primary';
  if (a.includes('approve') || a.includes('确认') || a.includes('通过') || a.includes('归档')) return 'success';
  if (a.includes('reject') || a.includes('拒绝') || a.includes('删除')) return 'danger';
  if (a.includes('need') || a.includes('补充') || a.includes('修改')) return 'warning';
  if (a.includes('sync') || a.includes('同步')) return 'info';
  return 'info';
}

function actionIcon(action) {
  if (!action) return Document;
  const a = action.toLowerCase();
  if (a.includes('upload') || a.includes('上传')) return Upload;
  if (a.includes('approve') || a.includes('确认') || a.includes('通过') || a.includes('归档') || a.includes('mark')) return CircleCheck;
  if (a.includes('reject') || a.includes('拒绝')) return Close;
  if (a.includes('modify') || a.includes('edit') || a.includes('修改')) return EditPen;
  if (a.includes('need') || a.includes('补充') || a.includes('警告')) return Warning;
  if (a.includes('sync') || a.includes('同步')) return DataAnalysis;
  if (a.includes('登录') || a.includes('login') || a.includes('设置')) return Setting;
  return Document;
}

async function loadLogs() {
  loading.value = true;
  try {
    const data = await adminApi.auditLogs(500);
    const arr = Array.isArray(data) ? data : (data?.list || data?.data || data?.logs || []);
    logs.value = [...arr].sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return tb - ta;
    });
  } catch (e) {
    ElMessage.error(e.message || '加载操作记录失败');
  } finally {
    loading.value = false;
  }
}

onMounted(loadLogs);
</script>

<style scoped>
.audit-detail {
  font-size: 13px;
  color: #334155;
}
.audit-detail-row {
  display: flex;
  gap: 8px;
  margin-bottom: 2px;
  flex-wrap: wrap;
}
.audit-detail-row:last-child { margin-bottom: 0; }
.audit-detail-key {
  color: #64748b;
  min-width: 70px;
  flex-shrink: 0;
}
.audit-detail-val {
  color: #1e293b;
  word-break: break-all;
  flex: 1;
}
.text-muted { color: #9ca3af; }
</style>
