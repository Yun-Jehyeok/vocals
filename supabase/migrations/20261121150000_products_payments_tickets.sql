-- 묶음 2: 상품·결제·수강권 (docs/erd.md 3·4·6장, 이슈 #28)
--
-- 만드는 것: lesson_products, enrollments, payments, tickets, refund_requests, refunds,
--           group_classes, fee_policies (+ enum 11개, 제약, RLS, private 판정 함수)
-- 바꾸는 것(#10에서 넘어온 정책)
--   - trainer_profiles_select: 정지 트레이너의 프로필을 수강 관계가 있는 학생도 읽는다(ADM-02).
--     trainer_genres·lesson_products의 읽기는 프로필 RLS를 따르므로 함께 열린다(팀장 결정 7).
--   - user_private_profiles_select: 트레이너가 자기 학생(AUTH-09)의 행을 읽는다.
--     user_account_records는 바꾸지 않는다(본인·운영자만).
-- 만들지 않는 것
--   - 결제 승인·수강 관계·수강권 생성, 수수료율 복사, 유효기간 계산, 환불 처리, 파일럿 발급, 만료 처리:
--     서버 함수(service_role)가 쓴다. 여기서는 권한만 만든다.
--   - 금액 계산: DB는 금액을 계산하거나 fee_policies에서 복사하지 않는다. 서버가 넣은 값을 그대로 저장하고
--     값의 범위만 검사한다(erd 3장, CLAUDE.md 도메인 규칙). 회차 금액·정산·환불 금액은 packages/shared가 맡는다.
--   - fixed_schedules 등 일정·출결(묶음 3), 정산(묶음 5)
--
-- 권한 원칙은 20261119170000 머리말과 같다. 본인 쓰기 정책에는 활성 판정
-- (select private.is_active_user((select auth.uid())))을 붙인다(AUTH-07, 20261121120000).
-- PM 결정으로 바뀔 수 있는 판정(자기 학생, 수강 관계, 환불 요청 가능 수강권)은 private 함수 하나씩에 둔다.

-- ---------------------------------------------------------------------------
-- enum. 이름은 "<테이블>_<컬럼>", 값은 erd 3·6장과 packages/shared/src/domain.ts와 같다.
-- 같은 값이라도 테이블마다 타입을 따로 둔다(결정 로그 2026-11-20).
-- ---------------------------------------------------------------------------

create type public.lesson_products_lesson_type as enum ('private', 'group');
create type public.lesson_products_ticket_type as enum ('regular', 'single');
create type public.enrollments_source as enum ('trainer_link', 'marketplace');
create type public.payments_method as enum ('card', 'kakaopay', 'naverpay', 'tosspay');
create type public.payments_status as enum ('paid', 'partially_refunded', 'refunded');
create type public.tickets_lesson_type as enum ('private', 'group');
create type public.tickets_ticket_type as enum ('regular', 'single');
create type public.tickets_status as enum ('waiting_schedule', 'active', 'ended');
create type public.tickets_end_reason as enum ('used_up', 'expired', 'refunded');
create type public.refund_requests_status as enum ('requested', 'processed');
create type public.fee_policies_source as enum ('trainer_link', 'marketplace');

-- ---------------------------------------------------------------------------
-- lesson_products (TRN-03, TRN-05, TRN-06, PAY-02)
-- 지우지 않는다. 판매를 멈출 때는 active = false (팀장 결정 1).
-- ---------------------------------------------------------------------------

create table public.lesson_products (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.trainer_profiles (user_id),
  lesson_type public.lesson_products_lesson_type not null,
  ticket_type public.lesson_products_ticket_type not null,
  session_count integer not null,
  price integer not null,
  duration_min integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  -- erd 3장 상품 값 (팀장 결정 2). 상한은 두지 않는다. 입력 검사이고 금액 계산이 아니다.
  constraint lesson_products_session_count_check check (session_count >= 1),
  constraint lesson_products_price_check check (price > 0),
  constraint lesson_products_duration_min_check check (duration_min > 0),
  -- TRN-03: 일회권은 1회
  constraint lesson_products_single_session_count_check check (
    ticket_type <> 'single' or session_count = 1
  )
);

create index lesson_products_trainer_id_idx on public.lesson_products (trainer_id);

-- ---------------------------------------------------------------------------
-- group_classes (TRN-04). 반은 상품과 연결하지 않는다(erd 4장).
-- ---------------------------------------------------------------------------

create table public.group_classes (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.trainer_profiles (user_id),
  name text not null,
  capacity integer not null,
  duration_min integer not null,
  created_at timestamptz not null default now(),
  constraint group_classes_capacity_check check (capacity >= 1),
  constraint group_classes_duration_min_check check (duration_min > 0)
);

create index group_classes_trainer_id_idx on public.group_classes (trainer_id);

-- ---------------------------------------------------------------------------
-- enrollments (PAY-04, PLT-02, MKT-06). (학생, 트레이너) 쌍마다 하나. 서버만 쓴다.
-- ---------------------------------------------------------------------------

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.users (id),
  trainer_id uuid not null references public.trainer_profiles (user_id),
  source public.enrollments_source not null,
  pilot_free boolean not null default false,
  created_at timestamptz not null default now(),
  constraint enrollments_student_id_trainer_id_key unique (student_id, trainer_id)
);

create index enrollments_trainer_id_idx on public.enrollments (trainer_id);

-- ---------------------------------------------------------------------------
-- payments (PAY-01, PAY-03). 학생 본인과 운영자만 읽는다(PM 결정 2026-11-21). 서버만 쓴다.
-- ---------------------------------------------------------------------------

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.users (id),
  product_id uuid not null references public.lesson_products (id),
  amount integer not null,
  method public.payments_method not null,
  pg_transaction_id text not null,
  status public.payments_status not null default 'paid',
  paid_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index payments_student_id_idx on public.payments (student_id);
create index payments_product_id_idx on public.payments (product_id);

-- ---------------------------------------------------------------------------
-- tickets (PAY-03, PAY-05, PAY-07, PAY-08, PLT-03, TRN-04)
-- 서버가 결제 당시 값(유형·횟수·가격·수수료율·유효기간)을 넣는다. DB는 값을 바꾸거나 채우지 않는다.
-- 클라이언트는 트레이너의 반 배정(group_class_id)만 고친다(팀장 결정 5).
-- ---------------------------------------------------------------------------

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments (id),
  product_id uuid not null references public.lesson_products (id),
  -- 결제 하나에 수강권은 최대 하나. 파일럿 무료면 없다(PLT-03).
  payment_id uuid unique references public.payments (id),
  lesson_type public.tickets_lesson_type not null,
  ticket_type public.tickets_ticket_type not null,
  total_sessions integer not null,
  remaining_sessions integer not null,
  price_paid integer not null,
  -- 결제 당시 수수료율. 파일럿 무료 수강권은 비워 둔다(팀장 결정 4). 서버가 넣은 값 그대로 저장한다.
  fee_rate numeric,
  valid_until date not null,
  group_class_id uuid references public.group_classes (id),
  status public.tickets_status not null default 'waiting_schedule',
  end_reason public.tickets_end_reason,
  created_at timestamptz not null default now(),
  -- erd 3장 수강권 값 (팀장 결정 3). 서버 insert에도 걸린다. 금액은 범위만 본다.
  constraint tickets_total_sessions_check check (total_sessions >= 1),
  constraint tickets_remaining_sessions_check check (
    remaining_sessions >= 0 and remaining_sessions <= total_sessions
  ),
  constraint tickets_price_paid_check check (price_paid >= 0),
  constraint tickets_single_total_sessions_check check (
    ticket_type <> 'single' or total_sessions = 1
  ),
  constraint tickets_end_reason_check check ((status = 'ended') = (end_reason is not null)),
  -- erd 4장: 반에 배정할 수 있는 것은 그룹 수강권
  constraint tickets_group_class_lesson_type_check check (
    group_class_id is null or lesson_type = 'group'
  )
);

create index tickets_enrollment_id_idx on public.tickets (enrollment_id);
create index tickets_product_id_idx on public.tickets (product_id);
create index tickets_group_class_id_idx on public.tickets (group_class_id);

-- ---------------------------------------------------------------------------
-- refund_requests (PAY-10, PAY-11). 학생이 만들고, processed로 바꾸는 것은 서버다.
-- ---------------------------------------------------------------------------

create table public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id),
  reason text,
  status public.refund_requests_status not null default 'requested',
  created_at timestamptz not null default now()
);

-- 팀장 결정 9: 수강권마다 처리 대기(requested) 요청은 하나까지. processed가 된 뒤에는 다시 요청할 수 있다.
create unique index refund_requests_requested_ticket_id_key
  on public.refund_requests (ticket_id)
  where status = 'requested';

-- ---------------------------------------------------------------------------
-- refunds (PAY-09, PAY-11). 서버만 쓴다. 금액 규칙은 나중에 정한다(idea 결정 필요 2).
-- ---------------------------------------------------------------------------

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id),
  payment_id uuid not null references public.payments (id),
  -- 앱 요청 없이 처리하면 없다(PAY-11)
  refund_request_id uuid references public.refund_requests (id),
  sessions_canceled integer not null,
  amount integer not null,
  processed_by uuid not null references public.users (id),
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index refunds_ticket_id_idx on public.refunds (ticket_id);

-- ---------------------------------------------------------------------------
-- fee_policies (STL-03). 운영자만 읽고, 쓰기는 마이그레이션·서버만(팀장 결정 10).
-- id는 기준 데이터라 int 자동 증가(erd 1장 표기).
-- ---------------------------------------------------------------------------

create table public.fee_policies (
  id integer generated by default as identity primary key,
  source public.fee_policies_source not null,
  rate numeric not null,
  effective_from date not null,
  created_at timestamptz not null default now(),
  constraint fee_policies_source_effective_from_key unique (source, effective_from)
);

-- 결정 로그 2026-11-19: 트레이너 링크 유입 8%. 운영 DB에도 필요하므로 마이그레이션에 넣는다.
-- effective_from은 결정일이다. marketplace는 비율이 정해질 때까지 넣지 않는다(idea 결정 필요 4, seed에만 더미).
insert into public.fee_policies (source, rate, effective_from)
values ('trainer_link', 0.08, '2026-11-19');

-- ---------------------------------------------------------------------------
-- 판정 함수 (RLS를 거치지 않고 읽는다. 정책끼리 서로 부르지 않게 한다)
-- ---------------------------------------------------------------------------

-- [ADM-02, 결정 로그 2026-11-19] 수강 관계가 있다: 로그인한 학생이 그 트레이너와 enrollments가 있다.
-- 수강권이 모두 끝나도(ended) 수강 관계는 남는다. 정지 트레이너의 프로필 공개 범위에 쓴다.
create function private.has_enrollment_with(target_trainer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.enrollments e
    where e.student_id = auth.uid()
      and e.trainer_id = target_trainer_id
  )
$$;

-- [AUTH-09, 결정 로그 2026-11-20] 자기 학생: 로그인한 트레이너의 tickets 중 status가
-- waiting_schedule 또는 active인 것이 있는 학생. 트레이너가 학생의 user_private_profiles를 읽는 기준이다.
create function private.is_own_student(target_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.enrollments e
    join public.tickets t on t.enrollment_id = e.id
    where e.trainer_id = auth.uid()
      and e.student_id = target_student_id
      and t.status in ('waiting_schedule', 'active')
  )
$$;

-- 로그인한 사용자가 그 수강 관계의 학생이나 트레이너인가 (PAY-03, ATT-05: 수강권 읽기)
create function private.is_enrollment_member(target_enrollment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.enrollments e
    where e.id = target_enrollment_id
      and (e.student_id = auth.uid() or e.trainer_id = auth.uid())
  )
$$;

-- 수강 관계의 트레이너 (수강권 무결성 검사, 반 배정 권한)
create function private.enrollment_trainer_id(target_enrollment_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.trainer_id from public.enrollments e where e.id = target_enrollment_id
$$;

-- 수강 관계의 학생 (반 정원 검사)
create function private.enrollment_student_id(target_enrollment_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.student_id from public.enrollments e where e.id = target_enrollment_id
$$;

-- 상품의 트레이너 (수강권 무결성 검사)
create function private.lesson_product_trainer_id(target_product_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.trainer_id from public.lesson_products p where p.id = target_product_id
$$;

-- 그룹 반의 트레이너 (수강권 무결성 검사)
create function private.group_class_trainer_id(target_group_class_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select g.trainer_id from public.group_classes g where g.id = target_group_class_id
$$;

-- [TRN-04, 팀장 결정 7] 로그인한 학생이 그 반에 배정된 수강권을 가지고 있는가 (반 읽기)
create function private.is_assigned_to_group_class(target_group_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tickets t
    join public.enrollments e on e.id = t.enrollment_id
    where t.group_class_id = target_group_class_id
      and e.student_id = auth.uid()
  )
$$;

-- [TRN-04, PAY-07, 팀장 결정 6] 반에 끝나지 않은 수강권으로 배정된 서로 다른 학생 수.
-- excluded_student_id는 세지 않는다(같은 학생의 재결제 수강권을 배정할 때 그 학생을 빼고 센다).
-- 반 행을 잠가서 동시에 배정·정원 변경이 일어나도 정원을 넘지 않게 한다(그래서 volatile).
create function private.group_class_student_count(
  target_group_class_id uuid,
  excluded_student_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  student_count integer;
begin
  perform 1 from public.group_classes g where g.id = target_group_class_id for no key update;

  select count(distinct e.student_id)::integer
  into student_count
  from public.tickets t
  join public.enrollments e on e.id = t.enrollment_id
  where t.group_class_id = target_group_class_id
    and t.status <> 'ended'
    and e.student_id is distinct from excluded_student_id;

  return student_count;
end
$$;

-- [PAY-10, PM 결정 2026-11-21] 로그인한 학생이 환불을 요청할 수 있는 수강권인가:
-- 자기 수강권 중 결제한(payment_id 있음) waiting_schedule·active 수강권. 파일럿 무료·끝난 수강권은 안 된다.
-- 기준이 바뀌면(idea 결정 필요 2) 새 마이그레이션에서 이 함수만 create or replace 한다.
create function private.can_request_refund(target_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tickets t
    join public.enrollments e on e.id = t.enrollment_id
    where t.id = target_ticket_id
      and e.student_id = auth.uid()
      and t.payment_id is not null
      and t.status in ('waiting_schedule', 'active')
  )
$$;

-- ---------------------------------------------------------------------------
-- 트리거 (클라이언트·서버 모두에 걸리는 무결성 검사. 값은 바꾸지 않는다)
-- ---------------------------------------------------------------------------

-- TRN-03: 상품의 trainer_id는 만든 뒤 바꿀 수 없다. 서버도 마찬가지다(수강권 무결성이 기대한다).
create function private.lesson_products_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.trainer_id is distinct from old.trainer_id then
    raise exception 'lesson_products.trainer_id는 바꿀 수 없다'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger lesson_products_before_update
before update on public.lesson_products
for each row execute function private.lesson_products_before_update();

-- TRN-04: 반의 trainer_id는 바꿀 수 없고, 정원은 배정된 학생 수보다 작게 줄일 수 없다(팀장 결정 6).
create function private.group_classes_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.trainer_id is distinct from old.trainer_id then
    raise exception 'group_classes.trainer_id는 바꿀 수 없다'
      using errcode = 'insufficient_privilege';
  end if;

  if new.capacity < old.capacity
    and private.group_class_student_count(new.id, null) > new.capacity
  then
    raise exception '정원을 배정된 학생 수보다 작게 줄일 수 없다'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger group_classes_before_update
before update on public.group_classes
for each row execute function private.group_classes_before_update();

-- 수강권 무결성 (erd 3·4장, 팀장 결정 3·5·6). 서버와 클라이언트 모두에 걸린다.
--   - 상품·그룹 반은 그 수강 관계의 트레이너 것이다.
--   - 반 배정이 바뀌면(배정·이동): 끝난 수강권은 새로 배정하지 않는다. 끝나지 않은 수강권은 정원을 넘지 않는다.
--     정원은 서로 다른 학생 수로 센다(같은 학생의 다른 수강권이 이미 있으면 자리를 더 쓰지 않는다).
--   - 서버가 끝난 수강권을 반과 함께 넣는 것(과거 기록)은 막지 않는다.
create function private.tickets_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ticket_trainer_id uuid := private.enrollment_trainer_id(new.enrollment_id);
  class_changed boolean := new.group_class_id is not null
    and (tg_op = 'INSERT' or new.group_class_id is distinct from old.group_class_id);
  class_capacity integer;
begin
  if tg_op = 'INSERT'
    or new.enrollment_id is distinct from old.enrollment_id
    or new.product_id is distinct from old.product_id
  then
    if private.lesson_product_trainer_id(new.product_id) is distinct from ticket_trainer_id then
      raise exception '수강권의 상품은 그 수강 관계의 트레이너 것이어야 한다'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.group_class_id is not null
    and (class_changed or new.enrollment_id is distinct from old.enrollment_id)
    and private.group_class_trainer_id(new.group_class_id) is distinct from ticket_trainer_id
  then
    raise exception '수강권의 그룹 반은 그 수강 관계의 트레이너 것이어야 한다'
      using errcode = 'check_violation';
  end if;

  if class_changed and tg_op = 'UPDATE' and new.status = 'ended' then
    raise exception '끝난 수강권은 반에 배정할 수 없다'
      using errcode = 'check_violation';
  end if;

  if class_changed and new.status <> 'ended' then
    -- 반 행을 잠근 뒤 센다(group_class_student_count). 정원은 그 뒤에 읽는다.
    if private.group_class_student_count(
      new.group_class_id,
      private.enrollment_student_id(new.enrollment_id)
    ) >= (
      select g.capacity from public.group_classes g where g.id = new.group_class_id
    ) then
      raise exception '반의 정원이 찼다'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end
$$;

create trigger tickets_before_write
before insert or update on public.tickets
for each row execute function private.tickets_before_write();

-- ---------------------------------------------------------------------------
-- 함수 실행 권한
-- ---------------------------------------------------------------------------

-- 기존 규칙: 그 함수를 부르는 정책·트리거가 쓰는 역할에만 준다. anon은 공개 프로필 판정만 쓴다.
-- 트리거 함수는 아무 역할에도 주지 않는다.
revoke all on function
  private.has_enrollment_with(uuid),
  private.is_own_student(uuid),
  private.is_enrollment_member(uuid),
  private.enrollment_trainer_id(uuid),
  private.enrollment_student_id(uuid),
  private.lesson_product_trainer_id(uuid),
  private.group_class_trainer_id(uuid),
  private.is_assigned_to_group_class(uuid),
  private.group_class_student_count(uuid, uuid),
  private.can_request_refund(uuid),
  private.lesson_products_before_update(),
  private.group_classes_before_update(),
  private.tickets_before_write()
from public, anon, authenticated, service_role;

grant execute on function
  private.has_enrollment_with(uuid),
  private.is_own_student(uuid),
  private.is_enrollment_member(uuid),
  private.enrollment_trainer_id(uuid),
  private.enrollment_student_id(uuid),
  private.lesson_product_trainer_id(uuid),
  private.group_class_trainer_id(uuid),
  private.is_assigned_to_group_class(uuid),
  private.group_class_student_count(uuid, uuid),
  private.can_request_refund(uuid)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS 켜기
-- ---------------------------------------------------------------------------

alter table public.lesson_products enable row level security;
alter table public.group_classes enable row level security;
alter table public.enrollments enable row level security;
alter table public.payments enable row level security;
alter table public.tickets enable row level security;
alter table public.refund_requests enable row level security;
alter table public.refunds enable row level security;
alter table public.fee_policies enable row level security;

-- ---------------------------------------------------------------------------
-- 권한: 기본 권한을 모두 회수한 뒤 필요한 것만 준다.
-- ---------------------------------------------------------------------------

revoke all on table
  public.lesson_products,
  public.group_classes,
  public.enrollments,
  public.payments,
  public.tickets,
  public.refund_requests,
  public.refunds,
  public.fee_policies
from anon, authenticated;

-- lesson_products -----------------------------------------------------------
grant select on public.lesson_products to anon, authenticated;
-- TRN-03: 트레이너가 만들고 고친다. trainer_id는 만들 때만. 지우기 권한은 없다(팀장 결정 1).
grant insert (trainer_id, lesson_type, ticket_type, session_count, price, duration_min, active)
  on public.lesson_products to authenticated;
grant update (lesson_type, ticket_type, session_count, price, duration_min, active)
  on public.lesson_products to authenticated;

-- 판매 중(active) 상품은 그 트레이너의 프로필을 읽을 수 있는 사람이 읽는다. trainer_profiles의 RLS를 그대로 거친다:
-- approved(listed 무관), 정지 트레이너는 수강 관계 학생(ADM-02, 팀장 결정 7). 비활성 상품은 본인·운영자만.
create policy lesson_products_select_anon on public.lesson_products
for select to anon
using (
  active
  and exists (
    select 1 from public.trainer_profiles tp where tp.user_id = lesson_products.trainer_id
  )
);

create policy lesson_products_select on public.lesson_products
for select to authenticated
using (
  trainer_id = (select auth.uid())
  or (select private.is_admin())
  or (
    active
    and exists (
      select 1 from public.trainer_profiles tp where tp.user_id = lesson_products.trainer_id
    )
  )
);

-- 트레이너 본인(pending·approved·suspended)이 만든다. 탈퇴하면 못 한다(AUTH-07).
create policy lesson_products_insert_own on public.lesson_products
for insert to authenticated
with check (
  trainer_id = (select auth.uid())
  and private.user_role((select auth.uid())) = 'trainer'
  and (select private.is_active_user((select auth.uid())))
);

create policy lesson_products_update_own on public.lesson_products
for update to authenticated
using (
  trainer_id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
)
with check (
  trainer_id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
);

-- group_classes -------------------------------------------------------------
grant select on public.group_classes to authenticated;
grant insert (trainer_id, name, capacity, duration_min) on public.group_classes to authenticated;
grant update (name, capacity, duration_min) on public.group_classes to authenticated;
-- 팀장 결정 8: 배정된 수강권이 있는 반은 tickets.group_class_id FK가 지우기를 막는다.
grant delete on public.group_classes to authenticated;

create policy group_classes_select on public.group_classes
for select to authenticated
using (
  trainer_id = (select auth.uid())
  or (select private.is_admin())
  or private.is_assigned_to_group_class(id)
);

create policy group_classes_insert_own on public.group_classes
for insert to authenticated
with check (
  trainer_id = (select auth.uid())
  and private.user_role((select auth.uid())) = 'trainer'
  and (select private.is_active_user((select auth.uid())))
);

create policy group_classes_update_own on public.group_classes
for update to authenticated
using (
  trainer_id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
)
with check (
  trainer_id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
);

create policy group_classes_delete_own on public.group_classes
for delete to authenticated
using (
  trainer_id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
);

-- enrollments ---------------------------------------------------------------
-- 클라이언트는 읽기만 한다. 만들기·고치기(source, pilot_free 포함)·지우기는 서버(PAY-04, PLT-02, MKT-06).
grant select on public.enrollments to authenticated;

create policy enrollments_select on public.enrollments
for select to authenticated
using (
  student_id = (select auth.uid())
  or trainer_id = (select auth.uid())
  or (select private.is_admin())
);

-- payments ------------------------------------------------------------------
-- 학생 본인과 운영자만 읽는다. 트레이너는 tickets.price_paid로 본다(PM 결정 2026-11-21). 쓰기는 서버.
grant select on public.payments to authenticated;

create policy payments_select on public.payments
for select to authenticated
using (student_id = (select auth.uid()) or (select private.is_admin()));

-- tickets -------------------------------------------------------------------
grant select on public.tickets to authenticated;
-- 팀장 결정 5: 클라이언트가 고치는 컬럼은 반 배정뿐이다. 차감·상태·금액은 서버가 쓴다.
grant update (group_class_id) on public.tickets to authenticated;

create policy tickets_select on public.tickets
for select to authenticated
using (private.is_enrollment_member(enrollment_id) or (select private.is_admin()));

-- TRN-04: 그 수강 관계의 트레이너가 반을 배정한다. 반·유형·끝남·정원 검사는 tickets_before_write와 제약이 한다.
create policy tickets_update_trainer on public.tickets
for update to authenticated
using (
  private.enrollment_trainer_id(enrollment_id) = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
)
with check (
  private.enrollment_trainer_id(enrollment_id) = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
);

-- refund_requests -----------------------------------------------------------
grant select on public.refund_requests to authenticated;
-- PAY-10: 학생이 수강권과 사유만 넣는다. status는 기본값(requested)이고 processed는 서버가 바꾼다.
grant insert (ticket_id, reason) on public.refund_requests to authenticated;

-- 그 수강권을 읽을 수 있는 사람(학생, 그 트레이너, 운영자)이 읽는다. tickets의 RLS를 그대로 거친다.
create policy refund_requests_select on public.refund_requests
for select to authenticated
using (
  exists (select 1 from public.tickets t where t.id = refund_requests.ticket_id)
);

create policy refund_requests_insert_own on public.refund_requests
for insert to authenticated
with check (
  status = 'requested'
  and private.can_request_refund(ticket_id)
  and (select private.is_active_user((select auth.uid())))
);

-- refunds -------------------------------------------------------------------
-- PAY-11: 서버만 쓴다. 학생, 그 수강권의 트레이너, 운영자가 읽는다.
grant select on public.refunds to authenticated;

create policy refunds_select on public.refunds
for select to authenticated
using (
  exists (select 1 from public.tickets t where t.id = refunds.ticket_id)
);

-- fee_policies --------------------------------------------------------------
-- 팀장 결정 10: 운영자만 읽고, 쓰기는 마이그레이션·서버만.
grant select on public.fee_policies to authenticated;

create policy fee_policies_select_admin on public.fee_policies
for select to authenticated
using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- #10에서 넘어온 정책
-- ---------------------------------------------------------------------------

-- ADM-02(결정 로그 2026-11-19): 정지 트레이너의 프로필은 본인, 운영자, 수강 관계가 있는 학생이 읽는다.
-- 수강 관계 판정은 private.has_enrollment_with() 하나에 둔다. trainer_genres_select와
-- lesson_products_select는 이 정책을 거쳐 같은 기준을 따른다.
alter policy trainer_profiles_select on public.trainer_profiles
using (
  private.trainer_profile_is_public(approval_status)
  or user_id = (select auth.uid())
  or (select private.is_admin())
  or (approval_status = 'suspended' and private.has_enrollment_with(user_id))
);

-- AUTH-09(결정 로그 2026-11-20): 트레이너는 자기 학생의 실명·생년월일·휴대폰을 읽는다.
-- 자기 학생 판정은 private.is_own_student() 하나에 둔다. user_account_records는 그대로(본인·운영자만).
alter policy user_private_profiles_select on public.user_private_profiles
using (
  user_id = (select auth.uid())
  or (select private.is_admin())
  or private.is_own_student(user_id)
);
