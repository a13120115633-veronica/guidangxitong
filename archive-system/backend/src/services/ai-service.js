const path = require('path');

const DEFAULT_BUSINESS_CATEGORY_KEYS = ['project', 'business', 'report'];
function categoryKeyForPath(targetPath) {
  if (!targetPath) return 'other';
  if (targetPath.startsWith('1.项目资料')) return 'project';
  if (targetPath.startsWith('2.商务资料')) return 'business';
  if (targetPath === '3.执行资料/5.报告' || targetPath.startsWith('3.执行资料/5.报告/')) return 'report';
  return 'other';
}
function boostIfDefaultCategory(obj) {
  if (!obj || typeof obj.confidence !== 'number') return obj;
  const ck = categoryKeyForPath(obj.targetPath || '');
  if (DEFAULT_BUSINESS_CATEGORY_KEYS.includes(ck)) {
    obj.confidence = Math.min(0.99, obj.confidence + 0.12);
  }
  obj.category_key = ck;
  return obj;
}

function guessAiSuggestion(fileName, note) {
  const ext = path.extname(fileName || '').toLowerCase() || '.dat';
  const base = path.basename(fileName || '资料', ext).trim() || '资料';
  const text = `${base} ${note || ''}`;
  let result = null;

  if (/合同|协议/.test(text)) {
    result = {
      targetRoot: '2.商务资料',
      targetPath: '2.商务资料/合同扫描',
      suggestedName: `${base.replace(/扫描件|扫描/g, '合同')}`,
      confidence: 0.88,
      reason: '文件名或备注包含合同/协议，优先归入商务资料的合同扫描。'
    };
  } else if (/发票|付款|报价|投标|招标/.test(text)) {
    result = {
      targetRoot: '2.商务资料',
      targetPath: '2.商务资料',
      suggestedName: `${base}`,
      confidence: 0.82,
      reason: '文件名或备注包含商务关键词，建议归入商务资料。'
    };
  } else if (/报告|意见书|评审|评估|保护方案|验收|勘探/.test(text)) {
    result = {
      targetRoot: '3.执行资料',
      targetPath: '3.执行资料/5.报告',
      suggestedName: `${base}`,
      confidence: 0.86,
      reason: '文件名或备注包含报告/检查意见书/评审/评估/验收/勘探等报告类关键词，归入执行资料/5.报告目录（商务端默认推荐位）。'
    };
  } else if (/CAD|dwg|dxf|底图|工作图/i.test(text)) {
    result = {
      targetRoot: '3.执行资料',
      targetPath: '3.执行资料/3.CAD工程',
      suggestedName: `${base}`,
      confidence: 0.86,
      reason: '文件名或备注包含 CAD 或工程图关键词。'
    };
  } else if (/红线|坐标|KML|范围|位置|宗地|界址|立项|批复|申报|审批|红头|可研|备案|申请|项目书|任务书|委托书|中标|通知书|合同附件/.test(text)) {
    result = {
      targetRoot: '1.项目资料',
      targetPath: '1.项目资料',
      suggestedName: `${base}`,
      confidence: 0.88,
      reason: '项目立项、审批、批复、申报、红头、中标等资料按规范归入 1.项目资料。'
    };
  } else if (/照片|航拍|踏查|走访|探孔|RTK|外业/.test(text)) {
    result = {
      targetRoot: '3.执行资料',
      targetPath: '3.执行资料/1.外业原始资料',
      suggestedName: `${base}`,
      confidence: 0.72,
      reason: '疑似外业资料，先建议进入外业原始资料，需管理员筛选后再进入外业成果。'
    };
  }
  if (result) {
    boostIfDefaultCategory(result);
    return result;
  }
  result = {
    targetRoot: '1.项目资料',
    targetPath: '1.项目资料',
    suggestedName: `${base}`,
    confidence: 0.58,
    reason: '未匹配到明确规则 — 按商务端「3 默认位优先」策略：先兜底归入项目资料（占比 80% 的默认位），请管理员人工确认。'
  };
  boostIfDefaultCategory(result);
  return result;
}

function flattenArchiveNodes(nodes, prefix = '') {
  return nodes.flatMap((node) => {
    const fullPath = prefix ? `${prefix}/${node.name}` : node.name;
    return [
      { id: node.id, name: node.name, path: fullPath, aiAutoArchive: node.aiAutoArchive !== false }
    ].concat(flattenArchiveNodes(node.children || [], fullPath));
  });
}

function displayLabelForCategoryKey(ck) {
  switch (ck) {
    case 'project':  return '项目资料';
    case 'business': return '商务资料';
    case 'report':   return '执行资料·报告';
    case 'other':    return '其他/人工指定';
    default:         return '-';
  }
}
function displayLabelForSourceRole(sr) {
  switch (sr) {
    case 'employee_business': return '商务端';
    case 'admin_manual':      return '管理员端';
    default:                  return sr ? String(sr) : '商务端';
  }
}
function isDefaultBusinessCategoryPath(targetPath) {
  if (!targetPath) return false;
  const ck = categoryKeyForPath(targetPath);
  return DEFAULT_BUSINESS_CATEGORY_KEYS.includes(ck);
}

module.exports = {
  guessAiSuggestion,
  flattenArchiveNodes,
  categoryKeyForPath,
  displayLabelForCategoryKey,
  displayLabelForSourceRole,
  isDefaultBusinessCategoryPath,
  DEFAULT_BUSINESS_CATEGORY_KEYS
};
