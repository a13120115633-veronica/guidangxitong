const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');
const { readJsonIfExists, writeJson } = require('./utils');

const STATE_PATH = path.join(DATA_DIR, 'app-state.json');

const DEFAULT_STATE = {
  projects: [],
  files: [],
  nasJobs: [],
  auditLogs: [],
  projectSourceCache: {
    sourceUrl: '',
    lastSyncedAt: '',
    count: 0,
    items: [],
    lastError: ''
  }
};

let cache = null;
let writeTimer = null;

function loadState() {
  if (cache) return cache;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  cache = readJsonIfExists(STATE_PATH, null);
  if (!cache || typeof cache !== 'object') {
    cache = JSON.parse(JSON.stringify(DEFAULT_STATE));
    persistNow();
  }
  Object.keys(DEFAULT_STATE).forEach((k) => {
    if (cache[k] === undefined) cache[k] = DEFAULT_STATE[k];
  });
  return cache;
}

function persistNow() {
  writeJson(STATE_PATH, cache || DEFAULT_STATE);
}

function saveState() {
  if (!cache) return;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => persistNow(), 30);
}

function state() {
  return loadState();
}

function projectsTable() {
  return {
    all: () => state().projects,
    get: (id) => state().projects.find((p) => p.id === id),
    findByRootName: (rootName) => state().projects.find((p) => p.root_name === rootName),
    upsert: (project) => {
      const arr = state().projects;
      const idx = arr.findIndex((p) => p.id === project.id);
      if (idx >= 0) arr[idx] = { ...arr[idx], ...project };
      else arr.unshift(project);
      saveState();
      return project;
    },
    search: (q) => {
      const query = (q || '').trim().toLowerCase();
      const arr = state().projects;
      const order = { mine: 0, related: 1, other: 2 };
      return arr
        .filter((p) =>
          !query ||
          [p.root_name, p.name, p.month_key, p.owner, p.department, p.summary]
            .some((v) => String(v || '').toLowerCase().includes(query))
        )
        .sort((a, b) => (order[a.priority] ?? 9) - (order[b.priority] ?? 9) || String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    }
  };
}

function filesTable() {
  return {
    all: () => state().files,
    get: (id) => state().files.find((f) => f.id === id),
    unshift: (file) => { state().files.unshift(file); saveState(); return file; },
    update: (id, patch) => {
      const f = state().files.find((x) => x.id === id);
      if (!f) return null;
      Object.assign(f, patch);
      saveState();
      return f;
    },
    byProject: (projectId) => state().files.filter((f) => f.project_id === projectId)
      .sort((a, b) => String(b.uploaded_at || '').localeCompare(String(a.uploaded_at || ''))),
    filter: (predicate) => state().files.filter(predicate)
      .sort((a, b) => String(b.uploaded_at || '').localeCompare(String(a.uploaded_at || '')))
  };
}

function nasJobsTable() {
  return {
    all: () => state().nasJobs,
    get: (id) => state().nasJobs.find((j) => j.id === id),
    unshift: (job) => { state().nasJobs.unshift(job); saveState(); return job; },
    update: (id, patch) => {
      const j = state().nasJobs.find((x) => x.id === id);
      if (!j) return null;
      Object.assign(j, patch);
      saveState();
      return j;
    }
  };
}

function auditLogsTable() {
  return {
    all: () => state().auditLogs,
    unshift: (log) => { state().auditLogs.unshift(log); saveState(); return log; }
  };
}

function sourceCache() {
  return {
    get: () => state().projectSourceCache,
    set: (patch) => {
      state().projectSourceCache = { ...state().projectSourceCache, ...patch };
      saveState();
      return state().projectSourceCache;
    }
  };
}

module.exports = {
  state,
  persistNow,
  projectsTable,
  filesTable,
  nasJobsTable,
  auditLogsTable,
  sourceCache
};
