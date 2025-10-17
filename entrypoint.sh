#!/bin/sh
set -e

echo "🟢 Checking database..."
# ✅ ถ้า DB ยังไม่มี — ค่อยสร้าง
npx sequelize-cli db:create || echo "✅ Database already exists, skipping create."

echo "🟢 Running migrations..."
npx sequelize-cli db:migrate

echo "🟢 Starting Node server..."
exec node server.js
