const { filesTable } = require('../database');
const {
  EXTRACT_STATUSES,
  EXTRACT_QUEUE_CONFIG,
  ARK_CONFIG
} = require('../config');
const { nowText } = require('../utils');
const {
  getFileById,
  updateFileExtract,
  attachExtractQueue
} = require('./file-service');
const { getProjectById } = require('./project-service');
const { extractFileContent, truncateMiddle } = require('./extractor-service');
const { ocrImage, ocrPdfByFileUpload, suggestArchiveNaming } = require('./ark-service');
const { guessAiSuggestion } = require('./ai-service');

const CONCURRENCY = EXTRACT_QUEUE_CONFIG.CONCURRENCY;
const MAX_RETRIES = EXTRACT_QUEUE_CONFIG.MAX_RETRIES;
const RETRY_BASE = EXTRACT_QUEUE_CONFIG.RETRY_BASE_DELAY_MS;

const pending = new Set();
const running = new Set();
const completed = new Set();
let tickTimer = null;
let initialized = false;

function log(...args) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`[extract-queue ${ts}]`, ...args);
}

function enqueue(fileId, opts = {}) {
  if (!fileId) return;
  if (opts.force) {
    running.delete(fileId);
    completed.delete(fileId);
  }
  if (completed.has(fileId) && !opts.force) return;
  pending.add(fileId);
  log(`enqueue → ${fileId} (pending=${pending.size} running=${running.size} force=${!!opts.force})`);
  scheduleTick(200);
}

let _scheduled = null;
function scheduleTick(delayMs = 500) {
  if (_scheduled) return;
  _scheduled = setTimeout(() => {
    _scheduled = null;
    tick();
  }, delayMs).unref?.();
  if (!_scheduled) _scheduled = setTimeout(() => {
    _scheduled = null;
    tick();
  }, delayMs);
}

function nextPending() {
  const now = Date.now();
  for (const fileId of pending) {
    const f = filesTable().get(fileId);
    if (!f) {
      pending.delete(fileId);
      continue;
    }
    const nextRun = f.extract_next_run_at ? new Date(f.extract_next_run_at).getTime() : 0;
    if (nextRun && nextRun > now) continue;
    return fileId;
  }
  return null;
}

async function tick() {
  while (running.size < CONCURRENCY) {
    const nextId = nextPending();
    if (!nextId) break;
    pending.delete(nextId);
    running.add(nextId);
    processOne(nextId)
      .catch((err) => {
        log(`UNCAUGHT worker exception ${nextId}:`, err && err.message ? err.message : err);
        markFatalFailed(nextId, err && err.message ? err.message : String(err));
      })
      .finally(() => {
        running.delete(nextId);
        scheduleTick(300);
      });
  }
  if (pending.size > 0 || running.size > 0) scheduleTick(1500);
}

function markFatalFailed(fileId, msg) {
  updateFileExtract(fileId, {
    extract_status: EXTRACT_STATUSES.FAILED,
    extract_error: `fatal: ${String(msg || '').slice(0, 400)}`
  });
  completed.add(fileId);
}

async function processOne(fileId) {
  const startedAt = Date.now();
  log(`start ${fileId}`);
  let extractForSummary = null;

  try {
    const file = getFileById(fileId);
    if (!file) {
      markFatalFailed(fileId, '文件记录不存在');
      return;
    }
    const project = getProjectById(file.project_id);
    if (!project) {
      log(`skip ${fileId}: project ${file.project_id} 不存在`);
    }
    updateFileExtract(fileId, {
      extract_status: EXTRACT_STATUSES.RUNNING,
      extract_started_at: nowText(),
      extract_error: '',
      extract_debug: { startedAt }
    });

    const extractResult = await extractFileContent(file);
    extractForSummary = extractResult;
    log(`extract done ${fileId} method=${extractResult.method} needsOcr=${extractResult.needsOcr} textLen=${(extractResult.text || '').length}`);

    if (extractResult.needsOcr) {
      if (extractResult.ocrKind === 'image') {
        const ocr = await ocrImage(extractResult.storedAbsolutePath, extractResult.ext);
        if (ocr.ok) {
          extractResult.ocrText = ocr.text || '';
          if (!extractResult.method) extractResult.method = 'ark-ocr-image';
          extractResult.method = `${extractResult.method}+ark-ocr-image`;
          log(`ocr-image ${fileId} chars=${extractResult.ocrText.length} latency=${ocr.latencyMs}ms`);
        } else {
          extractResult.ocrError = `图片OCR失败：${ocr.error}，status=${ocr.status}`;
        }
      } else if (extractResult.ocrKind === 'scan-pdf') {
        const ocr = await ocrPdfByFileUpload(extractResult.storedAbsolutePath, file.original_name);
        if (ocr.ok) {
          extractResult.ocrText = ocr.text || '';
          extractResult.method = `${extractResult.method}+ark-file-pdf`;
          log(`ocr-scan-pdf ${fileId} chars=${extractResult.ocrText?.length || 0} latency=${ocr.latencyMs}ms`);
        } else {
          extractResult.ocrError = `扫描件PDF理解失败：${ocr.error}，status=${ocr.status}`;
          log(`ocr-scan-pdf failed ${fileId}:`, extractResult.ocrError);
        }
      } else if (extractResult.ocrKind === 'old-office') {
        const ocr = await ocrPdfByFileUpload(extractResult.storedAbsolutePath, file.original_name);
        if (ocr.ok) {
          extractResult.ocrText = ocr.text || '';
          extractResult.method = `${extractResult.method}+ark-file-office`;
          log(`ocr-old-office ${fileId} chars=${extractResult.ocrText?.length || 0} latency=${ocr.latencyMs}ms`);
        } else {
          extractResult.ocrError = `老版本Office文档理解失败：${ocr.error}，status=${ocr.status}`;
          log(`ocr-old-office failed ${fileId}:`, extractResult.ocrError);
        }
      }
    }

    const finalText = [
      extractResult.text || '',
      extractResult.ocrText || ''
    ].filter(Boolean).join('\n\n===== OCR 与正文合并 =====\n\n');

    const finalChars = String(finalText || '').length;
    updateFileExtract(fileId, {
      extract_method: extractResult.method,
      extracted_text: truncateMiddle(extractResult.text || '', ARK_CONFIG.EXTRACT_MAX_TEXT_CHARS),
      ocr_text: truncateMiddle(extractResult.ocrText || '', ARK_CONFIG.EXTRACT_MAX_TEXT_CHARS),
      extracted_chars: finalChars,
      extract_error: extractResult.ocrError || extractResult.error || ''
    });

    const hasEnoughContent = finalChars >= 60 || (extractResult.ocrText && extractResult.ocrText.length >= 30);
    let suggest = null;
    if (hasEnoughContent && ARK_CONFIG.ENABLED) {
      suggest = await suggestArchiveNaming({ file, project: project || {}, extractResult: { ...extractResult, text: finalText } });
      log(`suggest ${fileId} ok=${suggest.ok} latency=${suggest.latencyMs}ms`);
    }

    const patch = {};
    if (suggest && suggest.ok && suggest.suggestion) {
      const s = suggest.suggestion;
      const safeName = (() => {
        const { safeName: sn } = require('../utils');
        const origExt = (file.original_name.split('.').pop() || '').toLowerCase();
        let name = s.suggestedName || file.original_name;
        if (!/\.[a-zA-Z0-9]{1,6}$/.test(name)) {
          name = `${name}.${origExt}`;
        }
        return sn(name);
      })();
      patch.ai_target_path = s.targetPath || file.ai_filename_target_path || file.ai_target_path;
      patch.ai_suggested_name = safeName;
      patch.ai_confidence = typeof s.confidence === 'number' ? s.confidence : 0.5;
      patch.ai_reason = s.reason || '';
      patch.ai_basis = 'filename+content+ark';
      patch.ai_model_used = suggest.model || '';
      patch.content_summary = s.contentSummary || '';
      patch.doc_type = s.docType || '';
      patch.ai_content_suggestion = {
        target_root: s.targetRoot || '',
        target_path: patch.ai_target_path,
        suggested_name: safeName,
        confidence: patch.ai_confidence,
        doc_type: s.docType || '',
        content_summary: s.contentSummary || '',
        reason: s.reason || '',
        model: suggest.model || '',
        usage: suggest.usage || null,
        latency_ms: suggest.latencyMs || 0
      };
    } else if (suggest && !suggest.ok) {
      log(`suggest failed ${fileId}:`, suggest.error);
      patch.ai_reason = (patch.ai_reason ? patch.ai_reason + '；' : '') + `大模型命名失败：${suggest.error || 'unknown'}`;
      patch.ai_model_used = patch.ai_model_used || suggest.model || '';
      patch.extract_error = (patch.extract_error ? patch.extract_error + ' | ' : '') + `命名失败：${suggest.error || ''}`.slice(0, 400);
    }

    patch.extract_status = EXTRACT_STATUSES.SUCCESS;
    patch.extracted_at = nowText();
    patch.extract_debug = {
      startedAt,
      finishedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      extract_method: extractResult.method,
      extract_error: extractResult.error || '',
      ocr_error: extractResult.ocrError || '',
      unsupported: !!extractResult.unsupported,
      warning: extractResult.warning || ''
    };
    updateFileExtract(fileId, patch);
    completed.add(fileId);
    log(`done ${fileId} in ${Date.now() - startedAt}ms method=${extractResult.method} basis=${patch.ai_basis || file.ai_basis}`);
  } catch (err) {
    const f = getFileById(fileId);
    const retry = (f && f.extract_retry) || 0;
    const errMsg = err && err.message ? err.message : String(err);
    log(`worker error ${fileId} retry=${retry}: ${errMsg}`);
    if (retry < MAX_RETRIES) {
      const nextRun = new Date(Date.now() + RETRY_BASE * Math.pow(2, retry)).toISOString();
      updateFileExtract(fileId, {
        extract_status: EXTRACT_STATUSES.PENDING,
        extract_retry: retry + 1,
        extract_next_run_at: nextRun,
        extract_error: `retry#${retry + 1}: ${errMsg}`.slice(0, 300)
      });
      pending.add(fileId);
    } else {
      updateFileExtract(fileId, {
        extract_status: EXTRACT_STATUSES.FAILED,
        extract_error: `max retries(${MAX_RETRIES}) reached: ${errMsg}`.slice(0, 400),
        extract_retry: retry + 1
      });
      completed.add(fileId);
    }
  }
}

function start() {
  if (initialized) return;
  initialized = true;
  if (!ARK_CONFIG.ENABLED) {
    log('ARK 已禁用（ARK_ENABLED=0），队列不启动。所有文件将按文件名规则推荐。');
    return;
  }
  attachExtractQueue(enqueue);

  const all = filesTable().all();
  let seeded = 0;
  let seededOldEmpty = 0;
  all.forEach((f) => {
    if (!f.extract_status) {
      if (f.status === 'pending_review') {
        pending.add(f.id);
        seeded++;
        seededOldEmpty++;
      }
      return;
    }
    if (f.extract_status === EXTRACT_STATUSES.PENDING || f.extract_status === EXTRACT_STATUSES.RUNNING) {
      pending.add(f.id);
      seeded++;
    } else if (f.extract_status === EXTRACT_STATUSES.FAILED && (f.extract_retry || 0) < MAX_RETRIES) {
      pending.add(f.id);
      seeded++;
    } else if (f.extract_status === EXTRACT_STATUSES.SUCCESS) {
      completed.add(f.id);
    }
  });
  log(`启动：扫描到 ${all.length} 个文件，本次 seed ${seeded} 个入队（含 extract_status 空的早期待审文件 ${seededOldEmpty} 个）。并发=${CONCURRENCY} 重试=${MAX_RETRIES}`);
  scheduleTick(2000);
}

function stats() {
  return {
    pending: pending.size,
    running: running.size,
    completed: completed.size,
    concurrency: CONCURRENCY,
    maxRetries: MAX_RETRIES
  };
}

module.exports = {
  start,
  enqueue,
  stats,
  processOne
};
