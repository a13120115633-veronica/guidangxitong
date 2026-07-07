const path = require('path');

function guessAiSuggestion(fileName, note) {
  const ext = path.extname(fileName || '').toLowerCase() || '.dat';
  const base = path.basename(fileName || '资料', ext).trim() || '资料';
  const text = `${base} ${note || ''}`;

  if (/合同|协议/.test(text)) {
    return {
      targetRoot: '2.商务资料',
      targetPath: '2.商务资料/合同扫描',
      suggestedName: `${base.replace(/扫描件|扫描/g, '合同')}`,
      confidence: 0.88,
      reason: '文件名或备注包含合同/协议，优先归入商务资料的合同扫描。'
    };
  }
  if (/发票|付款|报价|投标|招标/.test(text)) {
    return {
      targetRoot: '2.商务资料',
      targetPath: '2.商务资料',
      suggestedName: `${base}`,
      confidence: 0.82,
      reason: '文件名或备注包含商务关键词，建议归入商务资料。'
    };
  }
  if (/报告|计划|评估|保护方案|验收/.test(text)) {
    return {
      targetRoot: '3.执行资料',
      targetPath: '3.执行资料/5.报告',
      suggestedName: `${base}`,
      confidence: 0.84,
      reason: '文件名或备注包含报告/计划/评估等技术文本关键词。'
    };
  }
  if (/CAD|dwg|dxf|底图|工作图/i.test(text)) {
    return {
      targetRoot: '3.执行资料',
      targetPath: '3.执行资料/3.CAD工程',
      suggestedName: `${base}`,
      confidence: 0.86,
      reason: '文件名或备注包含 CAD 或工程图关键词。'
    };
  }
  if (/红线|坐标|KML|范围|位置|宗地|界址|立项|批复|申报|审批|红头|可研|备案|申请|项目书|任务书|委托书|中标|通知书|合同附件/.test(text)) {
    return {
      targetRoot: '1.项目资料',
      targetPath: '1.项目资料',
      suggestedName: `${base}`,
      confidence: 0.88,
      reason: '项目立项、审批、批复、申报、红头、中标等资料按规范归入 1.项目资料。'
    };
  }
  if (/照片|航拍|踏查|走访|探孔|RTK|外业/.test(text)) {
    return {
      targetRoot: '3.执行资料',
      targetPath: '3.执行资料/1.外业原始资料',
      suggestedName: `${base}`,
      confidence: 0.72,
      reason: '疑似外业资料，先建议进入外业原始资料，需管理员筛选后再进入外业成果。'
    };
  }
  return {
    targetRoot: '人工确认',
    targetPath: '03_无法识别需人工确认',
    suggestedName: `${base}`,
    confidence: 0.45,
    reason: '无法从文件名和备注可靠判断，必须人工确认。'
  };
}

function flattenArchiveNodes(nodes, prefix = '') {
  return nodes.flatMap((node) => {
    const fullPath = prefix ? `${prefix}/${node.name}` : node.name;
    return [
      { id: node.id, name: node.name, path: fullPath, aiAutoArchive: node.aiAutoArchive !== false }
    ].concat(flattenArchiveNodes(node.children || [], fullPath));
  });
}

module.exports = {
  guessAiSuggestion,
  flattenArchiveNodes
};
