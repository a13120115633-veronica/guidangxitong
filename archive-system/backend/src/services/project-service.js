const { projectsTable, sourceCache } = require('../database');
const { PROJECT_SOURCE_URL, PROJECT_SOURCE_CACHE_PATH } = require('../config');
const { nowText, generateId, projectDisplayName, readJsonIfExists, writeJson } = require('../utils');

function projectInternalId(item) {
  const raw = String(item?.id || item?.name || generateId('proj'));
  return `official-${raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80)}`;
}

function normalizeOfficialProject(item, existingProject) {
  const rootName = String(item.name || item.rootName || '').trim();
  const monthKey = item.monthKey || (rootName.match(/^(\d{4})(\d{2})/) ? `${rootName.slice(0, 4)}-${rootName.slice(4, 6)}` : '');
  return {
    id: existingProject?.id || projectInternalId(item),
    source_id: String(item.id || ''),
    root_name: rootName,
    name: projectDisplayName(rootName),
    owner: existingProject?.owner || '未指定',
    department: existingProject?.department || '未指定',
    status: existingProject?.status || 'active',
    priority: existingProject?.priority || 'other',
    summary: existingProject?.summary || `来自公司项目名称库${monthKey ? `（${monthKey}）` : ''}`,
    source: 'official',
    month_key: monthKey,
    created_at: existingProject?.created_at || nowText(),
    updated_at: nowText()
  };
}

function getAllProjects() {
  return projectsTable().all();
}

function getProjectById(id) {
  return projectsTable().get(id);
}

function searchProjects(q) {
  return projectsTable().search(q);
}

function upsertProject(project) {
  return projectsTable().upsert(project);
}

async function fetchProjectSource() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(PROJECT_SOURCE_URL, {
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`项目库接口返回 ${response.status}`);
    const payload = await response.json();
    const items = Array.isArray(payload.items) ? payload.items : Array.isArray(payload) ? payload : [];
    if (!items.length) throw new Error('项目库没有返回项目');
    return items;
  } finally {
    clearTimeout(timer);
  }
}

function mergeAndUpsertProjects(sourceItems) {
  const localProjects = getAllProjects();
  const existingByRootName = new Map(localProjects.map((p) => [p.root_name, p]));
  const officialProjects = sourceItems
    .filter((item) => String(item?.name || item?.rootName || '').trim())
    .map((item) => normalizeOfficialProject(item, existingByRootName.get(String(item.name || item.rootName).trim())));
  officialProjects.forEach(upsertProject);
  const officialRootNames = new Set(officialProjects.map((p) => p.root_name));
  localProjects
    .filter((p) => !officialRootNames.has(p.root_name))
    .forEach((p) => upsertProject({ ...p, source: p.source || 'local' }));
  return officialProjects.length;
}

async function syncProjectSource() {
  const fallbackCache = readJsonIfExists(PROJECT_SOURCE_CACHE_PATH, {
    sourceUrl: PROJECT_SOURCE_URL,
    lastSyncedAt: '',
    count: 0,
    items: [],
    lastError: ''
  });
  try {
    const items = await fetchProjectSource();
    mergeAndUpsertProjects(items);
    const cache = {
      sourceUrl: PROJECT_SOURCE_URL,
      lastSyncedAt: nowText(),
      count: items.length,
      items,
      lastError: ''
    };
    writeJson(PROJECT_SOURCE_CACHE_PATH, cache);
    sourceCache().set(cache);
    return { ok: true, source: 'official', ...cache, localProjectCount: getAllProjects().length };
  } catch (error) {
    if (fallbackCache.items?.length) {
      mergeAndUpsertProjects(fallbackCache.items);
      fallbackCache.lastError = error.message;
      writeJson(PROJECT_SOURCE_CACHE_PATH, fallbackCache);
      sourceCache().set(fallbackCache);
      return { ok: false, source: 'cache', ...fallbackCache, localProjectCount: getAllProjects().length };
    }
    sourceCache().set({ lastError: error.message });
    return {
      ok: false,
      source: 'local',
      sourceUrl: PROJECT_SOURCE_URL,
      lastSyncedAt: '',
      count: 0,
      items: [],
      lastError: error.message,
      localProjectCount: getAllProjects().length
    };
  }
}

function getProjectSourceStatus() {
  const cache = readJsonIfExists(PROJECT_SOURCE_CACHE_PATH, sourceCache().get());
  const merged = { ...sourceCache().get(), ...cache };
  const hasData = (merged.items?.length || merged.count || 0) > 0;
  return {
    sourceUrl: merged.sourceUrl || PROJECT_SOURCE_URL,
    lastSyncedAt: merged.lastSyncedAt || '',
    count: merged.count || 0,
    localProjectCount: getAllProjects().length,
    lastError: merged.lastError || '',
    source: hasData ? (merged.lastError ? 'cache' : 'official') : 'local'
  };
}

module.exports = {
  getAllProjects,
  getProjectById,
  searchProjects,
  syncProjectSource,
  getProjectSourceStatus,
  upsertProject
};
