#!/bin/bash
# 公司资料统一归档系统 — 端到端 API 冒烟测试
# 用法：
#   cd archive-system && bash e2e-test.sh            # 默认连 http://127.0.0.1:5174
#   BASE_URL=http://x:y bash e2e-test.sh
set -u

BASE_URL="${BASE_URL:-http://127.0.0.1:5174}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "================================================"
echo " 公司资料统一归档系统 - 端到端 API 冒烟测试"
echo " BASE_URL = $BASE_URL"
echo "================================================"
echo ""

step_ok=0; step_fail=0
check() {
  local label="$1"; local expect="$2"; local actual="$3"
  if [[ "$actual" == *"$expect"* ]]; then
    printf "  ✅ %-42s\n" "$label"
    step_ok=$((step_ok+1))
  else
    printf "  ❌ %-42s  (期望包含: %s)\n        实际: %.400s\n" "$label" "$expect" "$actual"
    step_fail=$((step_fail+1))
  fi
}

# py_eval: 安全地把 shell 变量中的 JSON 传给 Python 脚本
#   用法: result=$(py_eval "$JSON_VAR" 'python 代码，用 d 变量代表解析后的 JSON')
py_eval() {
  local j_b64 c_b64
  j_b64=$(printf '%s' "${1:-}" | base64)
  c_b64=$(printf '%s' "${2:-pass}" | base64)
  JSON_B64="$j_b64" CODE_B64="$c_b64" python3 <<'PYEOF'
import os, json, base64
raw = base64.b64decode(os.environ["JSON_B64"]).decode("utf-8", errors="replace")
try:
    d = json.loads(raw)
except Exception:
    d = None
code = base64.b64decode(os.environ["CODE_B64"]).decode("utf-8", errors="replace")
exec(code)
PYEOF
}

# 0. 健康检查
echo "[0] 健康检查"
HC=$(curl -s "$BASE_URL/health" 2>&1)
check "health 接口返回 ok" '"ok":true' "$HC"

# 1. 归档路径树
echo "[1] 归档路径树"
PATHS=$(curl -s "$BASE_URL/api/archive-paths" 2>&1)
check "返回 1.项目资料" '"1.项目资料"' "$PATHS"
check "返回 4.成果资料" '"4.成果资料"' "$PATHS"

# 2. 项目搜索（不带中文 URL 参数避免编码问题）
echo "[2] 项目搜索"
PROJ_JSON=$(curl -s "$BASE_URL/api/projects" 2>&1)
PROJ_COUNT=$(py_eval "$PROJ_JSON" '
if isinstance(d, list):
    print(len(d))
else:
    print(0)
')
check "已加载项目数 >= 1" "1" "$([[ ${PROJ_COUNT:-0} -ge 1 ]] && echo 1 || echo 0)"
PROJ_ID=$(py_eval "$PROJ_JSON" '
if isinstance(d, list) and d:
    print(str(d[0].get("id","")))
else:
    print("")
')
PROJ_NAME=$(py_eval "$PROJ_JSON" '
if isinstance(d, list) and d:
    print(str(d[0].get("name","(项目)")))
else:
    print("")
')
if [[ -z "${PROJ_ID:-}" ]]; then
  echo "  ⚠️  无项目可用，跳过上传/审批/下载 后续 6 个步骤"
  SKIP_REST=1
else
  echo "  使用项目 ID=$PROJ_ID 名称=$PROJ_NAME"
  SKIP_REST=0
fi
SKIP() { [[ "${SKIP_REST:-1}" == "1" ]]; }

# 3. 上传
if ! SKIP; then
echo "[3] 上传 3 个测试文件"
printf 'seedling purchase contract scan content 2026' > "$TMP/contract-scan.pdf"
printf 'CAD as-built drawing DWG binary data' > "$TMP/asbuilt-final.dwg"
printf 'project approval establishment docx content' > "$TMP/project-approval.docx"
UP1=$(curl -s -X POST "$BASE_URL/api/files/upload" \
  -F "projectId=$PROJ_ID" -F "uploader=张三测" -F "department=测试部" \
  -F "file=@$TMP/contract-scan.pdf" -F "note=合同扫描采购协议苗木")
UP2=$(curl -s -X POST "$BASE_URL/api/files/upload" \
  -F "projectId=$PROJ_ID" -F "uploader=张三测" -F "department=测试部" \
  -F "file=@$TMP/asbuilt-final.dwg" -F "note=CAD竣工图dwg图纸")
UP3=$(curl -s -X POST "$BASE_URL/api/files/upload" \
  -F "projectId=$PROJ_ID" -F "uploader=张三测" -F "department=测试部" \
  -F "file=@$TMP/project-approval.docx" -F "note=立项批复红头文件")
check "合同上传成功" '"status":"pending_review"' "$UP1"
check "DWG上传成功" '"status":"pending_review"' "$UP2"
check "立项文件上传成功" '"status":"pending_review"' "$UP3"

F1=$(py_eval "$UP1" '
if isinstance(d, dict) and d.get("files"):
    print(str(d["files"][0]["id"]))
')
F2=$(py_eval "$UP2" '
if isinstance(d, dict) and d.get("files"):
    print(str(d["files"][0]["id"]))
')
F3=$(py_eval "$UP3" '
if isinstance(d, dict) and d.get("files"):
    print(str(d["files"][0]["id"]))
')
fi

# 4. 审核任务 + AI 红线
echo "[4] 审核任务列表 + AI建议"
TASKS=$(curl -s "$BASE_URL/api/review/tasks" 2>&1)
check "DWG文件 AI 建议 3.执行资料/3.CAD工程" '"3.执行资料/3.CAD工程"' "$TASKS"
AI_4OK=$(py_eval "$TASKS" '
if isinstance(d, list):
    bad = any((j.get("ai_target_path") or "").startswith("4.成果资料") for j in d)
else:
    bad = True
print("AI_NOT_4_OK" if not bad else "FOUND_4_ACHIEVEMENT_BAD")
')
check "AI未建议 4.成果资料(确保红线)" "AI_NOT_4_OK" "$AI_4OK"

# 5. 审批
if ! SKIP; then
RUN_TAG=$(date +%Y%m%d%H%M%S)-$RANDOM
echo "[5] 红线-4.成果资料人工审批 + 路径冲突校验 (run_tag=$RUN_TAG)"
F1_PDF="e2e-$RUN_TAG-苗木采购合同-归档.pdf"
F2_DWG="e2e-$RUN_TAG-XX花园一期-竣工图-2026.dwg"
F3_DOCX="e2e-$RUN_TAG-XX花园一期-立项批复-2026.docx"
APV1=$(curl -s -X POST "$BASE_URL/api/review/tasks/$F1/approve" \
  -H 'Content-Type: application/json' \
  -d '{"targetPath":"4.成果资料/商务归档","finalName":"'"$F1_PDF"'","reviewer":"QA审核"}')
check "F1 人工归4.成果资料 成功" '"status":"ready_for_nas"' "$APV1"
APV_CONFLICT=$(curl -s -X POST "$BASE_URL/api/review/tasks/$F2/approve" \
  -H 'Content-Type: application/json' \
  -d '{"targetPath":"4.成果资料/商务归档","finalName":"'"$F1_PDF"'","reviewer":"QA审核"}')
check "路径冲突拒绝生效" "目标路径已存在同名文件" "$APV_CONFLICT"
APV2=$(curl -s -X POST "$BASE_URL/api/review/tasks/$F2/approve" \
  -H 'Content-Type: application/json' \
  -d '{"targetPath":"4.成果资料/竣工图","finalName":"'"$F2_DWG"'","reviewer":"QA审核"}')
check "F2 归4.成果资料/竣工图 成功" '"status":"ready_for_nas"' "$APV2"
APV3=$(curl -s -X POST "$BASE_URL/api/review/tasks/$F3/approve" \
  -H 'Content-Type: application/json' \
  -d '{"targetPath":"1.项目资料","finalName":"'"$F3_DOCX"'","reviewer":"QA审核"}')
check "F3 归1.项目资料 成功" '"status":"ready_for_nas"' "$APV3"

# 6. NAS
echo "[6] NAS 待上传列表 + 手动标记已上传"
JOBS=$(curl -s "$BASE_URL/api/nas/jobs" 2>&1)
NEW_PREP=$(py_eval "$JOBS" '
if isinstance(d, list):
    targets = {"'"$F1"'","'"$F2"'","'"$F3"'"}
    print(sum(1 for j in d if j.get("status")=="prepared" and j.get("file_id") in targets))
else:
    print(0)
')
check "本地上传3文件均生成NAS prepared任务" "3" "$([[ ${NEW_PREP:-0} == 3 ]] && echo 3 || echo ${NEW_PREP:-0})"

JOB1=$(py_eval "$JOBS" '
if isinstance(d, list):
    r=[j for j in d if j.get("file_id")=="'"$F1"'" and j.get("status")=="prepared"]
    if r: print(str(r[0]["id"]))
')
JOB2=$(py_eval "$JOBS" '
if isinstance(d, list):
    r=[j for j in d if j.get("file_id")=="'"$F2"'" and j.get("status")=="prepared"]
    if r: print(str(r[0]["id"]))
')
MARK1=$(curl -s -X POST "$BASE_URL/api/nas/jobs/$JOB1/mark-manually-uploaded" \
  -H 'Content-Type: application/json' -d '{"actor":"e2e测试管理员"}')
MARK2=$(curl -s -X POST "$BASE_URL/api/nas/jobs/$JOB2/mark-manually-uploaded" \
  -H 'Content-Type: application/json' -d '{"actor":"e2e测试管理员"}')
check "JOB1 手动标记成功" '"manually_uploaded"' "$MARK1"
check "JOB2 手动标记成功" '"manually_uploaded"' "$MARK2"

# 7. 下载
echo "[7] 文件下载（200 且字节数>0）"
DL1_CODE=$(curl -s -o "$TMP/dl1" -w "%{http_code}" "$BASE_URL/api/files/$F1/download")
DL1_SIZE=$(wc -c < "$TMP/dl1" | tr -d ' ')
check "F1 下载 HTTP=200" "200" "$DL1_CODE"
check "F1 下载字节数>0" "yes" "$([[ ${DL1_SIZE:-0} -gt 0 ]] && echo yes || echo no)"

# 8. 审计日志
echo "[8] 审计日志包含本次所有关键动作"
LOGS=$(curl -s "$BASE_URL/api/audit-logs?limit=50" 2>&1)
check "日志含 upload" '"action":"upload"' "$LOGS"
check "日志含 approve" '"action":"approve"' "$LOGS"
check "日志含 mark_manually_uploaded" '"action":"mark_manually_uploaded"' "$LOGS"
fi  # 闭合 if ! SKIP

echo ""
echo "================================================"
echo " 结果：通过 $step_ok / 失败 $step_fail"
echo "================================================"
if [[ $step_fail == 0 ]]; then
  echo "🎉 全部通过，系统可投入使用"
  exit 0
else
  echo "❌ 有失败项，请查看上面对应 ❌ 标签的动作排查"
  exit 1
fi
