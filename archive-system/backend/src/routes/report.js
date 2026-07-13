const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const router = express.Router();

const reportSvc = require('../services/report-service');

const ADMIN_PASSWORD = 'admin123';

function requireAdmin(req, res, next) {
  const fromHeader = String(req.headers['x-admin-password'] || '').trim();
  const fromQuery = String(req.query['admin_token'] || req.query['admin_password'] || '').trim();
  const fromBody = String((req.body && (req.body.adminPassword || req.body.admin_token || req.body.admin_password)) || '').trim();
  const ok = [fromHeader, fromQuery, fromBody].some((v) => v === ADMIN_PASSWORD);
  if (!ok) {
    return res.status(401).json({ error: '管理员鉴权失败，请在请求头带 x-admin-password: admin123，或与前端管理员登录一致' });
  }
  next();
}

const uploadDisk = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(os.tmpdir(), 'archive-report-uploads');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const safe = String(file.originalname || 'manual.xlsx')
        .replace(/[\\/:*?"<>|]+/g, '_')
        .slice(-80);
      cb(null, Date.now() + '_' + safe);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xlsx|xls)$/i.test(file.originalname || '');
    if (!ok) return cb(new Error('只允许上传 .xlsx / .xls 人工确认表'));
    cb(null, true);
  },
});

router.get('/report/skills/status', requireAdmin, async (_req, res) => {
  try {
    const info = await reportSvc.allSkillsDoctor();
    res.json({ ok: true, skills: info });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message || '自检失败' });
  }
});

router.get('/report/nas-projects', requireAdmin, async (_req, res) => {
  try {
    const data = await reportSvc.listNasProjects();
    res.json({ ok: true, ...data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message || 'NAS 项目列表获取失败' });
  }
});

router.get('/report/runs', requireAdmin, (_req, res) => {
  try {
    res.json({ ok: true, runs: reportSvc.listRuns() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/report/runs', requireAdmin, async (req, res) => {
  try {
    const { skillType, nasProjectPath, name } = req.body || {};
    if (!['plan', 'report'].includes(skillType)) {
      return res.status(400).json({ ok: false, error: 'skillType 必填，只能是 plan / report' });
    }
    if (!nasProjectPath) return res.status(400).json({ ok: false, error: 'nasProjectPath 不能为空（NAS 里项目源目录的绝对路径）' });
    if (!fs.existsSync(nasProjectPath)) {
      return res.status(400).json({ ok: false, error: 'NAS 项目源目录不存在：' + nasProjectPath });
    }
    const st = reportSvc.createRun({ skillType, nasProjectPath, name });
    res.json({ ok: true, run: st });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message || '创建 run 失败' });
  }
});

router.get('/report/runs/:runId', requireAdmin, (req, res) => {
  try {
    res.json({ ok: true, run: reportSvc.loadRunState(req.params.runId) });
  } catch (e) {
    res.status(404).json({ ok: false, error: e.message });
  }
});

router.post('/report/runs/:runId/preflight', requireAdmin, async (req, res) => {
  try {
    const result = await reportSvc.preflightRun(req.params.runId);
    res.json({ ok: !!result.ok, result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/report/runs/:runId/prepare', requireAdmin, async (req, res) => {
  try {
    const result = await reportSvc.prepareRun(req.params.runId);
    res.json({ ok: !!result.ok, ...result });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/report/runs/:runId/download/:file', requireAdmin, (req, res) => {
  try {
    const info = reportSvc.resolveDownloadFile(req.params.runId, req.params.file);
    if (!fs.existsSync(info.path)) throw new Error('文件不存在：' + info.path);
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="' + encodeURIComponent(info.name) + '"'
    );
    res.download(info.path, info.name);
  } catch (e) {
    res.status(404).json({ ok: false, error: e.message });
  }
});

router.post('/report/runs/:runId/upload-manual-form', requireAdmin, (req, res) => {
  uploadDisk.single('manualForm')(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ ok: false, error: err.message || '上传失败' });
      if (!req.file) return res.status(400).json({ ok: false, error: '缺少 manualForm 文件字段（xlsx）' });
      const r = await reportSvc.buildSmartFormFromUploadedManual(req.params.runId, req.file.path);
      res.json({ ok: !!r.ok, ...r });
    } catch (e) {
      console.error(e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
});

router.get('/report/runs/:runId/manual-json', requireAdmin, async (req, res) => {
  try {
    const data = await reportSvc.parseManualFormToJson(req.params.runId);
    res.json({ ok: true, data });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/report/runs/:runId/update-manual-and-build', requireAdmin, async (req, res) => {
  try {
    const payload = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? (req.body.payload || req.body)
      : null;
    if (!payload || !Array.isArray(payload.sheets)) {
      return res.status(400).json({ ok: false, error: '请求体必须是 { sheets: [...] } 结构' });
    }
    const r = await reportSvc.saveManualFormFromJsonAndBuild(req.params.runId, payload);
    res.json({ ok: !!r.ok, ...r });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/report/runs/:runId/recommend', requireAdmin, async (req, res) => {
  try {
    const { personnelSet } = req.body || {};
    const r = await reportSvc.recommendRun(req.params.runId, personnelSet);
    res.json({ ok: !!r.ok, ...r });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/report/runs/:runId/validate-timeline', requireAdmin, async (req, res) => {
  try {
    const r = await reportSvc.validateTimeline(req.params.runId);
    res.json({ ok: !!r.ok, ...r });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/report/runs/:runId/generate', requireAdmin, async (req, res) => {
  try {
    const { confirmTemplate } = req.body || {};
    const r = await reportSvc.generateRun(req.params.runId, { confirmTemplate: confirmTemplate !== false });
    res.json({ ok: !!r.ok, ...r });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/report/runs/:runId/audit', requireAdmin, async (req, res) => {
  try {
    const { passed, comment } = req.body || {};
    const r = await reportSvc.auditRun(req.params.runId, { passed: !!passed, comment: comment || '' });
    res.json({ ok: true, audit: r });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/report/runs/:runId/push-to-nas', requireAdmin, async (req, res) => {
  try {
    const { nasProjectPath } = req.body || {};
    const r = await reportSvc.pushAuditPassedToNas(req.params.runId, nasProjectPath || undefined);
    res.json({ ok: true, push: r });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/report/runs/:runId/reset', requireAdmin, (req, res) => {
  try {
    const st = reportSvc.loadRunState(req.params.runId);
    const patch = {
      steps: { picked: true },
      manualFormPath: null,
      smartFormPath: null,
      personnelSet: null,
      matchedTemplate: null,
      outputs: [],
      audit: null,
      nasPushTarget: null,
    };
    const next = reportSvc.saveRunState(req.params.runId, patch);
    res.json({ ok: true, run: next });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
