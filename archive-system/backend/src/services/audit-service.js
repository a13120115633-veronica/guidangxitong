const { auditLogsTable } = require('../database');
const { nowText, generateId } = require('../utils');

function addAuditLog(actor, action, targetType, targetId, detail) {
  const id = generateId('log');
  auditLogsTable().unshift({
    id,
    actor: actor || '',
    action: action || '',
    target_type: targetType || '',
    target_id: targetId || '',
    detail: detail || '',
    created_at: nowText()
  });
}

function getAuditLogs(limit = 200) {
  return auditLogsTable().all().slice(0, limit);
}

module.exports = {
  addAuditLog,
  getAuditLogs
};
