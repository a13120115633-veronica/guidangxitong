const express = require('express');
const path = require('path');
const fs = require('fs');
const {
  listNasJobs,
  markNasJobManuallyUploaded,
  renameNasPreparedFile,
  getNasMountStatus,
  pushSingleJobToNas,
  pushAllReadyJobsToNas,
  scanNasDirectory,
  resolveNasDownloadFile,
  streamFileDownloadSafe,
  savePersistedNasSettings,
  getPublicNasConfig,
  getNasHeartbeatStatus
} = require('../services/file-service');
const { getAuditLogs } = require('../services/audit-service');

const router = express.Router();

router.get('/nas/jobs', (req, res) => {
  try {
    const jobs = listNasJobs();
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/nas/jobs/:id/mark-manually-uploaded', (req, res) => {
  try {
    const { id } = req.params;
    const { actor } = req.body || {};
    const result = markNasJobManuallyUploaded(id, { actor });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/nas/jobs/:id/rename', (req, res) => {
  try {
    const { id } = req.params;
    const { newFinalName, newTargetPath, actor } = req.body || {};
    const result = renameNasPreparedFile(id, { newFinalName, newTargetPath, actor });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message, error_code: error.code || null });
  }
});

router.get('/nas/settings', (req, res) => {
  try {
    res.json(getPublicNasConfig());
  } catch (error) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

router.post('/nas/settings', (req, res) => {
  try {
    const { mountRoot, copyMode, overwrite, mkdirRecursive, autoScanIntervalMinutes, actor } = req.body || {};
    if (!mountRoot || !String(mountRoot).trim()) {
      return res.status(400).json({ error: 'NAS 挂载路径（mountRoot）不能为空' });
    }
    let intervalVal = undefined;
    if (typeof autoScanIntervalMinutes === 'number') intervalVal = autoScanIntervalMinutes;
    else if (typeof autoScanIntervalMinutes === 'string' && String(autoScanIntervalMinutes).trim()) {
      const parsed = Number(String(autoScanIntervalMinutes));
      if (!isNaN(parsed)) intervalVal = parsed;
    }
    const saved = savePersistedNasSettings({
      mountRoot: String(mountRoot).trim(),
      copyMode: copyMode === 'move' ? 'move' : 'copy',
      overwrite: typeof overwrite === 'boolean' ? overwrite : false,
      mkdirRecursive: typeof mkdirRecursive === 'boolean' ? mkdirRecursive : true,
      autoScanIntervalMinutes: intervalVal
    });
    try {
      const { addAuditLog } = require('../services/audit-service');
      if (addAuditLog) addAuditLog({ type: 'nas_settings_save', actor: actor || '管理员', detail: saved });
    } catch (_) {}
    res.json({ ok: true, settings: saved });
  } catch (error) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

router.get('/nas/status', (req, res) => {
  try {
    const { mount_root } = req.query || {};
    if (mount_root && String(mount_root).trim()) {
      const { getNasMountStatus: _privateGet } = require('../services/file-service');
      const originalMount = String(mount_root).trim();
      const orig = _privateGet ? _privateGet() : null;
      const path = require('path');
      const fs = require('fs');
      const probe = path.join(originalMount, `.archive_write_probe_${Date.now()}_${process.pid}`);
      let configured = true, exists = false, isDir = false, writable = false, msg = '';
      try { exists = fs.existsSync(originalMount); if (exists) { const s = fs.statSync(originalMount); isDir = s.isDirectory(); } } catch (e) { exists = false; isDir = false; msg = e.message || e.code || String(e); }
      if (msg) {
        // already have status msg from stat phase
      } else if (isDir) {
        let writeOk = false;
        let writeErr = null;
        let deleteFailed = false;
        try {
          fs.writeFileSync(probe, 'ok', { flag: 'wx' });
          writeOk = true;
        } catch (we) { writeErr = we; }
        if (writeOk) {
          try { fs.unlinkSync(probe); } catch (_) { deleteFailed = true; }
          writable = true;
          msg = deleteFailed
            ? '正常（可写入。NAS 端禁止删除 probe 临时文件，属常见防删策略，不影响文件推送）'
            : '正常（目录存在且可写）';
        } else {
          writable = false;
          msg = '目录不可写：' + (writeErr?.message || writeErr?.code || writeErr || '未知错误');
        }
      } else {
        msg = exists ? '路径不是目录' : '目录不存在（SMB 共享盘未挂载？）';
      }
      return res.json({
        mountRoot: originalMount,
        configured: true,
        exists,
        isDirectory: isDir,
        writable,
        probeMessage: msg,
        defaultCopyMode: orig?.defaultCopyMode || 'copy',
        defaultOverwriteExisting: !!orig?.defaultOverwriteExisting,
        custom_mount: true
      });
    }
    const status = getNasMountStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

router.get('/nas/heartbeat', (req, res) => {
  try {
    const { run_now } = req.query || {};
    const runNow = run_now === '1' || run_now === 'true' || String(run_now).toLowerCase() === 'true';
    const hb = getNasHeartbeatStatus({ runNow });
    res.json(hb || null);
  } catch (error) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

router.post('/nas/jobs/:id/push', (req, res) => {
  try {
    const { id } = req.params;
    const { actor, copyMode, mountRoot, overwriteExisting, dryRun } = req.body || {};
    const result = pushSingleJobToNas(id, {
      actor,
      copyMode,
      mountRoot,
      overwriteExisting: typeof overwriteExisting === 'boolean' ? overwriteExisting : undefined,
      dryRun: !!dryRun
    });
    res.json(result);
  } catch (error) {
    const code = error.code || null;
    let status = 400;
    if (code === 'NAS_JOB_NOT_FOUND') status = 404;
    else if (code === 'NAS_JOB_ALREADY_UPLOADED') status = 409;
    else if (code === 'NAS_MOUNT_NOT_SET') status = 412;
    else if (code === 'NAS_TARGET_CONFLICT') status = 409;
    else if (code === 'NAS_COPY_FAILED' || code === 'NAS_MKDIR_FAILED') status = 500;
    res.status(status).json({ error: error.message || String(error), error_code: code });
  }
});

router.post('/nas/jobs/push-all', (req, res) => {
  try {
    const { actor, copyMode, mountRoot, overwriteExisting, dryRun } = req.body || {};
    const result = pushAllReadyJobsToNas({
      actor,
      copyMode,
      mountRoot,
      overwriteExisting: typeof overwriteExisting === 'boolean' ? overwriteExisting : undefined,
      dryRun: !!dryRun
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || String(error), error_code: error.code || null });
  }
});

router.get('/nas/scan', (req, res) => {
  try {
    const { mount_root, project_id, q, limit, offset } = req.query || {};
    const data = scanNasDirectory({
      mountRoot: mount_root,
      projectId: project_id,
      q,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : 0
    });
    res.json(data);
  } catch (error) {
    const code = error.code || null;
    let status = 500;
    if (code === 'NAS_MOUNT_NOT_SET') status = 412;
    else if (code === 'NAS_MOUNT_MISSING' || code === 'NAS_MOUNT_NOT_DIR') status = 404;
    else if (code === 'NAS_MOUNT_ACCESS_ERR') status = 400;
    res.status(status).json({ error: error.message || String(error), error_code: code });
  }
});

router.get('/nas/file/download', (req, res) => {
  try {
    const { mount_root, relative_path, absolute_path, download_name } = req.query || {};
    const dl = resolveNasDownloadFile({
      mountRoot: mount_root,
      relativePath: relative_path,
      absolutePath: absolute_path,
      downloadName: download_name
    });
    if (!dl) {
      return res.status(404).json({ error: '文件不存在或路径越界', error_code: 'NAS_FILE_NOT_FOUND' });
    }
    streamFileDownloadSafe(res, dl.absolutePath, {
      contentType: dl.contentType,
      downloadName: dl.downloadName,
      relativePath: dl.relativePath
    });
  } catch (error) {
    const code = error.code || null;
    let status = 500;
    if (code === 'NAS_MOUNT_NOT_SET') status = 412;
    else if (code === 'NAS_MOUNT_MISSING' || code === 'NAS_MOUNT_NOT_DIR') status = 404;
    else if (code === 'NAS_MOUNT_ACCESS_ERR') status = 400;
    res.status(status).json({ error: error.message || String(error), error_code: code });
  }
});

router.get('/audit-logs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 200;
    const logs = getAuditLogs(Math.min(limit, 1000));
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/integrations/mcp/tools', (req, res) => {
  res.json({
    status: 'reserved',
    message: 'MCP 工具网关已预留。第一版不调用外部工具。',
    adapters: ['AiAnalyzer', 'OcrExtractor', 'NasPublisher', 'MessageVerifier', 'McpToolGateway']
  });
});

module.exports = router;
