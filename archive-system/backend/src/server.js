require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { PORT, HOST, STORAGE_DIR, DATA_DIR, ROOT, READY_FOR_NAS_DIR, ORIGINAL_UPLOADS_DIR, NAS_CONFIG } = require('./config');
require('./database');

const archiveRoutes = require('./routes/archive');
const projectRoutes = require('./routes/projects');
const fileRoutes = require('./routes/files');
const reviewRoutes = require('./routes/review');
const adminRoutes = require('./routes/admin');
const reportRoutes = require('./routes/report');

[STORAGE_DIR, DATA_DIR, READY_FOR_NAS_DIR, ORIGINAL_UPLOADS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

require('./services/extract-queue').start();

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

app.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.use('/api', archiveRoutes);
app.use('/api', projectRoutes);
app.use('/api', fileRoutes);
app.use('/api', reviewRoutes);
app.use('/api', adminRoutes);
app.use('/api', reportRoutes);

const FRONTEND_DIR = path.join(ROOT, '..', 'frontend', 'dist');
if (fs.existsSync(FRONTEND_DIR)) {
  app.use(express.static(FRONTEND_DIR));
  app.get(/^(?!\/api|\/health|\/storage).*/, (req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
  });
} else {
  const SIMPLE_UI = path.join(ROOT, 'public');
  if (fs.existsSync(SIMPLE_UI)) {
    app.use(express.static(SIMPLE_UI));
  }
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

app.listen(PORT, HOST, () => {
  console.log(`公司资料统一归档系统已启动: http://${HOST}:${PORT}`);
  console.log(`后端 API 根路径: /api`);
  console.log(`数据目录: ${DATA_DIR}`);
  console.log(`存储目录: ${STORAGE_DIR}`);

  const mount = NAS_CONFIG.mountRoot;
  if (!mount) {
    console.log('[NAS 推送] 未设置 NAS_MOUNT_ROOT（可在 待上传NAS 页面填挂载路径）');
  } else {
    try {
      const exists = fs.existsSync(mount);
      const stats = exists ? fs.statSync(mount) : null;
      const isDir = stats ? stats.isDirectory() : false;
      let writable = false;
      if (isDir) {
        try {
          const probe = path.join(mount, '.archive_write_probe_' + Date.now());
          fs.writeFileSync(probe, 'ok');
          writable = true;
          try { fs.unlinkSync(probe); } catch (_) {}
        } catch (_) { writable = false; }
      }
      if (exists && isDir && writable) {
        console.log(`[NAS 推送] ✅ 挂载点可用，模式=${NAS_CONFIG.copyMode}，根目录=${mount}`);
      } else {
        console.log(`[NAS 推送] ⚠️  挂载点异常：exists=${exists} isDir=${isDir} writable=${writable} 路径=${mount}`);
      }
    } catch (e) {
      console.log(`[NAS 推送] ❌ 检测挂载点失败：${e.message} 路径=${mount}`);
    }
  }
});
