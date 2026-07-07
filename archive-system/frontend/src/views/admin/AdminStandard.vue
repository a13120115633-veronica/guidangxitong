<template>
  <div>
    <div class="page-header">
      <h1><el-icon><DocumentCopy /></el-icon> 归档规范</h1>
      <div class="sub">系统采用的归档目录结构与文件命名规范</div>
    </div>

    <div class="section-card" v-if="loading">
      <el-skeleton :rows="6" animated />
    </div>

    <div v-else>
      <div class="section-card">
        <h2>
          <el-icon><Edit /></el-icon>
          命名规则 (Naming Rules)
        </h2>
        <div v-if="namingRules.length === 0" class="text-muted" style="padding: 12px 0;">
          暂无命名规则配置
        </div>
        <el-timeline v-else>
          <el-timeline-item
            v-for="(rule, idx) in namingRules"
            :key="idx"
            :timestamp="rule.priority ? '优先级 ' + rule.priority : ''"
            placement="top"
            :type="rule.type || (idx % 2 === 0 ? 'primary' : 'success')"
          >
            <div class="rule-card">
              <div class="rule-title">
                {{ rule.title || rule.name || ('规则 ' + (idx + 1)) }}
              </div>
              <div class="rule-body" v-if="rule.description || rule.rule || rule.pattern || rule.template">
                <div v-if="rule.description" class="rule-row">
                  <span class="rule-label">说明</span>
                  <span class="rule-value">{{ rule.description }}</span>
                </div>
                <div v-if="rule.rule" class="rule-row">
                  <span class="rule-label">规则</span>
                  <div class="path-preview" style="margin-top: 2px;">{{ rule.rule }}</div>
                </div>
                <div v-if="rule.pattern" class="rule-row">
                  <span class="rule-label">匹配模式</span>
                  <div class="path-preview" style="margin-top: 2px;">{{ rule.pattern }}</div>
                </div>
                <div v-if="rule.template" class="rule-row">
                  <span class="rule-label">命名模板</span>
                  <div class="path-preview" style="margin-top: 2px;">{{ rule.template }}</div>
                </div>
                <div v-if="rule.example" class="rule-row">
                  <span class="rule-label">示例</span>
                  <el-tag type="success" effect="light">{{ rule.example }}</el-tag>
                </div>
              </div>
              <div v-else class="rule-body">
                <div class="path-preview">{{ typeof rule === 'string' ? rule : JSON.stringify(rule) }}</div>
              </div>
            </div>
          </el-timeline-item>
        </el-timeline>
      </div>

      <div class="section-card">
        <h2 style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
          <span>
            <el-icon><FolderOpened /></el-icon>
            归档目录结构 (Root Folders)
          </span>
          <el-button size="small" @click="expandAll = !expandAll">
            {{ expandAll ? '全部折叠' : '全部展开' }}
          </el-button>
        </h2>

        <div style="margin-bottom: 12px; padding: 10px 12px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; display: flex; gap: 8px; align-items: flex-start;">
          <el-icon style="color: #991b1b; margin-top: 2px;"><WarningFilled /></el-icon>
          <div style="font-size: 13px; color: #991b1b;">
            <b>特别说明：</b>目录名含「4.成果资料」的目录<b>仅可人工选择归档，不由 AI 自动推荐或自动归档</b>
          </div>
        </div>

        <div v-if="treeData.length === 0" class="text-muted" style="padding: 12px 0;">
          暂无目录结构配置
        </div>
        <el-tree
          v-else
          ref="treeRef"
          :data="treeData"
          node-key="id"
          :props="{ label: 'label', children: 'children' }"
          :expand-on-click-node="false"
          :default-expand-all="expandAll"
          :icon="Folder"
          style="background: #fafbfc; border-radius: 8px; padding: 8px;"
        >
          <template #default="{ node, data }">
            <span class="tree-node-label">
              <span :class="['tree-node-name', { 'is-manual': data.isManual }]">
                {{ data.label }}
              </span>
              <el-tag
                v-if="data.isManual"
                type="danger"
                size="small"
                effect="light"
                style="margin-left: 6px;"
              >
                <el-icon style="margin-right: 2px;"><Lock /></el-icon>仅人工
              </el-tag>
              <span v-if="data.desc || data.description" class="tree-node-desc">
                · {{ data.desc || data.description }}
              </span>
              <span v-if="data.children?.length" class="tree-node-count">
                ({{ data.children.length }} 个子项)
              </span>
            </span>
          </template>
        </el-tree>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { ElMessage } from 'element-plus';
import {
  DocumentCopy, Edit, FolderOpened, Folder, WarningFilled, Lock
} from '@element-plus/icons-vue';
import { archiveApi } from '@/api/index.js';

const loading = ref(false);
const standard = ref({});
const expandAll = ref(true);
const treeRef = ref(null);

const namingRules = computed(() => {
  const r = standard.value?.namingRules || standard.value?.naming_rules || [];
  if (Array.isArray(r)) return r;
  if (r && typeof r === 'object') return Object.entries(r).map(([k, v]) => ({ title: k, description: typeof v === 'string' ? v : JSON.stringify(v) }));
  return [];
});

function isManualFolder(label) {
  if (!label) return false;
  const s = String(label);
  return s.includes('4.成果资料') || s.includes('成果资料') || s.startsWith('4.');
}

function buildTree(nodes, parentIsManual = false) {
  if (!Array.isArray(nodes)) return [];
  return nodes.map((n, i) => {
    const label = n.label ?? n.name ?? n.path ?? n.title ?? ('目录 ' + (i + 1));
    const manual = isManualFolder(label) || parentIsManual || n.aiAutoArchive === false || n.ai_auto_archive === false || n.manualOnly === true;
    const children = n.children || n.subFolders || n.sub_folders || n.folders || [];
    return {
      id: (n.id != null ? String(n.id) : null) || (label + '_' + i + '_' + Math.random().toString(36).slice(2, 6)),
      label,
      desc: n.desc || n.description || n.remark || '',
      isManual: manual,
      children: children.length ? buildTree(children, manual) : undefined
    };
  });
}

const treeData = computed(() => {
  const rf = standard.value?.rootFolders || standard.value?.root_folders || standard.value?.folders || standard.value?.paths || [];
  return buildTree(rf);
});

watch(expandAll, async (val) => {
  await nextTick();
  const tree = treeRef.value;
  if (!tree) return;
  const allNodes = getAllNodes(treeData.value);
  allNodes.forEach(node => {
    if (val) tree.store.nodesMap[node.id]?.expand();
    else tree.store.nodesMap[node.id]?.collapse();
  });
});

function getAllNodes(arr) {
  const out = [];
  for (const n of arr) {
    out.push(n);
    if (n.children) out.push(...getAllNodes(n.children));
  }
  return out;
}

async function loadStandard() {
  loading.value = true;
  try {
    const data = await archiveApi.getStandard();
    standard.value = data?.standard || data || {};
  } catch (e) {
    ElMessage.error(e.message || '加载归档规范失败');
  } finally {
    loading.value = false;
  }
}

onMounted(loadStandard);
</script>

<style scoped>
.rule-card {
  background: #f8fafc;
  border-radius: 8px;
  padding: 10px 12px;
}
.rule-title {
  font-weight: 600;
  font-size: 14px;
  color: #1e293b;
  margin-bottom: 6px;
}
.rule-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rule-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rule-label {
  font-size: 12px;
  color: #94a3b8;
}
.rule-value {
  font-size: 13px;
  color: #334155;
}
.text-muted { color: #9ca3af; }
.tree-node-label {
  font-size: 14px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
}
.tree-node-name {
  font-weight: 500;
  color: #1e293b;
}
.tree-node-name.is-manual {
  color: #991b1b;
}
.tree-node-desc {
  color: #94a3b8;
  font-size: 12px;
}
.tree-node-count {
  color: #94a3b8;
  font-size: 12px;
}
</style>
