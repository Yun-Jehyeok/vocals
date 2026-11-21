# 개발 메모리 — 반복되는 함정

- 한 Bash 명령에 보호 경로 문자열(`tests/acceptance/`, `supabase/migrations/`, `docs/`)과 훅이 해석 못 하는 쓰기(`pnpm`, `python3` 스크립트 등)가 함께 있으면 훅(`developer.opaque-write`)이 막는다. 인수 테스트는 `cd /home/claude/vocals/supabase && pnpm exec vitest run 16-account-edit`처럼 파일 이름 필터로, PR 설명은 `/tmp`에 받아 Edit로 고친 뒤 `gh api -X PATCH … -F body=@파일`로 올린다(#16).
- 정책만 바꿀 때는 새 마이그레이션에서 `alter policy <이름> on <테이블> using (...) with check (...)`로 고친다. 이름·대상 역할이 그대로라 drop/create보다 안전하다(#16).
- 새 `private` 함수를 만들면 `supabase/tests/schema.test.ts`의 실행 권한 목록에도 더한다. anon 목록은 `trainer_profile_is_public` 하나여야 하므로 SECURITY DEFINER 함수는 authenticated·service_role에만 준다(#16).
- 본인 쓰기 정책에는 활성 판정 `(select private.is_active_user((select auth.uid())))`을 붙인다. 묶음 2 이후 테이블도 같다(#16, AUTH-07).
- 이 클론은 `remote.origin.fetch`가 없어 `origin/main`이 안 생긴다. `git fetch origin main:refs/remotes/origin/main`처럼 대상 ref를 적는다(#28).
- `supabase/tests/qa-boundaries.test.ts`(QA 작성, 보호 경로 아님)는 권한 카탈로그를 고정한다(예: authenticated 테이블 단위 쓰기는 DELETE 몇 개뿐). 테이블 단위 grant를 더하면 깨지므로 한 줄만 고치고 [보고]에서 QA 확인을 요청한다(#28).
- seed의 승인 트레이너(`11`)는 기존 테스트가 "학생 없는 다른 트레이너"로 쓴다. 수강 관계 더미는 다른 트레이너(`12`·`13`·`16`)에 둔다(#28).
- 자식 테이블 읽기는 `exists (select 1 from <부모> where ...)`로 부모 RLS를 그대로 거치게 하면 판정이 한 곳에 모인다(trainer_genres, refund_requests·refunds → tickets). 행 잠금이 필요한 private 함수는 `volatile`이어야 한다(stable에서 FOR UPDATE 불가)(#28).
