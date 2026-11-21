-- 이슈 #16: 계정 수정 권한 보완 (AUTH-07, AUTH-08, ADM-02)
--
-- PM 결정(2026-11-20)
--   - 탈퇴한 사용자(보관 중)는 닉네임 등 자기 정보를 고칠 수 없다.
--   - 정지된 트레이너는 자기 프로필을 고칠 수 있다(공개되지 않을 뿐). 지금 정책과 맞으므로 바꾸지 않는다.
--
-- 바꾸는 것
--   - "활성 사용자인가" 판정을 private.is_active_user() 하나에 둔다. is_admin()도 이 함수를 쓴다.
--   - 클라이언트(authenticated)의 본인 쓰기 정책에 활성 사용자 조건을 더한다:
--     users_update_own, trainer_profiles_insert_own, trainer_profiles_update,
--     trainer_genres_insert_own, trainer_genres_delete_own,
--     trainer_business_profiles_insert_own, trainer_business_profiles_update_own
-- 바꾸지 않는 것
--   - 읽기(select) 정책: 탈퇴 사용자의 읽기 권한은 이 이슈에서 바꾸지 않는다.
--   - 서버(service_role): RLS를 거치지 않으므로 탈퇴 사용자 행을 계속 고친다(AUTH-08 탈퇴·삭제 처리).
--   - 정지 트레이너: users.status는 active이므로 이 조건에 걸리지 않는다. 사업자 정보는 기존대로
--     trainer_can_edit_business_info(pending만)가 막는다.
--
-- 묶음 2 이후 테이블(레슨 상품·숙제·영상·채팅 등)의 본인 쓰기 정책도 같은 판정을 쓴다:
--   with check (<본인 조건> and (select private.is_active_user((select auth.uid()))))
-- 판정 기준을 바꿀 때는 새 마이그레이션에서 이 함수만 create or replace 한다.

-- ---------------------------------------------------------------------------
-- 내부 함수
-- ---------------------------------------------------------------------------

-- [AUTH-07] 활성 사용자인가: users.status = 'active'. 탈퇴(withdrawn, 보관 중)이거나 행이 없으면 false.
-- RLS를 거치지 않고 읽어야 정책끼리 서로 부르지 않는다.
create function private.is_active_user(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    where u.id = target_user_id
      and u.status = 'active'
  )
$$;

-- 운영자인가 (ADM-06). 탈퇴한 운영자 계정은 운영자 권한을 잃는다(AUTH-07).
-- 활성 판정을 is_active_user() 한 곳에 모은다. 동작은 20261119170000과 같다.
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user(auth.uid())
    and private.user_role(auth.uid()) is not distinct from 'admin'
$$;

-- 함수 실행 권한: 기존 규칙대로 그 함수를 부르는 정책이 쓰는 역할에만 준다.
-- SECURITY DEFINER 함수는 anon에게 주지 않는다(anon은 쓰기 정책이 없다).
revoke all on function private.is_active_user(uuid) from public, anon, authenticated, service_role;
grant execute on function private.is_active_user(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- users (AUTH-06, AUTH-07): 본인은 활성일 때만 닉네임·프로필 사진을 고친다.
-- ---------------------------------------------------------------------------

alter policy users_update_own on public.users
using (
  id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
)
with check (
  id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
);

-- ---------------------------------------------------------------------------
-- trainer_profiles (AUTH-04, AUTH-07, ADM-02)
-- 정지 트레이너는 활성 사용자이므로 계속 고친다. 운영자 조건(is_admin)은 그대로다.
-- ---------------------------------------------------------------------------

alter policy trainer_profiles_insert_own on public.trainer_profiles
with check (
  user_id = (select auth.uid())
  and private.user_role((select auth.uid())) = 'trainer'
  and (select private.is_active_user((select auth.uid())))
);

alter policy trainer_profiles_update on public.trainer_profiles
using (
  (user_id = (select auth.uid()) and (select private.is_active_user((select auth.uid()))))
  or (select private.is_admin())
)
with check (
  (user_id = (select auth.uid()) and (select private.is_active_user((select auth.uid()))))
  or (select private.is_admin())
);

-- ---------------------------------------------------------------------------
-- trainer_genres (TRN-08, AUTH-07)
-- ---------------------------------------------------------------------------

alter policy trainer_genres_insert_own on public.trainer_genres
with check (
  trainer_id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
);

alter policy trainer_genres_delete_own on public.trainer_genres
using (
  trainer_id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
);

-- ---------------------------------------------------------------------------
-- trainer_business_profiles (AUTH-04 확정 4, AUTH-07): 활성이고 pending일 때만 본인이 만들고 고친다.
-- 운영자 정책(trainer_business_profiles_update_admin)은 그대로다.
-- ---------------------------------------------------------------------------

alter policy trainer_business_profiles_insert_own on public.trainer_business_profiles
with check (
  trainer_id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
  and private.trainer_can_edit_business_info(private.trainer_approval_status(trainer_id))
);

alter policy trainer_business_profiles_update_own on public.trainer_business_profiles
using (
  trainer_id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
  and private.trainer_can_edit_business_info(private.trainer_approval_status(trainer_id))
)
with check (
  trainer_id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
);
