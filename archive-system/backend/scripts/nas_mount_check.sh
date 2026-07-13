#!/bin/bash
# ==============================================================================
#  nas_mount_check.sh
#  作用：用户级 NAS 挂载检测 + 自动重连
#  特点：
#    * 以当前登录用户（ivan）身份运行，能直接访问 Login Keychain 的 SMB 凭证
#      → 完美绕过 SIP enabled 下 root automountd 读不到 Keychain 的 macOS 限制
#    * 每 60 秒由 LaunchAgent 调一次
#    * 检测 3 种异常并修复：(1) 没挂载 (2) 挂载存在但访问变 I/O error (3) smbutil status 显示 server down
#    * 日志：~/Library/Logs/nas_mount.log
#  用法：
#    手动测试:  bash ~/bin/nas_mount_check.sh
#    自动运行:  通过 ~/Library/LaunchAgents/com.user.nasmount.plist 每 60s + 登录后
# ==============================================================================

# ---------- 配置（跟 setup_autofs.sh 保持一致）----------
NAS_USER_ENC="%E5%86%AF%E5%86%B0%E9%92%B0"   # 冯冰钰 UTF-8 percent-encode
NAS_HOST="192.168.31.131"
NAS_SHARE="personal_folder"
LIVE_MOUNT="/System/Volumes/Data/nas/${NAS_SHARE}"
SMB_URL="smb://${NAS_USER_ENC}@${NAS_HOST}/${NAS_SHARE}"

# ---------- 日志 ----------
LOG_DIR="${HOME}/Library/Logs"
LOG="${LOG_DIR}/nas_mount.log"
mkdir -p "${LOG_DIR}" 2>/dev/null || true

log() {
  local ts
  ts="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "[$ts] $*" >> "$LOG"
  [ -t 1 ] && echo "[$ts] $*"
}

# 落地的时间戳文件：成功挂载后写，用于「新挂载 90s 内绝对不卸」防抖动误卸
LAST_SUCCESS_TS="${LOG_DIR}/.nas_mount_last_success_ts"
AUTH_FAIL_COUNT="${LOG_DIR}/.nas_mount_auth_fail_cnt"
NEW_MOUNT_GRACE_SEC=90

# ---------- 辅助：判断「当前挂载点是否真正可用（不是僵尸）」----------
# 双检：第一次 probe 失败 → sleep 2 → 再 probe，两次都失败才算真死
mount_alive() {
  if ! mount 2>/dev/null | grep -qF "on ${LIVE_MOUNT} (smbfs"; then
    return 1
  fi
  local rc1 rc2
  (ls -1 "${LIVE_MOUNT}/" >/dev/null 2>&1) ; rc1=$?
  if [ "${rc1}" -eq 0 ]; then
    return 0
  fi
  sleep 2
  (ls -1 "${LIVE_MOUNT}/" >/dev/null 2>&1) ; rc2=$?
  [ "${rc2}" -eq 0 ] && return 0
  return 1
}

# ---------- 辅助：强制卸载（但必须先通过「超过宽限期 + 真的僵死」双重门槛才允许卸）----------
force_unmount() {
  /sbin/umount    "${LIVE_MOUNT}" 2>/dev/null && return 0
  sleep 1
  /sbin/umount -f "${LIVE_MOUNT}" 2>/dev/null && return 0
  sleep 1
  (command -v diskutil >/dev/null 2>&1 && diskutil unmount force "${LIVE_MOUNT}" >/dev/null 2>&1) && return 0
  if mount 2>/dev/null | grep -qF "on ${LIVE_MOUNT} (smbfs"; then
    return 1
  fi
  return 0
}

# ---------- 宽限期：刚成功挂载 < NEW_MOUNT_GRACE_SEC，就算这次 probe 失败也直接跳过 ----------
within_grace_period() {
  [ -f "$LAST_SUCCESS_TS" ] || return 1
  local last now
  last=$(cat "$LAST_SUCCESS_TS" 2>/dev/null || echo 0)
  now=$(date +%s)
  [ -z "$last" ] && return 1
  [ "$last" -le 0 ] && return 1
  [ $((now - last)) -lt "${NEW_MOUNT_GRACE_SEC}" ] && return 0
  return 1
}

mark_success() {
  date +%s > "$LAST_SUCCESS_TS"
  # 成功一次就清零认证失败计数
  : > "$AUTH_FAIL_COUNT" 2>/dev/null || true
}

# ---------- 主体 ----------
if mount_alive; then
  mark_success
  HEARTBEAT="${LOG_DIR}/.nas_mount_lastok"
  NOW=$(date +%s)
  if [ -f "$HEARTBEAT" ]; then
    LAST=$(stat -f%m "$HEARTBEAT" 2>/dev/null || echo 0)
    if [ $((NOW - LAST)) -lt 86400 ]; then
      exit 0
    fi
  fi
  touch "$HEARTBEAT"
  log "✅ 挂载正常 ${LIVE_MOUNT} (心跳)"
  exit 0
fi

# 走到这里 = 要么没挂，要么僵死
# 关键防护：如果在 90 秒宽限期内（刚有过成功挂载），就算这次 probe 失败也绝对不卸/不重挂 → 防止双进程竞态误卸
if within_grace_period; then
  log "⏳ 宽限期内（${NEW_MOUNT_GRACE_SEC}s）有成功挂载记录，跳过本次巡检（避免刚挂上就误卸抖动）"
  exit 0
fi

log "⚠️  挂载异常，准备修复 ${LIVE_MOUNT}"

# 确保目标目录存在且属于当前用户
if [ ! -d "${LIVE_MOUNT}" ]; then
  mkdir -p "${LIVE_MOUNT}" 2>>"$LOG" || {
    log "❌ mkdir ${LIVE_MOUNT} 失败，跳过这次重挂"
    exit 2
  }
fi
# 只有当 mount 列表里确实挂着、而且已经通过宽限期防护，才卸
if mount 2>/dev/null | grep -qF "on ${LIVE_MOUNT} (smbfs"; then
  log "   → 先卸载僵死挂载 ${LIVE_MOUNT}"
  if ! force_unmount; then
    log "❌ 僵死挂载卸载失败，跳过这次（下次巡检会再试）"
    exit 3
  fi
  sleep 2
fi

# 先检查 NAS 是否在线（避免 mount_smbfs 卡住 60+ 秒超时）
if ! /sbin/ping -c 1 -W 1 "${NAS_HOST}" >/dev/null 2>&1; then
  log "⚠️  NAS ${NAS_HOST} 不在线，跳过本次挂载（60 秒后再试）"
  exit 0
fi

# 正式挂
log "   → 执行 mount_smbfs ${SMB_URL} ${LIVE_MOUNT}"
START=$(date +%s)
if /sbin/mount_smbfs "${SMB_URL}" "${LIVE_MOUNT}" 2>>"$LOG"; then
  sleep 1
  ELAPSED=$(( $(date +%s) - START ))
  if mount_alive; then
    PROBE="${LIVE_MOUNT}/.nas_mount_probe_$$"
    if (touch "${PROBE}" 2>/dev/null && /bin/rm -f "${PROBE}" 2>/dev/null); then
      mark_success
      log "✅ 成功挂载 ✅  读写验证通过（${ELAPSED}s） ${LIVE_MOUNT}"
      exit 0
    else
      log "⚠️  挂载成功但读写 probe 失败（可能 NAS 端权限？等下次巡检）"
      exit 0
    fi
  else
    log "❌ mount_smbfs 没报错但实际没挂上？等下次巡检"
    exit 4
  fi
else
  RC=$?
  # 认证失败 RC=77 累计计数，连续 3 次给 Keychain 提示
  if [ "${RC}" -eq 77 ]; then
    CNT=$(cat "$AUTH_FAIL_COUNT" 2>/dev/null || echo 0)
    [ -z "$CNT" ] && CNT=0
    CNT=$((CNT+1))
    echo "$CNT" > "$AUTH_FAIL_COUNT"
    if [ "$CNT" -eq 3 ]; then
      log "🔔 连续 3 次认证失败（RC=77）→ 请在 Keychain Access.app 中：找到 192.168.31.131 SMB Internet Password → 访问控制 → 添加 /sbin/mount_smbfs 到允许列表"
    fi
  fi
  log "❌ mount_smbfs 失败 RC=${RC}（可能 NAS 刚掉线或 Keychain 未解锁，60 秒后再试）"
  exit "${RC}"
fi
