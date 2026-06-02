#!/usr/bin/env bash
# NovelForge 数据备份/恢复脚本
# 用法:
#   导出: ./backup.sh export
#   导入: ./backup.sh import backup/20250602_120000.sql

set -e

APP_DIR="/opt/novelforge"
BACKUP_DIR="${APP_DIR}/backup"
DB_CONTAINER="novelforge-db-1"
DB_USER="novelforge"
DB_NAME="novelforge"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 自动检测容器名
if docker ps --format '{{.Names}}' | grep -q "db"; then
  DB_CONTAINER=$(docker ps --format '{{.Names}}' | grep "db" | head -1)
fi

usage() {
  echo "用法:"
  echo "  $0 export                    # 导出数据库到 backup/ 目录"
  echo "  $0 import <备份文件>         # 导入备份文件到数据库"
  echo "  $0 upload                    # 打包 uploads 目录（含小说文件）"
  echo "  $0 full-export               # 导出数据库 + uploads（完整迁移）"
  echo ""
  echo "示例（本地 → 云端迁移）:"
  echo "  本地: ./backup.sh full-export   # 生成迁移包 backup/migrate_xxx.tar.gz"
  echo "  上传迁移包到服务器 backup/ 目录"
  echo "  服务器: ./backup.sh full-import backup/migrate_xxx.tar.gz"
  exit 1
}

export_db() {
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  BACKUP_FILE="${BACKUP_DIR}/novelforge_${TIMESTAMP}.sql"

  echo "正在导出数据库 ..."
  mkdir -p "$BACKUP_DIR"
  docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" > "$BACKUP_FILE"

  echo -e "${GREEN}✅ 数据库已导出: ${BACKUP_FILE}${NC}"
  echo "文件大小: $(du -h "$BACKUP_FILE" | cut -f1)"
}

import_db() {
  FILE="$1"
  if [ ! -f "$FILE" ]; then
    echo -e "${RED}❌ 文件不存在: $FILE${NC}"
    exit 1
  fi

  echo -e "${YELLOW}⚠️  警告: 这将覆盖云端现有数据！${NC}"
  read -rp "确认导入? [y/N]: " CONFIRM
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "已取消"
    exit 0
  fi

  echo "正在导入数据库 ..."
  docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$FILE"

  echo -e "${GREEN}✅ 数据导入完成${NC}"
}

upload_uploads() {
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  UPLOAD_BACKUP="${BACKUP_DIR}/uploads_${TIMESTAMP}.tar.gz"

  echo "正在打包 uploads 目录 ..."
  mkdir -p "$BACKUP_DIR"
  tar -czf "$UPLOAD_BACKUP" -C "$APP_DIR" uploads/

  echo -e "${GREEN}✅ uploads 已打包: ${UPLOAD_BACKUP}${NC}"
}

full_export() {
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  MIGRATE_DIR="${BACKUP_DIR}/migrate_${TIMESTAMP}"
  MIGRATE_TAR="${BACKUP_DIR}/migrate_${TIMESTAMP}.tar.gz"

  echo "正在执行完整导出（数据库 + uploads）..."
  mkdir -p "$MIGRATE_DIR"

  # 导出数据库
  docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" > "${MIGRATE_DIR}/database.sql"

  # 复制 uploads
  if [ -d "${APP_DIR}/uploads" ]; then
    cp -r "${APP_DIR}/uploads" "${MIGRATE_DIR}/"
  fi

  # 打包
  tar -czf "$MIGRATE_TAR" -C "$BACKUP_DIR" "migrate_${TIMESTAMP}"
  rm -rf "$MIGRATE_DIR"

  echo -e "${GREEN}✅ 完整迁移包已生成: ${MIGRATE_TAR}${NC}"
  echo ""
  echo "下一步:"
  echo "  1. 下载此文件到本地: scp root@服务器IP:${MIGRATE_TAR} ./"
  echo "  2. 上传到云端服务器 backup/ 目录"
  echo "  3. 云端执行: ./backup.sh full-import ${MIGRATE_TAR}"
}

full_import() {
  TAR_FILE="$1"
  if [ ! -f "$TAR_FILE" ]; then
    echo -e "${RED}❌ 文件不存在: $TAR_FILE${NC}"
    exit 1
  fi

  echo -e "${YELLOW}⚠️  警告: 这将覆盖云端现有数据！${NC}"
  read -rp "确认导入? [y/N]: " CONFIRM
  if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    echo "已取消"
    exit 0
  fi

  MIGRATE_DIR="${BACKUP_DIR}/migrate_temp_$$"
  mkdir -p "$MIGRATE_DIR"

  echo "正在解压迁移包 ..."
  tar -xzf "$TAR_FILE" -C "$MIGRATE_DIR"

  # 找到解压后的目录
  EXTRACTED=$(find "$MIGRATE_DIR" -maxdepth 1 -type d | tail -1)

  # 导入数据库
  if [ -f "${EXTRACTED}/database.sql" ]; then
    echo "正在导入数据库 ..."
    docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "${EXTRACTED}/database.sql"
  fi

  # 恢复 uploads
  if [ -d "${EXTRACTED}/uploads" ]; then
    echo "正在恢复 uploads ..."
    rm -rf "${APP_DIR}/uploads"
    mv "${EXTRACTED}/uploads" "${APP_DIR}/"
  fi

  rm -rf "$MIGRATE_DIR"

  echo -e "${GREEN}✅ 完整迁移完成${NC}"
}

# ──────────────────────────────────────────────────
# 入口
# ──────────────────────────────────────────────────
COMMAND="${1:-}"

# 允许在项目根目录或任意位置运行
if [ -d "/opt/novelforge" ]; then
  cd "/opt/novelforge"
fi

mkdir -p "$BACKUP_DIR"

case "$COMMAND" in
  export)
    export_db
    ;;
  import)
    import_db "$2"
    ;;
  upload)
    upload_uploads
    ;;
  full-export)
    full_export
    ;;
  full-import)
    full_import "$2"
    ;;
  *)
    usage
    ;;
esac
