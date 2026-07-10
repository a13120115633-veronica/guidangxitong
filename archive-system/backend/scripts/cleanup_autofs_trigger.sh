#!/bin/bash
# ==============================================================================
#  cleanup_autofs_trigger.sh
#  作用：去掉之前加的 autofs SMB trigger（它在 SIP enabled 下根本用不了，
#        还把目标路径变成 autofs 触发节点导致任何访问都 I/O error）
#  保留：synthetic.conf（这样重启后 /nas/ 快捷路径还是能用）
#  用法：sudo bash cleanup_autofs_trigger.sh
# ==============================================================================
set -e
if [[ $EUID -ne 0 ]]; then
  echo "[X] 请用 sudo 执行：sudo bash $0"; exit 1
fi

LIVE_MOUNT="/System/Volumes/Data/nas/personal_folder"
REAL_USER="${SUDO_USER:-$(stat -f%Su /dev/console 2>/dev/null || echo ivan)}"
REAL_GROUP=$(id -gn "$REAL_USER" 2>/dev/null || echo staff)
BACKUP_DIR="/tmp/autofs_cleanup_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "[-] 备份当前 auto_master / auto_smb -> $BACKUP_DIR/"
[ -f /etc/auto_master ] && cp -a /etc/auto_master "$BACKUP_DIR/auto_master.bak"
[ -f /etc/auto_smb    ] && cp -a /etc/auto_smb    "$BACKUP_DIR/auto_smb.bak"
chmod -R a+r "$BACKUP_DIR" 2>/dev/null || true

echo "[-] 从 /etc/auto_master 中删除 'auto_smb' 行（保留其他内容）"
grep -vE '^/-[[:space:]]+auto_smb([[:space:]]|$)' /etc/auto_master > /etc/auto_master.new || true
mv /etc/auto_master.new /etc/auto_master
chmod 644 /etc/auto_master
chown root:wheel /etc/auto_master

echo "[-] 清空 /etc/auto_smb（避免下次误触发）"
: > /etc/auto_smb
chmod 644 /etc/auto_smb
chown root:wheel /etc/auto_smb

echo "[-] 执行 automount -vc 清理掉已经注册的 autofs 触发点"
automount -vc 2>&1 | sed -e 's/^/      /' || true
sleep 2

echo "[-] 确认触发点已解除：$LIVE_MOUNT 现在应该是普通空目录，不再出现 I/O error"
if [ -d "$LIVE_MOUNT" ]; then
  chown -R "${REAL_USER}:${REAL_GROUP}" "/System/Volumes/Data/nas" 2>/dev/null || true
  echo "    ls 一下（不应有 I/O error）："
  ls -la "$LIVE_MOUNT" 2>&1 | sed -e 's/^/      /' || true
else
  mkdir -p "$LIVE_MOUNT"
  chown -R "${REAL_USER}:${REAL_GROUP}" "/System/Volumes/Data/nas" 2>/dev/null || true
fi

echo
echo "✅ autofs SMB trigger 已清理完毕。"
echo "   synthetic.conf 保留未动 → 重启后 /nas/personal_folder 快捷路径仍然能用"
echo "   备份：$BACKUP_DIR/"
echo "   下一步：以用户身份（不需要 sudo）手动运行 ~/bin/nas_mount_check.sh 挂上 SMB"
