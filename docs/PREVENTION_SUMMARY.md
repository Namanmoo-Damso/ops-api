# 🛡️ Prisma Schema 불일치 문제 방지 시스템

## 📋 문제 요약

### 발생한 문제
1. **Schema-DB 불일치**: `schema.prisma`에 `gender`, `ward_type` 필드가 있었으나 DB에는 없었음
2. **잘못된 마이그레이션**: 존재하지 않는 컬럼(`diseases`, `medication`)을 참조하는 SQL

### 근본 원인
- 누군가 `schema.prisma`를 수정했지만 마이그레이션을 생성하지 않음
- 마이그레이션 작성 시 실제 DB 상태를 확인하지 않음
- 자동 검증 메커니즘 부재

---

## 🚀 구축한 자동 방지 시스템

### 1️⃣ Pre-commit Hook (즉각 차단)
**위치**: `ops-api/.husky/pre-commit`

```bash
#!/usr/bin/env sh
# schema.prisma 변경 시 migration 파일 확인
# 없으면 커밋 차단!
```

**작동 방식**:
- Git commit 시도 시 자동 실행
- `schema.prisma` 변경 감지
- `migrations/` 디렉토리에 변경사항 없으면 → **커밋 차단**
- `npx prisma validate` 자동 실행

**설치 방법**:
```bash
cd ops-api
npm install --save-dev husky
npx husky install
# .husky/pre-commit 파일이 이미 생성되어 있음
```

---

### 2️⃣ Docker 시작 시 검증 (런타임 차단)
**위치**: `ops-api/scripts/check-prisma-sync.sh`

```bash
#!/bin/sh
# API 시작 전 자동 검증
npx prisma migrate deploy
npx prisma validate
npx prisma migrate status || exit 1
```

**작동 방식**:
- Docker 컨테이너 시작 시 자동 실행
- 마이그레이션 적용 (`migrate deploy`)
- Schema 검증 (`validate`)
- Migration 상태 확인 (`migrate status`)
- 문제 발견 시 → **컨테이너 시작 실패**

**Dockerfile 설정**:
```dockerfile
CMD ["sh", "-c", "./scripts/check-prisma-sync.sh && node dist/main.js"]
```

---

### 3️⃣ GitHub Actions CI (PR 차단)
**위치**: `.github/workflows/prisma-check.yml`

**작동 방식**:
- PR 생성/업데이트 시 자동 실행
- `schema.prisma` 변경 감지
- Migration 파일 변경 확인
- Schema만 변경되고 migration 없으면 → **CI 실패 (PR 머지 차단)**
- 테스트 DB에서 migration 적용 테스트

**검증 단계**:
1. ✅ Schema 변경 시 migration도 변경되었는지 확인
2. ✅ `npx prisma validate` 실행
3. ✅ 테스트 DB에 migration 적용
4. ✅ `npx prisma migrate status` 확인
5. ✅ Schema-DB diff 검사

---

### 4️⃣ 개발자 문서 (교육 및 가이드)
**위치**:
- `WORKFLOW_GUIDE.md` - Prisma Migration 규칙 섹션 추가
- `ops-api/README-PRISMA.md` - 상세 가이드

**내용**:
- ✅ 올바른 절차 설명
- ❌ 하지 말아야 할 것
- 🔧 트러블슈팅 가이드
- 📝 명령어 레퍼런스

---

## 📊 방지 레벨별 정리

| 레벨 | 시점 | 도구 | 차단 여부 | 비고 |
|------|------|------|-----------|------|
| **Level 1** | 커밋 시 | Pre-commit Hook | ✅ 차단 | 가장 빠른 피드백 |
| **Level 2** | PR 시 | GitHub Actions | ✅ 차단 | 팀 리뷰 전 검증 |
| **Level 3** | 배포 시 | Docker 검증 | ✅ 차단 | 최종 안전장치 |
| **Level 4** | 항상 | 문서 | ❌ 가이드 | 개발자 교육 |

---

## 🔧 설치 및 활성화

### 로컬 개발 환경
```bash
# 1. Husky 설치 (pre-commit hook)
cd ops-api
npm install --save-dev husky
npx husky install

# 2. pre-commit hook 활성화 (이미 파일이 생성되어 있음)
chmod +x .husky/pre-commit

# 3. 테스트
git add prisma/schema.prisma
git commit -m "test"  # schema만 변경하면 차단됨!
```

### Docker 환경
```bash
# Dockerfile이 이미 수정되어 있음
# 다음 빌드 시 자동으로 적용됨
docker compose build api
docker compose up -d api
```

### GitHub Actions
```bash
# .github/workflows/prisma-check.yml 파일이 이미 생성됨
# 다음 PR부터 자동으로 작동
git add .github/workflows/prisma-check.yml
git commit -m "ci: Prisma 검증 워크플로우 추가"
git push
```

---

## ✅ 검증 방법

### Pre-commit Hook 테스트
```bash
# 1. schema.prisma만 수정
vim ops-api/prisma/schema.prisma
# (아무 필드나 추가)

# 2. 커밋 시도 (migration 없이)
cd ops-api
git add prisma/schema.prisma
git commit -m "test: schema 변경"

# 예상 결과: ❌ 커밋 차단
# "schema.prisma changed but no migration files were staged!"
```

### Docker 검증 테스트
```bash
# 1. schema에 없는 컬럼을 참조하는 코드 작성
# 2. 빌드 및 실행
docker compose build api
docker compose up api

# 예상 결과: ❌ 컨테이너 시작 실패
# "Database schema is out of sync with migrations!"
```

---

## 🎯 이전 vs 이후 비교

### 🔴 이전 (문제 발생 가능)
```bash
# 개발자 A
vim schema.prisma  # gender 필드 추가
git commit -m "feat: gender 추가"
git push

# 개발자 B가 pull
git pull
docker compose up  # ❌ 오류 발생!
# "column gender does not exist"
```

### 🟢 이후 (자동 차단)
```bash
# 개발자 A
vim schema.prisma  # gender 필드 추가
git commit -m "feat: gender 추가"

# ❌ Pre-commit hook이 차단!
# "Please run: npx prisma migrate dev"

npx prisma migrate dev --name add_gender
git add prisma/  # schema + migration
git commit -m "feat: gender 필드 추가"
git push

# 개발자 B가 pull
git pull
docker compose up  # ✅ 정상 작동!
# migration이 자동으로 적용됨
```

---

## 📝 체크리스트

프로젝트에 다음이 구축되었는지 확인:

- [x] Pre-commit hook 생성 (`ops-api/.husky/pre-commit`)
- [x] Docker 검증 스크립트 (`ops-api/scripts/check-prisma-sync.sh`)
- [x] Dockerfile 수정 (검증 스크립트 실행)
- [x] GitHub Actions 워크플로우 (`.github/workflows/prisma-check.yml`)
- [x] WORKFLOW_GUIDE.md에 Prisma 규칙 추가
- [x] README-PRISMA.md 작성

---

## 🚀 다음 단계

1. **팀 공유**: 이 문서를 팀원들과 공유
2. **Husky 설치**: 모든 팀원이 `npm install` 실행 (husky 자동 설치)
3. **문서 숙지**: `WORKFLOW_GUIDE.md`의 Prisma 섹션 읽기
4. **테스트**: Pre-commit hook이 작동하는지 확인

---

## 📚 참고 문서

- [ops-api/README-PRISMA.md](ops-api/README-PRISMA.md) - 상세 가이드
- [WORKFLOW_GUIDE.md](WORKFLOW_GUIDE.md) - Prisma Migration 규칙
- [Prisma Migrate 공식 문서](https://www.prisma.io/docs/orm/prisma-migrate)
