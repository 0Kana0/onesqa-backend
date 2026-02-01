#!/bin/sh
set -e

cd /usr/src/app

echo "🟢 Booting container..."

# 1) ติดตั้ง dependencies ถ้ายังไม่มี (สำคัญมากเวลา mount โค้ด)
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm ci || npm install
fi

# 2) รัน DB setup เฉพาะตอนเป็น server (กัน worker ไปทำ migration/seed ซ้ำ)
if [ "${RUN_DB_SETUP:-true}" = "true" ]; then
  echo "🟢 Checking database..."
  npx sequelize-cli db:create || echo "✅ Database already exists, skipping create."

  echo "🟢 Running migrations..."
  npx sequelize-cli db:migrate

  echo "🟢 Create seed data..."
  # ถ้า seed ซ้ำแล้ว error บ่อย แนะนำให้ควบคุมด้วย env
  if [ "${RUN_SEED:-true}" = "true" ]; then
    npx sequelize-cli db:seed:all || echo "✅ Seed already applied or skipped."
  else
    echo "⏭️ Skipping seeds (RUN_SEED=false)"
  fi
else
  echo "⏭️ Skipping DB setup (RUN_DB_SETUP=false)"
fi

echo "▶️ Starting: $@"
exec "$@"
