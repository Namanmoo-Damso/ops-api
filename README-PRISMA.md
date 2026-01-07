# Prisma Migration 가이드

## 🚨 중요: Schema 변경 시 필수 절차

Prisma schema를 변경할 때는 **반드시 마이그레이션을 생성**해야 합니다.

### ✅ 올바른 절차

```bash
# 1. schema.prisma 수정
vim prisma/schema.prisma

# 2. 마이그레이션 생성 (자동으로 DB에 적용됨)
npx prisma migrate dev --name add_gender_field

# 3. 생성된 파일 확인
cat prisma/migrations/XXXXXX_add_gender_field/migration.sql

# 4. Git에 커밋 (schema와 migration 모두)
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: organization_wards에 gender 필드 추가"
```

### ❌ 절대 하지 말 것

```bash
# 잘못된 방법 1: schema만 수정하고 커밋
git add prisma/schema.prisma  # ❌ migration 없음!
git commit -m "feat: gender 필드 추가"

# 잘못된 방법 2: 프로덕션에서 db push 사용
npx prisma db push  # ❌ 마이그레이션 기록이 남지 않음!

# 잘못된 방법 3: 이미 적용된 migration 수정
vim prisma/migrations/existing/migration.sql  # ❌ 히스토리 꼬임!
```

## 🛡️ 자동 방지 메커니즘

이 프로젝트는 실수를 방지하기 위한 여러 안전장치를 가지고 있습니다:

### 1. Pre-commit Hook (즉각 차단)
- schema.prisma 변경 시 migration 파일이 없으면 커밋 차단
- 자동으로 `npx prisma validate` 실행

### 2. Docker 시작 검증
- API 컨테이너 시작 시 자동으로 migration 상태 확인
- Schema-DB 불일치 시 오류 발생하여 시작 차단

### 3. GitHub Actions CI
- PR 생성 시 자동으로 Prisma 검증
- Schema 변경 있는데 migration 없으면 PR 실패

## 📝 Migration 명령어

### 개발 환경
```bash
# 새 마이그레이션 생성 및 적용
npx prisma migrate dev --name description_of_change

# 마이그레이션 상태 확인
npx prisma migrate status

# Schema 검증
npx prisma validate

# Prisma Client 재생성
npx prisma generate
```

### 프로덕션 환경
```bash
# 마이그레이션 적용만 (이미 생성된 것)
npx prisma migrate deploy

# 마이그레이션 상태 확인
npx prisma migrate status
```

## 🔧 트러블슈팅

### 실패한 마이그레이션 복구

```bash
# 1. 실패한 마이그레이션을 rolled back으로 표시
npx prisma migrate resolve --rolled-back "20260105120000_migration_name"

# 2. 마이그레이션 파일 수정 (필요시)
vim prisma/migrations/20260105120000_migration_name/migration.sql

# 3. 다시 적용
npx prisma migrate deploy
```

### Schema와 DB가 동기화되지 않을 때

```bash
# 1. 현재 DB와 schema의 차이 확인
npx prisma migrate diff \
  --from-schema-datamodel prisma/schema.prisma \
  --to-schema-datasource prisma/schema.prisma \
  --script

# 2. 새 마이그레이션 생성
npx prisma migrate dev --name sync_schema_with_db
```

### 로컬 DB 초기화 (개발 전용!)

```bash
# ⚠️ 주의: 모든 데이터가 삭제됩니다!
npx prisma migrate reset
```

## 📚 더 알아보기

- [Prisma Migrate 공식 문서](https://www.prisma.io/docs/orm/prisma-migrate)
- [Migration 트러블슈팅](https://www.prisma.io/docs/orm/prisma-migrate/workflows/troubleshooting)
- [프로덕션 Migration 가이드](https://www.prisma.io/docs/orm/prisma-migrate/workflows/patching-and-hotfixing)
