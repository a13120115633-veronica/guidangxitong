export function formatSize(bytes) {
  if (bytes == null) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function statusLabel(s) {
  const map = {
    pending_review: '待审核',
    needs_info: '需补充',
    rejected: '已拒绝',
    ready_for_nas: '等待管理员上传',
    manually_uploaded: '已归档'
  };
  return map[s] || s;
}

export function statusClass(s) {
  return `status-tag status-${s || 'pending_review'}`;
}

export function downloadLabel(s) {
  if (s === 'manually_uploaded') return '下载归档文件';
  return '下载原始文件';
}

export function canDownloadArchived(s) {
  return s === 'manually_uploaded';
}

export function highlightText(text, keyword) {
  if (!keyword) return text || '';
  const t = String(text || '');
  const k = String(keyword).trim();
  if (!k) return t;
  try {
    const parts = t.split(new RegExp(`(${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'));
    return parts.map((p) => p.toLowerCase() === k.toLowerCase()
      ? `<mark style="background:#fef08a;padding:0 2px;border-radius:2px;">${p}</mark>` : p
    ).join('');
  } catch {
    return t;
  }
}

export function displayFileName(f) {
  if (!f) return '';
  const nested = f.file || {};
  return f.final_name
    || nested.final_name
    || f.ai_suggested_name
    || nested.ai_suggested_name
    || nested.suggested_name
    || f.original_name
    || nested.original_name
    || nested.original_filename
    || f.file_name
    || f.name
    || '';
}

export function originalFileName(f) {
  if (!f) return '';
  const nested = f.file || {};
  return f.original_name
    || nested.original_name
    || nested.original_filename
    || nested.client_name
    || f.file_name
    || f.name
    || f.final_name
    || nested.final_name
    || '';
}

export function isRenamed(f) {
  if (!f) return false;
  const finalN = displayFileName(f);
  const origN = originalFileName(f);
  if (!finalN) return false;
  if (!origN) return false;
  return finalN !== origN;
}

export function finalPathPreview(f, projectDisplayName) {
  if (!f) return '';
  const nested = f.file || {};
  const raw = f.final_path
    || nested.final_path
    || f.ai_target_path
    || nested.ai_target_path
    || f.target_relative_path
    || nested.target_relative_path
    || '';
  const project = projectDisplayName
    || f.project?.root_name
    || f.project?.name
    || f.project_name
    || nested.project?.root_name
    || nested.project?.name
    || '';

  if (!raw && !project) return '';

  if (raw) {
    if (project && !String(raw).startsWith(String(project) + '/')) {
      return `${project}/${raw}`;
    }
    return raw;
  }

  return project;
}

export function extractFilenameFromHeaders(headers, fallbackName = 'download') {
  try {
    const hdrs = headers || {};
    const disp = String(hdrs['content-disposition'] || hdrs['Content-Disposition'] || '');
    if (disp) {
      const starMatch = disp.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;]+)/i);
      if (starMatch && starMatch[1]) {
        try { return decodeURIComponent(starMatch[1].trim().replace(/^"|"$/g, '')); } catch (_) {}
      }
      const plainMatch = disp.match(/filename\s*=\s*"([^"]+)"/i) || disp.match(/filename\s*=\s*([^;]+)/i);
      if (plainMatch && plainMatch[1]) return plainMatch[1].trim();
    }
  } catch (_) {}
  return fallbackName || 'download';
}

export async function saveBlobFromResponse(resp, fallbackName = 'download') {
  const data = resp?.data;
  if (!data) throw new Error('下载响应为空');
  const headers = resp?.headers || {};
  const ct = (headers['content-type'] || headers['Content-Type'] || 'application/octet-stream').toString().toLowerCase();
  const isJsonBlob = (typeof Blob !== 'undefined' && data instanceof Blob && data.type && data.type.toLowerCase().includes('application/json'));
  if (ct.includes('application/json') || isJsonBlob) {
    let parsed = null;
    try {
      const text = typeof data === 'string' ? data : (data instanceof Blob ? await data.text() : JSON.stringify(data));
      parsed = JSON.parse(text || '{}');
    } catch (_) { parsed = null; }
    throw new Error((parsed && parsed.error) ? String(parsed.error) : '下载失败：返回格式异常');
  }
  const finalName = extractFilenameFromHeaders(headers, fallbackName);
  const blob = data instanceof Blob ? data : new Blob([data], { type: ct || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = finalName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { try { document.body.removeChild(a); } catch (_) {} }, 100);
  } finally {
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 5000);
  }
  return true;
}

