const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { ARK_CONFIG } = require('../config');
const { truncateMiddle } = require('./extractor-service');
const { readJsonIfExists } = require('../utils');
const { ARCHIVE_STANDARD_PATH, ROOT } = require('../config');

let _axiosInstance = null;

function client() {
  if (_axiosInstance) return _axiosInstance;
  _axiosInstance = axios.create({
    baseURL: ARK_CONFIG.BASE_URL,
    timeout: ARK_CONFIG.REQUEST_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${ARK_CONFIG.API_KEY}`,
      'Content-Type': 'application/json'
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity
  });
  return _axiosInstance;
}

function elapsedSince(startMs) {
  return Math.round(Date.now() - startMs);
}

function parseModelJsonOutput(raw) {
  const s = String(raw || '').trim();
  if (!s) return { ok: false, error: '模型返回空内容' };
  let candidate = s;
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence && fence[1]) {
    candidate = fence[1].trim();
  } else {
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first >= 0 && last > first) candidate = s.slice(first, last + 1);
  }
  try {
    const obj = JSON.parse(candidate);
    return { ok: true, data: obj };
  } catch (e) {
    return { ok: false, error: `JSON 解析失败：${e.message}，原始片段：${candidate.slice(0, 150)}` };
  }
}

async function compressImageIfNeeded(absPath) {
  try {
    const stat = fs.statSync(absPath);
    const limitBytes = ARK_CONFIG.OCR_MAX_IMAGE_MB * 1024 * 1024;
    if (stat.size <= limitBytes) {
      return { path: absPath, mime: mimeFromExt(path.extname(absPath)), compressed: false };
    }
    const sharp = require('sharp');
    const dir = path.dirname(absPath);
    const base = path.basename(absPath, path.extname(absPath));
    const outPath = path.join(dir, `${base}__ark_compressed_${Date.now()}.jpg`);
    await sharp(absPath, { limitInputPixels: 300_000_000 })
      .rotate()
      .resize({ width: 2400, withoutEnlargement: true })
      .jpeg({ quality: 78, mozjpeg: true })
      .toFile(outPath);
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
      return { path: absPath, mime: mimeFromExt(path.extname(absPath)), compressed: false };
    }
    return { path: outPath, mime: 'image/jpeg', compressed: true };
  } catch (e) {
    return { path: absPath, mime: mimeFromExt(path.extname(absPath)), compressed: false, error: e.message };
  }
}

function mimeFromExt(ext) {
  const e = String(ext || '').toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.webp') return 'image/webp';
  if (e === '.tif' || e === '.tiff') return 'image/tiff';
  if (e === '.bmp') return 'image/bmp';
  return 'image/jpeg';
}

async function fileToBase64DataUrl(absPath, mime) {
  const buf = fs.readFileSync(absPath);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function ocrImage(absPath, ext, opts = {}) {
  const started = Date.now();
  if (!ARK_CONFIG.ENABLED) {
    return { ok: false, error: 'ARK 已在配置中关闭', latencyMs: elapsedSince(started) };
  }
  const prepared = await compressImageIfNeeded(absPath);
  try {
    const dataUrl = await fileToBase64DataUrl(prepared.path, prepared.mime);
    const resp = await client().post('/chat/completions', {
      model: ARK_CONFIG.VISION_MODEL,
      stream: false,
      temperature: 0,
      max_tokens: 8192,
      messages: [
        {
          role: 'system',
          content: '你是专为中文档案设计的专业OCR引擎。任务要求：1. 逐字逐行输出图片中所有可见文字，识别准确率最大化；2. 必须完整还原红头、文号(如XX发〔2025〕1号)、发文机关、盖章文字、手写签字批注、表格内容、财务数字、日期(年月日)、金额(元/万元)、单位名、页码、页眉页脚；3. 严禁凭空编造、替换错别字、合并/拆分汉字；4. 识别到的数字、序号、括号内文字必须严格保留；5. 段落之间保留自然换行；6. 如某部分文字无法100%确定，请使用【□】标出不确定的单字，不得乱猜；7. 若整张图完全无文字输出"<无可见文字>"。除识别结果本身外，禁止输出任何解释或对话。'
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: opts.prompt || '开始OCR识别，逐字输出，不要省略任何汉字或数字。' },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }
      ]
    });
    const text = resp?.data?.choices?.[0]?.message?.content || '';
    return {
      ok: true,
      text: text === '<无可见文字>' ? '' : text,
      empty: text === '<无可见文字>',
      model: resp?.data?.model || ARK_CONFIG.VISION_MODEL,
      usage: resp?.data?.usage,
      compressed: prepared.compressed,
      latencyMs: elapsedSince(started)
    };
  } catch (e) {
    return {
      ok: false,
      error: e?.response?.data ? JSON.stringify(e.response.data).slice(0, 400) : (e.message || 'OCR 调用失败'),
      status: e?.response?.status || null,
      latencyMs: elapsedSince(started)
    };
  } finally {
    if (prepared.compressed && prepared.path && prepared.path !== absPath) {
      try { fs.unlinkSync(prepared.path); } catch (_) {}
    }
  }
}

async function uploadFileForArk(absPath, originalName) {
  const started = Date.now();
  try {
    const FormData = require('form-data');
    const fd = new FormData();
    fd.append('purpose', 'user_data');
    fd.append('file', fs.createReadStream(absPath), {
      filename: originalName || path.basename(absPath),
      contentType: mimeFromExt(path.extname(absPath))
    });
    const resp = await client().post('/files', fd, {
      headers: { ...fd.getHeaders(), 'Content-Type': undefined },
      maxBodyLength: 1000 * 1024 * 1024
    });
    return { ok: true, file: resp.data, latencyMs: elapsedSince(started) };
  } catch (e) {
    return {
      ok: false,
      error: e?.response?.data ? JSON.stringify(e.response.data).slice(0, 500) : (e.message || '上传失败'),
      status: e?.response?.status || null,
      latencyMs: elapsedSince(started)
    };
  }
}

async function waitForArkFileReady(fileId, options = {}) {
  const maxWaitMs = options.maxWaitMs || 120000;
  const pollMs = options.pollMs || 4000;
  const started = Date.now();
  let lastState = null;
  const PROCESSED_STATES = new Set(['processed', 'active', 'completed', 'ready']);
  const FAILED_STATES = new Set(['error', 'failed', 'deleted', 'deactivated']);
  while (Date.now() - started < maxWaitMs) {
    try {
      const resp = await client().get(`/files/${fileId}`);
      const status = resp?.data?.status;
      lastState = status;
      if (PROCESSED_STATES.has(status)) {
        return { ok: true, waitedMs: elapsedSince(started), status };
      }
      if (FAILED_STATES.has(status)) {
        return { ok: false, error: `文件处理失败，状态=${status}`, waitedMs: elapsedSince(started), status };
      }
    } catch (e) {
      const msg = e?.response?.data ? JSON.stringify(e.response.data) : (e.message || 'unknown');
      lastState = `poll_error:${msg.slice(0, 80)}`;
    }
    await new Promise(r => setTimeout(r, pollMs));
  }
  return { ok: false, error: `等待 Ark 文件就绪超时（${(maxWaitMs/1000)|0}s），最后状态=${lastState}`, waitedMs: elapsedSince(started), status: lastState };
}

async function ocrPdfByFileUpload(absPath, originalName) {
  const started = Date.now();
  if (!ARK_CONFIG.ENABLED) return { ok: false, error: 'ARK 已关闭', latencyMs: 0 };
  const uploaded = await uploadFileForArk(absPath, originalName);
  if (!uploaded.ok) {
    return { ...uploaded, text: '', method: 'file-upload-failed' };
  }
  const fileId = uploaded.file?.id;
  const ready = await waitForArkFileReady(fileId, { maxWaitMs: 90000, pollMs: 3000 });
  if (!ready.ok) {
    return {
      ok: false,
      error: `Ark 文件就绪等待失败：${ready.error}`,
      method: 'ark-file-wait-failed',
      latencyMs: elapsedSince(started)
    };
  }
  try {
    const pdfTimeout = Math.max(ARK_CONFIG.REQUEST_TIMEOUT_MS, 300000);
    const resp = await client().post('/responses', {
      model: ARK_CONFIG.TEXT_MODEL,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_file', file_id: fileId },
            { type: 'input_text', text: '请逐页完整识别这份文档中的全部文字（包括扫描件、手写批注、盖章文字、表格、页眉页脚、页码）。严格要求：1.按原文顺序输出，禁止遗漏；2.红头、文号（如XX发〔2025〕1号）、日期（YYYY年MM月DD日）、金额、单位名必须一字不差；3.无法100%确认的单字用【□】标记，绝不能乱猜；4.不要输出任何解释、总结或对话，只输出逐字识别结果。' }
          ]
        }
      ]
    }, { timeout: pdfTimeout });
    let rawText = '';
    const d = resp?.data;
    if (d?.output_text) rawText = d.output_text;
    else if (Array.isArray(d?.output)) {
      for (const part of d.output) {
        if (Array.isArray(part?.content)) {
          rawText = part.content.map(c => c?.text || '').filter(Boolean).join('\n');
          if (rawText) break;
        }
      }
    }
    return {
      ok: true,
      text: String(rawText || '').replace(/\\n/g, '\n'),
      method: 'ark-pdf-file-api',
      usage: resp?.data?.usage,
      latencyMs: elapsedSince(started)
    };
  } catch (e) {
    return {
      ok: false,
      error: e?.response?.data ? JSON.stringify(e.response.data).slice(0, 500) : (e.message || 'PDF文档理解调用失败'),
      method: 'ark-pdf-file-api-failed',
      latencyMs: elapsedSince(started)
    };
  }
}

function loadArchiveStandard() {
  const std = readJsonIfExists(ARCHIVE_STANDARD_PATH, null);
  if (!std) return null;
  return std;
}

function flattenStdPaths(std) {
  const flat = [];
  function walk(nodes, prefix) {
    (nodes || []).forEach((n) => {
      const full = prefix ? `${prefix}/${n.name}` : n.name;
      flat.push({
        path: full,
        name: n.name,
        description: n.description || '',
        aiAutoArchive: n.aiAutoArchive !== false
      });
      if (n.children && n.children.length) walk(n.children, full);
    });
  }
  walk(std.rootFolders || [], '');
  return flat;
}

function buildArchivePrompt(std, project) {
  const flat = flattenStdPaths(std);
  const lines = [];
  lines.push(`【归档目录结构（按层级列出，路径格式为 一级/二级/...）】`);
  flat.forEach((n, i) => {
    lines.push(`${i + 1}. ${n.path}${n.aiAutoArchive ? '' : '  [AI禁止自动归档，需人工确认]'} — ${n.description}`);
  });
  if (std.namingRules && std.namingRules.length) {
    lines.push('');
    lines.push('【命名规则（必须遵守）】');
    std.namingRules.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
  }
  if (std.principles && std.principles.length) {
    lines.push('');
    lines.push('【归档原则】');
    std.principles.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
  }
  return lines.join('\n');
}

async function suggestArchiveNaming(params) {
  const started = Date.now();
  const { file, project, extractResult } = params;
  if (!ARK_CONFIG.ENABLED) {
    return { ok: false, error: 'ARK 已关闭，将使用纯文件名关键词规则兜底', latencyMs: 0 };
  }
  const std = loadArchiveStandard();
  if (!std) {
    return { ok: false, error: '归档规范 JSON 不存在，无法调用大模型生成命名', latencyMs: 0 };
  }
  const mergedText = [
    extractResult?.text || '',
    extractResult?.ocrText || '',
    file.note ? `【员工备注】：${file.note}` : ''
  ].filter(Boolean).join('\n\n-----\n\n');

  const truncatedText = truncateMiddle(mergedText, ARK_CONFIG.SUGGEST_MAX_INPUT_CHARS);
  const archivePromptBlock = buildArchivePrompt(std, project);
  const ext = path.extname(file.original_name || '').toLowerCase() || path.extname(file.stored_path || '').toLowerCase() || '.pdf';

  const systemPrompt = [
    '你是严格遵守公司档案管理规范的档案管理员。你的任务是根据文件正文内容、文件名、员工备注、项目信息，结合归档规范，输出：最终文件名（不含扩展名，扩展名由后端自动沿用原文件扩展名）、归档目标目录路径、置信度、推荐理由、内容摘要、文件类型标签。',
    '',
    '【硬性约束】',
    '1. 输出必须是纯 JSON，不能有 markdown 包裹，不能有任何解释文字。',
    '2. 禁止推荐到任何标为"AI禁止自动归档"的目录（例如"4.成果资料"）；如果内容确实是成果资料，则 target_path 回退到 "03_无法识别需人工确认" 并在 reason 里写明"疑似成果资料，需人工归类到 4.成果资料 下的子目录"。',
    '3. 最终文件名 final_name / suggestedName 只写主名，绝对不要加任何扩展名（不要写 .pdf .docx .doc .png .jpg 等），扩展名由后端从原始文件名自动补上。',
    '4. 命名遵守规范：公文类写"公文标题（文号）"；报告类写"报告题目YYYYMMDD"；合同类写"甲方-乙方-合同简称YYYYMMDD"；外业照片写"场景描述-日期-编号"。',
    '5. 文件名中禁止包含 \\ / : * ? " < > | 字符，长度不超过 160 个字符。',
    '6. target_path 必须从归档目录结构里选一个叶子节点的完整路径。',
    '7. confidence 必须是 0 到 1 之间的数字。依据：正文里明确出现红头文号/合同落款签字盖章/报告封面标题 → 0.85以上；正文有强关键词但缺红头/盖章 → 0.70~0.84；只能靠文件名猜测 → <0.70。'
  ].join('\n');

  const userPrompt = [
    '【项目信息】',
    `项目根目录：${project?.root_name || '(未提供)'}`,
    `项目全称：${project?.name || project?.root_name || ''}`,
    `项目月度：${project?.month_key || ''}`,
    `项目概况：${project?.summary || ''}`,
    `项目负责人：${project?.owner || ''} / 部门 ${project?.department || ''}`,
    '',
    '【文件元信息】',
    `原始文件名：${file.original_name}`,
    `上传时间：${file.uploaded_at || ''}`,
    `文件大小(字节)：${extractResult?.bytes || file.size || '未知'}`,
    `内容解析方式：${extractResult?.method || '未知'}`,
    `解析警告：${extractResult?.warning || extractResult?.error || '无'}`,
    '',
    archivePromptBlock,
    '',
    '【文件正文（可能为OCR结果或抽取的电子文本，已按长度截断）】',
    '>>>>>>>>>>>>>>>>>>>',
    truncatedText || '(无正文内容)',
    '<<<<<<<<<<<<<<<<<<<',
    '',
    '请严格按 JSON Schema 输出（直接输出纯 JSON，不要 ``` 包裹）：',
    '{',
    '  "final_name": "完整文件名（含扩展名）",',
    '  "target_path": "目标目录完整路径，如 3.执行资料/5.报告",',
    '  "target_root": "目标一级目录名，如 3.执行资料",',
    '  "confidence": 0.85,',
    '  "doc_type": "立项红头/合同扫描/外业照片/保护方案报告/CAD图纸/发票付款/无法判断",',
    '  "content_summary": "200字以内的内容摘要，突出文号、甲乙双方、报告类型、日期、关键结论。",',
    '  "reason": "推荐理由，结合文档正文里的具体证据（引用具体的红头/签字/盖章/关键词句子）。"',
    '}'
  ].join('\n');

  try {
    const resp = await client().post('/chat/completions', {
      model: ARK_CONFIG.TEXT_MODEL,
      stream: false,
      temperature: 0.1,
      max_tokens: 1600,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' }
    });
    const raw = resp?.data?.choices?.[0]?.message?.content || '';
    const parsed = parseModelJsonOutput(raw);
    if (!parsed.ok) {
      return { ok: false, error: parsed.error, rawOutput: raw.slice(0, 600), latencyMs: elapsedSince(started) };
    }
    const o = parsed.data || {};
    return {
      ok: true,
      suggestion: {
        targetRoot: o.target_root || '',
        targetPath: o.target_path || '',
        suggestedName: o.final_name || '',
        confidence: typeof o.confidence === 'number' ? Math.max(0, Math.min(1, o.confidence)) : 0.5,
        docType: o.doc_type || '',
        contentSummary: o.content_summary || '',
        reason: o.reason || ''
      },
      model: resp?.data?.model || ARK_CONFIG.TEXT_MODEL,
      usage: resp?.data?.usage,
      latencyMs: elapsedSince(started)
    };
  } catch (e) {
    return {
      ok: false,
      error: e?.response?.data ? JSON.stringify(e.response.data).slice(0, 500) : (e.message || '命名大模型调用失败'),
      status: e?.response?.status || null,
      latencyMs: elapsedSince(started)
    };
  }
}

module.exports = {
  client,
  ocrImage,
  ocrPdfByFileUpload,
  uploadFileForArk,
  suggestArchiveNaming,
  parseModelJsonOutput,
  compressImageIfNeeded
};
