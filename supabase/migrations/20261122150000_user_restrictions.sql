-- 묶음 7: 사용자 이용 제한 (docs/erd.md 7장 "사용자 이용 제한", 이슈 #45, ADM-04)
--
-- 만드는 것: user_restrictions (+ 제약, 무결성 트리거, RLS, 컬럼 권한), 제한 중 판정 private 함수,
--           기존 테이블(messages, reviews, review_replies)에 거는 제한 트리거
-- 결정 (docs/decisions.md 2026-11-22, #45 PM 질문 1~3, 팀장 결정 후보 1~6)
--   - 한 줄 = 제한 한 번. 풀면 그 줄의 lifted_at·lifted_by를 채운다(해제 이력). 사용자마다 풀리지 않은 줄은 하나.
--   - 쓰기: 탈퇴하지 않은 운영자가 직접 쓴다. 제한하기(새 줄, restricted_by = 자기 자신, lifted_* 없음)와
--     풀기(빈 lifted_at·lifted_by를 한 번 채움, lifted_by = 자기 자신)뿐. user_id·reason·restricted_by 고치기,
--     해제 되돌리기, 지우기 없음.
--   - 읽기: 운영자는 모두, 본인은 자기 줄(지난 줄 포함). 그 사용자의 트레이너·학생을 포함한 다른 사람은 못 본다.
--   - DB 제약(서버 쓰기에도 걸린다): reason 필수, restricted_by·lifted_by는 운영자, lifted_at ⇔ lifted_by,
--     대상은 학생·트레이너. 제한 중인 사람이 보내는 메시지·쓰는 후기 insert, 제한 중인 작성자의 후기 body 고치기,
--     제한 중인 트레이너의 답글 insert는 실패한다. 후기 지우기와 운영자 가리기(hidden)는 막지 않는다.
-- 만들지 않는 것 (erd 10장 "7장 사용자 이용 제한 — 서버 함수 이슈에서 정할 것")
--   - 1:1 대화 열기의 제한 판정(여는 사람만, PM 질문 3): 채팅방·참여 행은 서버가 두 사람 몫을 함께 만들어
--     DB는 누가 여는지 모른다. 그래서 chat_rooms·chat_members에는 제한 트리거를 걸지 않는다.
--   - 메시지·후기·답글 쓰기 서버 함수의 오류·안내 문구, 운영자 화면(A-03), 앱의 제한 안내.
--   - 트레이너 정지(ADM-02)와 연동하지 않는다(서로 상태를 바꾸지 않는다).
--
-- 권한 원칙은 20261121210000·20261122090000·20261122120000 머리말과 같다. 판정은 private 함수(security definer,
-- search_path '', 트리거 함수는 아무 역할에도 실행 권한 없음)에 둔다. 운영자는 private.is_admin·private.user_role,
-- 탈퇴는 private.is_active_user를 다시 쓰고 public.users를 직접 읽지 않는다.
-- 클라이언트 insert가 있으므로 #38처럼 user_restrictions_authorize_insert가 무결성 트리거보다 먼저 돈다.

-- ---------------------------------------------------------------------------
-- user_restrictions (ADM-04). created_at = 제한 시각. 서버가 넣은 값을 그대로 저장한다(기본값만 now()).
-- ---------------------------------------------------------------------------

create table public.user_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id),
  reason text not null,
  restricted_by uuid not null references public.users (id),
  lifted_at timestamptz,
  lifted_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  -- ADM-04: 제한 사유는 비어 있지 않다
  constraint user_restrictions_reason_check check (reason <> ''),
  -- ADM-04: 해제 시각과 해제한 운영자는 함께 있거나 함께 없다
  constraint user_restrictions_lifted_check check ((lifted_at is null) = (lifted_by is null))
);

-- ADM-04 (팀장 결정 후보 1): 사용자마다 풀리지 않은 줄은 하나다(풀린 줄은 여러 개여도 된다)
create unique index user_restrictions_user_id_active_key
  on public.user_restrictions (user_id)
  where lifted_at is null;

-- ---------------------------------------------------------------------------
-- 판정 함수 (RLS를 거치지 않고 읽는다)
-- ---------------------------------------------------------------------------

-- [ADM-04] 그 사용자가 지금 이용 제한 중인가(풀리지 않은 줄이 있는가). 기간(만료 시각)은 없다.
-- 아래 제한 트리거만 부른다(정책은 부르지 않는다).
create function private.is_restricted_user(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_restrictions r
    where r.user_id = target_user_id
      and r.lifted_at is null
  )
$$;

-- ---------------------------------------------------------------------------
-- 트리거 (클라이언트·서버 모두에 걸리는 무결성 검사, 팀장 결정 후보 4)
-- 검사는 쓰는 사람의 RLS와 관계없이 같아야 하므로 security definer로 읽는다(아무 역할에도 실행 권한을 주지 않는다).
-- ---------------------------------------------------------------------------

-- 제한 줄 (ADM-04): 대상은 학생·트레이너, restricted_by·lifted_by는 운영자.
-- 서버에는 auth.uid()가 없으므로 "자기 자신"은 보지 않고 역할만 본다("자기 자신"은 클라이언트 정책이 본다).
create function private.user_restrictions_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.user_id is distinct from old.user_id)
    and private.user_role(new.user_id) not in ('student', 'trainer')
  then
    raise exception '이용 제한 대상은 학생·트레이너다'
      using errcode = 'check_violation';
  end if;

  if (tg_op = 'INSERT' or new.restricted_by is distinct from old.restricted_by)
    and private.user_role(new.restricted_by) is distinct from 'admin'
  then
    raise exception '이용 제한은 운영자가 한다'
      using errcode = 'check_violation';
  end if;

  if new.lifted_by is not null
    and (tg_op = 'INSERT' or new.lifted_by is distinct from old.lifted_by)
    and private.user_role(new.lifted_by) is distinct from 'admin'
  then
    raise exception '이용 제한은 운영자가 푼다'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

create trigger user_restrictions_before_write
before insert or update of user_id, restricted_by, lifted_by on public.user_restrictions
for each row execute function private.user_restrictions_before_write();

-- 메시지 (ADM-04, CHAT-05, DM-04): 제한 중인 사람은 단체 채팅방·1:1 대화에 메시지를 보내지 못한다.
-- 가리기(hidden_by)는 보낸 사람이 바뀌지 않아 막지 않는다. 이미 보낸 메시지는 그대로 둔다.
create function private.messages_check_restriction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.sender_id is distinct from old.sender_id)
    and private.is_restricted_user(new.sender_id)
  then
    raise exception '이용 제한 중인 사용자는 메시지를 보내지 못한다'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

create trigger messages_check_restriction
before insert or update of sender_id on public.messages
for each row execute function private.messages_check_restriction();

-- 후기 (ADM-04, REV-02, REV-04, PM 질문 2): 제한 중인 작성자는 후기를 쓰거나 본문을 고치지 못한다.
-- 운영자의 가리기(hidden)와 작성자의 지우기는 막지 않는다(hidden·delete에는 걸리지 않는다).
create function private.reviews_check_restriction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
      tg_op = 'INSERT'
      or new.body is distinct from old.body
      or new.student_id is distinct from old.student_id
    )
    and private.is_restricted_user(new.student_id)
  then
    raise exception '이용 제한 중인 사용자는 후기를 쓰거나 고치지 못한다'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

create trigger reviews_check_restriction
before insert or update of student_id, body on public.reviews
for each row execute function private.reviews_check_restriction();

-- 답글 (ADM-04, REV-06, PM 질문 2): 답글은 그 후기의 트레이너 것이다. 그 트레이너가 제한 중이면 쓰지 못한다.
-- 답글 수정은 없지만(#41 팀장 결정 6) 서버가 본문·후기를 바꾸는 것도 같은 기준으로 막는다.
create function private.review_replies_check_restriction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  review_trainer_id uuid;
begin
  select r.trainer_id into review_trainer_id
  from public.reviews r
  where r.id = new.review_id;

  -- 없는 후기는 FK가 막는다
  if review_trainer_id is not null and private.is_restricted_user(review_trainer_id) then
    raise exception '이용 제한 중인 트레이너는 답글을 쓰지 못한다'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

create trigger review_replies_check_restriction
before insert or update of review_id, body on public.review_replies
for each row execute function private.review_replies_check_restriction();

-- ---------------------------------------------------------------------------
-- 클라이언트 insert 권한 판정 (#38). user_restrictions를 더한다. 판정은 insert 정책과 같다.
--   user_restrictions  restricted_by = auth.uid() 그리고 활성 운영자 (user_restrictions_insert_admin)
-- 기존 8개 테이블의 판정은 20261122120000과 같다.
-- ---------------------------------------------------------------------------

create or replace function private.authorize_client_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  writer_id uuid;
  target_readable boolean := true;
begin
  -- RLS가 걸리지 않는 쓰기(서버)는 정책도 없으므로 판정도 없다
  if not pg_catalog.row_security_active(tg_relid) then
    return new;
  end if;

  if tg_table_name in ('homework_targets', 'homework_videos') then
    writer_id := private.homework_trainer_id(new.homework_id);
  elsif tg_table_name = 'homeworks' then
    writer_id := new.trainer_id;
  elsif tg_table_name = 'submissions' then
    writer_id := new.student_id;
  elsif tg_table_name = 'feedback_comments' then
    writer_id := new.author_id;
  elsif tg_table_name = 'trainer_profile_videos' then
    writer_id := new.trainer_id;
  elsif tg_table_name = 'blocks' then
    writer_id := new.blocker_id;
  elsif tg_table_name = 'reports' then
    writer_id := new.reporter_id;
  elsif tg_table_name = 'user_restrictions' then
    writer_id := new.restricted_by;
  else
    raise exception 'authorize_client_insert: 판정 기준이 없는 테이블 %', tg_table_name;
  end if;

  if writer_id is null
    or writer_id is distinct from auth.uid()
    or not private.is_active_user(auth.uid())
  then
    -- RLS가 거부할 때와 같은 코드·문구로 거부한다(어느 쪽에서 막혔는지 구별되지 않게)
    raise exception 'new row violates row-level security policy for table "%"', tg_table_name
      using errcode = 'insufficient_privilege';
  end if;

  -- ADM-04: 제한 줄은 운영자만 만든다. 학생·트레이너는 대상·값과 관계없이 여기서 42501로 막힌다.
  if tg_table_name = 'user_restrictions' and not private.is_admin() then
    raise exception 'new row violates row-level security policy for table "%"', tg_table_name
      using errcode = 'insufficient_privilege';
  end if;

  if tg_table_name = 'reports' then
    if new.target_type = 'message' then
      target_readable := exists (select 1 from public.messages m where m.id = new.target_id);
    elsif new.target_type = 'review' then
      target_readable := exists (select 1 from public.reviews r where r.id = new.target_id);
    else
      target_readable := exists (select 1 from public.users u where u.id = new.target_id);
    end if;

    if not target_readable then
      raise exception 'new row violates row-level security policy for table "%"', tg_table_name
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end
$$;

-- 같은 시점 트리거는 이름순으로 돈다. user_restrictions_authorize_insert가 user_restrictions_before_write보다 앞이다.
create trigger user_restrictions_authorize_insert
before insert on public.user_restrictions
for each row execute function private.authorize_client_insert();

-- ---------------------------------------------------------------------------
-- 함수 실행 권한
-- ---------------------------------------------------------------------------

-- 기존 규칙: 그 함수를 부르는 정책이 쓰는 역할에만 준다. 제한 중 판정은 트리거만 부르고, 트리거 함수는
-- 아무 역할에도 주지 않는다(트리거 실행에는 필요 없다).
revoke all on function
  private.is_restricted_user(uuid),
  private.user_restrictions_before_write(),
  private.messages_check_restriction(),
  private.reviews_check_restriction(),
  private.review_replies_check_restriction(),
  private.authorize_client_insert()
from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS와 권한
-- ---------------------------------------------------------------------------

alter table public.user_restrictions enable row level security;

revoke all on table public.user_restrictions from anon, authenticated;

grant select on public.user_restrictions to authenticated;
-- 팀장 결정 후보 2·3: 운영자는 제한하기(새 줄)와 풀기(lifted_at·lifted_by)만 쓴다. id·created_at은 DB가 넣는다.
-- 처음부터 풀린 줄은 정책이 막는다. 사유 수정·해제 되돌리기·지우기 없음.
grant insert (user_id, reason, restricted_by, lifted_at, lifted_by) on public.user_restrictions to authenticated;
grant update (lifted_at, lifted_by) on public.user_restrictions to authenticated;

-- ADM-04, AUTH-06 (PM 질문 1): 운영자는 모두, 본인은 자기 줄(지난 줄 포함)을 읽는다.
create policy user_restrictions_select on public.user_restrictions
for select to authenticated
using (
  user_id = (select auth.uid())
  or (select private.is_admin())
);

-- ADM-04, AUTH-07 (팀장 결정 후보 2): 탈퇴하지 않은 운영자가 자기 이름으로 풀리지 않은 줄을 만든다.
-- user_restrictions_authorize_insert가 같은 기준으로 먼저 본다.
create policy user_restrictions_insert_admin on public.user_restrictions
for insert to authenticated
with check (
  restricted_by = (select auth.uid())
  and lifted_at is null
  and lifted_by is null
  and (select private.is_admin())
  and (select private.is_active_user((select auth.uid())))
);

-- ADM-04, AUTH-07 (팀장 결정 후보 3): 탈퇴하지 않은 운영자가 풀리지 않은 줄을 자기 이름으로 한 번 푼다.
-- 풀린 줄은 using이 걸러 다시 고치거나 되돌리지 못한다.
create policy user_restrictions_update_admin_lift on public.user_restrictions
for update to authenticated
using (
  lifted_at is null
  and (select private.is_admin())
  and (select private.is_active_user((select auth.uid())))
)
with check (
  lifted_at is not null
  and lifted_by = (select auth.uid())
  and (select private.is_admin())
  and (select private.is_active_user((select auth.uid())))
);
