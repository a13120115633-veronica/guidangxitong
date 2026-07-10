const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { filesTable, nasJobsTable } = require('../database');
const {
  ROOT,
  ORIGINAL_UPLOADS_DIR,
  READY_FOR_NAS_DIR,
  FILE_STATUSES,
  NAS_JOB_STATUSES,
  EXTRACT_STATUSES,
  ARK_CONFIG,
  NAS_CONFIG,
  NAS_SETTINGS_FILE_PATH,
  DATA_DIR
} = require('../config');
const {
  nowText,
  generateId,
  safeName,
  safeRelativePath,
  ensureInside
} = require('../utils');
const { addAuditLog } = require('./audit-service');
const { getProjectById } = require('./project-service');
const {
  guessAiSuggestion,
  categoryKeyForPath,
  displayLabelForCategoryKey,
  displayLabelForSourceRole,
  isDefaultBusinessCategoryPath
} = require('./ai-service');

let _extractQueueEnqueue = null;
function attachExtractQueue(fn) {
  _extractQueueEnqueue = typeof fn === 'function' ? fn : null;
}

function decorateForResponse(f) {
  if (!f) return f;
  const hasFilename = Boolean(f.ai_filename_target_path && String(f.ai_filename_target_path).length > 0);
  const isFilenameBasis = !f.ai_basis || f.ai_basis === 'filename+note';
  const patch = {};
  if (!hasFilename && isFilenameBasis) {
    patch.ai_filename_target_path = f.ai_target_path || '';
    patch.ai_filename_suggested_name = f.ai_suggested_name || '';
    patch.ai_filename_confidence = typeof f.ai_confidence === 'number' ? f.ai_confidence : 0;
    patch.ai_filename_reason = f.ai_reason || '';
  }
  if (!f.ai_basis) {
    patch.ai_basis = f.ai_content_suggestion ? 'filename+content+ark' : 'filename+note';
  }
  if (!f.ai_reason && f.ai_filename_reason) {
    patch.ai_reason = f.ai_filename_reason;
  }
  patch.ai_content_suggestion = f.ai_content_suggestion || null;
  patch.extract_status = f.extract_status || '';
  patch.extract_method = f.extract_method || '';
  patch.extract_error = f.extract_error || '';
  patch.extract_retry = f.extract_retry || 0;
  patch.extract_started_at = f.extract_started_at || '';
  patch.extracted_at = f.extracted_at || '';
  patch.extracted_chars = f.extracted_chars || 0;
  patch.extracted_text = f.extracted_text || '';
  patch.ocr_text = f.ocr_text || '';
  patch.content_summary = f.content_summary || '';
  patch.doc_type = f.doc_type || '';
  patch.ai_model_used = f.ai_model_used || '';
  const rawSourceRole = f.source_role || (f.uploader && String(f.uploader).includes('管理员') ? 'admin_manual' : 'employee_business');
  patch.source_role = rawSourceRole;
  patch.source_display = displayLabelForSourceRole(rawSourceRole);
  const finalTargetPath = f.final_target_path || f.ai_target_path || f.final_path || '';
  const computedCk = f.category_key || categoryKeyForPath(finalTargetPath);
  patch.category_key = computedCk;
  patch.category_label = displayLabelForCategoryKey(computedCk);
  patch.is_default_category = isDefaultBusinessCategoryPath(finalTargetPath);
  return { ...f, ...patch };
}

function createFileRecord({
  projectId,
  originalName,
  storedPath,
  size,
  mimeType,
  uploader,
  department,
  note,
  device,
  sourceRole
}) {
  const id = generateId('f');
  const filenameSuggestion = guessAiSuggestion(originalName, note);
  const uploadedAt = nowText();
  const defaultSourceRole = (uploader && String(uploader).includes('管理员')) ? 'admin_manual' : 'employee_business';
  const finalSourceRole = sourceRole || defaultSourceRole;
  const categoryKey = filenameSuggestion.category_key || categoryKeyForPath(filenameSuggestion.targetPath || '');
  const file = {
    id,
    project_id: projectId,
    original_name: originalName,
    stored_path: storedPath,
    size,
    mime_type: mimeType,
    uploader,
    department,
    note: note || '',
    device: device || '',
    status: FILE_STATUSES.PENDING_REVIEW,

    source_role: finalSourceRole,
    source_display: displayLabelForSourceRole(finalSourceRole),

    category_key: categoryKey,
    category_label: displayLabelForCategoryKey(categoryKey),
    ai_category_primary: categoryKey,
    category_overridden: false,
    category_override_reason: '',

    ai_target_path: filenameSuggestion.targetPath,
    ai_suggested_name: filenameSuggestion.suggestedName,
    ai_confidence: filenameSuggestion.confidence,
    ai_reason: filenameSuggestion.reason,
    ai_basis: 'filename+note',
    ai_model_used: '',

    ai_filename_target_path: filenameSuggestion.targetPath,
    ai_filename_suggested_name: filenameSuggestion.suggestedName,
    ai_filename_confidence: filenameSuggestion.confidence,
    ai_filename_reason: filenameSuggestion.reason,

    ai_content_suggestion: null,

    extract_status: ARK_CONFIG.ENABLED ? EXTRACT_STATUSES.PENDING : EXTRACT_STATUSES.SUCCESS,
    extract_method: '',
    extract_error: '',
    extract_retry: 0,
    extract_next_run_at: '',
    extract_started_at: '',
    extracted_at: '',
    extracted_text: '',
    extracted_chars: 0,
    ocr_text: '',
    content_summary: '',
    doc_type: '',
    extract_debug: null,

    final_name: null,
    final_target_path: filenameSuggestion.targetPath,
    final_path: null,
    ready_relative_path: null,
    review_comment: null,
    uploaded_at: uploadedAt,
    reviewed_at: null,
    archived_at: null
  };
  filesTable().unshift(file);
  addAuditLog(uploader, 'upload', 'file', id,
    `上传 ${originalName} 至项目 ${projectId}（来源：${finalSourceRole === 'admin_manual' ? '管理员端' : '商务端'}，分类：${displayLabelForCategoryKey(categoryKey)}）`);
  if (ARK_CONFIG.ENABLED && typeof _extractQueueEnqueue === 'function') {
    try { _extractQueueEnqueue(id); } catch (_) {}
  }
  return getFileById(id);
}

function updateFileExtract(fileId, patch) {
  if (!patch || typeof patch !== 'object') return null;
  const f = filesTable().update(fileId, patch);
  return f;
}

function getFileContent(fileId) {
  const f = getFileById(fileId);
  if (!f) throw new Error('文件不存在');
  return {
    id: f.id,
    original_name: f.original_name,
    uploader: f.uploader,
    uploaded_at: f.uploaded_at,
    note: f.note || '',

    extract_status: f.extract_status || '',
    extract_method: f.extract_method || '',
    extract_error: f.extract_error || '',
    extract_retry: f.extract_retry || 0,
    extract_started_at: f.extract_started_at || '',
    extracted_at: f.extracted_at || '',
    extracted_chars: f.extracted_chars || 0,

    extracted_text: f.extracted_text || '',
    ocr_text: f.ocr_text || '',

    content_summary: f.content_summary || '',
    doc_type: f.doc_type || '',

    filename_suggestion: {
      target_path: f.ai_filename_target_path || '',
      suggested_name: f.ai_filename_suggested_name || '',
      confidence: f.ai_filename_confidence || 0,
      reason: f.ai_filename_reason || ''
    },
    content_suggestion: f.ai_content_suggestion || null,
    current_suggestion: {
      target_path: f.ai_target_path || '',
      suggested_name: f.ai_suggested_name || '',
      confidence: f.ai_confidence || 0,
      reason: f.ai_reason || '',
      basis: f.ai_basis || ''
    },
    ai_model_used: f.ai_model_used || ''
  };
}

function reExtractFile(fileId, actor) {
  const f = getFileById(fileId);
  if (!f) throw new Error('文件不存在');
  if (!ARK_CONFIG.ENABLED) throw new Error('ARK 功能未启用，无法重跑内容解析');
  const filenameSuggestion = guessAiSuggestion(f.original_name, f.note);
  filesTable().update(fileId, {
    ai_target_path: filenameSuggestion.targetPath,
    ai_suggested_name: filenameSuggestion.suggestedName,
    ai_confidence: filenameSuggestion.confidence,
    ai_reason: filenameSuggestion.reason,
    ai_basis: 'filename+note',
    ai_content_suggestion: null,
    ai_model_used: '',
    extract_status: EXTRACT_STATUSES.PENDING,
    extract_method: '',
    extract_error: '',
    extract_retry: 0,
    extract_next_run_at: '',
    extract_started_at: '',
    extracted_at: '',
    extracted_text: '',
    extracted_chars: 0,
    ocr_text: '',
    content_summary: '',
    doc_type: '',
    extract_debug: null
  });
  addAuditLog(actor || '管理员', 're-extract', 'file', fileId,
    `手动重跑内容解析：${f.original_name}`);
  if (typeof _extractQueueEnqueue === 'function') {
    try { _extractQueueEnqueue(fileId, { force: true }); } catch (_) {}
  }
  return getFileContent(fileId);
}

function getFileById(id) {
  return decorateForResponse(filesTable().get(id));
}

function getFilesByProjectId(projectId) {
  return filesTable().byProject(projectId).map(decorateForResponse);
}

function listFiles({ status, projectId, q, uploader, department, categoryKey, lowConfidence, limit } = {}) {
  let results = filesTable().filter((f) => {
    if (status && f.status !== status) return false;
    if (projectId && f.project_id !== projectId) return false;
    if (uploader && f.uploader !== uploader) return false;
    if (department && f.department !== department) return false;
    if (lowConfidence) {
      const conf = typeof f.ai_confidence === 'number' ? f.ai_confidence : 0;
      const contentConf = f.ai_content_suggestion && typeof f.ai_content_suggestion.confidence === 'number'
        ? f.ai_content_suggestion.confidence : 1;
      if (conf >= 0.6 && contentConf >= 0.6) return false;
    }
    if (categoryKey) {
      const ck = f.category_key || categoryKeyForPath(f.final_target_path || f.ai_target_path || '');
      if (String(categoryKey) !== 'all' && String(ck) !== String(categoryKey)) return false;
    }
    if (q) {
      const query = q.toLowerCase();
      const haystack = `${f.original_name} ${f.uploader} ${f.department} ${f.note || ''} ${f.ai_suggested_name || ''} ${f.ai_target_path || ''} ${f.review_comment || ''} ${f.final_name || ''}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
  if (limit) results = results.slice(0, limit);
  return results.map(decorateForResponse);
}

function listReviewTasks(opts = {}) {
  const list = filesTable()
    .filter((f) => [FILE_STATUSES.PENDING_REVIEW, FILE_STATUSES.NEEDS_INFO].includes(f.status));
  return listFiles({
    ...opts,
    status: undefined
  }).filter((f) =>
    [FILE_STATUSES.PENDING_REVIEW, FILE_STATUSES.NEEDS_INFO].includes(f.status)
  );
}

function assertNoFinalPathConflict(file, finalRelativePath) {
  const safeRelative = safeRelativePath(finalRelativePath);
  const stagedPath = ensureInside(READY_FOR_NAS_DIR, path.join(READY_FOR_NAS_DIR, safeRelative));
  const occupiedByFile = filesTable().all().some((item) => item.id !== file.id && item.final_path === finalRelativePath);
  const occupiedByJob = nasJobsTable().all().some((job) => job.file_id !== file.id && job.target_relative_path === finalRelativePath && job.status !== NAS_JOB_STATUSES.MANUALLY_UPLOADED);
  if (fs.existsSync(stagedPath) || occupiedByFile || occupiedByJob) {
    throw new Error('目标路径已存在同名文件，请修改最终文件名后再确认');
  }
}

function stageFileForNas(file, finalRelativePath) {
  const sourcePath = ensureInside(ROOT, path.join(ROOT, file.stored_path || ''));
  if (!sourcePath.startsWith(ORIGINAL_UPLOADS_DIR) || !fs.existsSync(sourcePath)) {
    throw new Error('原始文件不存在，无法生成待上传区文件');
  }
  const safeRelative = safeRelativePath(finalRelativePath);
  const stagedPath = ensureInside(READY_FOR_NAS_DIR, path.join(READY_FOR_NAS_DIR, safeRelative));
  if (fs.existsSync(stagedPath)) {
    throw new Error('目标路径已存在同名文件，请修改最终文件名后再确认');
  }
  fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
  fs.copyFileSync(sourcePath, stagedPath);
  return {
    readyRelativePath: `storage/10_ready_for_nas/${safeRelative}`,
    readyAbsolutePath: stagedPath
  };
}

function createNasJob(file, finalPath, stagedFile) {
  const id = generateId('nas');
  const createdAt = nowText();
  const job = {
    id,
    file_id: file.id,
    project_id: file.project_id,
    target_relative_path: finalPath,
    ready_relative_path: stagedFile?.readyRelativePath || '',
    ready_absolute_path: stagedFile?.readyAbsolutePath || '',
    status: NAS_JOB_STATUSES.PREPARED,
    publisher_type: 'manual',
    created_at: createdAt,
    uploaded_at: null
  };
  nasJobsTable().unshift(job);
  return job;
}

function approveReview(fileId, { targetPath, finalName, reviewer, categoryOverrideReason, confirmNonDefaultCategory }) {
  const file = getFileById(fileId);
  if (!file) throw new Error('文件不存在');
  const project = getProjectById(file.project_id);
  if (!project) throw new Error('项目不存在');
  let safeFinalName = safeName(finalName || file.ai_suggested_name || file.original_name);
  if (!targetPath) throw new Error('目标目录不能为空');
  const hasExt = (() => {
    const idx = safeFinalName.lastIndexOf('.');
    if (idx <= 0 || idx === safeFinalName.length - 1) return false;
    return /^[a-zA-Z0-9]{1,6}$/.test(safeFinalName.slice(idx + 1));
  })();
  if (!hasExt && file.original_name && typeof file.original_name === 'string' && file.original_name.includes('.')) {
    const origIdx = file.original_name.lastIndexOf('.');
    if (origIdx > 0 && origIdx < file.original_name.length - 1) {
      const origExt = file.original_name.slice(origIdx + 1);
      if (/^[a-zA-Z0-9]{1,6}$/.test(origExt)) {
        safeFinalName = `${safeFinalName}.${origExt.toLowerCase()}`;
      }
    }
  }
  const finalPath = `${project.root_name}/${targetPath}/${safeFinalName}`;
  assertNoFinalPathConflict(file, finalPath);
  const stagedFile = stageFileForNas(file, finalPath);
  const reviewedAt = nowText();
  const newCategoryKey = categoryKeyForPath(targetPath);
  const aiPrimaryCk = file.ai_category_primary || file.category_key;
  const finalTargetPath = targetPath;
  const isDefaultCategory = isDefaultBusinessCategoryPath(finalTargetPath);
  const overridden = String(Boolean(confirmNonDefaultCategory || !isDefaultCategory || newCategoryKey !== (aiPrimaryCk || ''))) === 'true' || !isDefaultCategory;
  const saveOverridden = !isDefaultCategory || (newCategoryKey !== (aiPrimaryCk || file.category_key));
  const saveOverrideReason = !isDefaultCategory
    ? `归档目录「${targetPath}」不在商务端 3 个默认文件夹内（项目资料/商务资料/执行资料·报告），管理员已二次确认。${categoryOverrideReason ? ' 原因：' + categoryOverrideReason : ''}`
    : (categoryOverrideReason || '');
  filesTable().update(fileId, {
    status: FILE_STATUSES.READY_FOR_NAS,
    final_name: safeFinalName,
    final_target_path: finalTargetPath,
    final_path: finalPath,
    ready_relative_path: stagedFile.readyRelativePath,
    reviewed_at: reviewedAt,
    category_key: newCategoryKey,
    category_label: displayLabelForCategoryKey(newCategoryKey),
    category_overridden: saveOverridden,
    category_override_reason: saveOverrideReason
  });
  const job = createNasJob(file, finalPath, stagedFile);
  const logMsg = saveOverridden
    ? `确认整理（已改分类，原AI推荐分类=${aiPrimaryCk || file.category_key || '-'}，最终归档=${finalTargetPath}）`
    : `确认整理：${finalPath}`;
  addAuditLog(reviewer || '管理员', 'approve', 'file', fileId, logMsg);
  return { file: getFileById(fileId), nasJob: job, is_default_category: isDefaultCategory, category_overridden: saveOverridden };
}

function needsInfoReview(fileId, { comment, reviewer }) {
  if (!comment || !comment.trim()) throw new Error('标记需补充时必须填写原因');
  const file = getFileById(fileId);
  if (!file) throw new Error('文件不存在');
  filesTable().update(fileId, {
    status: FILE_STATUSES.NEEDS_INFO,
    review_comment: comment.trim(),
    reviewed_at: nowText()
  });
  addAuditLog(reviewer || '管理员', 'needs-info', 'file', fileId, `需补充：${comment.trim()}`);
  return getFileById(fileId);
}

function rejectReview(fileId, { comment, reviewer }) {
  if (!comment || !comment.trim()) throw new Error('拒绝归档时必须填写原因');
  const file = getFileById(fileId);
  if (!file) throw new Error('文件不存在');
  filesTable().update(fileId, {
    status: FILE_STATUSES.REJECTED,
    review_comment: comment.trim(),
    reviewed_at: nowText()
  });
  addAuditLog(reviewer || '管理员', 'reject', 'file', fileId, `拒绝归档：${comment.trim()}`);
  return getFileById(fileId);
}

function listNasJobs() {
  return nasJobsTable().all().map((job) => ({
    ...job,
    file: getFileById(job.file_id),
    project: getProjectById(job.project_id)
  }));
}

function markNasJobManuallyUploaded(jobId, { actor }) {
  const job = nasJobsTable().get(jobId);
  if (!job) throw new Error('待上传任务不存在');
  const uploadedAt = nowText();
  nasJobsTable().update(jobId, { status: NAS_JOB_STATUSES.MANUALLY_UPLOADED, uploaded_at: uploadedAt });
  filesTable().update(job.file_id, { status: FILE_STATUSES.MANUALLY_UPLOADED, archived_at: uploadedAt });
  addAuditLog(actor || '管理员', 'mark_manually_uploaded', 'nas_job', jobId, `标记已人工上传 NAS：${job.target_relative_path}`);
  return nasJobsTable().get(jobId);
}

function resolveDownloadFile(file) {
  const originalPath = path.resolve(ROOT, file.stored_path || '');
  const uploadsRoot = path.resolve(ORIGINAL_UPLOADS_DIR);
  const isOriginalAvailable = originalPath.startsWith(uploadsRoot) && fs.existsSync(originalPath);
  if (file.status === FILE_STATUSES.MANUALLY_UPLOADED && file.ready_relative_path) {
    const readyPath = path.resolve(ROOT, file.ready_relative_path);
    const readyRoot = path.resolve(READY_FOR_NAS_DIR);
    if (readyPath.startsWith(readyRoot) && fs.existsSync(readyPath)) {
      return {
        absolutePath: readyPath,
        downloadName: file.final_name || path.basename(readyPath),
        contentType: file.mime_type || 'application/octet-stream'
      };
    }
  }
  if (isOriginalAvailable) {
    return {
      absolutePath: originalPath,
      downloadName: file.original_name,
      contentType: file.mime_type || 'application/octet-stream'
    };
  }
  if (file.status === FILE_STATUSES.MANUALLY_UPLOADED) {
    try {
      let mountRoot = '';
      try {
        mountRoot = getMountRootOrDefault();
      } catch (_) { mountRoot = ''; }
      if (mountRoot) {
        const finalPath = String(file.final_path || '').trim();
        const readyRelativePath = String(file.ready_relative_path || '').trim();
        const job = nasJobsTable().all().find((j) => j && String(j.file_id) === String(file.id));
        const targetRelativePath = job && String(job.target_relative_path || '').trim();
        const candidatesRel = [];
        const candidatesAbs = [];
        if (finalPath) {
          if (path.isAbsolute(finalPath)) candidatesAbs.push(finalPath);
          else candidatesRel.push(finalPath);
        }
        if (targetRelativePath) {
          if (path.isAbsolute(targetRelativePath)) candidatesAbs.push(targetRelativePath);
          else if (!candidatesRel.includes(targetRelativePath)) candidatesRel.push(targetRelativePath);
        }
        if (readyRelativePath && !candidatesRel.includes(readyRelativePath)) {
          const rel = readyRelativePath.replace(/^(ready_for_nas|uploads|nas_scratch)[\/\\]/, '');
          if (!candidatesRel.includes(rel)) candidatesRel.push(rel);
        }
        const dlName = file.final_name || file.original_name || '';
        for (const rp of candidatesRel) {
          try {
            const found = resolveNasDownloadFile({
              mountRoot,
              relativePath: rp,
              downloadName: dlName
            });
            if (found) return {
              absolutePath: found.absolutePath,
              downloadName: found.downloadName || dlName || path.basename(found.absolutePath),
              contentType: file.mime_type || found.contentType || 'application/octet-stream'
            };
          } catch (_) {}
        }
        for (const ap of candidatesAbs) {
          try {
            const found = resolveNasDownloadFile({
              mountRoot,
              absolutePath: ap,
              downloadName: dlName
            });
            if (found) return {
              absolutePath: found.absolutePath,
              downloadName: found.downloadName || dlName || path.basename(found.absolutePath),
              contentType: file.mime_type || found.contentType || 'application/octet-stream'
            };
          } catch (_) {}
        }
        const finalNameBasename = finalPath ? path.basename(finalPath) : '';
        if (finalNameBasename && finalPath && !candidatesRel.includes(finalNameBasename)) {
          const dirName = finalPath.replace(/[\/\\][^\/\\]+$/, '');
          if (dirName && job) {
            const project = job.project_id ? getProjectById(job.project_id) : null;
            const projectRoot = project ? (project.root_name || project.name) : '';
            if (projectRoot) {
              const guessPaths = [
                `${projectRoot}/${dirName}/${finalNameBasename}`,
                `${projectRoot}/${finalNameBasename}`,
                `${dirName}/${finalNameBasename}`,
                finalNameBasename
              ];
              for (const guess of guessPaths) {
                try {
                  const found = resolveNasDownloadFile({ mountRoot, relativePath: guess, downloadName: dlName || finalNameBasename });
                  if (found) return {
                    absolutePath: found.absolutePath,
                    downloadName: found.downloadName || dlName || finalNameBasename,
                    contentType: file.mime_type || found.contentType || 'application/octet-stream'
                  };
                } catch (_) {}
              }
            }
          }
        }
      }
    } catch (_) {}
  }
  return null;
}

function renameNasPreparedFile(jobId, { newFinalName, newTargetPath, actor }) {
  const job = nasJobsTable().get(jobId);
  if (!job) throw new Error('待上传任务不存在');
  if (job.status === NAS_JOB_STATUSES.MANUALLY_UPLOADED) {
    throw new Error('已归档的任务不允许修改，请联系管理员');
  }
  const file = getFileById(job.file_id);
  if (!file) throw new Error('文件记录不存在');
  const project = getProjectById(file.project_id);
  if (!project) throw new Error('项目不存在');

  const safeFinalName = safeName(newFinalName || file.final_name || file.ai_suggested_name || file.original_name);
  const targetPath = newTargetPath || (() => {
    const full = job.target_relative_path || file.final_path || '';
    const parts = full.split('/');
    parts.shift();
    parts.pop();
    return parts.join('/');
  })();
  if (!targetPath) throw new Error('目标目录不能为空');

  const finalPath = `${project.root_name}/${targetPath}/${safeFinalName}`;
  const safeRelative = safeRelativePath(finalPath);

  if (finalPath !== (job.target_relative_path || file.final_path)) {
    assertNoFinalPathConflict(file, finalPath);
  }

  const oldStagedPath = job.ready_absolute_path
    ? ensureInside(READY_FOR_NAS_DIR, job.ready_absolute_path)
    : null;
  const newStagedPath = ensureInside(READY_FOR_NAS_DIR, path.join(READY_FOR_NAS_DIR, safeRelative));

  if (oldStagedPath && oldStagedPath !== newStagedPath) {
    if (!fs.existsSync(oldStagedPath)) {
      throw new Error('中转区原文件不存在，无法执行重命名');
    }
    fs.mkdirSync(path.dirname(newStagedPath), { recursive: true });
    if (fs.existsSync(newStagedPath)) {
      throw new Error('目标路径已存在同名文件，请修改最终文件名');
    }
    fs.renameSync(oldStagedPath, newStagedPath);
    try {
      const oldDir = path.dirname(oldStagedPath);
      if (oldDir.startsWith(READY_FOR_NAS_DIR) && fs.readdirSync(oldDir).length === 0) {
        fs.rmdirSync(oldDir, { recursive: true });
      }
    } catch (_) {}
  }

  const newReadyRelative = `storage/10_ready_for_nas/${safeRelative}`;

  nasJobsTable().update(jobId, {
    target_relative_path: finalPath,
    ready_relative_path: newReadyRelative,
    ready_absolute_path: newStagedPath
  });

  filesTable().update(file.id, {
    final_name: safeFinalName,
    final_path: finalPath,
    ready_relative_path: newReadyRelative
  });

  addAuditLog(actor || '管理员', 'rename', 'nas_job', jobId,
    `重命名待归档文件：${job.target_relative_path || file.final_path} → ${finalPath}`);

  return {
    job: nasJobsTable().get(jobId),
    file: getFileById(file.id)
  };
}

function getProjectStats(projectId) {
  const files = getFilesByProjectId(projectId);
  return {
    total: files.length,
    archived: files.filter((f) => f.status === FILE_STATUSES.MANUALLY_UPLOADED).length,
    pending: files.filter((f) => [FILE_STATUSES.PENDING_REVIEW, FILE_STATUSES.READY_FOR_NAS].includes(f.status)).length,
    needsInfo: files.filter((f) => f.status === FILE_STATUSES.NEEDS_INFO).length,
    rejected: files.filter((f) => f.status === FILE_STATUSES.REJECTED).length
  };
}

function buildNasPaths(job, { mountRoot, copyMode, overwriteExisting }) {
  const _mount = mountRoot && String(mountRoot).trim() ? String(mountRoot).trim() : (NAS_CONFIG.mountRoot || '');
  const _mode = copyMode === 'move' ? 'move' : (copyMode === 'copy' ? 'copy' : (NAS_CONFIG.copyMode === 'move' ? 'move' : 'copy'));
  const _overwrite = typeof overwriteExisting === 'boolean' ? overwriteExisting : !!NAS_CONFIG.overwrite;
  const _recursive = NAS_CONFIG.mkdirRecursive !== false;

  if (!_mount) {
    const err = new Error('未设置 NAS 挂载路径，请先在「NAS 设置」中填写 NAS_MOUNT_ROOT，或在 .env 中配置后重启后端');
    err.code = 'NAS_MOUNT_NOT_SET';
    throw err;
  }

  const sourceAbs = job.ready_absolute_path
    ? ensureInside(READY_FOR_NAS_DIR, job.ready_absolute_path)
    : null;

  if (!sourceAbs || !fs.existsSync(sourceAbs)) {
    const err = new Error('中转区文件不存在（可能已被删除或清理），请回到待审核页面重新确认整理结果');
    err.code = 'NAS_SOURCE_MISSING';
    throw err;
  }

  const targetRelative = String(job.target_relative_path || '').replace(/^[/\\]+/, '');
  if (!targetRelative) {
    const err = new Error('目标归档路径为空，请先执行「修改命名」或重新确认整理结果');
    err.code = 'NAS_TARGET_EMPTY';
    throw err;
  }

  const safeTargetRelative = safeRelativePath(targetRelative);
  const targetAbs = ensureInside(_mount, path.join(_mount, safeTargetRelative));
  const targetDir = path.dirname(targetAbs);

  return {
    mountRoot: _mount,
    copyMode: _mode,
    overwriteExisting: _overwrite,
    recursiveMkdir: _recursive,
    sourceAbsolutePath: sourceAbs,
    targetRelativePath: safeTargetRelative,
    targetAbsolutePath: targetAbs,
    targetDirectory: targetDir
  };
}

function inspectNasMount(mountRoot) {
  const mount = mountRoot || NAS_CONFIG.mountRoot || '';
  const result = {
    mountRoot: mount,
    configured: Boolean(mount && String(mount).trim()),
    exists: false,
    isDirectory: false,
    writable: false,
    probeMessage: '',
    freeBytes: null
  };
  if (!result.configured) {
    result.probeMessage = '未配置 NAS 挂载路径';
    return result;
  }
  try {
    result.exists = fs.existsSync(mount);
    if (result.exists) {
      const st = fs.statSync(mount);
      result.isDirectory = st.isDirectory();
    }
    if (result.isDirectory) {
      const probe = path.join(mount, `.archive_write_probe_${Date.now()}_${process.pid}`);
      let writeOk = false;
      let writeErr = null;
      let deleteFailed = false;
      for (const flag of ['wx', 'w', 'a']) {
        try {
          fs.writeFileSync(probe, 'ok', { flag });
          writeOk = true;
          writeErr = null;
          break;
        } catch (we) {
          const code = we?.code;
          const allowFallback = (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP' || code === 'EAGAIN' || code === 'EIO');
          if (allowFallback && flag !== 'a') {
            continue;
          }
          writeErr = we;
          writeOk = false;
        }
      }
      if (writeOk) {
        try { fs.unlinkSync(probe); } catch (_) { deleteFailed = true; }
        result.writable = true;
        if (deleteFailed) {
          result.probeMessage = '正常（可写入。NAS 端禁止删除 probe 临时文件，属常见防删策略，不影响文件推送）';
        } else {
          result.probeMessage = '正常（目录存在且可写）';
        }
      } else {
        result.writable = false;
        let msg = `目录不可写：${writeErr?.message || writeErr?.code || writeErr || '未知错误'}`;
        const writeCode = writeErr?.code;
        if (writeCode === 'EPERM' || writeCode === 'EACCES') {
          msg += SUGGEST_RESTART_BACKEND_SMB_HINT;
        }
        result.probeMessage = msg;
      }
    } else {
      result.probeMessage = result.exists ? '路径不是目录' : '目录不存在（SMB 共享盘未挂载？）';
    }
  } catch (e) {
    result.probeMessage = `检测失败：${e.message || e.code || String(e)}`;
  }
  return result;
}

function getNasMountStatus() {
  const st = inspectNasMount(NAS_CONFIG.mountRoot);
  return {
    ...st,
    configured: st.configured,
    mountRoot: st.mountRoot,
    defaultCopyMode: NAS_CONFIG.copyMode,
    defaultOverwriteExisting: !!NAS_CONFIG.overwrite
  };
}

function _validateMountDir(raw) {
  const r = String(raw || '').trim();
  if (!r) return { ok: false, code: 'NAS_MOUNT_NOT_SET', message: '未设置 NAS 挂载路径，请先在「NAS 设置」中填写 NAS_MOUNT_ROOT，或在 .env 中配置后重启后端' };
  if (!fs.existsSync(r)) return { ok: false, code: 'NAS_MOUNT_MISSING', message: `NAS 挂载路径不存在：${r}（请确认 Finder/资源管理器中是否已挂载 SMB 共享）` };
  try {
    const st = fs.statSync(r);
    if (!st.isDirectory()) return { ok: false, code: 'NAS_MOUNT_NOT_DIR', message: `NAS 挂载路径不是目录：${r}` };
    return { ok: true, path: path.resolve(r) };
  } catch (e) {
    return { ok: false, code: 'NAS_MOUNT_ACCESS_ERR', message: `NAS 挂载路径读取失败：${e.message || String(e)}` };
  }
}

function _detectNasMountRoots() {
  const out = [];
  const seen = new Set();
  const push = (p) => {
    if (!p) return;
    const rp = path.resolve(String(p));
    if (seen.has(rp)) return;
    seen.add(rp);
    const v = _validateMountDir(rp);
    if (v.ok && !_looksLikeBadCachePath(v.path)) out.push(v.path);
  };
  if (process.platform === 'darwin' || process.platform === 'linux') {
    if (fs.existsSync('/Volumes')) {
      try {
        const macVols = fs.readdirSync('/Volumes').filter(Boolean);
        macVols.forEach((name) => {
          if (!name || name.startsWith('.')) return;
          if (name === 'Macintosh HD' || name === 'Recovery' || name === 'Preboot' || name === 'VM' || name === 'Data') return;
          push('/Volumes/' + name);
        });
      } catch (_) {}
    }
    ['/mnt', '/media', '/srv', '/nas', '/share', '/shared'].forEach((base) => {
      if (fs.existsSync(base)) {
        try {
          fs.readdirSync(base).forEach((n) => { if (n && !n.startsWith('.')) push(base + '/' + n); });
        } catch (_) {}
      }
    });
    ['/mnt/nas', '/mnt/share', '/srv/nas', '/srv/share', '/data', '/nas'].forEach(push);
  } else if (process.platform === 'win32') {
    'DEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((c) => {
      try {
        const p = `${c}:\\`;
        if (fs.existsSync(p)) push(p);
      } catch (_) {}
    });
    ['\\\\127.0.0.1\\share', '\\\\localhost\\share'].forEach(push);
  }
  return out;
}

function _collectAllValidRoots(mountRootOverride, includeAutoDetect = true) {
  const override = (mountRootOverride && String(mountRootOverride).trim()) ? String(mountRootOverride).trim() : '';
  const persisted = NAS_CONFIG.mountRoot ? String(NAS_CONFIG.mountRoot).trim() : '';
  const seen = new Set();
  const roots = [];
  const errs = [];
  [override, persisted].forEach((cand) => {
    if (!cand || seen.has(cand)) return;
    seen.add(cand);
    const v = _validateMountDir(cand);
    if (v.ok && !_looksLikeBadCachePath(v.path)) roots.push(v.path);
    else errs.push({ kind: cand === override ? 'override' : 'persisted', path: cand, code: v.code, message: v.message });
  });
  if (includeAutoDetect) {
    try {
      _detectNasMountRoots().forEach((p) => {
        if (p && !seen.has(p)) { seen.add(p); roots.push(p); }
      });
    } catch (_) {}
  }
  return { roots, errs };
}

function getMountRootOrDefault(mountRootOverride) {
  const { roots, errs } = _collectAllValidRoots(mountRootOverride, true);
  if (roots.length > 0) return roots[0];
  const firstErr = errs[0] || null;
  const e = new Error(firstErr ? firstErr.message : '未设置 NAS 挂载路径，且未能自动发现共享盘（macOS 请确认 Finder 左侧「位置」里已挂载 SMB，Windows 请确认已映射网络驱动器盘符）');
  e.code = firstErr ? firstErr.code : 'NAS_MOUNT_NOT_SET';
  e.candidates = errs;
  throw e;
}

function isHiddenNasFile(name) {
  if (!name) return true;
  const n = String(name);
  if (n.startsWith('.')) return true;
  if (n.startsWith('~$')) return true;
  if (/\.tmp$|\.crdownload$|\.part$|\.ds_store$|^thumbs\.db$|^desktop\.ini$/i.test(n)) return true;
  if (n.startsWith('.archive_write_probe_')) return true;
  return false;
}

function _guessMimeFromName(name) {
  if (!name) return 'application/octet-stream';
  const ext = path.extname(String(name)).toLowerCase();
  const map = {
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed',
    '.7z': 'application/x-7z-compressed',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.dwg': 'image/vnd.dwg',
    '.dxf': 'image/vnd.dxf',
    '.htm': 'text/html; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.rtf': 'application/rtf'
  };
  return map[ext] || 'application/octet-stream';
}

function walkNasDirectory(rootAbs, currentRelative, opts, collected) {
  const currentAbs = currentRelative
    ? ensureInside(rootAbs, path.join(rootAbs, currentRelative))
    : rootAbs;
  let entries = [];
  try {
    entries = fs.readdirSync(currentAbs, { withFileTypes: true });
  } catch (e) {
    return collected;
  }
  entries.forEach(ent => {
    if (isHiddenNasFile(ent.name)) return;
    const rel = currentRelative ? `${currentRelative}/${ent.name}` : ent.name;
    if (ent.isDirectory()) {
      walkNasDirectory(rootAbs, rel, opts, collected);
    } else if (ent.isFile()) {
      const abs = ensureInside(rootAbs, path.join(rootAbs, rel));
      try {
        const st = fs.statSync(abs);
        if (!st.isFile()) return;
        const parts = rel.split('/').filter(Boolean);
        const fileName = parts.pop() || ent.name;
        const projectFolder = parts[0] || '';
        const categoryFolder = parts.slice(1).join('/') || '';
        const idSeed = Buffer.from(abs).toString('base64').replace(/[^a-z0-9]/gi, '').slice(0, 32)
          + '_' + String(st.size).slice(0, 12);
        collected.push({
          id: `ns-${idSeed}`,
          relative_path: rel,
          absolute_path: abs,
          project_folder: projectFolder,
          category_folder: categoryFolder,
          file_name: fileName,
          size: Number.isFinite(st.size) ? st.size : 0,
          last_modified: st.mtime ? new Date(st.mtime).toISOString() : null,
          source: 'nas_only',
          matched_file_id: null,
          matched_nas_job_id: null
        });
      } catch (_) { /* stat fail: skip this file */ }
    }
  });
  return collected;
}

function matchScannedFilesWithDb(scannedFiles, nasJobsArr, filesArr, projectsArr) {
  const byRelPath = new Map();
  (nasJobsArr || []).forEach(j => {
    if (j.target_relative_path) byRelPath.set(safeRelativePath(j.target_relative_path), j);
  });
  const projByRootName = new Map();
  (projectsArr || []).forEach(p => {
    if (p.root_name) projByRootName.set(String(p.root_name), p);
    if (p.name) projByRootName.set(String(p.name), p);
  });
  (filesArr || []).forEach(f => {
    if (f.final_path) {
      const sr = safeRelativePath(f.final_path);
      if (!byRelPath.has(sr)) byRelPath.set(sr, { __fileOnly: true, file_id: f.id, final_path: sr });
    }
  });
  scannedFiles.forEach(sf => {
    const safeRel = safeRelativePath(sf.relative_path);
    const match = byRelPath.get(safeRel);
    if (match) {
      sf.source = 'nas_and_db';
      if (match.__fileOnly) {
        sf.matched_file_id = match.file_id || null;
      } else {
        sf.matched_nas_job_id = match.id || null;
        sf.matched_file_id = match.file_id || null;
      }
    }
    const projMatch = projByRootName.get(sf.project_folder);
    if (projMatch) sf._project = { id: projMatch.id, name: projMatch.name, root_name: projMatch.root_name };
  });
  return scannedFiles;
}

function scanNasDirectory({ mountRoot, projectId, q, limit, offset } = {}) {
  const rootAbs = getMountRootOrDefault(mountRoot);
  const allFiles = walkNasDirectory(rootAbs, '', {}, []);

  const projects = projectId ? [getProjectById(projectId)].filter(Boolean) : null;
  const filesDb = filesTable().all();
  const jobsDb = nasJobsTable().all();
  const projectService = require('./project-service');
  const projDb = projects || (projectService && typeof projectService.getAllProjects === 'function' ? projectService.getAllProjects() : []);
  matchScannedFilesWithDb(allFiles, jobsDb, filesDb, Array.isArray(projDb) ? projDb : []);

  let result = allFiles;

  if (projectId) {
    const p = getProjectById(projectId);
    if (p) {
      const rn = String(p.root_name || '');
      const nm = String(p.name || '');
      result = result.filter(r => {
        const f = r.project_folder;
        return (rn && f === rn) || (nm && f === nm);
      });
    } else {
      result = [];
    }
  }

  if (q && String(q).trim()) {
    const k = String(q).trim().toLowerCase();
    result = result.filter(r =>
      String(r.file_name || '').toLowerCase().includes(k)
      || String(r.relative_path || '').toLowerCase().includes(k)
      || String(r.project_folder || '').toLowerCase().includes(k)
      || String(r.category_folder || '').toLowerCase().includes(k)
    );
  }

  result.sort((a, b) => {
    const sa = a.source === 'nas_and_db' ? 0 : 1;
    const sb = b.source === 'nas_and_db' ? 0 : 1;
    if (sa !== sb) return sa - sb;
    const ta = a.last_modified ? new Date(a.last_modified).getTime() : 0;
    const tb = b.last_modified ? new Date(b.last_modified).getTime() : 0;
    return tb - ta;
  });

  const total = result.length;
  let paged = result;
  if (limit) {
    const off = Math.max(0, Number(offset) || 0);
    const lim = Math.max(1, Number(limit));
    paged = result.slice(off, off + lim);
  }

  return {
    mount_root: rootAbs,
    scanned_at: new Date().toISOString(),
    total,
    nas_only_count: result.filter(r => r.source === 'nas_only').length,
    nas_and_db_count: result.filter(r => r.source === 'nas_and_db').length,
    limit: limit ? Number(limit) : null,
    offset: offset ? Number(offset) : 0,
    files: paged
  };
}

function _looksLikeBadCachePath(p) {
  if (!p) return true;
  const r = String(p).toLowerCase().replace(/\\/g, '/');
  const bad = [
    'tencent.xinwechat',
    'xinwechat',
    'com.tencent',
    '/message/',
    'application support/com.tencent',
    '/cache/',
    '/caches/',
    '/tmp/',
    '/temp/',
    'appdata/local/temp',
    'local settings/temporary',
    '/.trash',
    '/containers/',
    '/library/containers/',
    '/browser_locker/',
    '/lockerblob_storage/'
  ];
  if (bad.some((b) => r.includes(b))) return true;
  if (/^\/(private\/)?var\/folders\b/.test(r)) return true;
  return false;
}

function resolveNasDownloadFile({ mountRoot, relativePath, absolutePath, downloadName }) {
  const { roots: validRoots, errs: rootErrs } = _collectAllValidRoots(mountRoot, true);
  const resolvedCandidates = [];
  console.log('[NAS下载:resolveNasDownloadFile] 入参 =', JSON.stringify({
    mountRoot: mountRoot ? mountRoot : '(empty)',
    relativePath: relativePath ? relativePath.slice(0, 80) : '',
    absolutePath: absolutePath ? absolutePath.slice(0, 120) : '',
    downloadName: downloadName || ''
  }, null, 0));
  console.log('[NAS下载:resolveNasDownloadFile] 候选根数量 =', validRoots.length, 'validRoots =', JSON.stringify(validRoots), 'rootErrs =', JSON.stringify(rootErrs));
  if (absolutePath && String(absolutePath).trim()) {
    const absRaw = String(absolutePath).trim();
    try {
      const absResolved = path.resolve(absRaw);
      const absInfo = { kind: 'absolute-trust', input: absRaw, path: absResolved, root: '(absolute)' };
      if (fs.existsSync(absResolved)) {
        try {
          const st = fs.statSync(absResolved);
          const bad = _looksLikeBadCachePath(absResolved);
          console.log('[NAS下载:resolveNasDownloadFile] absolute-trust 检查：exists=', fs.existsSync(absResolved), 'isFile=', st.isFile(), 'badCache=', bad);
          if (st.isFile() && !bad) {
            const relFinal = relativePath
              ? safeRelativePath(String(relativePath))
              : path.basename(absResolved);
            const name = (downloadName && String(downloadName).trim())
              ? safeName(String(downloadName).trim())
              : path.basename(absResolved);
            return {
              absolutePath: absResolved,
              mountRoot: validRoots[0] || path.dirname(absResolved),
              relativePath: relFinal,
              downloadName: name,
              contentType: _guessMimeFromName(name),
              _hitStrategy: 'absolute-trust',
              _resolvedCandidates: [{ ...absInfo, status: 'ok', size: st.size }]
            };
          } else {
            absInfo.status = st.isFile() ? 'bad_cache_path' : 'not_file';
          }
        } catch (e) { absInfo.status = 'stat_err_' + (e.code || ''); }
      } else { absInfo.status = 'not_exist'; }
      resolvedCandidates.push(absInfo);
    } catch (_) {}
  }
  if (!validRoots.length) {
    const e = new Error('未找到有效 NAS 挂载路径，请在「NAS 设置」中配置正确的共享盘路径。已尝试解析：' +
      resolvedCandidates.map((c) => `${c.kind}=${c.status || 'n/a'}`).join(', '));
    e.code = 'NAS_MOUNT_NOT_SET';
    e.candidates = resolvedCandidates;
    throw e;
  }
  const candidates = [];
  if (absolutePath && String(absolutePath).trim()) {
    candidates.push({ kind: 'absolute-raw', input: String(absolutePath).trim() });
    const abs = String(absolutePath).trim();
    let rel = '';
    try { rel = safeRelativePath(abs.replace(/^[^a-zA-Z]:.*?\/Volumes\/.*?\//, '/').replace(/^[a-zA-Z]:.*?[\/\\]/, '').replace(/^\/Volumes\/[^\/]+[\/\\]/, '')); } catch (_) { rel = ''; }
    if (rel) candidates.push({ kind: 'absolute-rel-extracted', input: rel });
  }
  if (relativePath && String(relativePath).trim()) {
    candidates.push({ kind: 'relative-raw', input: String(relativePath).trim() });
    const normalized = safeRelativePath(String(relativePath).trim());
    if (normalized && normalized !== String(relativePath).trim()) {
      candidates.push({ kind: 'relative-sanitized', input: normalized });
    }
  }
  let targetAbs = null;
  let hitRootAbs = null;
  let hitStrategy = null;
  for (const rootAbs of validRoots) {
    for (const cand of candidates) {
      let candAbs = null;
      let status = 'n/a';
      try {
        if (cand.kind === 'absolute-raw') {
          const resolved = path.resolve(cand.input);
          try { candAbs = ensureInside(rootAbs, resolved); }
          catch (_) {
            try { candAbs = ensureInside(rootAbs, path.join(rootAbs, safeRelativePath(path.relative(rootAbs, resolved)))); } catch (__) { candAbs = null; }
          }
          if (!candAbs && fs.existsSync(resolved)) {
            try {
              const st = fs.statSync(resolved);
              if (st.isFile()) {
                for (const rr of validRoots) {
                  try {
                    const insideAbs = ensureInside(rr, resolved);
                    if (insideAbs && fs.existsSync(insideAbs)) { candAbs = insideAbs; break; }
                  } catch (_) {}
                }
              }
            } catch (_) {}
          }
        } else {
          const safeRel = safeRelativePath(cand.input);
          if (safeRel) candAbs = ensureInside(rootAbs, path.join(rootAbs, safeRel));
        }
      } catch (e) { candAbs = null; status = 'ensure_err_' + (e.code || ''); }
      if (!candAbs) {
        resolvedCandidates.push({ kind: cand.kind, root: rootAbs, input: cand.input, status });
        continue;
      }
      let size = 0;
      try {
        if (fs.existsSync(candAbs)) {
          const st = fs.statSync(candAbs);
          if (st.isFile()) {
            size = st.size;
            targetAbs = candAbs;
            hitRootAbs = rootAbs;
            hitStrategy = cand.kind;
          } else { status = 'not_file'; }
        } else { status = 'not_exist'; }
      } catch (e) { status = 'stat_err_' + (e.code || ''); }
      resolvedCandidates.push({ kind: cand.kind, root: rootAbs, input: cand.input, path: candAbs, status, size: size || undefined });
      if (targetAbs) break;
    }
    if (targetAbs) break;
  }
  if (!targetAbs) {
    console.log('[NAS下载:resolveNasDownloadFile] 全部失败！未找到目标文件。resolvedCandidates 尾 5 =', JSON.stringify(resolvedCandidates.slice(-5)));
    const e = new Error('文件不存在或路径越界。已尝试解析候选：' +
      resolvedCandidates.map((c) => `${c.kind}@${c.root || 'abs'}[${(c.input || '').slice(0, 40)}]=>${c.status || '?'}`).join('; '));
    e.code = 'NAS_FILE_NOT_FOUND';
    e.candidates = resolvedCandidates;
    e.validRoots = validRoots;
    return null;
  }
  console.log('[NAS下载:resolveNasDownloadFile] 命中！targetAbs =', targetAbs, 'hitRoot =', hitRootAbs, 'strategy =', hitStrategy);
  let relFinal;
  try { relFinal = path.relative(hitRootAbs || validRoots[0], targetAbs).split(path.sep).join('/'); }
  catch (_) { relFinal = relativePath ? safeRelativePath(String(relativePath)) : ''; }
  const name = (downloadName && String(downloadName).trim())
    ? safeName(String(downloadName).trim())
    : path.basename(targetAbs);
  return {
    absolutePath: targetAbs,
    mountRoot: hitRootAbs || validRoots[0],
    relativePath: relFinal,
    downloadName: name,
    contentType: _guessMimeFromName(name),
    _hitStrategy: hitStrategy,
    _resolvedCandidates: resolvedCandidates
  };
}

const RELIABLE_COPY_CHUNK_BYTES = 64 * 1024;

function copyFileReliably(sourcePath, targetPath, options = {}) {
  const { overwriteExisting = false, logPrefix = '[NASCopy]' } = options;
  const methodsTried = [];
  let lastErr = null;

  if (!overwriteExisting && fs.existsSync(targetPath)) {
    const e = new Error(`目标文件已存在且禁止覆盖：${targetPath}`);
    e.code = 'EEXIST';
    throw e;
  }

  const _layerLabel = (n, desc) => `${logPrefix} L${n}:${desc}`;

  // Layer 1: fs.copyFileSync (fast path, zero memory overhead on local FS)
  methodsTried.push('copyFileSync:L1[try]');
  try {
    const flags = overwriteExisting ? 0 : fs.constants.COPYFILE_EXCL;
    fs.copyFileSync(sourcePath, targetPath, flags);
    methodsTried[methodsTried.length - 1] = 'copyFileSync:L1[ok]';
    return { methodUsed: 'copyFileSync', layer: 1, methodsTried };
  } catch (l1Err) {
    lastErr = l1Err;
    if (l1Err.code === 'EEXIST' && !overwriteExisting) throw l1Err;
    methodsTried[methodsTried.length - 1] = `copyFileSync:L1[fail:${l1Err.code || l1Err.errno || 'err'}]`;
    try { fs.unlinkSync(targetPath); } catch (_) { /* ignore */ }
    console.warn(_layerLabel(1, 'copyFileSync fallback'),
      `code=${l1Err.code} syscall=${l1Err.syscall}`);
  }

  // Layer 2: chunked readSync/writeSync (memory safe, 64KB chunks)
  methodsTried.push('chunkedRW:L2[try]');
  try {
    if (!overwriteExisting && fs.existsSync(targetPath)) {
      const e = new Error(`目标文件已存在且禁止覆盖：${targetPath}`);
      e.code = 'EEXIST';
      throw e;
    }
    const fdIn = fs.openSync(sourcePath, 'r');
    try {
      const outFlags = overwriteExisting ? 'w' : 'wx';
      const fdOut = fs.openSync(targetPath, outFlags, 0o644);
      try {
        const buf = Buffer.alloc(RELIABLE_COPY_CHUNK_BYTES);
        let bytesRead;
        while ((bytesRead = fs.readSync(fdIn, buf, 0, RELIABLE_COPY_CHUNK_BYTES, null)) > 0) {
          fs.writeSync(fdOut, buf, 0, bytesRead, null);
        }
      } finally {
        fs.closeSync(fdOut);
      }
    } finally {
      fs.closeSync(fdIn);
    }
    methodsTried[methodsTried.length - 1] = 'chunkedRW:L2[ok]';
    return { methodUsed: 'chunkedRW', layer: 2, methodsTried };
  } catch (l2Err) {
    lastErr = l2Err;
    if (l2Err.code === 'EEXIST' && !overwriteExisting) throw l2Err;
    methodsTried[methodsTried.length - 1] = `chunkedRW:L2[fail:${l2Err.code || l2Err.errno || 'err'}]`;
    try { fs.unlinkSync(targetPath); } catch (_) { /* ignore */ }
    console.warn(_layerLabel(2, 'chunkedRW fallback'),
      `code=${l2Err.code} syscall=${l2Err.syscall}`);
  }

  // Layer 3: shell /bin/cp (OS-level, handles SMB/NFS/FUSE edge cases)
  methodsTried.push('shellCp:L3[try]');
  try {
    const args = [];
    if (!overwriteExisting) args.push('-n');
    args.push(sourcePath, targetPath);
    execFileSync('/bin/cp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    methodsTried[methodsTried.length - 1] = 'shellCp:L3[ok]';
    return { methodUsed: 'shellCp', layer: 3, methodsTried };
  } catch (l3Err) {
    lastErr = l3Err;
    methodsTried[methodsTried.length - 1] = `shellCp:L3[fail:status=${l3Err.status || l3Err.code || 'err'}]`;
    console.warn(_layerLabel(3, 'shellCp final fallback failed'),
      `status=${l3Err.status} stderr=${(l3Err.stderr || '').toString().slice(0, 160)}`);
  }

  const wrapped = new Error(
    `多层降级复制全部失败（${methodsTried.join(' → ')}）。` +
    `源=${sourcePath} 目标=${targetPath} ` +
    `最后错误：${lastErr?.code || lastErr?.message || String(lastErr)}`
  );
  wrapped.code = 'NAS_COPY_ALL_LAYERS_FAILED';
  wrapped.inner = lastErr;
  wrapped.methods_tried = methodsTried;
  throw wrapped;
}

function moveFileReliably(sourcePath, targetPath, options = {}) {
  const { overwriteExisting = false, logPrefix = '[NASMove]' } = options;

  if (!overwriteExisting && fs.existsSync(targetPath)) {
    const e = new Error(`目标文件已存在且禁止覆盖：${targetPath}`);
    e.code = 'EEXIST';
    throw e;
  }

  // Layer 1: fs.renameSync (atomic, same-FS fast path)
  try {
    fs.renameSync(sourcePath, targetPath);
    return { methodUsed: 'renameSync', layer: 1, copy_fallback_used: false };
  } catch (rnErr) {
    if (rnErr.code === 'EEXIST' && !overwriteExisting) throw rnErr;
    console.warn(`${logPrefix} L1:renameSync fallback code=${rnErr.code}`);
  }

  // Layer 2 (rename failed, esp. EXDEV cross-device): copy + unlink source
  const copyResult = copyFileReliably(sourcePath, targetPath, {
    overwriteExisting,
    logPrefix: logPrefix + ':CopyFallback'
  });
  try {
    fs.unlinkSync(sourcePath);
  } catch (unlinkErr) {
    console.warn(`${logPrefix} copy succeeded but source unlink failed`,
      `code=${unlinkErr.code} src=${sourcePath}`);
  }
  return {
    methodUsed: copyResult.methodUsed + '+unlink',
    layer: 2,
    copy_fallback_used: true,
    copy_layer: copyResult.layer,
    methods_tried: ['renameSync:L1', ...(copyResult.methodsTried || [])]
  };
}

const SUGGEST_RESTART_BACKEND_SMB_HINT = [
  '',
  '【排障建议】此错误通常由 macOS 后端进程的 NAS（SMB）共享盘认证会话过期导致，并非真实"权限不足"。',
  '请按以下 3 步快速修复（约 1 分钟）：',
  '  1. 在 macOS Finder 左侧「位置」栏中点击 /Volumes/personal_folder（或对应 NAS 共享卷），访问一次任意目录，刷新 SMB 认证；',
  '  2. 回到运行后端的 IDE 终端，按 Ctrl+C 停止当前的 npm run dev，然后重新执行 npm run dev 启动新进程（新进程会继承 Finder 刷新后的有效凭证）；',
  '  3. 回到页面点击「检测挂载点」确认状态正常，再重新执行推送即可。'
].join('\n');

function mkdirReliably(targetDir, options = {}) {
  const { recursive = true, logPrefix = '[NASMkdir]' } = options;
  const methodsTried = [];
  let lastErr = null;
  const layerLabel = (n, desc) => `${logPrefix} L${n}:${desc}`;

  if (fs.existsSync(targetDir) && fs.statSync(targetDir).isDirectory()) {
    return { methodUsed: 'alreadyExists', layer: 0, methodsTried, created: false };
  }

  // Layer 1: fs.mkdirSync with recursive (standard Node.js path, preferred)
  methodsTried.push('mkdirSync:L1[try]');
  try {
    fs.mkdirSync(targetDir, { recursive });
    methodsTried[methodsTried.length - 1] = 'mkdirSync:L1[ok]';
    return { methodUsed: 'mkdirSync', layer: 1, methodsTried, created: true };
  } catch (l1Err) {
    lastErr = l1Err;
    if (l1Err.code === 'EEXIST') {
      methodsTried[methodsTried.length - 1] = 'mkdirSync:L1[ok:existAfterRace]';
      return { methodUsed: 'mkdirSync:existing', layer: 1, methodsTried, created: false };
    }
    methodsTried[methodsTried.length - 1] = `mkdirSync:L1[fail:${l1Err.code || l1Err.errno || 'err'}]`;
    console.warn(layerLabel(1, 'mkdirSync fallback'),
      `code=${l1Err.code} syscall=${l1Err.syscall} target=${targetDir}`);
  }

  // Layer 2: shell /bin/mkdir -p (OS-level syscall, handles SMB/NFS/FUSE edge cases)
  methodsTried.push('shellMkdir:L2[try]');
  try {
    const args = [];
    if (recursive) args.push('-p');
    args.push(targetDir);
    execFileSync('/bin/mkdir', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      throw new Error(`shell mkdir -p 执行成功但目标目录不存在？ ${targetDir}`);
    }
    methodsTried[methodsTried.length - 1] = 'shellMkdir:L2[ok]';
    return { methodUsed: 'shellMkdir', layer: 2, methodsTried, created: true };
  } catch (l2Err) {
    lastErr = l2Err;
    methodsTried[methodsTried.length - 1] = `shellMkdir:L2[fail:status=${l2Err.status || l2Err.code || 'err'}]`;
    console.warn(layerLabel(2, 'shellMkdir final fallback failed'),
      `status=${l2Err.status} stderr=${(l2Err.stderr || '').toString().slice(0, 160)}`);
  }

  const wrapped = new Error(
    `多层降级创建目录全部失败（${methodsTried.join(' → ')}）。` +
    `目标=${targetDir} 最后错误：${lastErr?.code || lastErr?.message || String(lastErr)}` +
    SUGGEST_RESTART_BACKEND_SMB_HINT
  );
  wrapped.code = 'NAS_MKDIR_ALL_LAYERS_FAILED';
  wrapped.inner = lastErr;
  wrapped.methods_tried = methodsTried;
  throw wrapped;
}

function pushSingleJobToNas(jobId, options = {}) {
  const { actor = '管理员', dryRun = false, mountRoot, copyMode, overwriteExisting } = options;
  const job = nasJobsTable().get(jobId);
  if (!job) {
    const e = new Error('待上传任务不存在');
    e.code = 'NAS_JOB_NOT_FOUND';
    throw e;
  }
  if (job.status === NAS_JOB_STATUSES.MANUALLY_UPLOADED) {
    const e = new Error('该任务已归档，无需重复推送');
    e.code = 'NAS_JOB_ALREADY_UPLOADED';
    throw e;
  }
  if (job.status !== NAS_JOB_STATUSES.PREPARED) {
    const e = new Error(`当前状态 ${job.status} 不允许推送，请先确认整理结果`);
    e.code = 'NAS_JOB_BAD_STATUS';
    throw e;
  }

  const plan = buildNasPaths(job, { mountRoot, copyMode, overwriteExisting });
  if (dryRun) {
    return {
      job_id: job.id,
      file_name: job.file?.final_name || job.file?.original_name,
      dry_run: true,
      copy_mode: plan.copyMode,
      overwrite_existing: plan.overwriteExisting,
      source_absolute_path: plan.sourceAbsolutePath,
      target_absolute_path: plan.targetAbsolutePath,
      target_relative_path: plan.targetRelativePath,
      target_exists_before: fs.existsSync(plan.targetAbsolutePath),
      mount_status: inspectNasMount(plan.mountRoot)
    };
  }

  if (!plan.overwriteExisting && fs.existsSync(plan.targetAbsolutePath)) {
    const e = new Error(`NAS 目标路径已存在同名文件：${plan.targetAbsolutePath}。\n可在「NAS 设置」中开启「允许覆盖」后重试，或手动删除 NAS 端同名文件后再推送。`);
    e.code = 'NAS_TARGET_CONFLICT';
    e.target_absolute_path = plan.targetAbsolutePath;
    throw e;
  }

  let mkdirReliableResult = null;
  try {
    if (!fs.existsSync(plan.targetDirectory)) {
      if (plan.recursiveMkdir) {
        mkdirReliableResult = mkdirReliably(plan.targetDirectory, {
          recursive: true,
          logPrefix: `[NASPush:mkdir:${jobId}]`
        });
      } else {
        throw new Error(`目标目录不存在，且未开启递归创建：${plan.targetDirectory}`);
      }
    } else {
      mkdirReliableResult = { methodUsed: 'alreadyExists', layer: 0, methodsTried: [], created: false };
    }
  } catch (mkdirErr) {
    let msg = `无法创建 NAS 目标目录（可能是权限不足或 NAS 不可写）：${plan.targetDirectory}\n原因：${mkdirErr.message || mkdirErr.code || mkdirErr}`;
    if (mkdirErr.code === 'NAS_MKDIR_ALL_LAYERS_FAILED') {
      msg = mkdirErr.message || msg; // 已经自带多层降级描述和友好提示
    } else if (mkdirErr.code === 'EPERM' || mkdirErr.code === 'EACCES') {
      msg += SUGGEST_RESTART_BACKEND_SMB_HINT;
    }
    const wrapped = new Error(msg);
    wrapped.code = 'NAS_MKDIR_FAILED';
    wrapped.inner = mkdirErr;
    if (mkdirErr.methods_tried) wrapped.methods_tried = mkdirErr.methods_tried;
    if (mkdirReliableResult) wrapped.reliable_result = mkdirReliableResult;
    throw wrapped;
  }

  let reliableResult = null;
  try {
    if (plan.copyMode === 'move') {
      reliableResult = moveFileReliably(
        plan.sourceAbsolutePath,
        plan.targetAbsolutePath,
        { overwriteExisting: plan.overwriteExisting, logPrefix: `[NASPush:move:${jobId}]` }
      );
    } else {
      reliableResult = copyFileReliably(
        plan.sourceAbsolutePath,
        plan.targetAbsolutePath,
        { overwriteExisting: plan.overwriteExisting, logPrefix: `[NASPush:copy:${jobId}]` }
      );
    }
  } catch (cpErr) {
    let reason = cpErr.message || cpErr.code || String(cpErr);
    let appendHint = false;
    if (cpErr.code === 'NAS_COPY_ALL_LAYERS_FAILED') {
      const innerCode = cpErr.inner?.code;
      if (innerCode === 'EACCES' || innerCode === 'EPERM') {
        reason = '权限不足（NAS 目录只读 / 当前系统用户对 SMB 共享盘无写权限）。已尝试 3 层降级复制，全部失败。请检查 NAS 挂载权限';
        appendHint = true;
      } else if (innerCode === 'ENOSPC') {
        reason = 'NAS 磁盘空间不足';
      } else if (innerCode === 'ENOENT') {
        reason = '源文件或目标目录在写入时不存在（SMB 挂载中断？）';
      } else {
        reason = `复制失败（多层降级后仍失败，tried=${cpErr.methods_tried?.join('→') || 'N/A'}）：${cpErr.inner?.message || cpErr.inner?.code || String(cpErr.inner)}`;
        appendHint = cpErr.methods_tried?.some?.(m => m.includes('shellCp')); // L3 也失败 → 凭证问题高概率
      }
    } else if (cpErr.code === 'EACCES' || cpErr.code === 'EPERM') {
      reason = '权限不足（NAS 目录只读 / 当前系统用户对 SMB 共享盘无写权限）';
      appendHint = true;
    } else if (cpErr.code === 'ENOSPC') {
      reason = 'NAS 磁盘空间不足';
    } else if (cpErr.code === 'ENOENT') {
      reason = '源文件或目标目录在写入时不存在（SMB 挂载中断？）';
    } else if (cpErr.code === 'EEXIST') {
      reason = '目标文件已存在且禁止覆盖（COPYFILE_EXCL 冲突）';
    }
    let fullMsg = `推送文件到 NAS 失败：${reason}\n目标路径：${plan.targetAbsolutePath}`;
    if (appendHint) fullMsg += SUGGEST_RESTART_BACKEND_SMB_HINT;
    const wrapped = new Error(fullMsg);
    wrapped.code = 'NAS_COPY_FAILED';
    wrapped.inner = cpErr;
    if (cpErr.methods_tried) wrapped.methods_tried = cpErr.methods_tried;
    throw wrapped;
  }

  const marked = markNasJobManuallyUploaded(job.id, { actor });
  addAuditLog(actor, 'push_to_nas', 'nas_job', job.id,
    `NAS 直连推送成功：mode=${plan.copyMode} method=${reliableResult?.methodUsed || 'N/A'} layer=${reliableResult?.layer || 'N/A'} 源=${plan.sourceAbsolutePath} 目标=${plan.targetAbsolutePath}`);
  return {
    job_id: job.id,
    file_name: job.file?.final_name || job.file?.original_name,
    copy_mode: plan.copyMode,
    source_absolute_path: plan.sourceAbsolutePath,
    target_absolute_path: plan.targetAbsolutePath,
    target_relative_path: plan.targetRelativePath,
    uploaded_at: marked.uploaded_at,
    status: 'pushed_and_marked_archived',
    reliable_result: reliableResult
  };
}

function pushAllReadyJobsToNas(options = {}) {
  const { actor = '管理员', dryRun = false, mountRoot, copyMode, overwriteExisting, concurrency = 2 } = options;
  const jobs = nasJobsTable().all().filter(j => j.status === NAS_JOB_STATUSES.PREPARED);
  const results = [];
  let ok = 0, fail = 0, skipped = 0;

  for (const job of jobs) {
    try {
      const r = pushSingleJobToNas(job.id, { actor, dryRun, mountRoot, copyMode, overwriteExisting });
      results.push({ job_id: job.id, success: true, result: r });
      if (!dryRun) ok++;
    } catch (err) {
      const detail = {
        job_id: job.id,
        success: false,
        error: err.message || String(err),
        error_code: err.code || null
      };
      if (err.code === 'NAS_JOB_ALREADY_UPLOADED') skipped++;
      else fail++;
      results.push(detail);
    }
  }

  return {
    dry_run: !!dryRun,
    total: jobs.length,
    pushed_success: ok,
    skipped_already_uploaded: skipped,
    failed: fail,
    results
  };
}

function buildContentDispositionHeader(downloadName) {
  const raw = String(downloadName || 'download');
  const urlEncoded = encodeURIComponent(raw);
  let asciiFallback = raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const hasNonAscii = /[^\x20-\x7E]/.test(asciiFallback);
  if (hasNonAscii) {
    asciiFallback = urlEncoded;
  }
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${urlEncoded}`;
}

function streamFileDownloadSafe(res, absolutePath, { contentType, downloadName, relativePath }) {
  let stats;
  try {
    stats = fs.statSync(absolutePath);
    if (!stats.isFile()) {
      res.status(404).json({ error: '目标不是文件', error_code: 'DOWNLOAD_NOT_A_FILE' });
      return;
    }
  } catch (statErr) {
    const code = statErr.code || 'DOWNLOAD_STAT_ERR';
    const msg = code === 'ENOENT' ? '文件不存在' : `读取文件元信息失败：${statErr.message || String(statErr)}`;
    res.status(404).json({ error: msg, error_code: code });
    return;
  }
  try {
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('Content-Length', stats.size);
    if (relativePath) {
      let encodedRel = '';
      try { encodedRel = encodeURIComponent(String(relativePath)); } catch (_) { encodedRel = ''; }
      if (encodedRel) res.setHeader('X-Nas-Relative-Path', encodedRel);
    }
    const finalName = downloadName || path.basename(absolutePath);
    res.setHeader('Content-Disposition', buildContentDispositionHeader(finalName));
    const rs = fs.createReadStream(absolutePath);
    let respondedError = false;
    rs.on('error', (streamErr) => {
      if (respondedError) return;
      respondedError = true;
      try {
        if (!res.headersSent) {
          res.status(500).json({ error: `读取文件失败：${streamErr.message || streamErr.code || String(streamErr)}`, error_code: streamErr.code || 'DOWNLOAD_STREAM_ERR' });
        } else {
          try { res.destroy(streamErr); } catch (_) {}
        }
      } catch (_) {}
    });
    res.on('close', () => { try { rs.destroy(); } catch (_) {} });
    rs.pipe(res);
  } catch (fatalErr) {
    try {
      if (!res.headersSent) {
        res.status(500).json({ error: fatalErr.message || String(fatalErr), error_code: fatalErr.code || 'DOWNLOAD_FATAL_ERR' });
      } else { try { res.destroy(fatalErr); } catch (_) {} }
    } catch (_) {}
  }
}

function ensureDataDirForNasSettings() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (_) {}
}

const DEFAULT_AUTO_SCAN_INTERVAL_MINUTES = 20;
function loadPersistedNasSettings() {
  try {
    ensureDataDirForNasSettings();
    if (!fs.existsSync(NAS_SETTINGS_FILE_PATH)) return false;
    const raw = fs.readFileSync(NAS_SETTINGS_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw || '{}');
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.mountRoot === 'string' && parsed.mountRoot.trim()) {
        NAS_CONFIG.mountRoot = String(parsed.mountRoot).trim();
      }
      if (parsed.copyMode === 'move' || parsed.copyMode === 'copy') {
        NAS_CONFIG.copyMode = parsed.copyMode;
      }
      if (typeof parsed.mkdirRecursive === 'boolean') {
        NAS_CONFIG.mkdirRecursive = parsed.mkdirRecursive;
      }
      if (typeof parsed.overwrite === 'boolean') {
        NAS_CONFIG.overwrite = parsed.overwrite;
      }
      if (typeof parsed.autoScanIntervalMinutes === 'number' && parsed.autoScanIntervalMinutes >= 1 && parsed.autoScanIntervalMinutes <= 1440) {
        NAS_CONFIG.autoScanIntervalMinutes = parsed.autoScanIntervalMinutes;
      }
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

function _blockedMountRoot(raw) {
  const r = String(raw || '').toLowerCase().replace(/\\/g, '/');
  if (!r) return 'NAS 挂载路径不能为空';
  const bad = [
    'tencent.xinwechat',
    'xinwechat',
    'wechat',
    'weixin',
    'com.tencent',
    '/message',
    'application support/com.tencent',
    '/cache/',
    '/caches/',
    '/tmp/',
    '/temp/',
    'appdata/local/temp',
    'local settings/temporary',
    '/.Trash',
    '/.DS_Store',
    'thumbs.db',
    'crdownload',
    '/containers/',
    '/library/containers/',
    'browser_locker',
    'lockerblob_storage'
  ];
  const hit = bad.find((b) => r.includes(b));
  if (hit) return `挂载路径疑似系统/软件/微信缓存目录（含关键字 "${hit}"），不允许作为 NAS 共享盘根。请选择真正的 SMB/NFS 共享盘挂载目录（macOS 通常在 /Volumes/共享盘名；Windows 通常是 X:\\ 盘符；Linux 在 /mnt/xxx 或 /srv/xxx）`;
  if (/^\/(usr|bin|sbin|etc|var|private|var\/folders|system|library\/cache)\b/i.test(r)) {
    return '挂载路径是系统目录，请选择真正的共享盘挂载目录';
  }
  return '';
}

function savePersistedNasSettings({ mountRoot, copyMode, overwrite, mkdirRecursive, autoScanIntervalMinutes }) {
  ensureDataDirForNasSettings();
  if (typeof mountRoot === 'string' && mountRoot.trim()) {
    const raw = String(mountRoot).trim();
    const blocked = _blockedMountRoot(raw);
    if (blocked) {
      const e = new Error(blocked);
      e.code = 'NAS_MOUNT_BLOCKED';
      throw e;
    }
    const vr = _validateMountDir(raw);
    if (!vr.ok) {
      const e = new Error(vr.message + '（请确认 Finder/资源管理器/文件管理器中该共享盘已挂载）');
      e.code = vr.code;
      throw e;
    }
    NAS_CONFIG.mountRoot = vr.path;
  } else if (!(typeof mountRoot === 'undefined' || mountRoot === null)) {
    const e = new Error('NAS 挂载路径（mountRoot）不能为空');
    e.code = 'NAS_MOUNT_EMPTY';
    throw e;
  }
  if (copyMode === 'move' || copyMode === 'copy') {
    NAS_CONFIG.copyMode = copyMode;
  }
  if (typeof overwrite === 'boolean') {
    NAS_CONFIG.overwrite = overwrite;
  }
  if (typeof mkdirRecursive === 'boolean') {
    NAS_CONFIG.mkdirRecursive = mkdirRecursive;
  }
  if (typeof autoScanIntervalMinutes === 'number' && autoScanIntervalMinutes >= 1 && autoScanIntervalMinutes <= 1440) {
    NAS_CONFIG.autoScanIntervalMinutes = Math.round(autoScanIntervalMinutes);
  } else if (!NAS_CONFIG.autoScanIntervalMinutes) {
    NAS_CONFIG.autoScanIntervalMinutes = DEFAULT_AUTO_SCAN_INTERVAL_MINUTES;
  }
  const payload = {
    mountRoot: NAS_CONFIG.mountRoot,
    copyMode: NAS_CONFIG.copyMode,
    overwrite: !!NAS_CONFIG.overwrite,
    mkdirRecursive: NAS_CONFIG.mkdirRecursive !== false,
    autoScanIntervalMinutes: NAS_CONFIG.autoScanIntervalMinutes || DEFAULT_AUTO_SCAN_INTERVAL_MINUTES,
    savedAt: new Date().toISOString()
  };
  fs.writeFileSync(NAS_SETTINGS_FILE_PATH, JSON.stringify(payload, null, 2), 'utf-8');
  return payload;
}

function getPublicNasConfig() {
  return {
    mountRoot: NAS_CONFIG.mountRoot || '',
    copyMode: NAS_CONFIG.copyMode,
    overwrite: !!NAS_CONFIG.overwrite,
autoScanIntervalMinutes: NAS_CONFIG.autoScanIntervalMinutes || DEFAULT_AUTO_SCAN_INTERVAL_MINUTES,
    configured: Boolean(NAS_CONFIG.mountRoot && String(NAS_CONFIG.mountRoot).trim())
  };
}

const NAS_HEARTBEAT_INTERVAL_MS = 20 * 60 * 1000;
let _nasHeartbeatState = {
  lastCheckAt: null,
  lastOnlineAt: null,
  lastOfflineAt: null,
  online: null,
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
  lastProbe: null
};
let _nasHeartbeatTimer = null;
let _nasHeartbeatRunning = false;

function runNasHeartbeat() {
  if (_nasHeartbeatRunning) return;
  _nasHeartbeatRunning = true;
  try {
    const probe = inspectNasMount(NAS_CONFIG.mountRoot);
    const isOnline = probe.configured && probe.exists && probe.isDirectory;
    const now = new Date().toISOString();
    if (isOnline) {
      _nasHeartbeatState.consecutiveFailures = 0;
      _nasHeartbeatState.consecutiveSuccesses = (_nasHeartbeatState.consecutiveSuccesses || 0) + 1;
      _nasHeartbeatState.lastOnlineAt = now;
    } else {
      _nasHeartbeatState.consecutiveSuccesses = 0;
      _nasHeartbeatState.consecutiveFailures = (_nasHeartbeatState.consecutiveFailures || 0) + 1;
      _nasHeartbeatState.lastOfflineAt = now;
    }
    _nasHeartbeatState.online = isOnline;
    _nasHeartbeatState.lastCheckAt = now;
    _nasHeartbeatState.lastProbe = probe;
  } catch (e) {
    const now = new Date().toISOString();
    _nasHeartbeatState.consecutiveSuccesses = 0;
    _nasHeartbeatState.consecutiveFailures = (_nasHeartbeatState.consecutiveFailures || 0) + 1;
    _nasHeartbeatState.lastOfflineAt = now;
    _nasHeartbeatState.online = false;
    _nasHeartbeatState.lastCheckAt = now;
    _nasHeartbeatState.lastProbe = {
      mountRoot: NAS_CONFIG.mountRoot || '',
      configured: Boolean(NAS_CONFIG.mountRoot && String(NAS_CONFIG.mountRoot).trim()),
      exists: false,
      isDirectory: false,
      writable: false,
      probeMessage: `心跳检测异常：${e.message || e.code || String(e)}`
    };
  } finally {
    _nasHeartbeatRunning = false;
  }
  return _nasHeartbeatState;
}

function startNasHeartbeat() {
  if (_nasHeartbeatTimer) {
    clearTimeout(_nasHeartbeatTimer);
    _nasHeartbeatTimer = null;
  }
  runNasHeartbeat();
  const loop = () => {
    _nasHeartbeatTimer = setTimeout(() => {
      try { runNasHeartbeat(); } finally { loop(); }
    }, NAS_HEARTBEAT_INTERVAL_MS);
  };
  loop();
}

function getNasHeartbeatStatus({ runNow } = {}) {
  if (runNow) runNasHeartbeat();
  return {
    ..._nasHeartbeatState,
    intervalMinutes: Math.round(NAS_HEARTBEAT_INTERVAL_MS / 60000),
    configured: Boolean(NAS_CONFIG.mountRoot && String(NAS_CONFIG.mountRoot).trim())
  };
}

try { loadPersistedNasSettings(); } catch (_) {}
try { startNasHeartbeat(); } catch (_) {}

module.exports = {
  createFileRecord,
  getFileById,
  getFilesByProjectId,
  listFiles,
  listReviewTasks,
  approveReview,
  needsInfoReview,
  rejectReview,
  listNasJobs,
  markNasJobManuallyUploaded,
  resolveDownloadFile,
  renameNasPreparedFile,
  getProjectStats,
  updateFileExtract,
  getFileContent,
  reExtractFile,
  attachExtractQueue,
  getNasMountStatus,
  pushSingleJobToNas,
  pushAllReadyJobsToNas,
  getMountRootOrDefault,
  scanNasDirectory,
  resolveNasDownloadFile,
  matchScannedFilesWithDb,
  buildContentDispositionHeader,
  streamFileDownloadSafe,
  loadPersistedNasSettings,
  savePersistedNasSettings,
  getPublicNasConfig,
  getNasHeartbeatStatus
};
