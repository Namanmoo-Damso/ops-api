-- Fix incomplete registrations (Issue #60)
-- 불완전한 등록 상태의 사용자 데이터 정리

-- 1. 보류 중인 보호자 확인 (user_type이 null인데 guardians 레코드 없음)
-- 이 사용자들은 카카오 로그인 후 추가 정보 입력 전 이탈한 경우
SELECT
  u.id,
  u.email,
  u.nickname,
  u.user_type,
  u.created_at,
  g.id as guardian_id
FROM users u
LEFT JOIN guardians g ON g.user_id = u.id
WHERE u.user_type IS NULL
  AND g.id IS NULL
  AND u.kakao_id IS NOT NULL;

-- 2. user_type='guardian'인데 guardians 레코드가 없는 불일치 사용자 확인
SELECT
  u.id,
  u.email,
  u.nickname,
  u.user_type,
  u.created_at
FROM users u
LEFT JOIN guardians g ON g.user_id = u.id
WHERE u.user_type = 'guardian'
  AND g.id IS NULL;

-- 3. user_type='ward'인데 wards 레코드가 없는 불일치 사용자 확인
SELECT
  u.id,
  u.email,
  u.nickname,
  u.user_type,
  u.created_at
FROM users u
LEFT JOIN wards w ON w.user_id = u.id
WHERE u.user_type = 'ward'
  AND w.id IS NULL;

-- ============================================================
-- 정리 작업 (주의: 실행 전 위 SELECT로 영향 받는 데이터 확인 필수)
-- ============================================================

-- Case 1: 보류 중인 보호자 (user_type=null, 7일 이상 경과) 삭제
-- 이 사용자들은 등록 미완료 상태로 오래 방치된 경우
-- 주석 해제 후 실행
/*
DELETE FROM refresh_tokens
WHERE user_id IN (
  SELECT u.id FROM users u
  LEFT JOIN guardians g ON g.user_id = u.id
  WHERE u.user_type IS NULL
    AND g.id IS NULL
    AND u.kakao_id IS NOT NULL
    AND u.created_at < NOW() - INTERVAL '7 days'
);

DELETE FROM devices
WHERE user_id IN (
  SELECT u.id FROM users u
  LEFT JOIN guardians g ON g.user_id = u.id
  WHERE u.user_type IS NULL
    AND g.id IS NULL
    AND u.kakao_id IS NOT NULL
    AND u.created_at < NOW() - INTERVAL '7 days'
);

DELETE FROM users
WHERE id IN (
  SELECT u.id FROM users u
  LEFT JOIN guardians g ON g.user_id = u.id
  WHERE u.user_type IS NULL
    AND g.id IS NULL
    AND u.kakao_id IS NOT NULL
    AND u.created_at < NOW() - INTERVAL '7 days'
);
*/

-- Case 2: user_type='guardian'인데 guardians 레코드 없는 경우 -> user_type을 NULL로 리셋
-- 이렇게 하면 다음 로그인 시 다시 등록 절차를 밟게 됨
-- 주석 해제 후 실행
/*
UPDATE users
SET user_type = NULL, updated_at = NOW()
WHERE user_type = 'guardian'
  AND id NOT IN (SELECT user_id FROM guardians);
*/

-- Case 3: user_type='ward'인데 wards 레코드 없는 경우 -> 사용자 삭제
-- (이 경우는 심각한 데이터 불일치이므로 삭제 권장)
-- 주석 해제 후 실행
/*
DELETE FROM refresh_tokens
WHERE user_id IN (
  SELECT u.id FROM users u
  LEFT JOIN wards w ON w.user_id = u.id
  WHERE u.user_type = 'ward' AND w.id IS NULL
);

DELETE FROM devices
WHERE user_id IN (
  SELECT u.id FROM users u
  LEFT JOIN wards w ON w.user_id = u.id
  WHERE u.user_type = 'ward' AND w.id IS NULL
);

DELETE FROM users
WHERE id IN (
  SELECT u.id FROM users u
  LEFT JOIN wards w ON w.user_id = u.id
  WHERE u.user_type = 'ward' AND w.id IS NULL
);
*/
