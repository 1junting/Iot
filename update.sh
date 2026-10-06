#!/bin/bash
set -e

cd /opt/iot-all-in-one-sender

echo "=== 從 GitHub 取得最新版本 ==="
git pull --ff-only

echo "=== 重新 Build / 啟動 Docker ==="
docker compose up -d --build

echo "=== Container 狀態 ==="
docker compose ps

echo "=== 更新完成 ==="
