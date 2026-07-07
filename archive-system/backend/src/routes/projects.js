const express = require('express');
const {
  searchProjects,
  getProjectById,
  syncProjectSource,
  getProjectSourceStatus
} = require('../services/project-service');
const { getFilesByProjectId, getProjectStats } = require('../services/file-service');

const router = express.Router();

router.get('/project-source/status', (req, res) => {
  try {
    res.json(getProjectSourceStatus());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/project-source/sync', async (req, res) => {
  try {
    const result = await syncProjectSource();
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/projects', (req, res) => {
  try {
    const q = req.query.q || '';
    const projects = searchProjects(q);
    res.json(projects);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/projects/:id', (req, res) => {
  try {
    const { id } = req.params;
    const project = getProjectById(id);
    if (!project) return res.status(404).json({ error: '项目不存在' });
    const files = getFilesByProjectId(id);
    const stats = getProjectStats(id);
    res.json({ project, files, stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
