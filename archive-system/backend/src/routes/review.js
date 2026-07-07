const express = require('express');
const {
  listReviewTasks,
  approveReview,
  needsInfoReview,
  rejectReview,
  getFileById
} = require('../services/file-service');

const router = express.Router();

router.get('/review/tasks', (req, res) => {
  try {
    const { q, lowConfidence } = req.query;
    let tasks = listReviewTasks();
    if (q) {
      const query = String(q).toLowerCase();
      tasks = tasks.filter((t) =>
        [t.original_name, t.uploader, t.department, t.note, t.ai_target_path, t.ai_suggested_name]
          .some((v) => String(v || '').toLowerCase().includes(query))
      );
    }
    if (lowConfidence === 'true' || lowConfidence === '1') {
      tasks = tasks.filter((t) => (t.ai_confidence || 0) < 0.6);
    }
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/review/tasks/:fileId/approve', (req, res) => {
  try {
    const { fileId } = req.params;
    const { targetPath, finalName, reviewer } = req.body || {};
    const file = getFileById(fileId);
    if (!file) return res.status(404).json({ error: '文件不存在' });
    const result = approveReview(fileId, { targetPath, finalName, reviewer });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/review/tasks/:fileId/modify', (req, res) => {
  try {
    const { fileId } = req.params;
    const { targetPath, finalName, reviewer } = req.body || {};
    const file = getFileById(fileId);
    if (!file) return res.status(404).json({ error: '文件不存在' });
    const result = approveReview(fileId, { targetPath, finalName, reviewer });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/review/tasks/:fileId/needs-info', (req, res) => {
  try {
    const { fileId } = req.params;
    const { comment, reviewer } = req.body || {};
    const file = getFileById(fileId);
    if (!file) return res.status(404).json({ error: '文件不存在' });
    const result = needsInfoReview(fileId, { comment, reviewer });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/review/tasks/:fileId/reject', (req, res) => {
  try {
    const { fileId } = req.params;
    const { comment, reviewer } = req.body || {};
    const file = getFileById(fileId);
    if (!file) return res.status(404).json({ error: '文件不存在' });
    const result = rejectReview(fileId, { comment, reviewer });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
