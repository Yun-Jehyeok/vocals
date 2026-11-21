-- 묶음 3: 일정·출결 (docs/erd.md 4장, 이슈 #32, #31 포함)
--
-- 만드는 것: fixed_schedules, fixed_schedule_slots, lesson_sessions, session_attendees
--           (+ enum 5개, 제약, 무결성 트리거, RLS, private 판정 함수)
-- 바꾸는 것(#31): tickets_update_trainer — 클라이언트는 끝난(ended) 수강권의 반 배정을 바꾸지 못한다.
--   서버(service_role)는 RLS를 거치지 않으므로 끝난 수강권의 배정을 해제(null)할 수 있다.
--   끝난 수강권을 다른 반으로 옮기는 것은 tickets_before_write가 서버에게도 계속 막는다(이슈 #32 팀장 결정).
-- 만들지 않는 것 (이슈 #32 팀장 결정 1: 서버 함수가 쓴다. 여기서는 권한과 값 검사만)
--   - 고정 일정 입력·수정과 회차 자동 생성, 수강권 waiting_schedule → active 전환, 파일럿 발급,
--     일회권·보강 회차 만들기, 학생 사전 취소, 트레이너 회차 취소, 출결 체크·차감·회차 금액 기록, 출결 수정
--   - 금액·차감 계산: DB는 session_amount를 계산하지 않는다(트리거·함수·기본값 없음). 서버가
--     packages/shared의 sessionAmount(STL-02)로 계산해 넣은 값을 그대로 저장하고 범위만 검사한다.
--     "출결 상태 → 차감" 대응(isDeducted, ATT-02), 24시간 취소 마감(SCH-05), 수강권 remaining_sessions·status
--     변화도 DB에 다시 만들지 않는다(CLAUDE.md 도메인 규칙).
--   - 정산 확정 뒤 출결 잠금(ATT-06, 묶음 5), 알림·예약 작업
--
-- 시각: 회차 starts_at·ends_at은 timestamptz. 요일·start_time·effective_*·표시는 Asia/Seoul 기준이고
-- weekday는 0 = 일요일 ~ 6 = 토요일(erd 4장, Postgres extract(dow)와 같다).
--
-- 권한 원칙은 20261119170000·20261121150000 머리말과 같다. 판정은 private 함수에 두고, 수강 관계·반 배정
-- 판정은 기존 함수(is_enrollment_member, enrollment_trainer_id, enrollment_student_id, group_class_trainer_id,
-- is_assigned_to_group_class)를 다시 쓴다. 클라이언트 쓰기 정책에는 private.is_active_user를 붙인다(AUTH-07).

-- ---------------------------------------------------------------------------
-- enum. 이름은 "<테이블>_<컬럼>", 값은 erd 4장과 packages/shared/src/domain.ts와 같다.
-- ---------------------------------------------------------------------------

create type public.lesson_sessions_kind as enum ('regular', 'single', 'makeup');
-- online은 2단계 대비 값이다(erd 9장). 1단계에는 offline만 넣을 수 있다(아래 제약).
create type public.lesson_sessions_mode as enum ('offline', 'online');
create type public.lesson_sessions_status as enum ('scheduled', 'canceled');
create type public.session_attendees_attendance as enum (
  'none',
  'present',
  'absent',
  'pre_canceled',
  'makeup'
);
create type public.session_attendees_canceled_by as enum ('student', 'trainer');

-- ---------------------------------------------------------------------------
-- fixed_schedules (SCH-01, SCH-04, TRN-04). 1:1이면 수강권, 그룹이면 반에 붙는다. 서버만 쓴다.
-- 수정하면 기존 일정의 effective_to를 닫고 새 일정을 만든다(erd 4장).
-- ---------------------------------------------------------------------------

create table public.fixed_schedules (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.tickets (id),
  group_class_id uuid references public.group_classes (id),
  effective_from date not null,
  effective_to date,
  created_at timestamptz not null default now(),
  -- 팀장 결정 3: 수강권과 반 중 정확히 하나
  constraint fixed_schedules_target_check check (num_nonnulls(ticket_id, group_class_id) = 1),
  -- SCH-04: 닫힌 날은 시작일 이후(같은 날 포함)
  constraint fixed_schedules_effective_to_check check (
    effective_to is null or effective_to >= effective_from
  )
);

create index fixed_schedules_ticket_id_idx on public.fixed_schedules (ticket_id);
create index fixed_schedules_group_class_id_idx on public.fixed_schedules (group_class_id);

-- ---------------------------------------------------------------------------
-- fixed_schedule_slots (SCH-01). 주 여러 요일은 여러 줄. 서버만 쓴다.
-- ---------------------------------------------------------------------------

create table public.fixed_schedule_slots (
  id uuid primary key default gen_random_uuid(),
  fixed_schedule_id uuid not null references public.fixed_schedules (id) on delete cascade,
  -- 0 = 일요일 ~ 6 = 토요일 (Asia/Seoul, erd 4장)
  weekday integer not null,
  start_time time not null,
  created_at timestamptz not null default now(),
  constraint fixed_schedule_slots_weekday_check check (weekday between 0 and 6),
  constraint fixed_schedule_slots_fixed_schedule_id_weekday_start_time_key
    unique (fixed_schedule_id, weekday, start_time)
);

-- ---------------------------------------------------------------------------
-- lesson_sessions (SCH-01~SCH-09). 서버가 만들고·취소하고·지운다.
-- 클라이언트는 트레이너의 시간 변경(starts_at·ends_at)만 한다(팀장 결정 1·6).
-- ---------------------------------------------------------------------------

create table public.lesson_sessions (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.trainer_profiles (user_id),
  group_class_id uuid references public.group_classes (id),
  fixed_schedule_id uuid references public.fixed_schedules (id),
  kind public.lesson_sessions_kind not null,
  mode public.lesson_sessions_mode not null default 'offline',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.lesson_sessions_status not null default 'scheduled',
  created_at timestamptz not null default now(),
  constraint lesson_sessions_time_check check (ends_at > starts_at),
  -- erd 9장: 1단계는 offline만
  constraint lesson_sessions_mode_check check (mode = 'offline'),
  -- SCH-01, SCH-02, SCH-08: 정기 회차는 고정 일정에서 생긴다. 일회권·보강은 고정 일정·반이 없다
  -- (그룹 학생의 보강도 개별 회차).
  constraint lesson_sessions_kind_check check (
    (kind = 'regular' and fixed_schedule_id is not null)
    or (kind <> 'regular' and fixed_schedule_id is null and group_class_id is null)
  )
);

create index lesson_sessions_trainer_id_starts_at_idx on public.lesson_sessions (trainer_id, starts_at);
create index lesson_sessions_group_class_id_idx on public.lesson_sessions (group_class_id);
create index lesson_sessions_fixed_schedule_id_idx on public.lesson_sessions (fixed_schedule_id);

-- ---------------------------------------------------------------------------
-- session_attendees (ATT-01~ATT-05, STL-02). 학생별 출결. 서버만 쓴다.
-- 회차를 지우면 참여 행도 지워진다(차감된 행이 있으면 회차 삭제 자체를 막는다, 팀장 결정 4).
-- ---------------------------------------------------------------------------

create table public.session_attendees (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.lesson_sessions (id) on delete cascade,
  ticket_id uuid not null references public.tickets (id),
  student_id uuid not null references public.users (id),
  attendance public.session_attendees_attendance not null default 'none',
  canceled_by public.session_attendees_canceled_by,
  -- 서버가 isDeducted(ATT-02)로 정해 넣는다. DB는 attendance와의 대응을 검사하지 않는다.
  deducted boolean not null default false,
  -- 서버가 sessionAmount(STL-02)로 계산해 넣는다. DB는 계산하지 않고 범위만 본다.
  session_amount integer,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  -- ATT-03, PAY-07: (회차, 학생)마다 하나. 재결제로 수강권이 둘이어도 한 줄
  constraint session_attendees_session_id_student_id_key unique (session_id, student_id),
  -- SCH-05, SCH-06: 취소한 사람은 사전 취소일 때만
  constraint session_attendees_canceled_by_check check (
    (attendance = 'pre_canceled') = (canceled_by is not null)
  ),
  -- STL-02: 0 이상, 차감되지 않았으면 비어 있다
  constraint session_attendees_session_amount_check check (
    session_amount is null or (session_amount >= 0 and deducted)
  )
);

create index session_attendees_ticket_id_idx on public.session_attendees (ticket_id);
create index session_attendees_student_id_idx on public.session_attendees (student_id);

-- ---------------------------------------------------------------------------
-- 판정 함수 (RLS를 거치지 않고 읽는다. 정책끼리 서로 부르지 않게 한다)
-- ---------------------------------------------------------------------------

-- [PAY-03, ATT-05] 로그인한 사용자가 그 수강권의 학생이나 트레이너인가. 수강 관계 판정은
-- private.is_enrollment_member를 그대로 쓴다(tickets_select와 같은 기준). 고정 일정 읽기에 쓴다.
create function private.is_ticket_member(target_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tickets t
    where t.id = target_ticket_id
      and private.is_enrollment_member(t.enrollment_id)
  )
$$;

-- 고정 일정의 트레이너: 1:1이면 수강권의 수강 관계 트레이너, 그룹이면 반의 트레이너 (회차 무결성)
create function private.fixed_schedule_trainer_id(target_fixed_schedule_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.enrollment_trainer_id(t.enrollment_id),
    private.group_class_trainer_id(f.group_class_id)
  )
  from public.fixed_schedules f
  left join public.tickets t on t.id = f.ticket_id
  where f.id = target_fixed_schedule_id
$$;

-- 고정 일정의 반 (1:1이면 null) (회차 무결성)
create function private.fixed_schedule_group_class_id(target_fixed_schedule_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select f.group_class_id from public.fixed_schedules f where f.id = target_fixed_schedule_id
$$;

-- 회차의 트레이너 (참여 행 읽기, 참여 행 무결성)
create function private.lesson_session_trainer_id(target_session_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.trainer_id from public.lesson_sessions s where s.id = target_session_id
$$;

-- [SCH-09, ATT-05, 팀장 결정 2] 로그인한 학생이 그 회차에 참여 행이 있는가 (회차 읽기)
create function private.is_session_attendee(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.session_attendees a
    where a.session_id = target_session_id
      and a.student_id = auth.uid()
  )
$$;

-- [SCH-03, SCH-04, STL-02, 팀장 결정 4·6] 그 회차에 차감된 참여 행이 있는가
-- (트레이너 시간 변경 불가, 서버 회차 삭제 불가)
create function private.session_has_deducted_attendee(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.session_attendees a
    where a.session_id = target_session_id
      and a.deducted
  )
$$;

-- ---------------------------------------------------------------------------
-- 트리거 (클라이언트·서버 모두에 걸리는 무결성 검사. 값은 바꾸거나 채우지 않는다)
-- ---------------------------------------------------------------------------

-- SCH-01, SCH-02(팀장 결정 3): 고정 일정의 수강권은 1:1 정기권이다. 붙는 대상은 바꾸지 않는다
-- (수정은 effective_to를 닫고 새 일정을 만든다, SCH-04).
create function private.fixed_schedules_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.ticket_id is distinct from old.ticket_id
      or new.group_class_id is distinct from old.group_class_id
    then
      raise exception 'fixed_schedules의 ticket_id·group_class_id는 바꿀 수 없다'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.ticket_id is not null and not exists (
    select 1
    from public.tickets t
    where t.id = new.ticket_id
      and t.lesson_type = 'private'
      and t.ticket_type = 'regular'
  ) then
    raise exception '고정 일정은 1:1 정기권에만 붙는다'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger fixed_schedules_before_write
before insert or update on public.fixed_schedules
for each row execute function private.fixed_schedules_before_write();

-- 회차 무결성 (팀장 결정 3). 트레이너의 시간 변경(starts_at·ends_at)에는 아무 조회도 하지 않는다.
--   - trainer_id는 바꿀 수 없다(서버도).
--   - 고정 일정에서 생긴 회차의 트레이너·반은 그 고정 일정의 것과 같다.
--   - 참여 행이 있는 회차의 종류·반은 바꿀 수 없다(참여 행의 수강권 유형 검사가 깨지지 않게).
create function private.lesson_sessions_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.trainer_id is distinct from old.trainer_id then
      raise exception 'lesson_sessions.trainer_id는 바꿀 수 없다'
        using errcode = 'check_violation';
    end if;

    if (new.kind is distinct from old.kind or new.group_class_id is distinct from old.group_class_id)
      and exists (select 1 from public.session_attendees a where a.session_id = new.id)
    then
      raise exception '참여 행이 있는 회차의 종류·반은 바꿀 수 없다'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.fixed_schedule_id is not null
    and (
      tg_op = 'INSERT'
      or new.fixed_schedule_id is distinct from old.fixed_schedule_id
      or new.group_class_id is distinct from old.group_class_id
    )
  then
    if private.fixed_schedule_trainer_id(new.fixed_schedule_id) is distinct from new.trainer_id then
      raise exception '회차의 트레이너는 고정 일정의 트레이너여야 한다'
        using errcode = 'check_violation';
    end if;
    if private.fixed_schedule_group_class_id(new.fixed_schedule_id)
      is distinct from new.group_class_id
    then
      raise exception '회차의 반은 고정 일정의 반이어야 한다'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end
$$;

create trigger lesson_sessions_before_write
before insert or update on public.lesson_sessions
for each row execute function private.lesson_sessions_before_write();

-- SCH-04, STL-02(팀장 결정 4): 차감된 참여 행이 있는 회차는 서버도 지우지 못한다.
-- 차감 기록은 정산 항목(묶음 5)이 가리킨다. 차감이 없으면 참여 행은 FK(on delete cascade)로 함께 지워진다.
create function private.lesson_sessions_before_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if private.session_has_deducted_attendee(old.id) then
    raise exception '차감된 참여 행이 있는 회차는 지울 수 없다'
      using errcode = 'restrict_violation';
  end if;
  return old;
end
$$;

create trigger lesson_sessions_before_delete
before delete on public.lesson_sessions
for each row execute function private.lesson_sessions_before_delete();

-- 참여 행 무결성 (erd 4장, PAY-08, SCH-02, 팀장 결정 3). 출결·차감·금액 값은 보지 않는다.
--   - student_id는 그 수강권의 학생이고, 수강권의 트레이너는 회차의 트레이너다.
--   - 그룹 회차(group_class_id 있음)에는 그룹 수강권, 1:1 정기 회차에는 1:1 정기권,
--     일회권 회차에는 일회권만. 보강 회차는 유형을 묻지 않는다(그룹 학생의 보강도 개별 회차, SCH-08).
create function private.session_attendees_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ticket_enrollment_id uuid;
  ticket_lesson_type public.tickets_lesson_type;
  ticket_ticket_type public.tickets_ticket_type;
  session_trainer_id uuid;
  session_group_class_id uuid;
  session_kind public.lesson_sessions_kind;
begin
  if tg_op = 'UPDATE'
    and new.session_id is not distinct from old.session_id
    and new.ticket_id is not distinct from old.ticket_id
    and new.student_id is not distinct from old.student_id
  then
    return new;
  end if;

  select t.enrollment_id, t.lesson_type, t.ticket_type
  into ticket_enrollment_id, ticket_lesson_type, ticket_ticket_type
  from public.tickets t
  where t.id = new.ticket_id;

  select s.trainer_id, s.group_class_id, s.kind
  into session_trainer_id, session_group_class_id, session_kind
  from public.lesson_sessions s
  where s.id = new.session_id;

  -- 없는 수강권·회차는 FK가 막는다
  if ticket_enrollment_id is null or session_trainer_id is null then
    return new;
  end if;

  if private.enrollment_student_id(ticket_enrollment_id) is distinct from new.student_id then
    raise exception '참여 행의 학생은 그 수강권의 학생이어야 한다'
      using errcode = 'check_violation';
  end if;

  if private.enrollment_trainer_id(ticket_enrollment_id) is distinct from session_trainer_id then
    raise exception '참여 행의 수강권은 그 회차 트레이너의 수강권이어야 한다'
      using errcode = 'check_violation';
  end if;

  if session_group_class_id is not null then
    if ticket_lesson_type <> 'group' then
      raise exception '그룹 회차에는 그룹 수강권만 넣는다'
        using errcode = 'check_violation';
    end if;
  elsif session_kind = 'regular' then
    if ticket_lesson_type <> 'private' or ticket_ticket_type <> 'regular' then
      raise exception '1:1 정기 회차에는 1:1 정기권만 넣는다'
        using errcode = 'check_violation';
    end if;
  elsif session_kind = 'single' then
    if ticket_ticket_type <> 'single' then
      raise exception '일회권 회차에는 일회권만 넣는다'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end
$$;

create trigger session_attendees_before_write
before insert or update on public.session_attendees
for each row execute function private.session_attendees_before_write();

-- ---------------------------------------------------------------------------
-- 함수 실행 권한
-- ---------------------------------------------------------------------------

-- 기존 규칙: 그 함수를 부르는 정책·트리거가 쓰는 역할에만 준다. 트리거 함수는 아무 역할에도 주지 않는다.
revoke all on function
  private.is_ticket_member(uuid),
  private.fixed_schedule_trainer_id(uuid),
  private.fixed_schedule_group_class_id(uuid),
  private.lesson_session_trainer_id(uuid),
  private.is_session_attendee(uuid),
  private.session_has_deducted_attendee(uuid),
  private.fixed_schedules_before_write(),
  private.lesson_sessions_before_write(),
  private.lesson_sessions_before_delete(),
  private.session_attendees_before_write()
from public, anon, authenticated, service_role;

grant execute on function
  private.is_ticket_member(uuid),
  private.fixed_schedule_trainer_id(uuid),
  private.fixed_schedule_group_class_id(uuid),
  private.lesson_session_trainer_id(uuid),
  private.is_session_attendee(uuid),
  private.session_has_deducted_attendee(uuid)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS 켜기
-- ---------------------------------------------------------------------------

alter table public.fixed_schedules enable row level security;
alter table public.fixed_schedule_slots enable row level security;
alter table public.lesson_sessions enable row level security;
alter table public.session_attendees enable row level security;

-- ---------------------------------------------------------------------------
-- 권한: 기본 권한을 모두 회수한 뒤 필요한 것만 준다. 쓰기는 서버(service_role)가 한다(팀장 결정 1).
-- ---------------------------------------------------------------------------

revoke all on table
  public.fixed_schedules,
  public.fixed_schedule_slots,
  public.lesson_sessions,
  public.session_attendees
from anon, authenticated;

-- fixed_schedules -----------------------------------------------------------
-- SCH-01, SCH-09, ADM-07: 1:1이면 그 수강권의 학생·트레이너(끝난 수강권 포함, ATT-05),
-- 그룹이면 그 반의 트레이너와 그 반에 배정된 수강권이 있는 학생(group_classes_select와 같은 기준), 운영자.
grant select on public.fixed_schedules to authenticated;

create policy fixed_schedules_select on public.fixed_schedules
for select to authenticated
using (
  (select private.is_admin())
  or private.is_ticket_member(ticket_id)
  or private.group_class_trainer_id(group_class_id) = (select auth.uid())
  or private.is_assigned_to_group_class(group_class_id)
);

-- fixed_schedule_slots ------------------------------------------------------
-- 그 고정 일정을 읽을 수 있는 사람이 읽는다. fixed_schedules의 RLS를 그대로 거친다.
grant select on public.fixed_schedule_slots to authenticated;

create policy fixed_schedule_slots_select on public.fixed_schedule_slots
for select to authenticated
using (
  exists (
    select 1 from public.fixed_schedules f where f.id = fixed_schedule_slots.fixed_schedule_id
  )
);

-- lesson_sessions -----------------------------------------------------------
grant select on public.lesson_sessions to authenticated;
-- 팀장 결정 1: 클라이언트가 고치는 컬럼은 시간뿐이다. 회차 만들기·취소·삭제는 서버 함수.
grant update (starts_at, ends_at) on public.lesson_sessions to authenticated;

-- SCH-09, ATT-05, ADM-07(팀장 결정 2): 트레이너는 자기 회차 전부, 학생은 자기 참여 행이 있는 회차만, 운영자는 전부.
create policy lesson_sessions_select on public.lesson_sessions
for select to authenticated
using (
  trainer_id = (select auth.uid())
  or (select private.is_admin())
  or private.is_session_attendee(id)
);

-- SCH-03, ADM-02, AUTH-07(팀장 결정 6): 자기 회차 중 scheduled이고 차감된 참여 행이 없는 회차의 시간만.
-- 정지 트레이너도 고치고(approval_status를 보지 않는다), 탈퇴한 트레이너는 못 고친다.
create policy lesson_sessions_update_trainer on public.lesson_sessions
for update to authenticated
using (
  trainer_id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
  and status = 'scheduled'
  and not private.session_has_deducted_attendee(id)
)
with check (
  trainer_id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
  and status = 'scheduled'
);

-- session_attendees ---------------------------------------------------------
-- ATT-03, ATT-05, ADM-07(팀장 결정 2): 학생은 자기 참여 행만, 트레이너는 자기 회차의 참여 행, 운영자는 전부.
-- 쓰기(출결 체크, 사전 취소, deducted, session_amount)는 서버만 한다.
grant select on public.session_attendees to authenticated;

create policy session_attendees_select on public.session_attendees
for select to authenticated
using (
  student_id = (select auth.uid())
  or (select private.is_admin())
  or private.lesson_session_trainer_id(session_id) = (select auth.uid())
);

-- ---------------------------------------------------------------------------
-- #31: 끝난 수강권의 반 배정은 클라이언트가 바꾸지 못한다(#28 팀장 결정 8: 배정 기록 보존).
-- 클라이언트가 tickets에서 고칠 수 있는 컬럼은 group_class_id뿐이므로, 끝난 수강권은 트레이너의
-- 수정 대상에서 뺀다. 서버는 RLS를 거치지 않아 해제(null)할 수 있고, 다른 반으로 옮기는 것은
-- tickets_before_write("끝난 수강권은 반에 배정할 수 없다")가 서버에게도 막는다.
-- ---------------------------------------------------------------------------

alter policy tickets_update_trainer on public.tickets
using (
  private.enrollment_trainer_id(enrollment_id) = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
  and status <> 'ended'
)
with check (
  private.enrollment_trainer_id(enrollment_id) = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
  and status <> 'ended'
);
