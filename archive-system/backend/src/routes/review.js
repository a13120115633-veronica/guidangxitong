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
    const { q, lowConfidence, categoryKey } = req.query;
    const opts = {};
    if (q) opts.q = q;
    if (lowConfidence === 'true' || lowConfidence === '1') opts.lowConfidence = true;
    if (categoryKey && categoryKey !== 'all') opts.categoryKey = categoryKey;
    const tasks = listReviewTasks(opts);
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/review/tasks/:fileId/approve', (req, res) => {
  try {
    const { fileId } = req.params;
    const { targetPath, finalName, reviewer, categoryOverrideReason, confirmNonDefaultCategory } = req.body || {};
    const file = getFileById(fileId);
    if (!file) return res.status(404).json({ error: '文件不存在' });
    const result = approveReview(fileId, {
      targetPath,
      finalName,
      reviewer,
      categoryOverrideReason,
      confirmNonDefaultCategory
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/review/tasks/:fileId/modify', (req, res) => {
  try {
    const { fileId } = req.params;
    const { targetPath, finalName, reviewer, categoryOverrideReason, confirmNonDefaultCategory } = req.body || {};
    const file = getFileById(fileId);
    if (!file) return res.status(404).json({ error: '文件不存在' });
    const result = approveReview(fileId, {
      targetPath,
      finalName,
      reviewer,
      categoryOverrideReason,
      confirmNonDefaultCategory
    });
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
