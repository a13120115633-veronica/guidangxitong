const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STORAGE_DIR = path.join(ROOT, 'storage');
const ORIGINAL_UPLOADS_DIR = path.join(STORAGE_DIR, '00_original_uploads');
const READY_FOR_NAS_DIR = path.join(STORAGE_DIR, '10_ready_for_nas');
const AI_WORKING_DIR = path.join(STORAGE_DIR, '20_ai_working');
const REVIEW_QUEUE_DIR = path.join(STORAGE_DIR, '30_review_queue');
const UPLOADED_RECORDS_DIR = path.join(STORAGE_DIR, '40_uploaded_records');
const REJECTED_DIR = path.join(STORAGE_DIR, '90_rejected');
const LOGS_DIR = path.join(STORAGE_DIR, 'logs');
const DATA_DIR = path.join(ROOT, 'data');
const ARCHIVE_STANDARD_PATH = path.join(DATA_DIR, 'archive-standard.json');
const PROJECT_SOURCE_CACHE_PATH = path.join(DATA_DIR, 'project-source-cache.json');
const NAS_SETTINGS_FILE_PATH = path.join(DATA_DIR, 'nas-settings.json');

const MB = 1024 * 1024;
const MAX_FILE_UPLOAD_BYTES = (parseInt(process.env.MAX_FILE_UPLOAD_MB, 10) || 1000) * MB;
const MAX_FILES_PER_UPLOAD = parseInt(process.env.MAX_FILES_PER_UPLOAD, 10) || 20;
const PROJECT_SOURCE_URL = process.env.PROJECT_SOURCE_URL || 'https://shenpi.drevan.cn/api/projects';
const PORT = parseInt(process.env.PORT, 10) || 5173;
const HOST = process.env.HOST || '0.0.0.0';

const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.pdf', '.ofd',
  '.doc', '.docx', '.wps',
  '.xls', '.xlsx', '.et', '.csv',
  '.ppt', '.pptx', '.dps',
  '.jpg', '.jpeg', '.png', '.heic', '.heif', '.tif', '.tiff', '.bmp', '.gif',
  '.dwg', '.dxf',
  '.zip', '.rar', '.7z',
  '.txt'
]);

const BLOCKED_UPLOAD_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.com', '.scr', '.msi', '.app', '.apk', '.dmg',
  '.sh', '.bash', '.zsh', '.ps1', '.vbs', '.js', '.jar', '.py', '.php'
]);

const BLOCKED_UPLOAD_FILENAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

const FILE_STATUSES = {
  PENDING_REVIEW: 'pending_review',
  NEEDS_INFO: 'needs_info',
  REJECTED: 'rejected',
  READY_FOR_NAS: 'ready_for_nas',
  MANUALLY_UPLOADED: 'manually_uploaded'
};

const NAS_JOB_STATUSES = {
  PREPARED: 'prepared',
  MANUALLY_UPLOADED: 'manually_uploaded'
};

const DEFAULT_NAS_MOUNT_ROOT = process.env.NAS_MOUNT_ROOT || '';
const DEFAULT_NAS_COPY_MODE = (process.env.NAS_COPY_MODE || 'copy').toLowerCase() === 'move' ? 'move' : 'copy';

const NAS_CONFIG = {
  mountRoot: DEFAULT_NAS_MOUNT_ROOT,
  copyMode: DEFAULT_NAS_COPY_MODE,
  mkdirRecursive: true,
  overwrite: process.env.NAS_OVERWRITE_EXISTING?.toLowerCase() === 'true'
};

const EXTRACT_STATUSES = {
  PENDING: 'pending_extract',
  RUNNING: 'extracting',
  NEEDS_OCR: 'needs_ocr',
  SUCCESS: 'extract_success',
  FAILED: 'extract_failed'
};

const ARK_CONFIG = {
  ENABLED: String(process.env.ARK_ENABLED || '1') !== '0',
  API_KEY: process.env.ARK_API_KEY || 'ark-0efc080f-e823-4a17-8d7f-bacbb35c5096-71348',
  BASE_URL: process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
  TEXT_MODEL: process.env.ARK_TEXT_MODEL || 'doubao-seed-2-1-pro-260628',
  VISION_MODEL: process.env.ARK_VISION_MODEL || 'doubao-1-5-vision-pro-32k-250115',
  REQUEST_TIMEOUT_MS: parseInt(process.env.ARK_TIMEOUT_MS || '120000', 10),
  OCR_MAX_IMAGE_MB: parseInt(process.env.ARK_OCR_MAX_MB || '8', 10),
  EXTRACT_MAX_TEXT_CHARS: parseInt(process.env.ARK_EXTRACT_MAX_CHARS || '12000', 10),
  SUGGEST_MAX_INPUT_CHARS: parseInt(process.env.ARK_SUGGEST_MAX_INPUT || '8000', 10)
};

const EXTRACT_QUEUE_CONFIG = {
  CONCURRENCY: parseInt(process.env.EXTRACT_CONCURRENCY || '2', 10),
  MAX_RETRIES: parseInt(process.env.EXTRACT_RETRIES || '2', 10),
  RETRY_BASE_DELAY_MS: parseInt(process.env.EXTRACT_RETRY_DELAY || '5000', 10)
};

module.exports = {
  ROOT,
  STORAGE_DIR,
  ORIGINAL_UPLOADS_DIR,
  READY_FOR_NAS_DIR,
  AI_WORKING_DIR,
  REVIEW_QUEUE_DIR,
  UPLOADED_RECORDS_DIR,
  REJECTED_DIR,
  LOGS_DIR,
  DATA_DIR,
  ARCHIVE_STANDARD_PATH,
  PROJECT_SOURCE_CACHE_PATH,
  NAS_SETTINGS_FILE_PATH,
  MAX_FILE_UPLOAD_BYTES,
  MAX_FILES_PER_UPLOAD,
  PROJECT_SOURCE_URL,
  PORT,
  HOST,
  ALLOWED_UPLOAD_EXTENSIONS,
  BLOCKED_UPLOAD_EXTENSIONS,
  BLOCKED_UPLOAD_FILENAMES,
  FILE_STATUSES,
  NAS_JOB_STATUSES,
  NAS_CONFIG,
  EXTRACT_STATUSES,
  ARK_CONFIG,
  EXTRACT_QUEUE_CONFIG,
  MB
};
