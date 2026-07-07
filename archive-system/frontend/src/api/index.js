import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000
});

api.interceptors.response.use(
  (res) => {
    const rt = res.config && res.config.responseType;
    if (rt === 'blob' || rt === 'arraybuffer') {
      return { data: res.data, headers: res.headers || {}, status: res.status, statusText: res.statusText };
    }
    return res.data;
  },
  async (err) => {
    const res = err && err.response;
    const rt = res && res.config && res.config.responseType;
    let errData = res ? res.data : null;
    const isBlob = rt === 'blob' && typeof Blob !== 'undefined' && errData instanceof Blob;
    const isBuffer = rt === 'arraybuffer';
    if (isBlob) {
      try {
        const txt = await errData.text();
        try { errData = JSON.parse(txt || '{}'); } catch (_) { errData = { _raw: txt }; }
      } catch (_) {}
    } else if (isBuffer && errData && typeof errData === 'object') {
      try {
        const txt = new TextDecoder('utf-8').decode(errData);
        try { errData = JSON.parse(txt || '{}'); } catch (_) { errData = {}; }
      } catch (_) {}
    }
    const msg = (errData && errData.error) ? String(errData.error) : (err?.message || '请求失败');
    const error = new Error(msg);
    if (res) {
      error.response = {
        data: errData,
        headers: res.headers || {},
        status: res.status,
        statusText: res.statusText,
        config: res.config
      };
    }
    return Promise.reject(error);
  }
);

export const archiveApi = {
  getStandard: () => api.get('/archive-standard'),
  getPaths: () => api.get('/archive-paths')
};

export const projectApi = {
  getSourceStatus: () => api.get('/project-source/status'),
  syncSource: () => api.post('/project-source/sync'),
  search: (q = '') => api.get(`/projects?q=${encodeURIComponent(q)}`),
  getDetail: (id) => api.get(`/projects/${id}`)
};

export const fileApi = {
  list: (params = {}) => {
    const usp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') usp.set(k, v); });
    return api.get(`/files?${usp.toString()}`);
  },
  download: (id) => `/api/files/${id}/download`,
  downloadById: (id) => api.get(`/files/${id}/download`, { responseType: 'blob' }),
  nasScan: (params = {}) => {
    const usp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') usp.set(k, v); });
    return api.get(`/files/nas/scan?${usp.toString()}`);
  },
  nasDownloadUrl: ({ mountRoot, relativePath, absolutePath, downloadName } = {}) => {
    const usp = new URLSearchParams();
    if (mountRoot) usp.set('mount_root', mountRoot);
    if (relativePath) usp.set('relative_path', relativePath);
    if (absolutePath) usp.set('absolute_path', absolutePath);
    if (downloadName) usp.set('download_name', downloadName);
    return `/api/files/nas/download?${usp.toString()}`;
  },
  downloadNas: async ({ mountRoot, relativePath, absolutePath, downloadName } = {}) => {
    const params = {};
    if (mountRoot) params.mount_root = mountRoot;
    if (relativePath) params.relative_path = relativePath;
    if (absolutePath) params.absolute_path = absolutePath;
    if (downloadName) params.download_name = downloadName;
    return api.get('/files/nas/download', { params, responseType: 'blob' });
  },
  nasConfig: () => api.get('/files/nas/config'),
  upload: (formData, onProgress) =>
    api.post('/files/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: onProgress ? (e) => onProgress(Math.round((e.loaded * 100) / (e.total || 1))) : undefined
    }),
  getContent: (id) => api.get(`/files/${id}/content`),
  reExtract: (id, actor = '管理员') => api.post(`/files/${id}/re-extract`, { actor }),
  queueStats: () => api.get('/extract-queue/stats')
};

export const reviewApi = {
  list: (params = {}) => {
    const usp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') usp.set(k, v); });
    return api.get(`/review/tasks?${usp.toString()}`);
  },
  approve: (fileId, data) => api.post(`/review/tasks/${fileId}/approve`, data),
  modify: (fileId, data) => api.post(`/review/tasks/${fileId}/modify`, data),
  needsInfo: (fileId, data) => api.post(`/review/tasks/${fileId}/needs-info`, data),
  reject: (fileId, data) => api.post(`/review/tasks/${fileId}/reject`, data)
};

export const adminApi = {
  listNasJobs: () => api.get('/nas/jobs'),
  markNasUploaded: (id, data = {}) => api.post(`/nas/jobs/${id}/mark-manually-uploaded`, data),
  renameNasJob: (id, data = {}) => api.post(`/nas/jobs/${id}/rename`, data),
  getNasStatus: (mountRoot = null) => {
    const url = mountRoot && String(mountRoot).trim()
      ? `/nas/status?mount_root=${encodeURIComponent(String(mountRoot).trim())}`
      : '/nas/status';
    return api.get(url);
  },
  getNasHeartbeat: (runNow = false) => {
    const url = runNow ? '/nas/heartbeat?run_now=1' : '/nas/heartbeat';
    return api.get(url);
  },
  getNasSettings: () => api.get('/nas/settings'),
  saveNasSettings: (payload = {}) => api.post('/nas/settings', payload),
  pushNasJob: (id, data = {}) => api.post(`/nas/jobs/${id}/push`, data),
  pushAllNasJobs: (data = {}) => api.post('/nas/jobs/push-all', data),
  scanNas: (params = {}) => {
    const usp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') usp.set(k, v); });
    return api.get(`/nas/scan?${usp.toString()}`);
  },
  adminNasDownloadUrl: ({ mountRoot, relativePath, absolutePath, downloadName } = {}) => {
    const usp = new URLSearchParams();
    if (mountRoot) usp.set('mount_root', mountRoot);
    if (relativePath) usp.set('relative_path', relativePath);
    if (absolutePath) usp.set('absolute_path', absolutePath);
    if (downloadName) usp.set('download_name', downloadName);
    return `/api/nas/file/download?${usp.toString()}`;
  },
  downloadNasFile: async ({ mountRoot, relativePath, absolutePath, downloadName } = {}) => {
    const params = {};
    if (mountRoot) params.mount_root = mountRoot;
    if (relativePath) params.relative_path = relativePath;
    if (absolutePath) params.absolute_path = absolutePath;
    if (downloadName) params.download_name = downloadName;
    return api.get('/nas/file/download', { params, responseType: 'blob' });
  },
  auditLogs: (limit = 200) => api.get(`/audit-logs?limit=${limit}`),
  mcpTools: (payload) => api.post('/integrations/mcp/tools', payload || {})
};

export default api;
