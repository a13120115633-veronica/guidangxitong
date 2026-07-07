const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  ORIGINAL_UPLOADS_DIR,
  MAX_FILE_UPLOAD_BYTES,
  MAX_FILES_PER_UPLOAD,
  ROOT
} = require('../config');
const {
  safeName,
  decodeOriginalName,
  ensureInside,
  inferDevice,
  validateUploadedFiles,
  generateId
} = require('../utils');
const { getProjectById } = require('../services/project-service');
const {
  createFileRecord,
  getFileById,
  listFiles,
  resolveDownloadFile,
  getFileContent,
  reExtractFile,
  resolveNasDownloadFile,
  streamFileDownloadSafe,
  getPublicNasConfig,
  scanNasDirectory,
  getMountRootOrDefault
} = require('../services/file-service');
const extractQueue = require('../services/extract-queue');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(ORIGINAL_UPLOADS_DIR)) {
      fs.mkdirSync(ORIGINAL_UPLOADS_DIR, { recursive: true });
    }
    cb(null, ORIGINAL_UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const id = generateId('f');
    const original = safeName(decodeOriginalName(file.originalname));
    cb(null, `${id}-${original}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_UPLOAD_BYTES,
    files: MAX_FILES_PER_UPLOAD
  }
});

router.get('/files', (req, res) => {
  try {
    const { status, projectId, q, uploader } = req.query;
    const files = listFiles({ status, projectId, q, uploader });
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/files/nas/config', (req, res) => {
  try {
    res.json(getPublicNasConfig());
  } catch (error) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

router.get('/files/nas/scan', (req, res) => {
  try {
    const { mount_root, project_id, q, limit, offset } = req.query || {};
    let mountRoot = '';
    try {
      mountRoot = getMountRootOrDefault(mount_root);
    } catch (e) {
      return res.status(412).json({ error: e.message || '未配置 NAS 挂载', error_code: e.code || 'NAS_MOUNT_NOT_SET' });
    }
    const data = scanNasDirectory({
      mountRoot,
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

router.get('/files/nas/download', (req, res) => {
  try {
    const { mount_root, relative_path, absolute_path, download_name } = req.query || {};
    console.log('[NAS下载:路由入口] 收到请求，query =', JSON.stringify({
      mount_root: mount_root ? String(mount_root).slice(0, 120) : '',
      relative_path: relative_path ? String(relative_path).slice(0, 120) : '',
      absolute_path: absolute_path ? String(absolute_path).slice(0, 160) : '',
      download_name: download_name || ''
    }, null, 0));
    let mountRoot = '';
    try {
      mountRoot = getMountRootOrDefault(mount_root);
      console.log('[NAS下载:路由入口] getMountRootOrDefault 返回有效根 =', mountRoot);
    } catch (e) {
      console.log('[NAS下载:路由入口] getMountRootOrDefault 失败：', e && e.code, e && e.message);
      return res.status(412).json({ error: e.message || '未配置 NAS 挂载', error_code: e.code || 'NAS_MOUNT_NOT_SET' });
    }
    const dl = resolveNasDownloadFile({
      mountRoot,
      relativePath: relative_path,
      absolutePath: absolute_path,
      downloadName: download_name
    });
    if (!dl) {
      console.log('[NAS下载:路由入口] resolveNasDownloadFile 返回 null（文件未找到），返回 404');
      return res.status(404).json({ error: '文件不存在或路径越界', error_code: 'NAS_FILE_NOT_FOUND' });
    }
    console.log('[NAS下载:路由入口] 准备下发文件：absolutePath=', dl.absolutePath, 'downloadName=', dl.downloadName, 'strategy=', dl._hitStrategy);
    streamFileDownloadSafe(res, dl.absolutePath, {
      contentType: dl.contentType,
      downloadName: dl.downloadName,
      relativePath: dl.relativePath
    });
  } catch (error) {
    const code = error.code || null;
    let status = 500;
    if (code === 'NAS_MOUNT_NOT_SET') status = 412;
    else if (code === 'NAS_MOUNT_MISSING' || code === 'NAS_MOUNT_NOT_DIR' || code === 'NAS_FILE_NOT_FOUND') status = 404;
    else if (code === 'NAS_MOUNT_ACCESS_ERR') status = 400;
    console.log('[NAS下载:路由入口] 异常：code=', code, 'msg=', error && error.message, 'stack=', error && error.stack && error.stack.slice(0, 200));
    res.status(status).json({ error: error.message || String(error), error_code: code });
  }
});

router.get('/files/:id/download', (req, res) => {
  try {
    const { id } = req.params;
    if (id === 'nas' || id === 'download' || id === 'scan' || id === 'config' || id === 'content' || id === 'upload') {
      return res.status(400).json({ error: '非法的文件 ID', error_code: 'INVALID_FILE_ID' });
    }
    const file = getFileById(id);
    if (!file) return res.status(404).json({ error: '文件不存在' });
    const dl = resolveDownloadFile(file);
    if (!dl) return res.status(404).json({ error: '文件不存在' });
    const stats = fs.statSync(dl.absolutePath);
    res.setHeader('Content-Type', dl.contentType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(dl.downloadName)}`);
    fs.createReadStream(dl.absolutePath).pipe(res);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/files/:id/content', (req, res) => {
  try {
    const { id } = req.params;
    const content = getFileContent(id);
    res.json({ file: content, queue: extractQueue.stats() });
  } catch (error) {
    res.status(error.message === '文件不存在' ? 404 : 500).json({ error: error.message });
  }
});

router.post('/files/:id/re-extract', (req, res) => {
  try {
    const { id } = req.params;
    const { actor } = req.body || {};
    const result = reExtractFile(id, actor || '管理员');
    res.json({ ok: true, file: result, queue: extractQueue.stats() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/extract-queue/stats', (req, res) => {
  res.json(extractQueue.stats());
});

router.post('/files/upload', (req, res) => {
  upload.array('file', MAX_FILES_PER_UPLOAD)(req, res, (err) => {
    try {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: `单个文件不能超过 ${MAX_FILE_UPLOAD_BYTES / (1024 * 1024)}MB` });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({ error: `一次最多上传 ${MAX_FILES_PER_UPLOAD} 个文件` });
        }
        return res.status(400).json({ error: err.message });
      }
      const { projectId, uploader, department, note } = req.body;
      const files = req.files || [];
      if (!projectId || !uploader || !department || files.length === 0) {
        files.forEach((f) => { try { fs.unlinkSync(f.path); } catch (_) {} });
        return res.status(400).json({ error: '项目、上传人、部门、文件必填' });
      }
      validateUploadedFiles(files.map((f) => ({ originalname: f.originalname, size: f.size })));
      const project = getProjectById(projectId);
      if (!project) {
        files.forEach((f) => { try { fs.unlinkSync(f.path); } catch (_) {} });
        return res.status(404).json({ error: '项目不存在' });
      }
      const createdFiles = files.map((file) => {
        const storedRel = `storage/00_original_uploads/${path.basename(file.path)}`;
        const absPath = ensureInside(ORIGINAL_UPLOADS_DIR, file.path);
        return createFileRecord({
          projectId,
          originalName: safeName(decodeOriginalName(file.originalname)),
          storedPath: storedRel,
          size: file.size,
          mimeType: file.mimetype || 'application/octet-stream',
          uploader: String(uploader).trim(),
          department: String(department).trim(),
          note: String(note || '').trim(),
          device: inferDevice(req.headers['user-agent'])
        });
      });
      res.status(201).json({ files: createdFiles, count: createdFiles.length });
    } catch (error) {
      (req.files || []).forEach((f) => { try { fs.unlinkSync(f.path); } catch (_) {} });
      res.status(400).json({ error: error.message });
    }
  });
});

module.exports = router;
