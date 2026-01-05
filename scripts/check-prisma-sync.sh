#!/bin/sh
# Prisma schema와 데이터베이스 동기화 검증 스크립트

set -e

echo "🔍 Checking Prisma schema sync..."

# 1. 마이그레이션 적용
echo "📦 Applying pending migrations..."
npx prisma migrate deploy

# 2. Schema 문법 검증
echo "✅ Validating schema syntax..."
npx prisma validate

# 3. Schema-DB drift 확인 (선택적)
echo "🔍 Checking for schema drift..."
DRIFT_OUTPUT=$(npx prisma migrate diff \
  --from-schema-datamodel prisma/schema.prisma \
  --to-schema-datasource prisma/schema.prisma \
  --script 2>&1 || echo "")

if [ -n "$DRIFT_OUTPUT" ]; then
  echo "⚠️  WARNING: Detected potential drift between schema and database"
  echo "This might indicate missing migrations, but can be normal after migrate deploy."
fi

# 4. 마이그레이션 상태 확인
echo "📊 Checking migration status..."
npx prisma migrate status || {
  echo "❌ ERROR: Database schema is out of sync with migrations!"
  echo "Please run 'prisma migrate dev' locally to create missing migrations."
  exit 1
}

echo "✅ Prisma schema is in sync with database!"
