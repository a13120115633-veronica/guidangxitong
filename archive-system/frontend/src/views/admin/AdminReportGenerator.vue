<template>
  <div class="admin-report-page">
    <div class="page-header">
      <h1><el-icon><Reading /></el-icon> 智能报告生成平台</h1>
      <div class="sub">调用 NAS 中的项目源资料，一键生成「考古勘探工作计划 / 成果报告」DOCX，生成后人工审核通过自动推送到 NAS「执行资料 / 报告」目录</div>
    </div>

    <div class="top-actions">
      <div class="type-switch">
        <el-radio-group v-model="skillType" size="default" @change="onSkillTypeChange">
          <el-radio-button value="plan"><el-icon><Tickets /></el-icon>&nbsp;工作计划（DOCX）</el-radio-button>
          <el-radio-button value="report"><el-icon><Document /></el-icon>&nbsp;成果报告（DOCX）</el-radio-button>
        </el-radio-group>
        <el-tag size="small" :type="doctorType === 'ok' ? 'success' : doctorType === 'warn' ? 'warning' : 'danger'" style="margin-left:10px;">
          {{ doctorText }}
        </el-tag>
      </div>
      <div class="right-actions">
        <el-button size="small" :icon="Refresh" @click="refreshAll" :loading="loading.refresh">刷新</el-button>
        <el-button size="small" type="primary" :icon="Plus" @click="startNewRun">+ 新建生成任务</el-button>
      </div>
    </div>

    <el-row :gutter="18" class="main-grid">
      <el-col :span="6" class="runs-col">
        <el-card shadow="never" class="runs-card">
          <template #header>
            <div style="display:flex;align-items:center;justify-content:space-between;">
              <b><el-icon><Collection /></el-icon>&nbsp; 生成任务列表</b>
              <span style="font-size:12px;color:#6b7280;">共 {{ runs.length }} 个</span>
            </div>
          </template>
          <div v-if="!runs.length" class="empty">暂无生成任务，点「+ 新建生成任务」开始</div>
          <div v-for="r in runs" :key="r.id"
               :class="['run-item', { active: activeRunId === r.id }]"
               @click="selectRun(r.id)">
            <div class="ri-top">
              <el-tag size="small" :type="r.skillType === 'plan' ? 'warning' : 'primary'" style="margin-right:6px;">
                {{ r.skillType === 'plan' ? '工作计划' : '成果报告' }}
              </el-tag>
              <span class="ri-name">{{ r.name }}</span>
            </div>
            <div class="ri-meta">
              <span>{{ fmtDate(r.createdAt) }}</span>
              <span class="ri-step">进度：{{ stepTitles[currentStepOf(r)] }}</span>
            </div>
          </div>
        </el-card>
      </el-col>

      <el-col :span="18" class="detail-col">
        <div v-if="!activeRun" class="detail-card-wrapper">
          <el-card shadow="never" class="detail-card">
            <template #header>
              <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
                <div style="font-weight:600;font-size:15px;">
                  <el-tag size="small" style="margin-right:8px;" :type="skillType === 'plan' ? 'warning' : 'primary'">
                    {{ skillType === 'plan' ? '工作计划' : '成果报告' }}
                  </el-tag>
                  新建生成任务
                </div>
                <div style="color:#6b7280;font-size:12px;">
                  当前进度：第 1 步 / 共 7 步
                </div>
              </div>
            </template>
            <div class="step-body">
              <div class="step-card">
                <h3><el-icon><FolderOpened /></el-icon>&nbsp; 第 1 步：选择 NAS 里的项目源目录</h3>
                <p class="hint">项目目录里应该包含：项目概况、照片、红线/勘探图纸、坐标、回函等原始资料。</p>
                <el-alert v-if="nasMountError" type="warning" :closable="false" show-icon style="margin-bottom:12px;max-width:640px;"
                  title="NAS 未挂载或未配置"
                >
                  <template #default>
                    <div style="font-size:12px;line-height:1.7;">
                      <div>原因：{{ nasMountError }}</div>
                      <div style="margin-top:6px;">解决：在顶部「NAS 设置」里填写 SMB 挂载路径并保存；或在 macOS Finder 用 ⌘+K 连接 <code>smb://192.168.31.131/personal_folder</code> 后再点「刷新」。</div>
                    </div>
                  </template>
                </el-alert>
                <el-tree-select
                  v-if="nasTree && nasTree.length"
                  v-model="pickedProjectPath"
                  :data="nasTree"
                  check-strictly
                  node-key="absolutePath"
                  :props="{ label: 'name', children: 'children', value: 'absolutePath', disabled: (d) => !d || d.isDir === false }"
                  placeholder="点此从 NAS 目录树中选择项目目录"
                  filterable
                  style="width:100%;max-width:640px;"
                  size="default"
                />
                <el-input v-else style="max-width:640px;" placeholder="（NAS 未挂载或暂无目录，手动粘贴绝对路径，例如 /Volumes/personal_folder/2024-XX 项目名）" v-model="pickedProjectPath" />
                <div style="margin-top:12px;">
                  <el-tag size="small" type="info">已选路径：{{ pickedProjectPath || '（未选择）' }}</el-tag>
                </div>
                <div class="step-actions">
                <el-button
                  :icon="ArrowLeft"
                  :disabled="activeStepIdx <= 0"
                  @click="goPrevStep"
                >
                  ← 返回上一步
                </el-button>
                  <el-button
                    :icon="ArrowLeft"
                    :disabled="activeStepIdx <= 0"
                    @click="goPrevStep"
                  >
                    ← 返回上一步
                  </el-button>
                  <el-button type="primary" :icon="Check" :disabled="!canStartStep1" @click="createRunFromPicked">确认项目，创建生成任务</el-button>
                </div>
              </div>
            </div>
          </el-card>
        </div>

        <el-card shadow="never" class="detail-card" v-else>
          <template #header>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
              <div style="font-weight:600;font-size:15px;">
                {{ activeRun.name }}
                <el-tag size="small" style="margin-left:8px;" :type="activeRun.skillType === 'plan' ? 'warning' : 'primary'">
                  {{ activeRun.skillType === 'plan' ? '工作计划' : '成果报告' }}
                </el-tag>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <el-button size="small" :icon="FolderOpened" @click="openNasDir" :disabled="!activeRun.nasProjectPath">打开 NAS 项目目录</el-button>
                <el-button size="small" :icon="RefreshLeft" @click="resetActiveRun" :disabled="!activeRunId">重置本次任务</el-button>
              </div>
            </div>
          </template>

          <el-steps :active="activeStepIdx + 1" finish-status="success" align-center simple>
            <el-step v-for="t in stepTitles" :key="t" :title="t" />
          </el-steps>

          <div class="step-body">
            <div class="step-card" v-if="activeStepIdx === 0">
              <h3><el-icon><FolderOpened /></el-icon>&nbsp; 第 1 步：确认 NAS 里的项目源目录</h3>
              <p class="hint">项目目录里应该包含：项目概况、照片、红线/勘探图纸、坐标、回函等原始资料。</p>
              <el-alert v-if="nasMountError" type="warning" :closable="false" show-icon style="margin-bottom:12px;max-width:640px;"
                title="NAS 未挂载或未配置"
              >
                <template #default>
                  <div style="font-size:12px;line-height:1.7;">
                    <div>原因：{{ nasMountError }}</div>
                    <div style="margin-top:6px;">解决：在顶部「NAS 设置」里填写 SMB 挂载路径并保存；或在 macOS Finder 用 ⌘+K 连接 <code>smb://192.168.31.131/personal_folder</code> 后再点「刷新」。</div>
                  </div>
                </template>
              </el-alert>
              <el-tree-select
                v-if="nasTree && nasTree.length"
                v-model="pickedProjectPath"
                :data="nasTree"
                check-strictly
                node-key="absolutePath"
                :props="{ label: 'name', children: 'children', value: 'absolutePath', disabled: (d) => !d || d.isDir === false }"
                placeholder="点此从 NAS 目录树中选择项目目录"
                filterable
                style="width:100%;max-width:640px;"
                size="default"
              />
              <el-input v-else style="max-width:640px;" placeholder="（NAS 未挂载或暂无目录，手动粘贴绝对路径，例如 /Volumes/personal_folder/2024-XX 项目名）" v-model="pickedProjectPath" />
              <div style="margin-top:12px;">
                <el-tag size="small" type="info">已选路径：{{ pickedProjectPath || '（未选择）' }}</el-tag>
              </div>
              <div class="step-actions">
                <el-button
                  :icon="ArrowLeft"
                  :disabled="activeStepIdx <= 0"
                  @click="goPrevStep"
                >
                  ← 返回上一步
                </el-button>
                <el-button type="primary" :icon="Check" :disabled="!canStartStep1" @click="updateRunProjectAndGo">确认项目，进入下一步预检</el-button>
              </div>
            </div>

            <div class="step-card" v-else-if="activeStepIdx === 1">
              <h3><el-icon><Search /></el-icon>&nbsp; 第 2 步：资料预检（Preflight）</h3>
              <ResultBox :result="activeRun.steps && activeRun.steps.preflight" :ok="activeRun.steps && activeRun.steps.preflight && activeRun.steps.preflight.ok" />
              <div class="step-actions">
                <el-button
                  :icon="ArrowLeft"
                  :disabled="activeStepIdx <= 0"
                  @click="goPrevStep"
                >
                  ← 返回上一步
                </el-button>
                <el-button :icon="Refresh" @click="runStepPreflight" :loading="loading.preflight">重新预检</el-button>
                <el-button type="primary" :icon="ArrowRight" :disabled="!stepReady(2)" @click="activeStepIdx = 2">进入下一步</el-button>
              </div>
            </div>

            <div class="step-card" v-else-if="activeStepIdx === 2">
              <h3><el-icon><DocumentAdd /></el-icon>&nbsp; 第 3 步：生成预填「人工确认表」+ 确认修改</h3>
              <p class="hint">系统会根据 NAS 项目资料，自动预填「人工确认表 .xlsx」。推荐直接点击下方「在线预览/编辑」按钮在本页修改，改完后确认即可自动进入下一步（无需下载 Excel）。如需传统方式，也可下载到本地用 Excel 编辑，再到下一步手动上传。</p>
              <ResultBox :result="activeRun.steps && activeRun.steps.prepared" :ok="activeRun.steps && activeRun.steps.prepared && activeRun.steps.prepared.ok" />
              <div style="margin-top:10px;">
                <el-tooltip
                  v-if="!manualReadyForEdit"
                  effect="dark"
                  placement="top"
                  :content="manualReadyForEdit ? '' : (activeRun && activeRun.steps && activeRun.steps.prepared && activeRun.steps.prepared.ok === false ? '人工确认表生成失败，请先点击下方「重新生成人工确认表」修复' : '请先点击下方「重新生成人工确认表」生成成功后即可编辑')"
                >
                  <el-button size="default" type="primary" :icon="Edit" disabled :loading="loading.manualEditor || loading.submitManualEditor">
                    ✏️ 在线预览 / 编辑人工确认表（推荐）
                  </el-button>
                </el-tooltip>
                <el-button
                  v-else
                  size="default"
                  type="primary"
                  :icon="Edit"
                  @click="openManualEditor"
                  :loading="loading.manualEditor || loading.submitManualEditor"
                >
                  ✏️ 在线预览 / 编辑人工确认表（推荐：改完直接进入下一步）
                </el-button>
                &nbsp;
                <el-tooltip
                  v-if="!manualReadyForEdit"
                  effect="dark"
                  placement="top"
                  :content="manualReadyForEdit ? '' : '请先生成人工确认表后再下载'"
                >
                  <el-button size="default" type="success" :icon="Download" disabled>
                    ⬇️ 下载 人工确认表.xlsx
                  </el-button>
                </el-tooltip>
                <el-button
                  v-else
                  size="default"
                  type="success"
                  :icon="Download"
                  :href="reportApi.download(activeRunId, 'manual')"
                  target="_self"
                >
                  ⬇️ 下载 人工确认表.xlsx（传统 Excel 编辑方式）
                </el-button>
              </div>
              <div class="step-actions">
                <el-button
                  :icon="ArrowLeft"
                  :disabled="activeStepIdx <= 0"
                  @click="goPrevStep"
                >
                  ← 返回上一步
                </el-button>
                <el-button :icon="Refresh" @click="runStepPrepare" :loading="loading.prepare">重新生成人工确认表</el-button>
                <el-button v-if="smartFormAlreadyBuilt" type="success" :icon="CircleCheck" @click="activeStepIdx = 6">
                  ✅ Smart 表单已生成，直接进入下一步：推荐模板 + 门禁
                </el-button>
                <el-tooltip v-else effect="dark" placement="top" content="仅用于「下载到本地 Excel 编辑 → 手动上传」的传统方式。推荐直接用上方的✏️在线预览/编辑按钮（改完自动跳下一步，无需上传）。">
                  <el-button type="primary" :icon="ArrowRight" :disabled="!stepReady(4)" @click="activeStepIdx = 4">下一步：上传你修改后的人工确认表（传统方式）</el-button>
                </el-tooltip>
              </div>
            </div>

            <div class="step-card" v-else-if="activeStepIdx === 4">
              <h3><el-icon><Upload /></el-icon>&nbsp; 第 4 步：上传你在本地 Excel 编辑好的「人工确认表 .xlsx」</h3>
              <p class="hint">MVP 一期的交互：你在本地 Excel 改完 xlsx 后，把文件拖进下面上传框，或者点上传按钮选择文件。上传后系统会自动生成 smart-form。</p>
              <el-upload
                class="manual-upload"
                drag
                :auto-upload="false"
                :on-change="onManualChange"
                :show-file-list="true"
                multiple
                :limit="1"
                accept=".xlsx,.xls"
              >
                <el-icon class="el-icon--upload"><upload-filled /></el-icon>
                <div class="el-upload__text">把修改好的 .xlsx 拖到这里，或 <em>点此选择文件</em></div>
                <template #tip>
                  <div class="el-upload__tip">仅支持 .xlsx / .xls，大小不超过 200MB</div>
                </template>
              </el-upload>
              <div v-if="manualUploadFile" style="margin-top:8px;">
                <el-tag>已选：{{ manualUploadFile.name }}（{{ formatSize(manualUploadFile.size) }}）</el-tag>
              </div>
              <ResultBox :result="activeRun.steps && activeRun.steps.smartFormBuilt" :ok="activeRun.steps && activeRun.steps.smartFormBuilt && activeRun.steps.smartFormBuilt.ok" />
              <div class="step-actions">
                <el-button
                  :icon="ArrowLeft"
                  :disabled="activeStepIdx <= 0"
                  @click="goPrevStep"
                >
                  ← 返回上一步
                </el-button>
                <el-button type="primary" :icon="MagicStick" :disabled="!manualUploadFile || loading.buildSmart" @click="runBuildSmart" :loading="loading.buildSmart">
                  上传并生成 Smart 表单
                </el-button>
                <el-button :icon="ArrowRight" :disabled="!stepReady(6)" @click="activeStepIdx = 6">进入下一步</el-button>
              </div>
            </div>

            <div class="step-card" v-else-if="activeStepIdx === 6">
              <h3><el-icon><Avatar /></el-icon>&nbsp; 第 5 步：人员集 + 报告/计划模板匹配 + 时间线门禁</h3>
              <div class="two-col">
                <div class="sub-card">
                  <h4>① 选择人员集（多套人员时）</h4>
                  <el-select v-model="personnelSet" placeholder="请选择人员集，默认选「人员信息1」" style="width:100%;max-width:420px;" clearable>
                    <el-option label="人员信息1（第一套人员配置，默认推荐）" value="人员信息1" />
                    <el-option label="人员信息2（第二套备用人员配置）" value="人员信息2" />
                  </el-select>
                  <div style="color:#6b7280;font-size:12px;margin-top:6px;">脚本固定支持的人员共 2 套，一般项目默认选「人员信息1」即可；若该公司明确指定用第二套人员，请选「人员信息2」</div>
                </div>
                <div class="sub-card">
                  <h4>② 匹配结果（模板 + 门禁）</h4>
                  <div v-if="activeRun.matchedTemplate">
                    <el-tag type="success" size="small">✅ 已匹配模板：{{ activeRun.matchedTemplate }}</el-tag>
                  </div>
                  <div v-else style="color:#6b7280;font-size:12px;">还未运行推荐，点下面按钮开始匹配</div>
                </div>
              </div>
              <ResultBox :result="activeRun.steps && activeRun.steps.recommended" :ok="activeRun.steps && activeRun.steps.recommended && activeRun.steps.recommended.ok" title="推荐结果" />
              <ResultBox :result="activeRun.steps && activeRun.steps.timelineValidated" :ok="activeRun.steps && activeRun.steps.timelineValidated && activeRun.steps.timelineValidated.ok" title="时间线门禁" />
              <div class="step-actions">
                <el-button
                  :icon="ArrowLeft"
                  :disabled="activeStepIdx <= 0"
                  @click="goPrevStep"
                >
                  ← 返回上一步
                </el-button>
                <el-button :icon="User" @click="runRecommend" :loading="loading.recommend">运行人员+模板匹配</el-button>
                <el-button :icon="Clock" @click="runTimeline" :loading="loading.timeline">运行时间线门禁</el-button>
                <el-tooltip
                  v-if="!stepReady(8)"
                  effect="dark"
                  placement="top"
                  :content="generateDisabledHint"
                >
                  <el-button type="primary" :icon="ArrowRight" disabled>进入下一步：生成</el-button>
                </el-tooltip>
                <el-button v-else type="primary" :icon="ArrowRight" @click="activeStepIdx = 8">进入下一步：生成</el-button>
              </div>
              <div v-if="!stepReady(8)" style="color:#dc2626;font-size:12px;margin-top:8px;padding:0 8px;">
                ⚠️ {{ generateDisabledHint }}
              </div>
            </div>

            <div class="step-card" v-else-if="activeStepIdx === 8">
              <h3><el-icon><Promotion /></el-icon>&nbsp; 第 6 步：生成 DOCX + QA 检查报告</h3>
              <ResultBox :result="activeRun.steps && activeRun.steps.generated" :ok="activeRun.steps && activeRun.steps.generated && activeRun.steps.generated.ok" title="生成结果" />
              <div v-if="activeRun.outputs && activeRun.outputs.length" class="outputs-list">
                <h4>本次生成产物（{{ activeRun.outputs.length }} 个）</h4>
                <el-table :data="activeRun.outputs" size="small" border stripe>
                  <el-table-column prop="kind" label="类型" width="120">
                    <template #default="{ row }">
                      <el-tag size="small" :type="kindTag(row.kind)">{{ kindLabel(row.kind) }}</el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column prop="name" label="文件名" show-overflow-tooltip />
                  <el-table-column label="大小" width="100">
                    <template #default="{ row }">{{ formatSize(row.size) }}</template>
                  </el-table-column>
                  <el-table-column label="预览" width="100">
                    <template #default="{ row }">
                      <el-button
                        size="small"
                        type="success"
                        :icon="View"
                        :disabled="row.kind !== 'report-docx'"
                        @click="openReportPreview(row)"
                      >
                        预览
                      </el-button>
                    </template>
                  </el-table-column>
                  <el-table-column label="下载" width="100">
                    <template #default="{ row }">
                      <el-button size="small" type="primary" :icon="Download"
                                 :href="reportApi.download(activeRunId, row.id || row.name)"
                                 target="_self">下载</el-button>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
              <div class="step-actions">
                <el-button
                  :icon="ArrowLeft"
                  :disabled="activeStepIdx <= 0"
                  @click="goPrevStep"
                >
                  ← 返回上一步
                </el-button>
                <el-button :icon="Refresh" @click="runGenerate" :loading="loading.generate">重新生成</el-button>
                <el-tooltip
                  v-if="reportDocxFiles.length === 0"
                  effect="dark"
                  placement="top"
                  content="没有可预览的最终报告 DOCX，请先点「重新生成」生成成功后即可预览"
                >
                  <el-button type="success" :icon="View" disabled>👁 预览生成的报告</el-button>
                </el-tooltip>
                <el-button v-else type="success" :icon="View" @click="openReportPreview()">👁 预览生成的报告（{{ reportDocxFiles.length }} 个）</el-button>
                <el-tooltip
                  v-if="!stepReady(9)"
                  effect="dark"
                  placement="top"
                  :content="auditNextDisabledHint"
                >
                  <el-button type="primary" :icon="ArrowRight" disabled>下一步：人工审核</el-button>
                </el-tooltip>
                <el-button v-else type="primary" :icon="ArrowRight" @click="activeStepIdx = 9">下一步：人工审核</el-button>
              </div>
              <div v-if="!stepReady(9)" style="color:#dc2626;font-size:12px;margin-top:8px;padding:0 8px;">
                ⚠️ {{ auditNextDisabledHint }}
              </div>
            </div>

            <div class="step-card" v-else-if="activeStepIdx === 9">
              <h3><el-icon><CircleCheck /></el-icon>&nbsp; 第 7 步：人工审核（审核通过 → 自动推送到 NAS「执行资料/报告」目录）</h3>
              <div v-if="activeRun.audit" class="audit-info">
                <el-tag :type="activeRun.audit.passed ? 'success' : 'danger'" size="default">
                  {{ activeRun.audit.passed ? '✅ 已审核通过' : '❌ 已驳回' }}
                </el-tag>
                <div v-if="activeRun.audit.comment" style="margin-top:8px;">
                  <span style="color:#6b7280;">审核意见：</span>{{ activeRun.audit.comment }}
                  <span style="color:#9ca3af;margin-left:8px;">（{{ fmtDate(activeRun.audit.at) }}）</span>
                </div>
              </div>
              <div v-else class="audit-form">
                <el-radio-group v-model="auditPassed" size="default">
                  <el-radio-button :label="true" value="true"><el-icon><Check /></el-icon>&nbsp;审核通过（推送 NAS）</el-radio-button>
                  <el-radio-button :label="false" value="false"><el-icon><Close /></el-icon>&nbsp;驳回（不推送 NAS，回去修改）</el-radio-button>
                </el-radio-group>
                <el-input style="margin-top:10px;max-width:640px;" type="textarea" :rows="2" v-model="auditComment" placeholder="审核意见（可选）" />
              </div>
              <div v-if="activeRun.steps && activeRun.steps.pushedToNas" class="push-info">
                <el-alert type="success" :closable="false" show-icon title="✅ 已自动推送到 NAS">
                  <template #default>
                    目标目录：<code>{{ activeRun.steps.pushedToNas.targetFolder }}</code><br />
                    推送文件：{{ (activeRun.steps.pushedToNas.files || []).map(f => f.name).join('，') }}<br />
                    推送时间：{{ fmtDate(activeRun.steps.pushedToNas.at) }}
                  </template>
                </el-alert>
              </div>
              <div class="step-actions">
                <el-button
                  :icon="ArrowLeft"
                  :disabled="activeStepIdx <= 0"
                  @click="goPrevStep"
                >
                  ← 返回上一步
                </el-button>
                <el-tooltip
                  v-if="!!activeRun.audit"
                  effect="dark"
                  placement="top"
                  :content="auditSubmitDisabledHint"
                >
                  <el-button type="primary" :icon="CircleCheck" disabled>提交审核结论</el-button>
                </el-tooltip>
                <el-button v-else type="primary" :icon="CircleCheck" @click="runAudit" :loading="loading.audit">提交审核结论</el-button>
                <el-tooltip
                  v-if="!canPush"
                  effect="dark"
                  placement="top"
                  :content="pushDisabledHint"
                >
                  <el-button type="success" :icon="Top" disabled>审核通过后，一键推送到 NAS「执行资料/报告」</el-button>
                </el-tooltip>
                <el-button
                  v-else
                  type="success"
                  :icon="Top"
                  @click="runPushToNas"
                  :loading="loading.pushNas"
                >
                  审核通过后，一键推送到 NAS「执行资料/报告」
                </el-button>
              </div>
              <div v-if="!!activeRun.audit || !canPush" style="margin-top:8px;padding:0 8px;">
                <div v-if="!!activeRun.audit" style="color:#dc2626;font-size:12px;">⚠️ {{ auditSubmitDisabledHint }}</div>
                <div v-if="!canPush" style="color:#dc2626;font-size:12px;margin-top:6px;">⚠️ {{ pushDisabledHint }}</div>
              </div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>

  <el-dialog
    v-model="reportPreviewVisible"
    title="报告预览 - 检查和修改确认"
    width="92%"
    top="5vh"
    :close-on-click-modal="false"
    :append-to-body="false"
    destroy-on-close
  >
    <el-alert
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom:12px;"
      title="💡 如何修改报告：如发现内容需要调整，点左侧「重新生成」或回到上一步骤修改数据（包括人工确认表、推荐模板）后再重新生成。DOCX 文件可在浏览器内嵌预览，也可点「⬇ 下载到本地修改后重新上传替换」。"
    />
    <div style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;">
      <div style="font-size:13px;color:#475569;">
        共 {{ reportDocxFiles.length }} 个最终报告 DOCX，点击下方 Tab 切换预览
      </div>
      <div>
        <template v-if="reportDocxFiles[reportPreviewActiveIdx]">
          <el-button
            size="default"
            type="primary"
            plain
            :icon="Download"
            :href="reportApi.download(activeRunId, reportDocxFiles[reportPreviewActiveIdx].id || reportDocxFiles[reportPreviewActiveIdx].name)"
            target="_self"
          >
            ⬇ 下载当前报告
          </el-button>
        </template>
        <el-button size="default" @click="reportPreviewVisible = false">
          关闭预览
        </el-button>
      </div>
    </div>
    <el-tabs v-model="reportPreviewActiveIdx" type="card">
      <el-tab-pane
        v-for="(f, i) in reportDocxFiles"
        :key="(f.id || f.name || f.path) + '-' + i"
        :label="f.name || ('报告 ' + (i + 1))"
        :name="i"
      >
        <iframe
          v-if="f"
          :src="reportApi.download(activeRunId, f.id || f.name || f.path) + '#toolbar=1&navpanes=1'"
          style="width:100%;height:72vh;border:1px solid #e2e8f0;border-radius:6px;background:#fff;"
        />
      </el-tab-pane>
    </el-tabs>
  </el-dialog>

  <el-dialog
    v-model="manualEditorVisible"
    title="人工确认表 - 在线预览 / 编辑"
    width="92%"
    top="5vh"
    :close-on-click-modal="false"
    :append-to-body="false"
    destroy-on-close
  >
    <el-alert
      type="info"
      :closable="false"
      show-icon
      style="margin-bottom:12px;"
      title="编辑规则：绿色字段均可以直接点击修改。表格（红线坐标 / 勘探单元 / 标准孔与剖线 / 遗迹信息 / 图片清单）支持在底部点「+ 新增一行」或右侧「删除」按钮。完成全部修改后，点右下角「确认修改完毕，生成 Smart 表单进入下一步」。"
    />
    <el-tabs v-if="manualEditorSheets.length > 0" v-model="activeEditorSheet">
      <el-tab-pane
        v-for="(sheet, si) in manualEditorSheets"
        :key="sheet.name + '-' + si"
        :label="sheet.name + (sheet.type === 'kv' ? '（字段填写）' : '（表格编辑）')"
        :name="String(si)"
      >
        <!-- KV 两列表 -->
        <el-table
          v-if="sheet.type === 'kv'"
          :data="sheet.rows"
          border
          stripe
          size="default"
          style="width:100%;max-height:70vh;"
          height="70vh"
          :header-cell-style="{ background:'#f1f5f9', color:'#0f172a', fontWeight:'600' }"
        >
          <el-table-column label="字段" width="32%" prop="field">
            <template #default="{ row }">
              <span style="color:#475569;">{{ row.field || '' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="值（可直接点击编辑）" prop="value">
            <template #default="{ row }">
              <el-input
                v-model="row.value"
                placeholder="请输入此字段的值"
                size="default"
                clearable
                type="textarea"
                :autosize="{ minRows:1, maxRows:4 }"
              />
            </template>
          </el-table-column>
        </el-table>

        <!-- 动态列表格 -->
        <template v-else>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span class="hint" style="margin:0;">
              表头列共 {{ sheet.headers.length }} 列，当前数据行 {{ sheet.rows.length }} 行。
            </span>
            <el-button size="default" type="primary" plain :icon="Plus" @click="addEditorTableRow(si)">＋ 新增一行</el-button>
          </div>
          <el-table
            :data="sheet.rows"
            border
            stripe
            size="default"
            style="width:100%;max-height:63vh;"
            height="63vh"
            :header-cell-style="{ background:'#f1f5f9', color:'#0f172a', fontWeight:'600' }"
          >
            <el-table-column label="#" type="index" width="56" align="center" />
            <el-table-column
              v-for="(h, hi) in sheet.headers"
              :key="h + '-' + hi"
              :label="h || ('列' + (hi + 1))"
              :min-width="Math.max(120, 860 / Math.max(sheet.headers.length, 1))"
            >
              <template #default="{ row }">
                <el-input v-model="row[hi]" :placeholder="h || '请输入'" size="default" clearable />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="92" align="center" fixed="right">
              <template #default="scope">
                <el-button type="danger" text size="small" @click="removeEditorTableRow(si, scope.$index)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </template>
      </el-tab-pane>
    </el-tabs>
    <el-empty
      v-else-if="!loading.manualEditor"
      description="未加载到人工确认表数据（请先点「生成人工确认表」按钮）"
      :image-size="100"
    />

    <template #footer>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;">
        <div>
          <el-button
            :icon="Download"
            size="default"
            :href="reportApi.download(activeRunId, 'manual')"
            target="_self"
          >
            ⬇️ 下载备份（原表 xlsx）
          </el-button>
        </div>
        <div>
          <el-button @click="manualEditorVisible = false">取消编辑</el-button>
          <el-button
            type="primary"
            size="default"
            :icon="CircleCheck"
            :loading="loading.submitManualEditor"
            @click="submitManualEditor"
          >
            确认修改完毕，生成 Smart 表单进入下一步
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Reading, Tickets, Document, Refresh, Plus, Collection, FolderOpened, RefreshLeft,
  Check, ArrowRight, ArrowLeft, Search, DocumentAdd, Download, Upload, UploadFilled, MagicStick,
  Avatar, User, Clock, Promotion, CircleCheck, Close, Top, Edit, View
} from '@element-plus/icons-vue';
import { reportApi } from '../../api';

const loading = ref({
  refresh: false, skills: false, nas: false, runs: false,
  preflight: false, prepare: false, buildSmart: false, recommend: false,
  timeline: false, generate: false, audit: false, pushNas: false,
  manualEditor: false, submitManualEditor: false
});
const skillType = ref('report');
const doctor = ref({ plan: null, report: null });
const nasTree = ref([]);
const nasProjects = ref([]);
const nasMountError = ref('');
const runs = ref([]);
const activeRunId = ref(null);
const activeStepIdx = ref(0);
const pickedProjectPath = ref('');
const manualUploadFile = ref(null);
const personnelSet = ref('');
const auditPassed = ref(true);
const auditComment = ref('');
const manualEditorVisible = ref(false);
const manualEditorSheets = ref([]);
const activeEditorSheet = ref('0');
const reportPreviewVisible = ref(false);
const reportPreviewActiveIdx = ref(0);

const stepTitles = [
  '1. 选 NAS 项目',
  '2. 预检',
  '3. 生成人工确认表（下载）',
  '4. 你在 Excel 编辑',
  '5. 上传 xlsx + 生成 Smart 表单',
  '6. 推荐模板 + 时间线门禁',
  '7. 匹配 + 门禁确认',
  '8. 生成产物',
  '9. 下载 & 检查',
  '10. 人工审核 → 推 NAS'
];

const doctorType = computed(() => {
  const cur = doctor.value && doctor.value[skillType.value];
  if (!cur) return 'warn';
  return cur.ok ? 'ok' : 'danger';
});
const doctorText = computed(() => {
  const cur = doctor.value && doctor.value[skillType.value];
  if (!cur) return 'Skill 自检中…';
  if (cur.ok) return 'Skill 自检通过';
  return 'Skill 自检失败，点开日志排查';
});
const activeRun = computed(() => runs.value.find((r) => r.id === activeRunId.value) || null);

function currentStepOf(r) {
  if (!r || !r.steps) return 0;
  if (r.steps.pushedToNas && r.steps.pushedToNas.ok) return 9;
  if (r.audit) return 9;
  if (r.steps.generated && r.steps.generated.ok) return 8;
  if (r.steps.timelineValidated && r.steps.recommended && r.steps.recommended.ok) return 6;
  if (r.steps.smartFormBuilt && r.steps.smartFormBuilt.ok) return 4;
  if (r.steps.prepared && r.steps.prepared.ok) return 2;
  if (r.steps.preflight && r.steps.preflight.ok) return 1;
  return 0;
}

watch(activeRun, (v) => {
  if (!v) { activeStepIdx.value = 0; return; }
  activeStepIdx.value = currentStepOf(v);
  personnelSet.value = v.personnelSet || '';
  if (v.audit) { auditPassed.value = !!v.audit.passed; auditComment.value = v.audit.comment || ''; }
  if (v.nasProjectPath && !pickedProjectPath.value) pickedProjectPath.value = v.nasProjectPath;
}, { immediate: true });

const canStartStep1 = computed(() => !!pickedProjectPath.value);

const manualReadyForEdit = computed(() => {
  const r = activeRun.value;
  if (!r || !r.steps || !r.steps.prepared || !r.steps.prepared.ok) return false;
  return !!r.manualFormPath;
});

const smartFormAlreadyBuilt = computed(() => {
  const r = activeRun.value;
  if (!r || !r.steps) return false;
  return !!(r.steps.smartFormBuilt && r.steps.smartFormBuilt.ok);
});

const generateDisabledHint = computed(() => {
  const r = activeRun.value;
  if (!r || !r.steps) return '请先完成前面的步骤';
  const rec = r.steps.recommended;
  const tl = r.steps.timelineValidated;
  const recOk = !!(rec && rec.ok);
  const tlOk = !!(tl && tl.ok);
  if (!rec && !tl) return '请先点击「运行人员+模板匹配」和「运行时间线门禁」，两项都通过后才能生成';
  if (!recOk && !tlOk) {
    if (!rec && tlOk) return '请先点击「运行人员+模板匹配」匹配模板（时间线门禁已通过）';
    if (recOk && !tl) return '请先点击「运行时间线门禁」通过门禁（模板已匹配成功）';
    return '请先完成「运行人员+模板匹配」和「运行时间线门禁」，两项都通过后才能生成';
  }
  if (!recOk) return '「运行人员+模板匹配」未通过，无法生成。请先点击「运行人员+模板匹配」重新匹配';
  if (!tlOk) return '「时间线门禁」未通过，无法生成。请先点击「运行时间线门禁」重新检查';
  return '';
});

const auditNextDisabledHint = computed(() => {
  const r = activeRun.value;
  if (!r || !r.steps || !r.steps.generated) return '请先点击「重新生成」按钮生成 DOCX 报告 + QA 检查报告，生成成功后即可进入人工审核';
  if (!r.steps.generated.ok) return '上一次生成失败，请先点击「重新生成」按钮重新生成，成功后即可进入人工审核';
  return '';
});

const auditSubmitDisabledHint = computed(() => {
  if (activeRun.value && activeRun.value.audit) {
    return '已提交过审核结论，不能重复提交。如需修改请点击右上角「重置本次任务」';
  }
  return '';
});

const pushDisabledHint = computed(() => {
  const r = activeRun.value;
  if (!r || !r.audit) return '请先在上方勾选「审核通过 / 审核驳回」并填写意见，点击「提交审核结论」，提交成功后才能推送';
  if (r.audit && r.audit.passed !== true) return '当前审核结论为「驳回」，只有审核通过的报告才能推送到 NAS';
  return '';
});

const canPush = computed(() => {
  return activeRun.value && activeRun.value.audit && activeRun.value.audit.passed === true;
});

const reportDocxFiles = computed(() => {
  const r = activeRun.value;
  if (!r || !r.outputs || !r.outputs.length) return [];
  return r.outputs.filter((o) => o.kind === 'report-docx');
});

function openReportPreview(row) {
  const list = reportDocxFiles.value || [];
  if (!list.length) {
    ElMessage.warning('当前没有可预览的最终报告 DOCX，请先点击「重新生成」生成报告');
    return;
  }
  let idx = 0;
  if (row) {
    const hit = list.findIndex((f) =>
      (row.id && f.id === row.id) || (row.name && f.name === row.name) || (row.path && f.path === row.path)
    );
    if (hit >= 0) idx = hit;
  }
  reportPreviewActiveIdx.value = idx;
  reportPreviewVisible.value = true;
}

function stepReady(stepNumber) {
  if (!activeRun.value || !activeRun.value.steps) return false;
  if (stepNumber === 2) return !!activeRun.value.steps.preflight && !!activeRun.value.steps.preflight.ok;
  if (stepNumber === 4) return !!activeRun.value.steps.prepared && !!activeRun.value.steps.prepared.ok;
  if (stepNumber === 6) return !!activeRun.value.steps.smartFormBuilt && !!activeRun.value.steps.smartFormBuilt.ok;
  if (stepNumber === 8) {
    return !!(activeRun.value.steps.recommended && activeRun.value.steps.recommended.ok
          && activeRun.value.steps.timelineValidated && activeRun.value.steps.timelineValidated.ok);
  }
  if (stepNumber === 9) return !!activeRun.value.steps.generated && !!activeRun.value.steps.generated.ok;
  return false;
}

function fmtDate(v) {
  if (!v) return '';
  try {
    const d = new Date(v);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch (_) { return String(v); }
}
function formatSize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB';
  return (b / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}
function kindTag(k) {
  return ({
    'report-docx': 'success', 'qa-report': 'warning', 'smart-form': '',
    'manual-form': 'info', 'spreadsheet': 'info', 'text': '', 'other': ''
  })[k] || '';
}
function kindLabel(k) {
  return ({
    'report-docx': '最终报告/计划 DOCX',
    'qa-report': 'QA 专项检查报告',
    'smart-form': 'Smart 表单',
    'manual-form': '人工确认表',
    'spreadsheet': '表格',
    'text': '文本',
    'other': '其他'
  })[k] || k;
}

function goPrevStep() {
  if (activeStepIdx.value <= 0) { ElMessage.info('已经是第 1 步（选 NAS 项目），没有上一步可返回'); return; }
  const validStepIndexes = [0, 1, 2, 4, 6, 7, 8, 9];
  const curPos = validStepIndexes.indexOf(activeStepIdx.value);
  if (curPos <= 0) { activeStepIdx.value = validStepIndexes[0]; return; }
  const target = validStepIndexes[curPos - 1];
  activeStepIdx.value = target;
  ElMessage.info('已回到上一步（第 ' + (target + 1) + ' 步：' + (stepTitles[target] || '') + '）');
}

function onSkillTypeChange() {
  activeStepIdx.value = 0;
  manualUploadFile.value = null;
  auditPassed.value = true;
  auditComment.value = '';
}

async function refreshAll() {
  try {
    loading.value.refresh = true;
    await Promise.all([loadSkillsDoctor(), loadNasProjects(), loadRuns()]);
  } finally {
    loading.value.refresh = false;
  }
}

async function loadSkillsDoctor() {
  try {
    loading.value.skills = true;
    const r = await reportApi.skillsStatus();
    doctor.value = {
      plan: { ok: !!(r.skills && r.skills.plan && r.skills.plan.ok), raw: r.skills && r.skills.plan },
      report: { ok: !!(r.skills && r.skills.report && r.skills.report.ok), raw: r.skills && r.skills.report }
    };
  } catch (e) {
    ElMessage.error('Skill 自检失败：' + e.message);
  } finally {
    loading.value.skills = false;
  }
}
async function loadNasProjects() {
  try {
    loading.value.nas = true;
    const r = await reportApi.listNasProjects();
    nasTree.value = (r.tree || []).map(transformTreeNode);
    nasProjects.value = r.projects || [];
    nasMountError.value = r.mountError || '';
    if (r.mounted === false && nasMountError.value) {
      ElMessage.warning('NAS 未挂载或未配置：' + nasMountError.value);
    }
    if (!pickedProjectPath.value && nasProjects.value.length) {
      pickedProjectPath.value = nasProjects.value[0].absolutePath;
    }
  } catch (e) {
    nasMountError.value = e.message;
    ElMessage.error('获取 NAS 项目列表失败：' + e.message);
  } finally {
    loading.value.nas = false;
  }
}
function transformTreeNode(n) {
  return {
    name: n.name,
    absolutePath: n.absolutePath,
    relativePath: n.relativePath,
    isDir: n.isDir !== false,
    children: (n.children || []).map(transformTreeNode)
  };
}
async function loadRuns() {
  try {
    loading.value.runs = true;
    const r = await reportApi.listRuns();
    runs.value = (r.runs || []).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    if (!activeRunId.value && runs.value.length) activeRunId.value = runs.value[0].id;
  } catch (e) {
    ElMessage.error('加载任务列表失败：' + e.message);
  } finally {
    loading.value.runs = false;
  }
}
function selectRun(id) { activeRunId.value = id; nextTick(() => { const r = activeRun.value; if (r) activeStepIdx.value = currentStepOf(r); }); }

function startNewRun() {
  activeRunId.value = null;
  manualUploadFile.value = null;
  personnelSet.value = '';
  auditPassed.value = true;
  auditComment.value = '';
  activeStepIdx.value = 0;
  if (nasProjects.value.length && !pickedProjectPath.value) pickedProjectPath.value = nasProjects.value[0].absolutePath;
}

async function createRunFromPicked() {
  if (!pickedProjectPath.value) return ElMessage.warning('请先选择 NAS 里的项目源目录');
  try {
    const r = await reportApi.createRun({
      skillType: skillType.value,
      nasProjectPath: pickedProjectPath.value,
      name: skillType.value === 'plan' ? `[工作计划] ${(nasProjects.value.find(p => p.absolutePath === pickedProjectPath.value) || {}).name || '未命名'}`
                                  : `[成果报告] ${(nasProjects.value.find(p => p.absolutePath === pickedProjectPath.value) || {}).name || '未命名'}`
    });
    runs.value.unshift(r.run);
    activeRunId.value = r.run.id;
    activeStepIdx.value = 1;
    ElMessage.success('✅ 任务创建成功，开始预检');
    await runStepPreflight();
  } catch (e) {
    ElMessage.error('创建任务失败：' + e.message);
  }
}

async function updateRunProjectAndGo() {
  if (!activeRunId.value || !pickedProjectPath.value) return;
  try {
    activeStepIdx.value = 1;
    ElMessage.success('✅ 已确认项目，开始预检');
    await runStepPreflight();
  } catch (e) {
    ElMessage.error('进入预检失败：' + e.message);
  }
}

async function runStepPreflight() {
  if (!activeRunId.value) return;
  try {
    loading.value.preflight = true;
    const r = await reportApi.runPreflight(activeRunId.value);
    await refreshRun();
    if (r.ok) ElMessage.success('✅ 预检通过');
    else ElMessage.warning('预检存在警告/错误，请查看日志：' + ((r.result && r.result.stderrTail) || ''));
  } catch (e) {
    ElMessage.error('预检失败：' + e.message);
  } finally {
    loading.value.preflight = false;
  }
}
async function runStepPrepare() {
  if (!activeRunId.value) return;
  try {
    loading.value.prepare = true;
    const r = await reportApi.runPrepare(activeRunId.value);
    await refreshRun();
    if (r.ok) ElMessage.success('✅ 人工确认表已生成，点「在线预览/编辑」直接修改，或下载后 Excel 编辑');
    else ElMessage.warning('生成人工确认表异常：' + (r.manualFormPath ? '（但仍可尝试下载）' : (r.error || '')));
  } catch (e) {
    ElMessage.error('生成人工确认表失败：' + e.message);
  } finally {
    loading.value.prepare = false;
  }
}

async function openManualEditor() {
  if (!activeRunId.value) return;
  try {
    loading.value.manualEditor = true;
    manualEditorSheets.value = [];
    activeEditorSheet.value = '0';
    const r = await reportApi.getManualJson(activeRunId.value);
    if (!r || !r.ok || !r.data || !Array.isArray(r.data.sheets)) {
      ElMessage.error('加载人工确认表失败：' + ((r && r.error) || '返回结构异常'));
      return;
    }
    manualEditorSheets.value = JSON.parse(JSON.stringify(r.data.sheets));
    manualEditorVisible.value = true;
  } catch (e) {
    ElMessage.error('加载人工确认表失败：' + e.message);
  } finally {
    loading.value.manualEditor = false;
  }
}

function addEditorTableRow(sheetIdx) {
  const sheet = manualEditorSheets.value[sheetIdx];
  if (!sheet || sheet.type !== 'table') return;
  const cols = (sheet.headers || []).length;
  const newRow = new Array(Math.max(cols, 1)).fill('');
  sheet.rows = sheet.rows || [];
  sheet.rows.push(newRow);
}
function removeEditorTableRow(sheetIdx, rowIdx) {
  const sheet = manualEditorSheets.value[sheetIdx];
  if (!sheet || !Array.isArray(sheet.rows) || rowIdx < 0 || rowIdx >= sheet.rows.length) return;
  sheet.rows.splice(rowIdx, 1);
}

async function submitManualEditor() {
  if (!activeRunId.value || !manualEditorSheets.value.length) return;
  try {
    loading.value.submitManualEditor = true;
    const sheets = manualEditorSheets.value.map((s) => {
      if (s.type === 'kv') {
        return {
          name: s.name,
          type: 'kv',
          rows: (s.rows || []).map((r) => ({ field: r.field || '', value: r.value != null ? String(r.value) : '' }))
        };
      }
      return {
        name: s.name,
        type: 'table',
        headers: (s.headers || []).map((h) => (h == null ? '' : String(h))),
        rows: (s.rows || []).map((row) => {
          const cols = (s.headers || []).length;
          const out = new Array(cols).fill('');
          for (let i = 0; i < cols; i++) {
            if (row && row[i] != null) out[i] = String(row[i]);
          }
          return out;
        })
      };
    });
    const r = await reportApi.updateManualAndBuild(activeRunId.value, { sheets });
    await refreshRun();
    if (r && r.ok) {
      ElMessage.success('✅ 已写回人工确认表并生成 Smart 表单，自动跳转到下一步（推荐模板 + 门禁）');
      manualEditorVisible.value = false;
      manualEditorSheets.value = [];
      // 强制跳到第 6 步（推荐模板），不再依赖 stepReady(6) 的时序判断
      // （如果 smartFormBuilt 真的没成功，第 6 步的「生成推荐 + 时间线门禁」按钮会自动 disabled，不会让你走下去）
      await nextTick();
      activeStepIdx.value = 6;
      ElMessage.success('已自动进入第 6 步：请直接选择人员配置方案，点击「生成推荐 + 执行时间线门禁」');
    } else {
      ElMessage.warning('构建 Smart 表单异常：' + ((r && r.error) || '未知错误'));
    }
  } catch (e) {
    ElMessage.error('保存失败：' + e.message);
  } finally {
    loading.value.submitManualEditor = false;
  }
}

function onManualChange(file) { manualUploadFile.value = file && file.raw ? file.raw : file; }

async function runBuildSmart() {
  if (!activeRunId.value || !manualUploadFile.value) return;
  try {
    loading.value.buildSmart = true;
    const r = await reportApi.uploadManualForm(activeRunId.value, manualUploadFile.value);
    await refreshRun();
    if (r.ok) {
      ElMessage.success('✅ Smart 表单生成成功，下一步推荐模板+门禁');
      activeStepIdx.value = 6;
    } else {
      ElMessage.warning('Smart 表单生成异常：' + (r.error || ''));
    }
  } catch (e) {
    ElMessage.error('上传并构建 Smart 表单失败：' + e.message);
  } finally {
    loading.value.buildSmart = false;
  }
}

async function runRecommend() {
  if (!activeRunId.value) return;
  try {
    loading.value.recommend = true;
    await reportApi.recommend(activeRunId.value, personnelSet.value || undefined);
    await refreshRun();
    const rec = activeRun.value.steps.recommended;
    if (rec && rec.ok) ElMessage.success(rec.matchedTemplate ? ('✅ 已匹配模板：' + rec.matchedTemplate) : '✅ 推荐完成');
    else ElMessage.warning('推荐结果异常，请查看日志');
  } catch (e) {
    ElMessage.error('推荐失败：' + e.message);
  } finally {
    loading.value.recommend = false;
  }
}
async function runTimeline() {
  if (!activeRunId.value) return;
  try {
    loading.value.timeline = true;
    const r = await reportApi.validateTimeline(activeRunId.value);
    await refreshRun();
    if (r.ok) ElMessage.success('✅ 时间线门禁通过');
    else ElMessage.error('❌ 时间线门禁不通过（日期或照片水印冲突），必须修改人工确认表后重新上传');
  } catch (e) {
    ElMessage.error('时间线门禁失败：' + e.message);
  } finally {
    loading.value.timeline = false;
  }
}
async function runGenerate() {
  if (!activeRunId.value) return;
  try {
    loading.value.generate = true;
    const r = await reportApi.generate(activeRunId.value, true);
    await refreshRun();
    if (r.ok) ElMessage.success('✅ 生成成功！产物 ' + (r.outputs || []).length + ' 个');
    else ElMessage.warning('生成异常：' + (r.error || '查看后端日志'));
  } catch (e) {
    ElMessage.error('生成失败：' + e.message);
  } finally {
    loading.value.generate = false;
  }
}
async function runAudit() {
  if (!activeRunId.value) return;
  try {
    loading.value.audit = true;
    await reportApi.audit(activeRunId.value, { passed: !!auditPassed.value, comment: auditComment.value });
    await refreshRun();
    if (auditPassed.value) {
      ElMessage.success('✅ 审核通过，接下来点「推送到 NAS」按钮归档到执行资料/报告');
    } else {
      ElMessage.warning('已驳回，请修改资料或人工确认表后重新上传生成');
    }
  } catch (e) {
    ElMessage.error('审核失败：' + e.message);
  } finally {
    loading.value.audit = false;
  }
}
async function runPushToNas() {
  if (!activeRunId.value) return;
  try {
    await ElMessageBox.confirm(
      '即将把审核通过的报告/计划推送到 NAS 项目目录下的「执行资料/报告」子目录中，是否继续？',
      '推送到 NAS 确认',
      { confirmButtonText: '确认推送', cancelButtonText: '取消', type: 'success' }
    );
    loading.value.pushNas = true;
    const r = await reportApi.pushToNas(activeRunId.value);
    await refreshRun();
    ElMessage.success('✅ 已成功推送 ' + (r.push.files || []).length + ' 个文件到 NAS：' + r.push.targetFolder);
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('推送 NAS 失败：' + e.message);
  } finally {
    loading.value.pushNas = false;
  }
}

async function refreshRun() {
  if (!activeRunId.value) return;
  const r = await reportApi.getRun(activeRunId.value);
  const idx = runs.value.findIndex((x) => x.id === r.run.id);
  if (idx >= 0) runs.value.splice(idx, 1, r.run);
  else runs.value.unshift(r.run);
}

async function resetActiveRun() {
  if (!activeRunId.value) return;
  try {
    await ElMessageBox.confirm('确定要重置本次任务吗？当前进度会清空，但 run 记录保留。', '确认重置', { type: 'warning' });
    await reportApi.resetRun(activeRunId.value);
    manualUploadFile.value = null;
    personnelSet.value = '';
    auditPassed.value = true;
    auditComment.value = '';
    await refreshRun();
    activeStepIdx.value = 0;
    ElMessage.success('✅ 已重置');
  } catch (e) {
    if (e !== 'cancel') ElMessage.error('重置失败：' + e.message);
  }
}

function openNasDir() {
  if (!activeRun.value || !activeRun.value.nasProjectPath) return;
  ElMessage.info('（Mac 下）在 Finder 里 ⌘+⇧+G，粘贴：' + activeRun.value.nasProjectPath);
}

onMounted(() => { refreshAll(); });
</script>

<script>
const ResultBox = {
  props: {
    result: Object, ok: Boolean, title: { type: String, default: '执行结果' }
  },
  template: `
    <div style="margin-top:14px;border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;background:#fafbfc;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
        <strong style="color:#0f172a;">{{ title }}</strong>
        <el-tag size="small" :type="ok ? 'success' : (ok===false ? 'danger' : 'info')">
          {{ ok ? '✅ 通过' : (ok===false ? '❌ 失败' : '⏳ 未执行') }}
        </el-tag>
      </div>
      <details style="color:#4b5563;font-size:12px;" v-if="result && (result.result && (result.result.stdoutTail || result.result.stderrTail || result.result.error))">
        <summary style="cursor:pointer;margin-bottom:4px;">展开日志（stdout / stderr / error）</summary>
        <pre style="white-space:pre-wrap;word-break:break-all;margin:4px 0 0;background:#f3f4f6;padding:8px 10px;border-radius:6px;max-height:320px;overflow:auto;">
<span v-if="result.result && result.result.error">❌ ERROR：{{ result.result.error }}</span>
<span v-if="result.result && result.result.stdoutTail" style="color:#1f2937;">&#10;STDOUT：&#10;{{ result.result.stdoutTail }}</span>
<span v-if="result.result && result.result.stderrTail" style="color:#b91c1c;">&#10;STDERR：&#10;{{ result.result.stderrTail }}</span>
        </pre>
      </details>
      <div v-else style="color:#9ca3af;font-size:12px;">尚未运行对应步骤，点下方按钮开始执行。</div>
    </div>
  `
};
export default { components: { ResultBox } };
</script>

<style scoped>
.admin-report-page { padding: 6px 16px 18px; }
.page-header { padding: 10px 8px 12px; }
.page-header h1 { margin: 0 0 4px; font-size: 20px; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 6px; }
.page-header .sub { color: #6b7280; font-size: 13px; }

.top-actions {
  display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;
  gap: 10px; padding: 10px 14px; background: #fff; border-radius: 10px;
  border: 1px solid #e5e7eb; margin-bottom: 14px;
}
.type-switch { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.right-actions { display: flex; gap: 8px; flex-wrap: wrap; }

.runs-col .runs-card { min-height: 640px; }
.run-item {
  padding: 10px 12px; border-radius: 8px; border: 1px solid transparent;
  cursor: pointer; margin-bottom: 6px; transition: all 0.15s ease;
}
.run-item:hover { background: #f8fafc; border-color: #e5e7eb; }
.run-item.active { background: #eff6ff; border-color: #bfdbfe; }
.ri-top { display: flex; align-items: center; margin-bottom: 4px; }
.ri-name { font-weight: 600; color: #111827; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ri-meta { display: flex; justify-content: space-between; font-size: 12px; color: #6b7280; gap: 6px; flex-wrap: wrap; }
.ri-step { color: #2563eb; font-weight: 500; }
.empty { padding: 32px 0; color: #9ca3af; text-align: center; font-size: 13px; }

.detail-card .el-steps { padding: 12px 8px 20px; }
.step-body { padding: 4px 8px 10px; }
.step-card {
  background: #fff; border: 1px solid #eef2f7; border-radius: 12px; padding: 18px 18px 16px;
  margin-bottom: 14px;
}
.step-card h3 { margin: 0 0 8px; font-size: 16px; color: #0f172a; }
.step-card .hint { color: #6b7280; font-size: 13px; margin-bottom: 12px; }
.step-actions { margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap; }

.two-col { display: grid; grid-template-columns: 1fr 1.2fr; gap: 12px; margin-top: 6px; }
.sub-card {
  border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; background: #fafbfc;
}
.sub-card h4 { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #1f2937; }
.manual-upload { margin-top: 6px; }
.manual-upload :deep(.el-upload-dragger) { padding: 18px 12px; }
.audit-form { margin-top: 6px; }
.audit-info { padding: 8px 0 12px; }
.push-info { margin-top: 14px; }
.outputs-list { margin-top: 14px; }
.outputs-list h4 { margin: 0 0 8px; color: #111827; }

@media (max-width: 1200px) {
  .runs-col .el-col { width: 28%; }
  .detail-col .el-col { width: 72%; }
  .two-col { grid-template-columns: 1fr; }
}
@media (max-width: 900px) {
  .main-grid > .el-col { width: 100% !important; }
}
</style>
