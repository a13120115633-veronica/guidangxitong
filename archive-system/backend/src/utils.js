const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { BLOCKED_UPLOAD_EXTENSIONS, BLOCKED_UPLOAD_FILENAMES, ALLOWED_UPLOAD_EXTENSIONS, MAX_FILE_UPLOAD_BYTES, MAX_FILES_PER_UPLOAD } = require('./config');

function nowText() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function safeName(name) {
  return String(name || '未命名文件').replace(/[\\/:*?"<>|]/g, '_').slice(0, 180);
}

function looksLikeUtf8Mojibake(str) {
  if (!str) return false;
  return /[À-ß][\u0080-\u00bf]|[\u0080-\u00ff]{2,}/.test(str);
}

function containsReadableCjk(text) {
  return /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]{1,}/.test(text || '');
}

function cjkCount(text) {
  const m = String(text || '').match(/[\u4e00-\u9fff\u3400-\u4dbf]/g);
  return m ? m.length : 0;
}

function containsControl(text) {
  return /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text || '');
}

function decodeOriginalName(raw) {
  const name = String(raw == null ? '' : raw);
  if (!name) return '未命名文件';
  if (containsReadableCjk(name) && !looksLikeUtf8Mojibake(name)) {
    return name;
  }

  // 优先级 1：现代手机浏览器/微信/小程序 上传时 HTTP multipart 里 filename 是 UTF-8 字节
  // 但 Node Multer 默认按 Latin1(ISO-8859-1) 把 1 字节=1 字符 decode 出来 → 还原用同样编码原路回去再解 UTF-8
  for (const enc of ['latin1', 'binary']) {
    try {
      const b = Buffer.from(name, enc);
      const decoded = b.toString('utf-8');
      if (containsReadableCjk(decoded) && !containsControl(decoded)) {
        return decoded;
      }
    } catch (_) { /* ignore */ }
  }

  // 优先级 2：国产老安卓 / 微信内置浏览器个别版本走 GBK → iconv-lite
  try {
    const iconv = require('iconv-lite');
    for (const enc of ['gbk', 'gb18030', 'cp936']) {
      for (const src of ['binary', 'utf-8']) {
        try {
          const b = Buffer.from(name, src);
          const decoded = iconv.decode(b, enc);
          if (containsReadableCjk(decoded) && !containsControl(decoded)) {
            return decoded;
          }
        } catch (_) { /* ignore */ }
      }
    }
  } catch (_) { /* 没装 iconv-lite 跳过 */ }

  // 兜底：原样返回（但至少做一次 safeName 调用方会做）
  return name;
}

function safeRelativePath(relativePath) {
  return String(relativePath || '')
    .split('/')
    .map((part) => safeName(part).trim())
    .filter(Boolean)
    .join('/');
}

function ensureInside(baseDir, targetPath) {
  const base = path.resolve(baseDir);
  const target = path.resolve(targetPath);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('目标路径不安全');
  }
  return target;
}

function generateId(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

function projectDisplayName(rootName) {
  const clean = String(rootName || '').trim();
  const match = clean.match(/^(\d{8})-(.+)$/);
  return match ? match[2] : clean;
}

function inferDevice(userAgent = '') {
  if (/iPhone|iPad/i.test(userAgent)) return 'iPhone / iPad';
  if (/Android/i.test(userAgent)) return 'Android';
  if (/Macintosh|Mac OS/i.test(userAgent)) return 'Mac';
  if (/Windows/i.test(userAgent)) return 'Windows';
  return '未知设备';
}

function validateUploadedFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('请选择要上传的文件');
  }
  if (files.length > MAX_FILES_PER_UPLOAD) {
    throw new Error(`一次最多上传 ${MAX_FILES_PER_UPLOAD} 个文件`);
  }
  const validFiles = files.filter((f) => f && f.originalname);
  validFiles.forEach((file) => {
    const originalName = safeName(decodeOriginalName(file.originalname));
    const lowerName = originalName.toLowerCase();
    const ext = path.extname(lowerName);
    if (BLOCKED_UPLOAD_FILENAMES.has(lowerName) || lowerName.startsWith('._') || lowerName.startsWith('~$')) {
      throw new Error(`不允许上传系统临时文件：${originalName}`);
    }
    if (BLOCKED_UPLOAD_EXTENSIONS.has(ext)) {
      throw new Error(`不允许上传该类型文件：${originalName}`);
    }
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
      throw new Error(`暂不支持该文件类型：${originalName}`);
    }
    const size = file.size || (file.buffer ? file.buffer.length : 0);
    if (size > MAX_FILE_UPLOAD_BYTES) {
      throw new Error(`单个文件不能超过 ${Math.round(MAX_FILE_UPLOAD_BYTES / (1024 * 1024))}MB：${originalName}`);
    }
  });
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

module.exports = {
  nowText,
  safeName,
  decodeOriginalName,
  safeRelativePath,
  ensureInside,
  generateId,
  projectDisplayName,
  inferDevice,
  validateUploadedFiles,
  readJsonIfExists,
  writeJson
};
