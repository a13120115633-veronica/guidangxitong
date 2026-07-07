const express = require('express');
const fs = require('fs');
const path = require('path');
const { ARCHIVE_STANDARD_PATH } = require('../config');
const { flattenArchiveNodes } = require('../services/ai-service');

const router = express.Router();

router.get('/archive-standard', (req, res) => {
  try {
    if (!fs.existsSync(ARCHIVE_STANDARD_PATH)) {
      return res.status(404).json({ error: '归档标准文件不存在' });
    }
    const standard = JSON.parse(fs.readFileSync(ARCHIVE_STANDARD_PATH, 'utf8'));
    res.json(standard);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/archive-paths', (req, res) => {
  try {
    if (!fs.existsSync(ARCHIVE_STANDARD_PATH)) {
      return res.status(404).json({ error: '归档标准文件不存在' });
    }
    const standard = JSON.parse(fs.readFileSync(ARCHIVE_STANDARD_PATH, 'utf8'));
    const paths = flattenArchiveNodes(standard.rootFolders || []);
    res.json(paths);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
