-- 로컬 테스트용 Supabase 흉내(shim). 마이그레이션 앞에 한 번 적용한다.
-- 실제 Supabase 프로젝트에는 이미 있는 것들이라 migrations/에 넣지 않는다.
--
-- 실제 Supabase와 다른 점 (supabase/README.md에도 적는다)
--   - auth.users는 id, email, created_at만 있다. 실제 테이블은 컬럼이 훨씬 많다.
--   - auth.uid()/auth.role()/auth.jwt()는 request.jwt.claims 설정값만 읽는다.
--     실제로는 PostgREST가 JWT를 검증해 이 값을 넣는다. 테스트는 검증 없이 직접 넣는다.
--   - anon·authenticated·service_role 역할만 만든다. authenticator, supabase_admin 등은 없다.
--   - 기본 권한(alter default privileges)은 Supabase와 같게 public 스키마의 새 테이블·시퀀스·함수에
--     anon·authenticated·service_role 모두 권한을 준다. 마이그레이션이 이를 회수하는지 확인하기 위해서다.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  created_at timestamptz not null default now()
);

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select auth.jwt() ->> 'role'
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema auth to service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
