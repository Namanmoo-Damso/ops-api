#!/bin/sh
# Prisma schema와 데이터베이스 동기화 검증 스크립트

set -e

echo "🔍 Checking Prisma schema sync..."

# 1. 마이그레이션 적용
echo "📦 Applying pending migrations..."
npx prisma migrate deploy

# 2. Schema와 DB 동기화 확인 (validate 명령 사용)
echo "✅ Validating schema against database..."
npx prisma validate

# 3. 마이그레이션 상태 확인
echo "📊 Checking migration status..."
npx prisma migrate status || {
  echo "❌ ERROR: Database schema is out of sync with migrations!"
  echo "Please run 'prisma migrate dev' locally to create missing migrations."
  exit 1
}

echo "✅ Prisma schema is in sync with database!"
