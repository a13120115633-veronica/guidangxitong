const fs = require('fs');
const path = require('path');
const { ROOT, ORIGINAL_UPLOADS_DIR, ARK_CONFIG } = require('../config');
const { ensureInside } = require('../utils');

const MAX_CHARS = ARK_CONFIG.EXTRACT_MAX_TEXT_CHARS;
const IMAGE_EXT_SET = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp', '.heic', '.heif', '.webp']);
const DOC_TEXT_EXT_SET = new Set(['.txt', '.md', '.csv', '.json', '.xml', '.log', '.ini']);
const OFFICE_SKIP_SET = new Set(['.xls', '.xlsx', '.ppt', '.pptx', '.et', '.dps', '.dwg', '.dxf', '.zip', '.rar', '.7z', '.ofd']);

function truncateMiddle(text, maxChars = MAX_CHARS) {
  const s = String(text || '').replace(/\r\n|\r/g, '\n').replace(/\u0000/g, '');
  if (s.length <= maxChars) return s;
  const head = Math.floor(maxChars * 0.62);
  const tail = maxChars - head - 20;
  return `${s.slice(0, head)}\n\n……【中间截断，省略 ${s.length - head - tail} 字符】……\n\n${s.slice(-tail)}`;
}

function resolveStored(file) {
  const originalPath = path.resolve(ROOT, file.stored_path || '');
  const uploadsRoot = path.resolve(ORIGINAL_UPLOADS_DIR);
  if (!originalPath.startsWith(uploadsRoot) || !fs.existsSync(originalPath)) {
    throw new Error('原始文件不存在或路径不安全');
  }
  return ensureInside(uploadsRoot, originalPath);
}

async function extractPdf(filePath) {
  const result = { text: '', method: 'local-pdf', pageCount: 0 };
  try {
    const pdfParse = require('pdf-parse');
    const dataBuffer = fs.readFileSync(filePath);
    const parsed = await pdfParse(dataBuffer, { max: ARK_CONFIG.EXTRACT_MAX_TEXT_CHARS });
    result.text = parsed.text || '';
    result.pageCount = parsed.numpages || 0;
    result.info = {
      numpages: parsed.numpages,
      title: parsed.info?.Title,
      author: parsed.info?.Author,
      producer: parsed.info?.Producer
    };
    const stripped = result.text.replace(/\s+/g, '');
    if (stripped.length < 200) {
      result.scanned = true;
      result.method = 'scan-pdf-needs-ocr';
    }
  } catch (e) {
    result.error = `pdf-parse 失败：${e.message}`;
    result.method = 'local-pdf-failed';
  }
  return result;
}

async function extractDocx(filePath) {
  const result = { text: '', method: 'local-docx' };
  try {
    const mammoth = require('mammoth');
    const buf = fs.readFileSync(filePath);
    const r = await mammoth.extractRawText({ buffer: buf });
    result.text = r.value || '';
    if (r.messages && r.messages.length) {
      result.warning = r.messages.map((m) => String(m.message || m.type || '')).filter(Boolean).join('；');
    }
  } catch (e) {
    result.error = `mammoth docx 失败：${e.message}`;
    result.method = 'local-docx-failed';
  }
  return result;
}

async function _execStdout(command, args, timeoutMs = 30000) {
  try {
    const { spawn } = require('child_process');
    return await new Promise((resolve, reject) => {
      const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let outBuf = Buffer.alloc(0);
      let errBuf = Buffer.alloc(0);
      const timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch (_) {}
        reject(new Error(`命令执行超时 (${timeoutMs}ms)`));
      }, timeoutMs);
      proc.stdout.on('data', (d) => { outBuf = Buffer.concat([outBuf, d]); });
      proc.stderr.on('data', (d) => { errBuf = Buffer.concat([errBuf, d]); });
      proc.on('error', (e) => { clearTimeout(timer); reject(e); });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(outBuf.toString('utf-8').replace(/\r\n/g, '\n'));
        else reject(new Error(`${command} exit=${code}：${(errBuf.toString('utf-8') || '').slice(0, 300)}`));
      });
    });
  } catch (e) {
    throw e;
  }
}

async function extractDocOld(filePath, extHint) {
  const result = { text: '', method: 'local-olddoc-command' };
  let extracted = '';
  let methodUsed = '';
  let cmdErr = '';
  try {
    try {
      const out = await _execStdout('textutil', ['-convert', 'txt', '-stdout', '-encoding', 'UTF-8', filePath], 30000);
      if (out && out.trim().length >= 20) { extracted = out; methodUsed = 'textutil-mac'; }
    } catch (e) {
      cmdErr = `textutil:${e.message}`;
    }
    if (!extracted) {
      try {
        const textract = require('textract');
        extracted = await new Promise((resolve, reject) => {
          textract.fromFileWithPath(filePath, { preserveLineBreaks: true, includeAltText: false }, (err, txt) => {
            if (err) return reject(err);
            resolve(String(txt || ''));
          });
        });
        if (extracted && extracted.trim().length >= 20) { methodUsed = 'textract'; }
        else extracted = '';
      } catch (e) {
        cmdErr = cmdErr ? `${cmdErr}; textract:${e.message}` : `textract:${e.message}`;
      }
    }
    if (!extracted) {
      try {
        const antiword = await _execStdout('antiword', ['-m', 'UTF-8.txt', filePath], 20000);
        if (antiword && antiword.trim().length >= 20) { extracted = antiword; methodUsed = 'antiword'; }
      } catch (e) {
        cmdErr = cmdErr ? `${cmdErr}; antiword:${e.message}` : `antiword:${e.message}`;
      }
    }
  } catch (_) {}

  if (extracted && extracted.trim().length >= 20) {
    result.text = extracted;
    result.method = methodUsed || 'local-olddoc-command';
    return result;
  }
  result.text = '';
  result.error = cmdErr || `无法用本地命令抽取老版 Office (${extHint || ''}) 正文，将走 OCR 识别。`;
  result.method = 'old-doc-local-failed';
  result.needsOcrFallback = true;
  return result;
}

function extractPlainText(filePath) {
  const result = { text: '', method: 'local-text' };
  try {
    const buf = fs.readFileSync(filePath);
    const candidate = [
      () => buf.toString('utf-8'),
      () => buf.toString('gbk'),
      () => buf.toString('utf-16le')
    ];
    let best = '';
    let bestScore = -1;
    for (const tryFn of candidate) {
      try {
        const s = tryFn();
        const sClean = s.replace(/\s+/g, '');
        const cjk = (sClean.match(/[\u4e00-\u9fa5]/g) || []).length;
        const alpha = (sClean.match(/[A-Za-z0-9]/g) || []).length;
        const garbage = (s.match(/\ufffd/g) || []).length;
        const score = cjk * 3 + alpha - garbage * 10;
        if (score > bestScore) { bestScore = score; best = s; }
      } catch (_) {}
    }
    result.text = best;
  } catch (e) {
    result.error = `文本读取失败：${e.message}`;
    result.method = 'local-text-failed';
  }
  return result;
}

async function extractFileContent(file) {
  const ext = path.extname(file.original_name || '').toLowerCase() || path.extname(file.stored_path || '').toLowerCase();
  const absPath = resolveStored(file);
  const base = {
    ext,
    storedAbsolutePath: absPath,
    bytes: fs.existsSync(absPath) ? fs.statSync(absPath).size : 0,
    needsOcr: false,
    unsupported: false,
    text: '',
    method: 'unknown'
  };

  if (IMAGE_EXT_SET.has(ext)) {
    return { ...base, method: 'image-needs-ocr', needsOcr: true, ocrKind: 'image' };
  }
  if (ext === '.pdf') {
    const r = await extractPdf(absPath);
    const final = { ...base, ...r, text: truncateMiddle(r.text) };
    if (r.scanned || r.method === 'local-pdf-failed') {
      final.needsOcr = true;
      final.ocrKind = 'scan-pdf';
      final.method = r.method === 'local-pdf-failed' ? 'scan-pdf-needs-ocr' : r.method;
    }
    return final;
  }
  if (ext === '.docx' || ext === '.doc' || ext === '.wps' || ext === '.rtf') {
    if (ext === '.docx') {
      const r = await extractDocx(absPath);
      if (r.method === 'local-docx-failed') {
        return { ...base, ...r, text: truncateMiddle(r.text), method: 'old-doc-needs-ocr', needsOcr: true, ocrKind: 'old-office' };
      }
      return { ...base, ...r, text: truncateMiddle(r.text) };
    }
    const r = await extractDocOld(absPath, ext);
    if (r.needsOcrFallback || !r.text || r.text.trim().length < 20) {
      return { ...base, ...r, text: truncateMiddle(r.text), method: 'old-doc-needs-ocr', needsOcr: true, ocrKind: 'old-office' };
    }
    return { ...base, ...r, text: truncateMiddle(r.text) };
  }
  if (DOC_TEXT_EXT_SET.has(ext)) {
    const r = extractPlainText(absPath);
    return { ...base, ...r, text: truncateMiddle(r.text) };
  }
  if (OFFICE_SKIP_SET.has(ext)) {
    return {
      ...base,
      method: `unsupported-${ext.replace('.', '')}`,
      unsupported: true,
      warning: `${ext} 文件暂不支持内容解析，将按文件名规则推荐。管理员如需要可手动重命名。`
    };
  }
  return {
    ...base,
    method: `ext-unknown-${ext.replace('.', '')}`,
    unsupported: true,
    warning: `未知扩展名 ${ext}，按文件名规则推荐。`
  };
}

module.exports = {
  extractFileContent,
  extractPdf,
  extractDocx,
  extractDocOld,
  extractPlainText,
  truncateMiddle,
  IMAGE_EXT_SET
};
