<template>
  <div>
    <div class="page-header">
      <h1>
        <el-icon v-if="nasViewMode==='jobs'"><Upload /></el-icon>
        <el-icon v-else><FolderOpened /></el-icon>
        <template v-if="nasViewMode==='jobs'"> 待上传 NAS（平台 → NAS）</template>
        <template v-else> NAS 归档浏览（NAS → 平台）</template>
      </h1>
      <div class="sub" v-if="nasViewMode==='jobs'">确认文件已推送至 NAS，或点击「直连推送」自动拷贝到挂载的共享盘</div>
      <div class="sub" v-else>直接浏览 NAS 挂载盘中归档文件，查看并下载</div>
    </div>

    <div class="section-card" style="display: flex; flex-direction: column; gap: 14px;">
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        <el-radio-group v-model="nasViewMode" size="default">
          <el-radio-button value="jobs">
            <span style="display:inline-flex;align-items:center;gap:6px;">
              <el-icon><Upload /></el-icon>
              待上传（平台→NAS）
            </span>
          </el-radio-button>
          <el-radio-button value="browse">
            <span style="display:inline-flex;align-items:center;gap:6px;">
              <el-icon><FolderOpened /></el-icon>
              NAS 浏览（NAS→平台）
            </span>
          </el-radio-button>
        </el-radio-group>

        <div style="margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <span
            v-if="nasStatus && nasStatus.configured"
            class="text-sm"
          >
            NAS：
            <el-tag
              :type="nasStatus.writable ? 'success' : (nasStatus.exists ? 'warning' : 'danger')"
              size="small"
              effect="plain"
            >
              {{ nasStatus.writable ? '✅ 可读写' : (nasStatus.exists ? '⚠️ 不可写' : '❌ 未挂载') }}
            </el-tag>
          </span>
          <span v-if="nasHeartbeat && nasHeartbeat.configured" class="text-sm" style="display: inline-flex; align-items: center; gap: 6px;">
            <el-tooltip
              v-if="nasHeartbeat.lastCheckAt"
              effect="dark"
              placement="bottom"
            >
              <template #content>
                <div style="line-height: 1.7;">
                  <div>后端心跳检测间隔：每 {{ nasHeartbeat.intervalMinutes || 20 }} 分钟</div>
                  <div>最近检测时间：{{ nasHeartbeat.lastCheckAt ? new Date(nasHeartbeat.lastCheckAt).toLocaleString() : '-' }}</div>
                  <div v-if="nasHeartbeat.lastOnlineAt">最近在线时间：{{ new Date(nasHeartbeat.lastOnlineAt).toLocaleString() }}</div>
                  <div v-if="nasHeartbeat.lastOfflineAt">最近离线时间：{{ new Date(nasHeartbeat.lastOfflineAt).toLocaleString() }}</div>
                  <div>连续成功：{{ nasHeartbeat.consecutiveSuccesses || 0 }} 次</div>
                  <div>连续失败：{{ nasHeartbeat.consecutiveFailures || 0 }} 次</div>
                  <div v-if="nasHeartbeat.lastProbe?.probeMessage" style="max-width: 280px;">详情：{{ nasHeartbeat.lastProbe.probeMessage }}</div>
                </div>
              </template>
              <el-tag
                size="small"
                effect="light"
                :type="nasHeartbeat.online ? 'success' : (nasHeartbeat.online === null ? 'info' : 'danger')"
                style="cursor: help;"
              >
                <span style="display: inline-flex; align-items: center; gap: 4px;">
                  <span :style="{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%',
                    background: nasHeartbeat.online ? '#10b981' : (nasHeartbeat.online === null ? '#94a3b8' : '#ef4444'),
                    boxShadow: nasHeartbeat.online ? '0 0 0 2px rgba(16,185,129,0.18)' : 'none'
                  }"></span>
                  心跳 {{ nasHeartbeat.online ? '正常' : (nasHeartbeat.online === null ? '检测中' : '掉线') }}
                </span>
              </el-tag>
            </el-tooltip>
            <el-button
              link
              type="primary"
              size="small"
              :icon="Refresh"
              @click="pollNasHeartbeat({ force: true })"
              style="font-size: 12px; padding: 0;"
            >立即检测</el-button>
          </span>
          <span v-else style="color: #94a3b8; font-size: 12px;">
            · 未配置 NAS 挂载路径（先点右侧「NAS 设置」填写）
          </span>
          <el-button :icon="Setting" size="small" @click="openNasSettings">NAS 设置</el-button>
        </div>
      </div>

      <div v-if="nasViewMode==='jobs'" style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
        <div class="text-sm">
          共 <b>{{ totalJobs }}</b> 个任务，待确认 <b>{{ totalPrepared }}</b> 个，已归档 <b>{{ totalUploaded }}</b> 个
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <el-button
            type="success"
            :icon="UploadFilled"
            :loading="pushAllLoading"
            :disabled="totalPrepared === 0"
            size="small"
            @click="handlePushAll"
          >
            🚀 一键推送所有已确认到 NAS
          </el-button>
          <el-button size="small" :icon="Refresh" @click="loadData">刷新</el-button>
        </div>
      </div>

      <div v-else style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
        <div class="text-sm" v-if="scanResult">
          共扫描 <b>{{ scanResult.total }}</b> 个文件，
          <span style="color:#059669;"><b>{{ scanResult.nas_and_db_count || 0 }}</b> 个已在平台登记</span>，
          <span style="color:#64748b;"><b>{{ scanResult.nas_only_count || 0 }}</b> 个仅 NAS 上存在</span>
          <span v-if="scanResult.scanned_at" style="color:#94a3b8;"> · 扫描于 {{ formatDate(scanResult.scanned_at) }}</span>
        </div>
        <div class="text-sm" v-else style="color:#64748b;">点右侧「开始扫描」查看 NAS 当前文件</div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
          <el-input
            v-model="browseQ"
            placeholder="搜索文件名 / 路径 / 项目"
            size="small"
            clearable
            style="width: 260px; max-width: 60vw;"
            @keyup.enter="loadBrowseData()"
          >
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-button
            type="primary"
            :icon="Search"
            size="small"
            :loading="browseLoading"
            @click="loadBrowseData()"
          >
            开始扫描
          </el-button>
          <el-button size="small" :icon="Refresh" @click="loadBrowseData()" :loading="browseLoading">刷新</el-button>
        </div>
      </div>
    </div>

    <template v-if="nasViewMode==='jobs'">
      <div class="section-card" v-if="loading">
        <el-skeleton :rows="5" animated />
      </div>

      <div v-else-if="groups.length === 0" class="section-card" style="text-align: center; padding: 40px 16px;">
        <el-empty description="暂无待上传 NAS 的任务" />
      </div>

    <div v-else>
      <div v-for="group in groups" :key="group.projectId" class="section-card">
        <h2 style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
          <span style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0;">
            <el-icon style="color: #2563eb; flex-shrink: 0;"><Folder /></el-icon>
            <span style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
              <span style="font-size: 18px; font-weight: 600; color: #0f172a;">
                {{ group.projectDisplayName }}
              </span>
              <span
                v-if="group.projectId && !String(group.projectId).startsWith('__unknown_')"
                style="font-size: 12px; color: #94a3b8; font-weight: normal; letter-spacing: 0.2px; word-break: break-all;"
              >
                项目ID：{{ group.projectId }}
              </span>
            </span>
          </span>
          <el-tag size="small" effect="plain" type="info">
            共 {{ group.jobs.length }} 条待上传，
            <span style="color: #d97706;">{{ group.preparedCount }} 条等待确认</span>
          </el-tag>
        </h2>

        <div v-for="job in group.jobs" :key="job.id" class="nas-job-item">
          <div style="display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; align-items: flex-start;">
            <div style="flex: 1; min-width: 200px;">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap;">
                <el-icon style="color: #2563eb; flex-shrink: 0;"><Document /></el-icon>
                <span class="file-name" style="font-size: 16px; font-weight: 600; color: #0f172a;">
                  {{ displayFileName(job) }}
                </span>
                <el-tag
                  v-if="isRenamed(job)"
                  type="success"
                  size="small"
                  effect="light"
                >
                  已重命名
                </el-tag>
                <el-tag
                  v-if="job.status === 'manually_uploaded'"
                  type="success"
                  size="small"
                  effect="light"
                >
                  <el-icon><CircleCheckFilled /></el-icon> 已归档
                </el-tag>
                <el-tag
                  v-else-if="job.status === 'prepared'"
                  type="warning"
                  size="small"
                  effect="light"
                >
                  <el-icon><Clock /></el-icon> 待确认
                </el-tag>
                <el-tag
                  v-else
                  size="small"
                  effect="plain"
                >
                  {{ job.status || '-' }}
                </el-tag>
              </div>

              <div
                v-if="displayFileName(job) !== originalFileName(job)"
                style="font-size: 13px; color: #64748b; margin-bottom: 6px; padding-left: 26px;"
              >
                原上传文件名：<span style="color: #475569;">{{ originalFileName(job) }}</span>
              </div>

              <div class="nas-path-row">
                <span class="nas-path-label">待上传预览路径</span>
                <div class="path-preview" style="margin-top: 2px; font-size: 13px; font-weight: 500; color: #1d4ed8;">
                  {{ finalPathPreview(job, group.projectDisplayName) }}
                </div>
              </div>

              <div class="nas-path-row" v-if="job.ready_absolute_path">
                <span class="nas-path-label" style="color: #94a3b8;">中转区绝对路径</span>
                <div class="path-preview" style="margin-top: 2px; font-size: 12px; color: #64748b; word-break: break-all;">
                  {{ job.ready_absolute_path }}
                </div>
              </div>

              <div style="margin-top: 6px; font-size: 12px; color: #94a3b8; display: flex; align-items: center; flex-wrap: wrap; gap: 6px;">
                <el-icon><Calendar /></el-icon>
                {{ job.status === 'manually_uploaded' ? '归档时间' : '创建时间' }}：
                {{ formatDate(job.status === 'manually_uploaded' ? job.uploaded_at : job.created_at) }}
                <span v-if="job.uploader" class="nas-uploader"> · 整理人：{{ job.uploader }}</span>
                <span style="margin-left: auto; color: #cbd5e1;">
                  文件ID：{{ job.id }}
                </span>
              </div>
            </div>

            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <template v-if="job.status === 'prepared'">
                <el-button
                  :icon="EditPen"
                  :loading="submittingId === job.id + ':rename'"
                  @click="openRenameDialog(job)"
                >
                  修改命名
                </el-button>
                <el-button
                  type="success"
                  :icon="UploadFilled"
                  :loading="submittingId === job.id + ':push'"
                  @click="handlePushOne(job)"
                >
                  🚀 推送本条到 NAS
                </el-button>
                <el-button
                  type="primary"
                  :icon="CircleCheck"
                  :loading="submittingId === job.id"
                  @click="handleConfirm(job)"
                >
                  确认已上传 NAS
                </el-button>
              </template>
              <el-tag
                v-else-if="job.status === 'manually_uploaded'"
                type="success"
                size="default"
                effect="light"
              >
                <el-icon><Check /></el-icon>
                已归档 · {{ formatDate(job.uploaded_at) }}
              </el-tag>
            </div>
          </div>
        </div>
      </div>
    </div>
    </template>

    <template v-else-if="nasViewMode==='browse'">
      <div class="section-card" v-if="browseLoading" style="text-align: center; padding: 20px 16px;">
        <el-skeleton :rows="8" animated />
        <div style="font-size: 13px; color: #64748b; margin-top: 10px;">正在扫描 NAS 目录，请稍候（大型 NAS 可能需要几秒）...</div>
      </div>

      <div v-else-if="!scanResult || browseGroups.length === 0" class="section-card" style="text-align: center; padding: 40px 16px;">
        <el-empty :description="!scanResult ? '尚未开始扫描。点上方「开始扫描」读取 NAS 当前文件' : '当前 NAS 中还没有匹配的文件'">
          <el-button
            type="primary"
            :icon="Search"
            :loading="browseLoading"
            @click="loadBrowseData()"
          >
            {{ !scanResult ? '开始扫描' : '重新扫描' }}
          </el-button>
        </el-empty>
      </div>

      <div v-else>
        <div
          v-for="group in browseGroups"
          :key="group._project"
          class="section-card"
        >
          <h2 style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
            <span style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0;">
              <el-icon style="color: #2563eb; flex-shrink: 0;"><Folder /></el-icon>
              <span style="display: flex; flex-direction: column; gap: 2px; min-width: 0;">
                <span style="font-size: 18px; font-weight: 600; color: #0f172a;">
                  {{ group._name }}
                </span>
                <span style="font-size: 12px; color: #94a3b8; font-weight: normal; letter-spacing: 0.2px; word-break: break-all;">
                  NAS 项目目录：{{ group._project }}
                  <span v-if="group._projectId"> · 平台项目ID：{{ group._projectId }}</span>
                </span>
              </span>
            </span>
            <el-tag size="small" effect="plain" type="info">
              共 {{ group.total }} 个文件
              <span v-if="group.nasAndDb > 0" style="color:#059669;"> · {{ group.nasAndDb }} 个已在平台登记</span>
            </el-tag>
          </h2>

          <div
            v-for="(cat, catIdx) in Object.values(group.categories)"
            :key="group._project + '::' + cat._category"
            :style="catIdx === 0 ? 'margin-top: 6px;' : 'margin-top: 14px;'"
          >
            <div
              style="font-size: 13px; color: #475569; margin: 6px 0 8px 4px; display: flex; align-items: center; gap: 6px;"
            >
              <el-icon style="color: #64748b;"><FolderOpened /></el-icon>
              <b>{{ cat._category }}</b>
              <el-tag size="small" effect="plain" type="info" style="margin-left: 4px;">{{ cat.items.length }} 个</el-tag>
            </div>

            <div
              v-for="sf in cat.items"
              :key="sf.id"
              class="nas-job-item"
            >
              <div style="display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; align-items: flex-start;">
                <div style="flex: 1; min-width: 200px;">
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap;">
                    <el-icon style="color: #2563eb; flex-shrink: 0;"><Document /></el-icon>
                    <span class="file-name" style="font-size: 16px; font-weight: 600; color: #0f172a;">
                      {{ sf.file_name }}
                    </span>
                    <el-tag
                      v-if="sf.source === 'nas_and_db'"
                      type="success"
                      size="small"
                      effect="light"
                    >
                      已在平台登记
                    </el-tag>
                    <el-tag
                      v-else
                      size="small"
                      effect="plain"
                      type="info"
                    >
                      仅 NAS 存在
                    </el-tag>
                    <template v-if="sf.matched_file_id">
                      <el-tag
                        size="small"
                        effect="plain"
                        type="success"
                      >
                        文件ID：{{ sf.matched_file_id }}
                      </el-tag>
                    </template>
                    <template v-if="sf.matched_nas_job_id">
                      <el-tag
                        size="small"
                        effect="plain"
                        type="success"
                      >
                        任务ID：{{ sf.matched_nas_job_id }}
                      </el-tag>
                    </template>
                  </div>

                  <div class="nas-path-row">
                    <span class="nas-path-label">NAS 归档路径</span>
                    <div class="path-preview" style="margin-top: 2px; font-size: 13px; font-weight: 500; color: #1d4ed8;">
                      {{ sf.relative_path }}
                    </div>
                  </div>

                  <div class="nas-path-row" v-if="sf.absolute_path">
                    <span class="nas-path-label" style="color: #94a3b8;">本地绝对路径</span>
                    <div class="path-preview" style="margin-top: 2px; font-size: 12px; color: #64748b; word-break: break-all;">
                      {{ sf.absolute_path }}
                    </div>
                  </div>

                  <div style="margin-top: 6px; font-size: 12px; color: #94a3b8; display: flex; align-items: center; flex-wrap: wrap; gap: 6px;">
                    <el-icon><Coin /></el-icon> 大小：{{ formatSize(sf.size) }}
                    <span v-if="sf.last_modified">
                      · <el-icon><Calendar /></el-icon> 最后修改：{{ formatDate(sf.last_modified) }}
                    </span>
                    <span style="margin-left: auto; color: #cbd5e1;">
                      扫描ID：{{ sf.id }}
                    </span>
                  </div>
                </div>

                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                  <el-button
                    type="primary"
                    :icon="Download"
                    @click="downloadScannedFile(sf)"
                  >
                    下载
                  </el-button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <el-dialog
      v-model="renameDialogVisible"
      title="修改归档命名"
      width="95%"
      style="max-width: 560px;"
      @closed="onRenameDialogClosed"
    >
      <el-form :model="renameForm" label-position="top" size="default">
        <el-form-item label="最终文件名" required>
          <el-input v-model="renameForm.newFinalName" placeholder="请输入最终文件名（含扩展名）" />
        </el-form-item>
        <el-form-item label="归档目录" required>
          <el-select
            v-model="renameForm.newTargetPath"
            placeholder="请选择归档目录"
            style="width: 100%;"
            filterable
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
        </el-form-item>
        <el-form-item label="预览最终归档路径">
          <div class="path-preview" style="margin-top: 4px;">
            {{ renameProjectName }}/{{ renameForm.newTargetPath || '<未选择目录>' }}/{{ renameForm.newFinalName || '<未填写文件名>' }}
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="renameDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="renameSubmitting"
          :disabled="!canSubmitRename"
          @click="submitRename"
        >
          确认修改
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="nasSettingsVisible"
      title="NAS 推送设置"
      width="96%"
      style="max-width: 600px;"
      @closed="onNasSettingsClosed"
    >
      <el-form :model="nasSettingsForm" label-position="top" size="default">
        <el-form-item label="NAS 挂载根路径" required>
          <el-input
            v-model="nasSettingsForm.mountRoot"
            placeholder="例如 macOS: /Volumes/公司归档/项目资料   Windows: Z:\公司归档\项目资料"
          />
          <div style="font-size: 12px; color: #94a3b8; margin-top: 4px; line-height: 1.6;">
            把 NAS 通过 Finder / 网络映射 挂载到本机后，填能直接读写的绝对路径。
            这个路径可以在「NAS 设置」里临时填（本次会话生效，重启后端后会回到 .env 配置），
            或写进 backend/.env 的 NAS_MOUNT_ROOT 永久生效。
          </div>
        </el-form-item>
        <el-form-item label="推送模式" required>
          <el-radio-group v-model="nasSettingsForm.copyMode">
            <el-radio label="copy">📋 拷贝（推荐：推送成功后中转区仍保留一份原始重命名后的文件）</el-radio>
            <el-radio label="move">✂️ 移动（省空间：推送成功后中转区文件自动删除）</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="同名冲突处理" required>
          <el-radio-group v-model="nasSettingsForm.overwriteExisting">
            <el-radio :label="false">❌ 禁止覆盖（推荐：发现同名文件时报错，避免误覆盖）</el-radio>
            <el-radio :label="true">✅ 允许覆盖（推送时直接覆盖 NAS 端同名文件）</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="NAS 自动扫描间隔" required>
          <el-select v-model="nasSettingsForm.autoScanIntervalMinutes" size="default" style="min-width: 220px;">
            <el-option :value="5" label="每 5 分钟（更新频繁，适合高 IO 性能的 NAS）" />
            <el-option :value="15" label="每 15 分钟（更新较快）" />
            <el-option :value="20" label="每 20 分钟（默认推荐：平衡性能与更新时效）" />
            <el-option :value="30" label="每 30 分钟（平衡性能与更新时效）" />
            <el-option :value="60" label="每 60 分钟（更新较慢，降低 NAS 负载）" />
            <el-option :value="120" label="每 2 小时（资料更新极少时使用）" />
          </el-select>
          <div style="font-size: 12px; color: #94a3b8; margin-top: 4px; line-height: 1.6;">
            员工端下载中心 / 项目详情页打开时，会按该间隔自动扫描 NAS 目录刷新文件列表；同时保留「开始扫描」按钮，可随时手动立即扫描。
          </div>
        </el-form-item>
        <el-form-item label="路径连通性检测">
          <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            <el-button :icon="Search" @click="probeNasMount" :disabled="!nasSettingsForm.mountRoot?.trim()">
              检测挂载点
            </el-button>
            <el-tag
              v-if="nasProbeStatus"
              :type="nasProbeStatus.writable ? 'success' : (nasProbeStatus.exists ? 'warning' : 'danger')"
              effect="plain"
              size="default"
            >
              {{ nasProbeStatus.writable ? '✅ 可直连读写' : (nasProbeStatus.exists ? '⚠️ 能看到目录但不可写' : '❌ 路径不存在 / 未挂载') }}
            </el-tag>
          </div>
          <div v-if="nasProbeStatus?.probeMessage" style="font-size: 12px; color: #64748b; margin-top: 6px;">
            {{ nasProbeStatus.probeMessage }}
          </div>
          <div v-if="nasProbeStatus?.mountRoot" style="font-size: 12px; color: #94a3b8; margin-top: 4px;">
            当前路径：<code style="background:#f1f5f9;padding:1px 4px;border-radius:4px;">{{ nasProbeStatus.mountRoot }}</code>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="nasSettingsVisible = false">关闭</el-button>
        <el-button @click="probeNasMount" :disabled="!nasSettingsForm.mountRoot?.trim()">
          再检测一次
        </el-button>
        <el-button type="primary" :disabled="!nasSettingsForm.mountRoot?.trim()" @click="onNasSettingsSaved">
          保存并开始使用
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, reactive, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Upload, Refresh, Folder, Document, Clock,
  CircleCheckFilled, CircleCheck, Check, Calendar, EditPen,
  Setting, UploadFilled, Search, FolderOpened, Coin, Download
} from '@element-plus/icons-vue';
import { adminApi, projectApi, archiveApi } from '@/api/index.js';
import {
  displayFileName,
  originalFileName,
  isRenamed,
  finalPathPreview,
  formatSize,
  saveBlobFromResponse
} from '@/utils/format.js';

const loading = ref(false);
const jobs = ref([]);
const submittingId = ref(null);
const projectNames = reactive({});

const renameDialogVisible = ref(false);
const renameSubmitting = ref(false);
const currentRenameJob = ref(null);
const renameProjectName = ref('');
const renameForm = reactive({
  newFinalName: '',
  newTargetPath: ''
});
const pathOptions = ref([]);
const nasStatus = ref(null);
const nasSettingsVisible = ref(false);
const nasProbeStatus = ref(null);
const pushAllLoading = ref(false);
const nasSettingsForm = reactive({
  mountRoot: '',
  copyMode: 'copy',
  overwriteExisting: false,
  autoScanIntervalMinutes: 20
});
const STORAGE_KEY_NAS = 'archive_system_nas_settings_v1';
const NAS_MODE_KEY = 'archive_admin_nas_mode';

const _getSavedNasMode = () => {
  try {
    const saved = localStorage.getItem(NAS_MODE_KEY);
    return saved === 'browse' ? 'browse' : 'jobs';
  } catch (_) {
    return 'jobs';
  }
};
const nasViewMode = ref(_getSavedNasMode());
const browseLoading = ref(false);
const scanResult = ref(null);
const browseQ = ref('');

const nasHeartbeat = ref(null);
const nasHeartbeatPollTimer = ref(null);
const NAS_HEARTBEAT_POLL_MS = 2 * 60 * 1000;
let _nasHbLastAlertOnlineState = null;
let _nasHbLastAlertAt = 0;

async function pollNasHeartbeat({ force } = {}) {
  try {
    const hb = await adminApi.getNasHeartbeat(!!force);
    nasHeartbeat.value = hb || null;
    if (!hb || !hb.configured) return;
    const nowTs = Date.now();
    const isOffline = hb.online === false && (hb.consecutiveFailures || 0) >= 1;
    const justRecovered = hb.online === true && _nasHbLastAlertOnlineState === false;
    if (isOffline) {
      const needAlert = force
        || (_nasHbLastAlertOnlineState !== false)
        || (nowTs - _nasHbLastAlertAt >= 15 * 60 * 1000 && (hb.consecutiveFailures || 0) >= 2);
      if (needAlert) {
        _nasHbLastAlertOnlineState = false;
        _nasHbLastAlertAt = nowTs;
        try {
          const hbUrl = `/admin/nas`;
          ElMessageBox.alert(
            `连续 ${hb.consecutiveFailures || 1} 次心跳检测失败，NAS 共享盘当前可能处于离线或未挂载状态。\n\n检测时间：${hb.lastCheckAt ? new Date(hb.lastCheckAt).toLocaleString() : new Date().toLocaleString()}\n挂载路径：${hb.lastProbe?.mountRoot || '(未配置)'}\n${hb.lastProbe?.probeMessage ? ('\n详细信息：' + hb.lastProbe.probeMessage) : ''}\n\n请检查 NAS 是否开机、网络是否畅通、以及 Finder/资源管理器中是否正确挂载了 SMB 共享盘。`,
            '⚠️ NAS 心跳异常 · 共享盘可能已掉线',
            {
              confirmButtonText: '去 NAS 设置页检查',
              cancelButtonText: '稍后再说',
              showCancelButton: true,
              type: 'warning',
              dangerouslyUseHTMLString: false
            }
          ).then(() => {
            try {
              if (window.location.hash && window.location.hash.includes('#')) {
                if (!window.location.hash.includes('/admin/nas')) window.location.hash = '#/admin/nas';
              } else {
                window.location.href = hbUrl;
              }
            } catch (_) {}
          }).catch(() => {});
        } catch (_) {}
      }
    } else if (justRecovered) {
      _nasHbLastAlertOnlineState = true;
      ElMessage.success({
        message: '✅ NAS 共享盘已恢复在线',
        duration: 4000,
        showClose: true
      });
    } else if (hb.online === true) {
      _nasHbLastAlertOnlineState = true;
    }
  } catch (e) {
    console.warn('[NAS 心跳] 轮询失败：', e?.message || String(e));
  }
}

function startNasHeartbeatPolling() {
  if (nasHeartbeatPollTimer.value) {
    clearInterval(nasHeartbeatPollTimer.value);
    nasHeartbeatPollTimer.value = null;
  }
  pollNasHeartbeat({ force: false });
  nasHeartbeatPollTimer.value = setInterval(() => {
    pollNasHeartbeat({ force: false });
  }, NAS_HEARTBEAT_POLL_MS);
}

function stopNasHeartbeatPolling() {
  if (nasHeartbeatPollTimer.value) {
    clearInterval(nasHeartbeatPollTimer.value);
    nasHeartbeatPollTimer.value = null;
  }
}

const currentMountRootForBrowse = computed(() => {
  const direct = nasSettingsForm.mountRoot;
  const saved = nasStatus.value?.mountRoot;
  return String((direct && String(direct).trim()) ? direct : (saved || '')).trim();
});

const browseFiles = computed(() => Array.isArray(scanResult.value?.files) ? scanResult.value.files : []);

const browseGroups = computed(() => {
  const files = browseFiles.value;
  const byProj = {};
  files.forEach(f => {
    const proj = f.project_folder || '（未分类项目根）';
    const cat = f.category_folder || '（根目录）';
    if (!byProj[proj]) byProj[proj] = { _project: proj, _projectId: f._project?.id || null, _name: f._project?.name || f._project?.root_name || proj, total: 0, nasAndDb: 0, categories: {} };
    const p = byProj[proj];
    p.total++;
    if (f.source === 'nas_and_db') p.nasAndDb++;
    if (!p.categories[cat]) p.categories[cat] = { _category: cat, items: [] };
    p.categories[cat].items.push(f);
  });
  Object.values(byProj).forEach(p => {
    Object.values(p.categories).forEach(c => {
      c.items.sort((a, b) => {
        const sa = a.source === 'nas_and_db' ? 0 : 1;
        const sb = b.source === 'nas_and_db' ? 0 : 1;
        if (sa !== sb) return sa - sb;
        const ta = a.last_modified ? new Date(a.last_modified).getTime() : 0;
        const tb = b.last_modified ? new Date(b.last_modified).getTime() : 0;
        return tb - ta;
      });
    });
  });
  return Object.values(byProj).sort((a, b) => b.total - a.total);
});

async function loadBrowseData({ keepLoading } = {}) {
  if (!keepLoading) browseLoading.value = true;
  try {
    const data = await adminApi.scanNas({
      mount_root: currentMountRootForBrowse.value || undefined,
      q: browseQ.value || undefined,
      limit: 500
    });
    scanResult.value = data || null;
  } catch (e) {
    ElMessage.error(e.message || '扫描失败');
    scanResult.value = null;
  } finally {
    browseLoading.value = false;
  }
}

async function downloadScannedFile(scannedFile) {
  if (!scannedFile) return;
  try {
    const resp = await adminApi.downloadNasFile({
      mountRoot: currentMountRootForBrowse.value || undefined,
      relativePath: scannedFile.relative_path,
      absolutePath: scannedFile.absolute_path,
      downloadName: scannedFile.file_name
    });
    await saveBlobFromResponse(resp, scannedFile.file_name || 'archive-file');
    ElMessage.success({ message: `已开始下载：${scannedFile.file_name || '文件'}`, duration: 2000 });
  } catch (e) {
    const msg = e && e.response && e.response.data && e.response.data.error
      ? String(e.response.data.error)
      : (e && e.message ? e.message : '下载失败，请稍后重试');
    ElMessage.error({ message: msg, duration: 5000, showClose: true });
  }
}


const pathOptionsNormal = computed(() =>
  pathOptions.value.filter(p => !p.isManual)
);
const pathOptionsManual = computed(() =>
  pathOptions.value.filter(p => p.isManual)
);

const canSubmitRename = computed(() => {
  return !!renameForm.newFinalName?.trim()
    && !!renameForm.newTargetPath
    && !renameSubmitting.value;
});

const totalJobs = computed(() => jobs.value.length);
const totalPrepared = computed(() => jobs.value.filter(j => j.status === 'prepared').length);
const totalUploaded = computed(() => jobs.value.filter(j => j.status === 'manually_uploaded').length);

function extractProjectNameFromAny(job) {
  if (!job) return '';
  return job.project?.root_name
    || job.project?.name
    || job.project_name
    || job.project_display_name
    || '';
}

const groups = computed(() => {
  const map = {};
  jobs.value.forEach(job => {
    const pid = job.project_id || ('__unknown_' + job.id);
    if (!map[pid]) {
      map[pid] = {
        projectId: pid,
        projectName: '',
        projectDisplayName: '',
        jobs: [],
        preparedCount: 0
      };
    }
    map[pid].jobs.push(job);
    if (job.status === 'prepared') map[pid].preparedCount++;
  });

  Object.values(map).forEach(g => {
    const id = g.projectId;
    const sampleJob = g.jobs.find(j => extractProjectNameFromAny(j)) || g.jobs[0];
    const nested = extractProjectNameFromAny(sampleJob);
    if (id.startsWith('__unknown_')) {
      g.projectDisplayName = '未指定项目';
      g.projectName = '未指定项目';
    } else {
      g.projectDisplayName = nested
        || projectNames[id]
        || ('项目 #' + id);
      g.projectName = projectNames[id] || nested || ('项目 #' + id);
    }
    g.jobs.sort((a, b) => {
      const sa = a.status === 'prepared' ? 0 : 1;
      const sb = b.status === 'prepared' ? 0 : 1;
      if (sa !== sb) return sa - sb;
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return tb - ta;
    });
  });

  return Object.values(map).sort((a, b) => b.preparedCount - a.preparedCount);
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
  return `${y}-${m}-${day} ${hh}:${mm}`;
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

async function loadData() {
  loading.value = true;
  try {
    const data = await adminApi.listNasJobs();
    const arr = Array.isArray(data) ? data : (data?.list || data?.data || []);
    jobs.value = arr;

    const pids = [...new Set(arr.map(j => j.project_id).filter(Boolean))];
    if (pids.length) {
      await Promise.allSettled(pids.map(async pid => {
        try {
          const p = await projectApi.getDetail(pid);
          if (p) projectNames[pid] = p.root_name || p.name || ('项目 #' + pid);
        } catch {}
      }));
    }
  } catch (e) {
    ElMessage.error(e.message || '加载失败');
  } finally {
    loading.value = false;
  }
}

function parseTargetParts(targetRelativePath) {
  const full = targetRelativePath || '';
  const parts = full.split('/').filter(Boolean);
  const projectPart = parts[0] || '';
  const fileName = parts.pop() || '';
  parts.shift();
  const dirPath = parts.join('/');
  return { projectPart, dirPath, fileName };
}

function openRenameDialog(job) {
  if (!job) return;
  currentRenameJob.value = job;
  const projectDisplay = extractProjectNameFromAny(job)
    || projectNames[job.project_id]
    || ('项目 #' + job.project_id);
  renameProjectName.value = projectDisplay;
  const { dirPath, fileName } = parseTargetParts(job.target_relative_path);
  renameForm.newFinalName = fileName || displayFileName(job) || '';
  renameForm.newTargetPath = dirPath || '';
  renameDialogVisible.value = true;
}

function onRenameDialogClosed() {
  currentRenameJob.value = null;
  renameSubmitting.value = false;
  renameForm.newFinalName = '';
  renameForm.newTargetPath = '';
  renameProjectName.value = '';
}

async function submitRename() {
  if (!currentRenameJob.value) return;
  if (!canSubmitRename.value) return;
  renameSubmitting.value = true;
  submittingId.value = currentRenameJob.value.id + ':rename';
  try {
    await adminApi.renameNasJob(currentRenameJob.value.id, {
      newFinalName: renameForm.newFinalName.trim(),
      newTargetPath: renameForm.newTargetPath,
      actor: '管理员'
    });
    ElMessage.success('已修改归档命名');
    renameDialogVisible.value = false;
    await loadData();
  } catch (e) {
    ElMessage.error(e.message || '修改失败');
  } finally {
    renameSubmitting.value = false;
    submittingId.value = null;
  }
}

async function handleConfirm(job) {
  try {
    const projectDisplay = extractProjectNameFromAny(job)
      || projectNames[job.project_id]
      || ('项目 #' + job.project_id);
    await ElMessageBox.confirm(
      `请确认文件「${displayFileName(job)}」已手动上传至 NAS 的对应目录：\n\n${finalPathPreview(job, projectDisplay)}`,
      '确认已上传 NAS',
      {
        confirmButtonText: '确认已上传',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--primary',
        type: 'warning'
      }
    );
    submittingId.value = job.id;
    await adminApi.markNasUploaded(job.id, { actor: '管理员' });
    ElMessage.success('已标记为已归档');
    loadData();
  } catch (e) {
    if (e !== 'cancel' && e?.message) ElMessage.error(e.message || '操作失败');
  } finally {
    submittingId.value = null;
  }
}

async function loadNasStatus() {
  try {
    const s = await adminApi.getNasStatus();
    nasStatus.value = s || null;
    if (!nasSettingsForm.mountRoot?.trim() && s?.mountRoot) {
      nasSettingsForm.mountRoot = String(s.mountRoot || '').trim();
    }
    if (s?.defaultCopyMode) nasSettingsForm.copyMode = s.defaultCopyMode === 'move' ? 'move' : 'copy';
    if (typeof s?.defaultOverwriteExisting === 'boolean') nasSettingsForm.overwriteExisting = s.defaultOverwriteExisting;

    try {
      const raw = localStorage.getItem(STORAGE_KEY_NAS);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved?.mountRoot?.trim()) nasSettingsForm.mountRoot = String(saved.mountRoot).trim();
        if (saved?.copyMode) nasSettingsForm.copyMode = saved.copyMode === 'move' ? 'move' : 'copy';
        if (typeof saved?.overwriteExisting === 'boolean') nasSettingsForm.overwriteExisting = saved.overwriteExisting;
        if (saved?.mountRoot?.trim()) {
          try {
            const s2 = await adminApi.getNasStatus(saved.mountRoot);
            if (s2) nasStatus.value = s2;
          } catch {}
        }
      }
    } catch {}
  } catch (e) {
    nasStatus.value = null;
  }
}

async function openNasSettings() {
  if (nasStatus.value?.mountRoot && !nasSettingsForm.mountRoot.trim()) {
    nasSettingsForm.mountRoot = String(nasStatus.value.mountRoot).trim();
  }
  if (nasStatus.value?.defaultCopyMode && !nasSettingsForm.copyMode) {
    nasSettingsForm.copyMode = nasStatus.value.defaultCopyMode === 'move' ? 'move' : 'copy';
  }
  if (typeof nasStatus.value?.defaultOverwriteExisting === 'boolean') {
    nasSettingsForm.overwriteExisting = nasStatus.value.defaultOverwriteExisting;
  }
  try {
    const localRaw = localStorage.getItem(STORAGE_KEY_NAS);
    if (localRaw) {
      const local = JSON.parse(localRaw || '{}');
      if (typeof local?.autoScanIntervalMinutes === 'number') {
        nasSettingsForm.autoScanIntervalMinutes = Math.max(1, Math.min(1440, Number(local.autoScanIntervalMinutes)));
      }
    }
  } catch {}
  try {
    const remote = await adminApi.getNasSettings();
    if (remote && typeof remote?.autoScanIntervalMinutes === 'number') {
      nasSettingsForm.autoScanIntervalMinutes = Math.max(1, Math.min(1440, Number(remote.autoScanIntervalMinutes)));
    }
  } catch (e) {
    console.warn('[NAS] 拉取服务器设置失败（使用本地默认）：', e?.message);
  }
  nasProbeStatus.value = null;
  nasSettingsVisible.value = true;
}

function onNasSettingsClosed() {
  nasProbeStatus.value = null;
}

async function probeNasMount() {
  const p = (nasSettingsForm.mountRoot || '').trim();
  if (!p) {
    ElMessage.warning('请先填写 NAS 挂载根路径');
    return;
  }
  try {
    const s = await adminApi.getNasStatus(p);
    nasProbeStatus.value = s || null;
    if (s?.writable) ElMessage.success('✅ 挂载点正常：可读可写，可以直接推送');
    else if (s?.exists && !s?.isDirectory) ElMessage.error('❌ 该路径不是一个目录，无法作为 NAS 根目录');
    else if (s?.exists) ElMessage.warning('⚠️ 目录存在但不可写（请检查 SMB 共享盘权限 / 是否以读写模式挂载）');
    else ElMessage.error('❌ 目录不存在：请确认 Finder/网络映射里已经挂载了 NAS 共享盘');
  } catch (e) {
    nasProbeStatus.value = {
      mountRoot: p,
      configured: true,
      exists: false,
      isDirectory: false,
      writable: false,
      probeMessage: '检测失败：' + (e.message || String(e))
    };
    ElMessage.error('检测失败：' + (e.message || String(e)));
  }
}

async function onNasSettingsSaved() {
  if (!nasSettingsForm.mountRoot?.trim()) {
    ElMessage.warning('请先填写 NAS 挂载根路径');
    return;
  }
  const payload = {
    mountRoot: nasSettingsForm.mountRoot.trim(),
    copyMode: nasSettingsForm.copyMode,
    overwrite: !!nasSettingsForm.overwriteExisting,
    autoScanIntervalMinutes: Number(nasSettingsForm.autoScanIntervalMinutes) || 20
  };
  try {
    localStorage.setItem(STORAGE_KEY_NAS, JSON.stringify({
      ...payload,
      overwriteExisting: payload.overwrite
    }));
  } catch {}
  try {
    await adminApi.saveNasSettings({ ...payload, actor: '管理员' });
  } catch (e) {
    console.warn('[NAS] 后端保存设置失败（仅本地生效）：', e?.message);
  }
  loadNasStatus();
  nasSettingsVisible.value = false;
  ElMessage.success('✅ NAS 设置已保存并同步到服务器，员工端可直接使用');
}

function _currentNasOptions() {
  const root = nasSettingsForm.mountRoot?.trim() || nasStatus.value?.mountRoot?.trim() || '';
  return {
    mountRoot: root || null,
    copyMode: nasSettingsForm.copyMode || 'copy',
    overwriteExisting: !!nasSettingsForm.overwriteExisting,
    actor: '管理员'
  };
}

async function handlePushOne(job) {
  const opts = _currentNasOptions();
  if (!opts.mountRoot) {
    try {
      await ElMessageBox.confirm(
        '还没有配置 NAS 挂载路径，是否现在去「NAS 设置」里填写？',
        '需要先配置 NAS 挂载路径',
        { confirmButtonText: '去设置', cancelButtonText: '取消', type: 'warning' }
      );
      openNasSettings();
    } catch {}
    return;
  }
  try {
    submittingId.value = job.id + ':push';
    const r = await adminApi.pushNasJob(job.id, opts);
    ElMessage.success(
      `✅ 推送成功：${r?.file_name || job.file_name || job.name || '文件'}\n已自动标记为已归档`
    );
    await Promise.all([loadData(), loadNasStatus()]);
  } catch (e) {
    ElMessage.error({
      message: '❌ 推送失败：' + (e.message || String(e)),
      duration: 8000,
      showClose: true
    });
  } finally {
    submittingId.value = null;
  }
}

async function handlePushAll() {
  const opts = _currentNasOptions();
  if (!opts.mountRoot) {
    try {
      await ElMessageBox.confirm(
        '还没有配置 NAS 挂载路径，是否现在去「NAS 设置」里填写？',
        '需要先配置 NAS 挂载路径',
        { confirmButtonText: '去设置', cancelButtonText: '取消', type: 'warning' }
      );
      openNasSettings();
    } catch {}
    return;
  }
  if (totalPrepared.value === 0) {
    ElMessage.info('没有「待确认」的文件需要推送');
    return;
  }
  try {
    await ElMessageBox.confirm(
      `即将把全部 ${totalPrepared.value} 个「待确认」文件，用「${opts.copyMode === 'move' ? '移动' : '拷贝'}」方式推送到：\n${opts.mountRoot}\n\n是否继续？`,
      '🚀 一键推送所有已确认到 NAS',
      { confirmButtonText: '确认推送', cancelButtonText: '取消', type: 'warning' }
    );
  } catch { return; }

  pushAllLoading.value = true;
  try {
    const r = await adminApi.pushAllNasJobs(opts);
    const msg = [
      `📦 共 ${r?.total || 0} 条任务`,
      `✅ 推送成功：${r?.pushed_success || 0}`,
      r?.skipped_already_uploaded ? `⏭️  跳过（已归档）：${r.skipped_already_uploaded}` : null,
      `❌ 失败：${r?.failed || 0}`
    ].filter(Boolean).join('\n');
    if ((r?.failed || 0) === 0) {
      ElMessage.success(msg);
    } else {
      ElMessage.warning({ message: msg + '\n\n查看下方任务列表中的失败原因', duration: 10000, showClose: true });
    }
    await Promise.all([loadData(), loadNasStatus()]);
  } catch (e) {
    ElMessage.error('批量推送失败：' + (e.message || String(e)));
  } finally {
    pushAllLoading.value = false;
  }
}

onMounted(async () => {
  await loadPaths();
  try {
    const remote = await adminApi.getNasSettings();
    if (remote?.mountRoot && !nasSettingsForm.mountRoot?.trim()) {
      nasSettingsForm.mountRoot = String(remote.mountRoot).trim();
      if (remote.copyMode === 'move' || remote.copyMode === 'copy') {
        nasSettingsForm.copyMode = remote.copyMode;
      }
      if (typeof remote.overwrite === 'boolean') {
        nasSettingsForm.overwriteExisting = !!remote.overwrite;
      }
    }
  } catch (_) {}
  await loadNasStatus();

  if (nasViewMode.value === 'jobs') {
    await loadData();
  } else if (nasViewMode.value === 'browse') {
    const root = currentMountRootForBrowse.value;
    if (root) loadBrowseData();
  }
  startNasHeartbeatPolling();
});

onBeforeUnmount(() => {
  stopNasHeartbeatPolling();
});

watch(nasViewMode, (v) => {
  try { localStorage.setItem(NAS_MODE_KEY, v); } catch (_) {}
  if (v === 'browse') {
    const root = currentMountRootForBrowse.value;
    if (root && !scanResult.value) loadBrowseData();
  } else if (v === 'jobs' && jobs.value.length === 0 && !loading.value) {
    loadData();
  }
});
</script>

<style scoped>
.nas-job-item {
  padding: 12px 0;
  border-bottom: 1px solid #f1f5f9;
}
.nas-job-item:last-child {
  border-bottom: none;
}
.nas-path-row {
  margin-top: 6px;
}
.nas-path-label {
  font-size: 12px;
  color: #94a3b8;
}
.file-name {
  font-weight: 500;
  word-break: break-all;
}
.nas-uploader {
  margin-left: 4px;
}
</style>
