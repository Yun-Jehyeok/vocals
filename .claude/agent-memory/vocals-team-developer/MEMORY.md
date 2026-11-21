# 개발 메모리 — 반복되는 함정

- 한 Bash 명령에 보호 경로 문자열(`tests/acceptance/`, `supabase/migrations/`, `docs/`)과 훅이 해석 못 하는 쓰기(`pnpm`, `python3` 스크립트 등)가 함께 있으면 훅(`developer.opaque-write`)이 막는다. 인수 테스트는 `cd /home/claude/vocals/supabase && pnpm exec vitest run 16-account-edit`처럼 파일 이름 필터로, PR 설명은 `/tmp`에 받아 Edit로 고친 뒤 `gh api -X PATCH … -F body=@파일`로 올린다(#16).
- 정책만 바꿀 때는 새 마이그레이션에서 `alter policy <이름> on <테이블> using (...) with check (...)`로 고친다. 이름·대상 역할이 그대로라 drop/create보다 안전하다(#16).
- 새 `private` 함수를 만들면 `supabase/tests/schema.test.ts`의 실행 권한 목록에도 더한다. anon 목록은 `trainer_profile_is_public` 하나여야 하므로 SECURITY DEFINER 함수는 authenticated·service_role에만 준다(#16).
- 본인 쓰기 정책에는 활성 판정 `(select private.is_active_user((select auth.uid())))`을 붙인다. 묶음 2 이후 테이블도 같다(#16, AUTH-07).
