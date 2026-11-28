-- 역할 권한을 Supabase 기본 권한과 상관없이 같게 만든다 (이슈 #59)
--
-- 왜
--   - 지금까지의 마이그레이션은 "Supabase가 public의 새 테이블·시퀀스에 anon·authenticated·service_role
--     모두 권한을 준다"는 옛 기본 권한을 전제로, anon·authenticated만 회수하고 다시 줬다.
--     service_role(서버 함수)은 기본 권한에 기댔다.
--   - Supabase는 2026-05-30 이후 새 프로젝트, 2026-10-30부터 기존 프로젝트에서 public의 새 테이블·시퀀스에
--     세 역할 모두 기본 권한을 주지 않는다(Supabase changelog #45329). 테스트 프로젝트에 그대로 올리면
--     service_role은 테이블 권한이 하나도 없어 서버 함수가 42501(permission denied)로 실패한다.
--   - 프로젝트 설정("새 테이블 자동 노출")에 따라 옛 기본 권한일 수도 있다. 어느 쪽이든 적용 결과가 같도록
--     필요한 권한은 명시해서 주고, 기본 권한은 새 방식(클라이언트 역할에는 주지 않음)으로 고정한다.
--     tests/role-grants.test.ts가 두 방식에서 권한이 같은지 확인한다.
--
-- 바뀌는 것
--   - service_role: public의 모든 테이블·시퀀스에 옛 기본 권한과 같은 권한(all)을 준다. RLS는 원래 거치지 않는다.
--   - anon·authenticated: public 시퀀스 권한을 회수한다. 클라이언트가 행을 넣는 identity 컬럼 테이블은 없다
--     (regions, genres, fee_policies는 마이그레이션·서버만 쓴다). 옛 기본 권한에서는 setval까지 할 수 있었다.
--   - 앞으로 postgres가 public에 만드는 테이블·시퀀스: service_role에만 기본 권한을 준다.
--     anon·authenticated에는 지금처럼 테이블마다 필요한 것만 grant한다(supabase/README.md "새 테이블을 만들 때").
--   - 테이블·컬럼에 대한 anon·authenticated 권한은 바꾸지 않는다.

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

revoke all on all sequences in schema public from anon, authenticated;

alter default privileges for role postgres in schema public
  grant all on tables to service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to service_role;
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
