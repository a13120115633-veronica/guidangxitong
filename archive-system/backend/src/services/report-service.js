const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { DATA_DIR } = require('../config');
const {
  getMountRootOrDefault,
  scanNasDirectory,
} = require('./file-service');

const SKILLS_ROOT = path.resolve(__dirname, '..', '..', 'skills');
const RUNS_ROOT = path.join(DATA_DIR, 'report-runs');
if (!fs.existsSync(RUNS_ROOT)) fs.mkdirSync(RUNS_ROOT, { recursive: true });

const SKILL_MAP = {
  plan: {
    folder: 'smart-prospecting-plan',
    script: 'scripts/run_smart_report_workflow.py',
    generateSub: 'generate-plan',
    doctorHeader: '智能勘探计划 Skill 自检',
  },
  report: {
    folder: 'smart-prospecting-report',
    script: 'scripts/run_smart_report_workflow.py',
    generateSub: 'generate',
    doctorHeader: '智能勘探报告 Skill 自检',
  },
};

function skillRoot(type) {
  const cfg = SKILL_MAP[type];
  if (!cfg) throw new Error('未知 skillType，只接受 plan/report');
  const dir = path.join(SKILLS_ROOT, cfg.folder);
  if (!fs.existsSync(dir)) throw new Error('Skill 目录缺失：' + dir);
  return dir;
}
function skillScript(type) {
  const root = skillRoot(type);
  return path.join(root, SKILL_MAP[type].script);
}

function runIdNow() {
  const ts = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    ts.getFullYear().toString() +
    pad(ts.getMonth() + 1) +
    pad(ts.getDate()) +
    '-' +
    pad(ts.getHours()) +
    pad(ts.getMinutes()) +
    pad(ts.getSeconds()) +
    '-' +
    uuidv4().slice(0, 8)
  );
}

function runDir(runId) {
  const dir = path.join(RUNS_ROOT, runId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const proc = path.join(dir, '过程资料');
  const out = path.join(dir, '生成输出');
  if (!fs.existsSync(proc)) fs.mkdirSync(proc, { recursive: true });
  if (!fs.existsSync(out)) fs.mkdirSync(out, { recursive: true });
  return { root: dir, proc, out };
}

function runStatePath(runId) {
  return path.join(RUNS_ROOT, runId, 'run.json');
}
function loadRunState(runId) {
  const fp = runStatePath(runId);
  if (!fs.existsSync(fp)) throw new Error('Run 不存在：' + runId);
  return JSON.parse(fs.readFileSync(fp, 'utf-8'));
}
function saveRunState(runId, patch) {
  const fp = runStatePath(runId);
  const cur = fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, 'utf-8')) : {};
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(fp, JSON.stringify(next, null, 2));
  return next;
}

function createRun({ skillType, nasProjectPath, name }) {
  const runId = runIdNow();
  const dirs = runDir(runId);
  const mountRoot = getMountRootOrDefault();
  const nasAbsPath = path.isAbsolute(nasProjectPath)
    ? nasProjectPath
    : path.join(mountRoot, nasProjectPath || '');
  const st = {
    id: runId,
    name: name || path.basename(nasAbsPath) || ('未命名-' + skillType),
    skillType,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nasProjectPath: nasAbsPath,
    mountRoot,
    directories: dirs,
    steps: {
      picked: true,
      preflight: null,
      prepared: null,
      manualFormGenerated: null,
      manualFormUploaded: null,
      smartFormBuilt: null,
      recommended: null,
      timelineValidated: null,
      generated: null,
      audited: null,
      pushedToNas: null,
    },
    manualFormPath: null,
    smartFormPath: null,
    personnelSet: null,
    matchedTemplate: null,
    outputs: [],
    audit: null,
    nasPushTarget: null,
    logs: [],
  };
  saveRunState(runId, st);
  return st;
}

function listRuns() {
  if (!fs.existsSync(RUNS_ROOT)) return [];
  return fs
    .readdirSync(RUNS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      try {
        return loadRunState(d.name);
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

function appendRunLog(runId, level, text) {
  try {
    const state = loadRunState(runId);
    state.logs = (state.logs || []).concat([
      { time: new Date().toISOString(), level, text: String(text || '').slice(0, 5000) },
    ]);
    if (state.logs.length > 500) state.logs = state.logs.slice(-500);
    fs.writeFileSync(runStatePath(runId), JSON.stringify(state, null, 2));
  } catch (_) {}
}

function runPython({ cwd, args, timeoutMs = 1000 * 60 * 15, runId }) {
  return new Promise((resolve) => {
    const proc = spawn('python3', args, {
      cwd: cwd || process.cwd(),
      env: process.env,
      maxBuffer: 1024 * 1024 * 8,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (b) => {
      const s = String(b);
      stdout += s;
      if (runId) appendRunLog(runId, 'stdout', s);
    });
    proc.stderr.on('data', (b) => {
      const s = String(b);
      stderr += s;
      if (runId) appendRunLog(runId, 'stderr', s);
    });
    let done = false;
    const timeoutT = setTimeout(() => {
      if (done) return;
      done = true;
      try { proc.kill('SIGKILL'); } catch (_) {}
      resolve({ ok: false, code: -1, signal: 'TIMEOUT', stdout, stderr, error: '执行超时 (> ' + timeoutMs + 'ms)' });
    }, timeoutMs);
    proc.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timeoutT);
      resolve({ ok: false, code: -2, signal: null, stdout, stderr, error: String(e && e.message || e) });
    });
    proc.on('close', (code, signal) => {
      if (done) return;
      done = true;
      clearTimeout(timeoutT);
      resolve({
        ok: code === 0,
        code: code == null ? null : code,
        signal: signal || null,
        stdout,
        stderr,
      });
    });
  });
}

async function skillDoctor(type) {
  const script = skillScript(type);
  const res = await runPython({ args: [script, 'doctor'], cwd: skillRoot(type) });
  res.skillType = type;
  res.skillRoot = skillRoot(type);
  return res;
}
async function allSkillsDoctor() {
  return {
    plan: await skillDoctor('plan'),
    report: await skillDoctor('report'),
  };
}

function safeProjectNameFromPath(p) {
  return String(p || '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'project';
}

async function preflightRun(runId) {
  const state = loadRunState(runId);
  const script = skillScript(state.skillType);
  const args = [script, 'preflight', state.nasProjectPath];
  const dirs = runDir(runId);
  const r = await runPython({ cwd: dirs.proc, args, runId });
  saveRunState(runId, {
    steps: { ...(state.steps || {}), preflight: { ok: r.ok, result: summarizeRun(r), at: new Date().toISOString() } },
  });
  return r;
}

async function prepareRun(runId) {
  const state = loadRunState(runId);
  const script = skillScript(state.skillType);
  const args = [script, 'prepare', state.nasProjectPath, '--source-confirmed'];
  const dirs = runDir(runId);
  const r = await runPython({ cwd: dirs.proc, args, runId });
  const manual = findFileByName(dirs.proc, /(人工|manual|确认表).*\.xlsx$/i);
  saveRunState(runId, {
    manualFormPath: manual || null,
    steps: {
      ...(state.steps || {}),
      prepared: { ok: r.ok, result: summarizeRun(r), at: new Date().toISOString(), manualForm: manual || null },
      manualFormGenerated: manual ? { ok: true, path: manual, at: new Date().toISOString() } : null,
    },
  });
  return { ...r, manualFormPath: manual || null };
}

async function buildSmartFormFromUploadedManual(runId, uploadedManualPath) {
  const state = loadRunState(runId);
  const dirs = runDir(runId);
  const dest = path.join(dirs.proc, safeProjectNameFromPath(state.name) + '_人工确认表.xlsx');
  fs.copyFileSync(uploadedManualPath, dest);
  const script = skillScript(state.skillType);
  const args = [script, 'build-form', dest];
  const r = await runPython({ cwd: dirs.proc, args, runId });
  const smart = findFileByName(dirs.proc, /(smart|智能).*\.xlsx$/i) || findFileByName(dirs.proc, /smart.*xlsx$/i);
  saveRunState(runId, {
    manualFormPath: dest,
    smartFormPath: smart || null,
    steps: {
      ...(state.steps || {}),
      manualFormUploaded: { ok: true, path: dest, at: new Date().toISOString() },
      smartFormBuilt: smart
        ? { ok: true, path: smart, at: new Date().toISOString(), result: summarizeRun(r) }
        : { ok: false, result: summarizeRun(r), at: new Date().toISOString() },
    },
  });
  return { ...r, smartFormPath: smart || null };
}

async function recommendRun(runId, personnelSet) {
  const state = loadRunState(runId);
  if (!state.smartFormPath) throw new Error('还没有生成 smart-form，请先上传人工确认表');
  const script = skillScript(state.skillType);
  const args = [script, 'recommend', state.smartFormPath, '--smart'];
  if (state.skillType === 'plan') args.push('--plan');
  if (personnelSet) {
    args.push('--personnel-set', String(personnelSet));
  }
  const dirs = runDir(runId);
  const r = await runPython({ cwd: dirs.proc, args, runId });
  const matchedTpl = parseMatchedTemplate(r.stdout || r.stderr || '');
  saveRunState(runId, {
    personnelSet: personnelSet || state.personnelSet || null,
    matchedTemplate: matchedTpl || null,
    steps: {
      ...(state.steps || {}),
      recommended: {
        ok: r.ok,
        personnelSet: personnelSet || state.personnelSet || null,
        matchedTemplate: matchedTpl || null,
        at: new Date().toISOString(),
        result: summarizeRun(r),
      },
    },
  });
  return { ...r, matchedTemplate: matchedTpl || null };
}

async function validateTimeline(runId) {
  const state = loadRunState(runId);
  if (!state.smartFormPath) throw new Error('缺少 smart-form，请先完成 build-form');
  const script = skillScript(state.skillType).replace(
    /run_smart_report_workflow\.py$/,
    'validate_project_timeline.py'
  );
  const args = [
    script,
    '--form',
    state.smartFormPath,
    '--project-dir',
    state.nasProjectPath,
    '--photos-dir',
    state.nasProjectPath,
  ];
  const dirs = runDir(runId);
  const r = await runPython({ cwd: dirs.proc, args, runId });
  saveRunState(runId, {
    steps: {
      ...(state.steps || {}),
      timelineValidated: { ok: r.ok, at: new Date().toISOString(), result: summarizeRun(r) },
    },
  });
  return r;
}

function summarizeRun(r) {
  return {
    ok: r.ok,
    code: r.code ?? null,
    signal: r.signal ?? null,
    error: r.error || null,
    stdoutTail: (r.stdout || '').slice(-3000),
    stderrTail: (r.stderr || '').slice(-3000),
  };
}

function extractOutputsFromGenerateStdout(stdoutText, stderrText, existingOutputs) {
  const out = [];
  const lines = String(stdoutText || '')
    .split(/\r?\n/)
    .concat(String(stderrText || '').split(/\r?\n/));
  const seen = new Set((existingOutputs || []).map((o) => String(o.path || '')));
  for (let line of lines) {
    line = String(line || '').trim();
    if (!line) continue;
    const m = line.match(/^(?:过程检查|问题摘要|检查报告|检查|摘要)[:：]\s*(.+)$/);
    let cand = m ? m[1].trim() : line;
    cand = cand.replace(/^\s*['"“”‘’]|['"“”‘’]\s*$/g, '');
    if (!cand || !/[\u4e00-\u9fa5a-zA-Z0-9]/.test(cand)) continue;
    try {
      if (!fs.existsSync(cand)) continue;
      const st = fs.statSync(cand);
      if (!st.isFile()) continue;
      if (seen.has(cand)) continue;
      seen.add(cand);
      const name = path.basename(cand);
      const isQa = /(check|检查|QA|专项|issue|问题|摘要|回函|检查表|checklist)/i.test(name);
      let kind = 'other';
      if (/\.docx$|\.pdf$/i.test(name)) kind = isQa ? 'qa-report' : 'report-docx';
      else if (/\.xlsx$/i.test(name)) kind = isQa ? 'qa-report' : ((/(smart|智能)/i.test(name)) ? 'smart-form' : ((/(人工|manual|确认)/i.test(name)) ? 'manual-form' : 'spreadsheet'));
      else if (/\.md$|\.txt$/i.test(name)) kind = isQa ? 'qa-report' : 'text';
      out.push({
        id: name + '-' + String(st.size),
        name,
        kind,
        path: cand,
        size: st.size,
        mtime: st.mtime ? new Date(st.mtime).toISOString() : null,
      });
    } catch (_) {}
  }
  return out;
}

function cleanupOldRuns(maxDays = 30) {
  try {
    if (!fs.existsSync(RUNS_ROOT)) return;
    const now = Date.now();
    const cutoff = now - maxDays * 24 * 60 * 60 * 1000;
    const dirs = fs.readdirSync(RUNS_ROOT, { withFileTypes: true });
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const full = path.join(RUNS_ROOT, d.name);
      const stateFile = path.join(full, 'state.json');
      let createdAt = null;
      try {
        if (fs.existsSync(stateFile)) {
          const s = JSON.parse(fs.readFileSync(stateFile, 'utf-8') || '{}');
          if (s && s.createdAt) createdAt = new Date(s.createdAt).getTime();
        }
        if (!createdAt) createdAt = fs.statSync(full).mtimeMs;
      } catch (_) { createdAt = 0; }
      if (!createdAt || createdAt > cutoff) continue;
      try { fs.rmSync(full, { recursive: true, force: true }); }
      catch (e) { console.warn('[cleanupOldRuns] remove failed', d.name, e && e.message); }
    }
  } catch (e) {
    console.warn('[cleanupOldRuns] skipped', e && e.message);
  }
}

async function generateRun(runId, opts = {}) {
  const state = loadRunState(runId);
  if (!state.smartFormPath) throw new Error('缺少 smart-form，请先完成 build-form');
  const script = skillScript(state.skillType);
  const sub = SKILL_MAP[state.skillType].generateSub;
  const args = [
    script,
    sub,
    '--form',
    state.smartFormPath,
    '--project-dir',
    state.nasProjectPath,
  ];
  if (state.personnelSet) {
    args.push('--personnel-set', state.personnelSet);
  }
  if (opts.confirmTemplate !== false) args.push('--confirm-template');
  const dirs = runDir(runId);
  const r = await runPython({ cwd: dirs.proc, args, runId, timeoutMs: 1000 * 60 * 30 });
  const base = collectGeneratedOutputs(dirs.proc, dirs.out);
  const extra = extractOutputsFromGenerateStdout(r.stdout, r.stderr, base);
  const dedup = new Map();
  for (const o of base.concat(extra)) {
    const key = String(o.path || '') + '||' + String(o.id || o.name);
    if (!dedup.has(key)) dedup.set(key, o);
  }
  const outputs = Array.from(dedup.values());
  saveRunState(runId, {
    outputs: outputs.map((o) => ({ ...o })),
    steps: {
      ...(state.steps || {}),
      generated: { ok: r.ok, at: new Date().toISOString(), outputs: outputs.map((o) => o.name), result: summarizeRun(r) },
    },
  });
  cleanupOldRuns(30);
  return { ...r, outputs };
}

function findFileByName(rootDir, nameRegex) {
  let found = null;
  function walk(dir) {
    if (found) return;
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const fp = path.join(dir, name);
      let st;
      try { st = fs.statSync(fp); } catch (_) { continue; }
      if (st.isDirectory()) walk(fp);
      else if (nameRegex.test(name)) { found = fp; return; }
    }
  }
  walk(rootDir);
  return found;
}

function findAllFiles(rootDir, extensions = []) {
  const results = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const fp = path.join(dir, name);
      let st;
      try { st = fs.statSync(fp); } catch (_) { continue; }
      if (st.isDirectory()) walk(fp);
      else {
        if (!extensions.length) results.push({ name, path: fp, size: st.size, mtime: st.mtime });
        else if (extensions.includes(path.extname(name).toLowerCase())) {
          results.push({ name, path: fp, size: st.size, mtime: st.mtime });
        }
      }
    }
  }
  walk(rootDir);
  results.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  return results;
}

function collectGeneratedOutputs(procDir, outDir) {
  const cands = findAllFiles(procDir, ['.docx', '.pdf', '.md', '.txt', '.xlsx'])
    .concat(findAllFiles(outDir, ['.docx', '.pdf', '.md', '.txt', '.xlsx']));
  const seen = new Set();
  const out = [];
  for (const c of cands) {
    if (seen.has(c.path)) continue;
    seen.add(c.path);
    const isQa = /(check|检查|QA|专项|issue|问题|摘要|回函)/i.test(c.name);
    const isSmartForm = /(smart|智能).*\.xlsx$/i.test(c.name);
    const isManualForm = /(人工|manual|确认).*\.xlsx$/i.test(c.name);
    let kind = 'other';
    if (/\.docx$|\.pdf$/i.test(c.name)) kind = isQa ? 'qa-report' : 'report-docx';
    else if (isSmartForm) kind = 'smart-form';
    else if (isManualForm) kind = 'manual-form';
    else if (/\.xlsx$/i.test(c.name)) kind = 'spreadsheet';
    else if (/\.md$|\.txt$/i.test(c.name)) kind = isQa ? 'qa-report' : 'text';
    out.push({
      id: path.basename(c.path) + '-' + String(c.size),
      name: c.name,
      kind,
      path: c.path,
      size: c.size,
      mtime: c.mtime,
    });
  }
  return out;
}

function parseMatchedTemplate(stdoutOrStderr) {
  const combined = String(stdoutOrStderr || '');
  const lines = combined.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/(模板|template|匹配到|TPL|计划模板|报告模板)[^\n]{0,30}((?:[A-Za-z0-9_\-./\\]|[\u4e00-\u9fa5])+\.docx)/i);
    if (m) return m[2];
    const strict = line.match(/([\u4e00-\u9fa5A-Za-z0-9_\-./\\()（）]+\.docx)/i);
    if (strict && /(模板|匹配|推荐|选中|使用)/.test(line)) return strict[1];
  }
  return null;
}

async function listNasProjects() {
  let mountRoot = null;
  let mountError = null;
  try {
    mountRoot = getMountRootOrDefault();
  } catch (e) {
    mountError = e.message;
    mountRoot = null;
  }
  if (!mountRoot || !fs.existsSync(mountRoot)) {
    return {
      mountRoot,
      mounted: false,
      mountError,
      tree: [],
      projects: []
    };
  }
  function isHiddenDirName(n) {
    if (!n) return true;
    if (n.startsWith('.')) return true;
    if (/^(__|\$RECYCLE|\.trash|System Volume Information|@eaDir)/i.test(n)) return true;
    return false;
  }
  function walkLevel(dirAbs, rel, depth, maxDepth = 3) {
    const out = [];
    let subs = [];
    try { subs = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch (_) { return out; }
    subs.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    for (const ent of subs) {
      if (isHiddenDirName(ent.name) && ent.isDirectory()) continue;
      const abs = path.join(dirAbs, ent.name);
      const curRel = rel ? rel + '/' + ent.name : ent.name;
      if (ent.isDirectory()) {
        const node = {
          name: ent.name,
          relativePath: curRel,
          absolutePath: abs,
          isDir: true,
          size: 0,
          children: depth + 1 <= maxDepth ? walkLevel(abs, curRel, depth + 1, maxDepth) : [],
        };
        out.push(node);
      } else if (depth === maxDepth || true) {
        // 文件也一并带上（给小目录预览）
        let size = 0;
        try { size = fs.statSync(abs).size || 0; } catch (_) {}
        out.push({
          name: ent.name,
          relativePath: curRel,
          absolutePath: abs,
          isDir: false,
          size,
          children: [],
        });
      }
    }
    return out;
  }
  const tree = walkLevel(mountRoot, '', 0, 3).filter((n) => n.isDir);
  const projects = flattenDirectoriesOnly(tree);
  return { mountRoot, mounted: true, tree, projects };
}

function flattenDirectoriesOnly(roots) {
  const out = [];
  function walk(list, parents) {
    for (const n of list) {
      if (!n.isDir) continue;
      const pathStack = parents.concat([n.name]);
      if (!n.children || n.children.length === 0 || n.children.every((c) => !c.isDir)) {
        out.push({
          name: n.name,
          relativePath: n.relativePath,
          absolutePath: n.absolutePath,
          breadcrumb: pathStack.join(' / '),
        });
      }
      if (n.children && n.children.length) walk(n.children, pathStack);
    }
  }
  walk(roots, []);
  return out;
}

async function auditRun(runId, { passed, comment }) {
  const state = loadRunState(runId);
  if (!state.steps || !state.steps.generated || !state.steps.generated.ok) {
    throw new Error('报告尚未生成完成，不能进行人工审核');
  }
  const info = { passed: !!passed, comment: comment || '', at: new Date().toISOString() };
  saveRunState(runId, {
    audit: info,
    steps: { ...(state.steps || {}), audited: info },
  });
  return info;
}

async function pushAuditPassedToNas(runId, nasProjectPathOverride) {
  const state = loadRunState(runId);
  if (!state.audit || !state.audit.passed) throw new Error('只有审核通过的报告才能推送到 NAS');
  const outputs = state.outputs || [];
  const main = outputs.find((o) => o.kind === 'report-docx') || outputs.find((o) => /\.docx$|\.pdf$/i.test(o.name));
  if (!main) throw new Error('没有要推送的 DOCX/PDF 报告文件');
  const nasTargetProject = nasProjectPathOverride || state.nasProjectPath;
  if (!nasTargetProject || !fs.existsSync(nasTargetProject)) {
    throw new Error('NAS 项目源目录不存在：' + nasTargetProject);
  }
  const reportDestFolder = path.join(nasTargetProject, '执行资料', '报告');
  if (!fs.existsSync(reportDestFolder)) fs.mkdirSync(reportDestFolder, { recursive: true });
  const copied = [];
  for (const o of outputs) {
    // 按用户要求：只推送最终的 DOCX/PDF 报告（kind=report-docx）到 NAS 执行资料/报告目录。
    // QA 检查报告、Smart 表单、人工确认表等过程资料都不推送 NAS，保存在本地 run 目录里，30 天自动清理。
    if (o.kind !== 'report-docx') continue;
    const dst = path.join(reportDestFolder, o.name);
    try { fs.unlinkSync(dst); } catch (_) {}
    try {
      fs.copyFileSync(o.path, dst);
      copied.push({ kind: o.kind, from: o.path, to: dst, name: o.name });
    } catch (e) {
      throw new Error('拷贝失败 ' + o.name + '：' + e.message);
    }
  }
  const pushInfo = {
    ok: true,
    at: new Date().toISOString(),
    nasProjectPath: nasTargetProject,
    targetFolder: reportDestFolder,
    files: copied,
  };
  saveRunState(runId, {
    nasPushTarget: reportDestFolder,
    steps: { ...(state.steps || {}), pushedToNas: pushInfo },
  });
  return pushInfo;
}

function resolveDownloadFile(runId, file) {
  const state = loadRunState(runId);
  if (file === 'manual') {
    if (!state.manualFormPath || !fs.existsSync(state.manualFormPath)) throw new Error('人工确认表尚未生成');
    return { path: state.manualFormPath, name: path.basename(state.manualFormPath) };
  }
  if (file === 'smart') {
    if (!state.smartFormPath || !fs.existsSync(state.smartFormPath)) throw new Error('Smart 表单尚未生成');
    return { path: state.smartFormPath, name: path.basename(state.smartFormPath) };
  }
  const match = (state.outputs || []).find(
    (o) => o.id === file || path.basename(o.path) === file || o.path === file
  );
  if (!match) throw new Error('文件不存在或无权访问');
  return { path: match.path, name: match.name };
}

function convertScriptPath(skillType) {
  return path.join(skillRoot(skillType || 'report'), 'scripts', 'xlsx_json_convert.py');
}

async function parseManualFormToJson(runId) {
  const state = loadRunState(runId);
  if (!state.manualFormPath || !fs.existsSync(state.manualFormPath)) {
    throw new Error('人工确认表尚未生成，请先完成「生成预填人工确认表」步骤');
  }
  const script = convertScriptPath(state.skillType);
  const r = await runPython({
    args: [script, 'parse', state.manualFormPath],
    cwd: runDir(runId).proc,
    runId,
  });
  if (!r.ok) {
    throw new Error('解析人工确认表失败：' + (r.stderr || r.stdout || r.error || '未知错误'));
  }
  const combined = (r.stdout || '') + '\n' + (r.stderr || '');
  const m = combined.match(/\{[\s\S]*\}\s*$/);
  if (!m) throw new Error('解析脚本未返回 JSON 格式：' + combined.slice(-400));
  try {
    return JSON.parse(m[0]);
  } catch (e) {
    throw new Error('JSON 解析失败：' + e.message + '；原始内容：' + m[0].slice(0, 200));
  }
}

async function saveManualFormFromJsonAndBuild(runId, jsonPayload) {
  const state = loadRunState(runId);
  if (!state.manualFormPath || !fs.existsSync(state.manualFormPath)) {
    throw new Error('人工确认表尚未生成，请先完成「生成预填人工确认表」步骤');
  }
  const script = convertScriptPath(state.skillType);
  const dirs = runDir(runId);
  const out = path.join(dirs.proc, safeProjectNameFromPath(state.name) + '_人工确认表_编辑版.xlsx');
  const jsonStr = JSON.stringify(jsonPayload || {});
  const r = await runPython({
    args: [script, 'write', state.manualFormPath, out, '--json-json', jsonStr],
    cwd: dirs.proc,
    runId,
  });
  if (!r.ok || !fs.existsSync(out)) {
    throw new Error('写回人工确认表失败：' + (r.stderr || r.stdout || r.error || '输出文件未生成'));
  }
  return await buildSmartFormFromUploadedManual(runId, out);
}

module.exports = {
  SKILL_MAP,
  RUNS_ROOT,
  skillRoot,
  skillScript,
  createRun,
  loadRunState,
  saveRunState,
  listRuns,
  appendRunLog,
  skillDoctor,
  allSkillsDoctor,
  preflightRun,
  prepareRun,
  buildSmartFormFromUploadedManual,
  recommendRun,
  validateTimeline,
  generateRun,
  auditRun,
  pushAuditPassedToNas,
  listNasProjects,
  runDir,
  parseManualFormToJson,
  saveManualFormFromJsonAndBuild,
  resolveDownloadFile,
};
