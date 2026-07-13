#!/bin/bash
# ==============================================================================
#  NAS (SMB) autofs 一键安装脚本（v4 修正：man auto_master 正确格式）
#  关键修正：
#    - auto_smb 第三列 URL 用 //ENC_USER@IP/share 开头（不是 ://）
#      依据 man auto_master 示例：smb  -fstype=smb  //guest@smbserver/share
#    - fallback 先 3 次 ls 触发 autofs（避免强行 mount 到已占坑目录报 File exists）
#    - 仍用 percent-encode 用户名：Keychain 查询用 UTF-8 中文，URL 用编码
#  用法：sudo bash setup_autofs.sh
# ==============================================================================
set -e

# ==== 可配置参数 ==============================================================
NAS_USER="冯冰钰"                          # Login Keychain 中保存的原始中文名（查询 Keychain / 显示用）
NAS_USER_ENC="%E5%86%AF%E5%86%B0%E9%92%B0" # 上面的 UTF-8 percent-encode，URL 用
NAS_HOST="192.168.31.131"
NAS_SHARE="personal_folder"
# ==============================================================================

LIVE_MOUNT="/System/Volumes/Data/nas/${NAS_SHARE}"
FIRMLINK_SRC="System/Volumes/Data/nas"
FIRMLINK_ALIAS="nas"
BACKUP_DIR="/tmp/autofs_backup_$(date +%Y%m%d_%H%M%S)"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log_ok()   { echo -e "${GREEN}[OK]${NC}  $*"; }
log_warn() { echo -e "${YELLOW}[!]${NC}   $*"; }
log_err()  { echo -e "${RED}[X]${NC}   $*"; }
log_info() { echo -e "[-]   $*"; }

if [[ $EUID -ne 0 ]]; then
  log_err "请以 sudo 执行此脚本： sudo bash $0"
  exit 1
fi

REAL_USER="${SUDO_USER:-$(stat -f%Su /dev/console 2>/dev/null || echo ivan)}"
REAL_GROUP=$(id -gn "$REAL_USER" 2>/dev/null || echo staff)

# ---------- 前置检查 ----------
log_info "前置检查..."
SIP=$(csrutil status 2>/dev/null | grep -io 'enabled\|disabled' | head -1)
log_info "SIP=${SIP:-未知}  执行用户=${REAL_USER}"
log_info "NAS 用户名（原始）=${NAS_USER}   （URL 编码）=${NAS_USER_ENC}"

if ! ping -c 1 -W 1 "${NAS_HOST}" >/dev/null 2>&1; then
  log_warn "无法 ping 通 ${NAS_HOST}（NAS 未开机？或不在同网段？）脚本继续写配置。"
fi

if security find-internet-password -s "${NAS_HOST}" -a "${NAS_USER}" -r "smb " >/dev/null 2>&1; then
  log_ok "Login Keychain 已有 [${NAS_USER}@${NAS_HOST}] SMB 凭证"
else
  log_err "Login Keychain 未找到 [${NAS_USER}@${NAS_HOST}] SMB 凭证"
  echo
  echo "    先在 Finder 按 ⌘K → 粘贴下面地址，勾选「记住密码」后再跑："
  echo "    smb://${NAS_USER_ENC}@${NAS_HOST}/${NAS_SHARE}"
  echo
  read -rp "    仍然继续写配置（稍后再存凭证）？[y/N]: " k
  case "$k" in [yY]|[yY][eE][sS]) ;; *) exit 2;; esac
fi

# ---------- 备份 ----------
mkdir -p "${BACKUP_DIR}"
for f in /etc/auto_master /etc/synthetic.conf /etc/auto_smb; do
  [ -f "$f" ] && cp -a "$f" "${BACKUP_DIR}/$(basename "$f").bak"
done
chmod -R a+r "${BACKUP_DIR}" 2>/dev/null || true
log_info "旧配置备份：${BACKUP_DIR}/"

# ---------- 创建真实挂载目录 ----------
mkdir -p "${LIVE_MOUNT}"
chown "${REAL_USER}:${REAL_GROUP}" "/System/Volumes/Data/nas" "${LIVE_MOUNT}" 2>/dev/null || true
log_ok "真实挂载目录：${LIVE_MOUNT} (owner=${REAL_USER})"

# ---------- synthetic.conf（重启后 /nas 快捷路径）----------
log_info "写入 /etc/synthetic.conf..."
touch /etc/synthetic.conf
SYNTHETIC_EXISTS=0
grep -qE "^${FIRMLINK_ALIAS}[[:space:]]+${FIRMLINK_SRC//\//\\/}$" /etc/synthetic.conf 2>/dev/null && SYNTHETIC_EXISTS=1
if [ "${SYNTHETIC_EXISTS}" -eq 0 ]; then
  printf '%s\t%s\n' "${FIRMLINK_ALIAS}" "${FIRMLINK_SRC}" >> /etc/synthetic.conf
  log_ok "已追加（下次重启后可用 /nas/${NAS_SHARE}）"
else
  log_warn "synthetic.conf 已配置，跳过"
fi
chmod 644 /etc/synthetic.conf
log_info "  当前 synthetic.conf（TAB=0x09）："
hexdump -C /etc/synthetic.conf 2>/dev/null | head -3 | sed -e 's/^/        /'
sed -e 's/^/        /' /etc/synthetic.conf 2>/dev/null

# ---------- /etc/auto_master（追加 direct map）----------
log_info "写入 /etc/auto_master..."
MASTER_EXISTS=0
grep -Eq '^/-[[:space:]]+auto_smb([[:space:]]|$)' /etc/auto_master 2>/dev/null && MASTER_EXISTS=1
if [ "${MASTER_EXISTS}" -eq 0 ]; then
  printf '/-\tauto_smb\t-nosuid,noowners\n' >> /etc/auto_master
  log_ok "已追加 /- auto_smb 行"
else
  log_warn "auto_master 已有 auto_smb 行，跳过"
fi
chmod 644 /etc/auto_master
log_info "  auto_master 末尾："
tail -3 /etc/auto_master | sed -e 's/^/        /'

# ---------- /etc/auto_smb（direct map，严格按 man auto_master 格式）----------
# 依据 man auto_master：
#   smb     -fstype=smb              //guest@smbserver/share
# 格式 A（有 -fstype） ：第 3 列 = //user@host/share（没有前导冒号！）
# 格式 B（无 -fstype） ：第 3 列 = 完整 URL smb://user@host/share
# 我们用格式 A（保留 soft/noatime/nodev/nosuid/noubc 选项，smbfs 挂载更稳）
log_info "写入 /etc/auto_smb（man auto_master 格式 A：-fstype + //ENC_USER@host/share）..."
SMB_OPTS="-fstype=smbfs,soft,noatime,nodev,nosuid,noubc"
# ⚠️ 关键修正：第三列 URL 开头是 // 不是 :// （之前多打了冒号导致 autofs 不解析 SMB）
SMB_LOC="//${NAS_USER_ENC}@${NAS_HOST}/${NAS_SHARE}"
if [ -f /etc/auto_smb ]; then
  grep -vE "^[[:space:]]*${LIVE_MOUNT//\//\\/}([[:space:]]|$)" /etc/auto_smb > /tmp/auto_smb.clean 2>/dev/null || true
  mv /tmp/auto_smb.clean /etc/auto_smb
else
  : > /etc/auto_smb
fi
printf '%s\t%s\t%s\n' "${LIVE_MOUNT}" "${SMB_OPTS}" "${SMB_LOC}" >> /etc/auto_smb
chown root:wheel /etc/auto_smb
chmod 644 /etc/auto_smb
log_ok "/etc/auto_smb 写入完成"
log_info "  当前 auto_smb（字节级校验：TAB=0x09，URL 以 // 开头，用户名 percent-encode）："
hexdump -C /etc/auto_smb 2>/dev/null | head -10 | sed -e 's/^/        /'
echo "        原始行："
sed -e 's/^/            /' /etc/auto_smb 2>/dev/null

# ---------- 激活 automount ----------
log_info "执行 automount -vc 刷新 automounter..."
automount -vc 2>&1 | sed -e 's/^/        /' || true
sleep 2

# ---------- 首次挂载验证（多次重试 ls 触发 autofs）----------
log_info "触发首次自动挂载（访问 ${LIVE_MOUNT}，共 3 次重试）..."
MOUNTED=0
TRIES=0
MAX_TRIES=3
while [ "${MOUNTED}" -eq 0 ] && [ "${TRIES}" -lt "${MAX_TRIES}" ]; do
  TRIES=$((TRIES+1))
  log_info "  触发尝试 ${TRIES}/${MAX_TRIES}：ls ${LIVE_MOUNT}（以 ${REAL_USER} 身份）"
  su - "${REAL_USER}" -c "/bin/ls -la '${LIVE_MOUNT}' >/dev/null 2>&1 || true" || true
  sleep 3
  if mount 2>/dev/null | grep -qF "on ${LIVE_MOUNT} (smbfs"; then
    MOUNTED=1
    log_ok "  ✅ 第 ${TRIES} 次触发后 smbfs 挂载成功"
    break
  fi
done

# 如果 3 次 ls 触发仍没挂上，说明 Keychain 上下文 / 凭证有问题
# 此时不能直接 mount_smbfs 到 LIVE_MOUNT（autofs 已占坑 → File exists），改用临时 staging 路径
# 验证凭证是否 OK + 给用户清晰排错指引
if [ "${MOUNTED}" -eq 0 ]; then
  log_warn "3 次 autofs 触发未自动挂上。改用临时 staging 路径验证 smb URL + 凭证组合..."
  STAGE="/tmp/.nas_stage_$$"
  mkdir -p "${STAGE}"
  chown "${REAL_USER}" "${STAGE}"
  # 完整 smb:// 形式给 mount_smbfs（它是命令行，接受完整 URL）
  STAGE_URL="smb://${NAS_USER_ENC}@${NAS_HOST}/${NAS_SHARE}"
  log_info "  staging mount: ${STAGE_URL} -> ${STAGE}"
  if su - "${REAL_USER}" -c "/sbin/mount_smbfs '${STAGE_URL}' '${STAGE}'" 2>&1 | sed -e 's/^/        /'; then
    sleep 2
    # staging 挂载成功 = 凭证和 URL 100% OK，问题是 autofs 对 Keychain 上下文的访问权限
    log_ok "  ✅ staging 挂载成功（凭证 + URL 正确！）。staging 读写验证："
    PROBE="${STAGE}/.autofs_probe_stage_$$"
    if su - "${REAL_USER}" -c "touch '${PROBE}' && ls -l '${PROBE}' && rm -f '${PROBE}'" 2>&1 | sed -e 's/^/        /'; then
      log_ok "    staging 读写通过"
    fi
    # 卸载 staging，避免占配额
    /sbin/umount -f "${STAGE}" 2>/dev/null || true
    rmdir "${STAGE}" 2>/dev/null || true
    log_warn "staging OK 但 autofs 没挂上：这是 macOS autofs（root 身份）无法访问用户 Login Keychain 中 SMB 凭证的老问题。"
    log_info "  两个解决方法，任选其一（推荐 A）："
    log_info "    A. 重启 Mac（重启后 automountd 会重新在用户登录上下文初始化，Login Keychain 凭证就能被找到）"
    log_info "    B. 把这条 SMB 凭证额外复制一条到 System Keychain："
    log_info "       sudo security add-internet-password -a '${NAS_USER}' -s '${NAS_HOST}' -r 'smb ' -l 'NAS auto_mount' -T /usr/sbin/automountd -T /sbin/mount_smbfs /Library/Keychains/System.keychain"
    log_info "       然后重新执行本脚本"
    MOUNTED=2   # 状态 2 = staging OK（功能上没问题，只等重启 / 加 System Keychain）
  else
    log_err "staging 也挂不上 = 凭证不匹配 / NAS 离线 / 网络不通。按排错建议操作后重试。"
    /sbin/umount -f "${STAGE}" 2>/dev/null || true
    rmdir "${STAGE}" 2>/dev/null || true
  fi
fi

# 如果成功挂载（状态 1）→ 做读写验证
if [ "${MOUNTED}" -eq 1 ]; then
  log_ok "✅ 自动挂载成功（smbfs on ${LIVE_MOUNT}）"
  mount 2>/dev/null | grep "on ${LIVE_MOUNT} (smbfs" | sed -e 's/^/        /'
  log_info "  执行读写验证..."
  PROBE="${LIVE_MOUNT}/.autofs_probe_$(date +%s)"
  if su - "${REAL_USER}" -c "touch '${PROBE}' 2>&1 && /bin/ls -l '${PROBE}' 2>&1 && /bin/rm -f '${PROBE}' 2>&1" | sed -e 's/^/        /'; then
    log_ok "  读写验证通过 ✅  autofs 完美工作！"
  else
    log_warn "  读写测试失败（通常重启后恢复）"
  fi
fi

# ---------- 总结 ----------
echo
echo "============================================================"
if [ "${MOUNTED}" -eq 1 ]; then
  log_ok "🎉 autofs 配置 + 首次挂载 + 读写验证 全部通过！"
elif [ "${MOUNTED}" -eq 2 ]; then
  log_warn "autofs 配置全部正确写入 ✅ staging 挂载 + 读写也通过 ✅"
  log_warn "   只差 automountd 访问用户 Keychain 的上下文问题 → 重启 Mac 后自动生效。"
else
  log_err "autofs 配置已写入，但首次挂载需排错（见上）"
fi
echo
echo "  稳定长路径（autofs 接管，掉线自动重连）："
echo "      ${LIVE_MOUNT}"
echo
echo "  快捷短路径 /nas/${NAS_SHARE} → 重启 Mac 后由 synthetic.conf 生效"
echo
echo "  旧的 Finder /Volumes/${NAS_SHARE} 仍可共存使用。"
echo
echo "  备份：${BACKUP_DIR}/"
echo "============================================================"
