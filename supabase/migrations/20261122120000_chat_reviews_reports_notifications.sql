-- 묶음 6: 채팅·후기·신고·알림 (docs/erd.md 7·8장, 이슈 #41)
--
-- 만드는 것: chat_rooms, chat_members, messages, reviews, review_replies, blocks, reports, push_tokens,
--           notifications (+ enum 7개, 제약, 무결성 트리거, RLS, private 판정 함수)
-- 쓰기 경로 (이슈 #41 팀장 결정 1, erd 7장 "쓰기 경로", 8장)
--   - 서버(service_role)가 쓴다: 채팅방 만들기, 참여 행 만들기·다시 들어오기·ticket_ended, 메시지 보내기,
--     후기 쓰기·고치기, 답글 쓰기, 기기 토큰, 알림 만들기.
--   - 클라이언트 직접: 자기 참여 행의 muted와 나가기(self), 트레이너의 내보내기(kicked), 트레이너(자기 단체 채팅방)·
--     운영자의 메시지 가리기, 작성자의 후기 지우기, 운영자의 후기 가리기, 차단하기, 신고하기, 운영자의 신고 처리,
--     자기 알림 읽음. 모두 탈퇴하지 않은 사용자만(private.is_active_user, AUTH-07). 정지 트레이너는 막지 않는다
--     (팀장 결정 7, erd 7장).
--   - 고치거나 지우지 않는 것(팀장 결정 6): 메시지 수정·삭제, 가리기 되돌리기, 답글 수정·삭제, 차단 해제, 신고 철회,
--     알림 삭제. 후기를 지우면 답글도 지워진다(FK on delete cascade).
-- 만들지 않는 것 (erd 10장 "7·8장 서버 함수 이슈에서 정할 것")
--   - 서버 함수: 1:1 대화를 열 수 있는 사이·차단 판정(DM-01~03, DM-05), 금칙어 필터(NFR-02),
--     답글 쓴 사람 검사(REV-06: review_replies에 쓴 사람 컬럼이 없어 DB가 검사할 수 없다), 단체 채팅방 만들기 시점,
--     다시 들어오는 조건, 탈퇴 사용자 처리. 푸시 발송, Realtime 구독, 채팅 사진 저장소.
--   - 알림 type 값 목록과 payload 형식: DB는 비어 있지 않은 문자열·JSON만 본다.
--
-- 권한 원칙은 20261121210000·20261122090000 머리말과 같다. 판정은 private 함수(security definer, search_path '',
-- 정책이 쓰는 함수만 authenticated·service_role에 실행 권한, 트리거 함수는 아무 역할에도 없음)에 둔다.
-- 수강권 판정은 기존 함수(enrollment_student_id, enrollment_trainer_id)를 다시 쓰고 enrollments를 직접 읽지 않는다.
-- 후기·답글 읽기는 trainer_genres_select처럼 trainer_profiles 읽기 정책을 거쳐 정지 트레이너 기준까지 같게 따른다.
-- 클라이언트 insert가 있는 blocks·reports는 #38처럼 <테이블>_authorize_insert 트리거가 무결성 트리거보다 먼저 돈다.

-- ---------------------------------------------------------------------------
-- enum. 이름은 "<테이블>_<컬럼>", 값은 erd 7·8장과 packages/shared/src/domain.ts와 같다.
-- ---------------------------------------------------------------------------

create type public.chat_rooms_type as enum ('group', 'direct');
create type public.chat_members_member_role as enum ('admin', 'member');
create type public.chat_members_left_reason as enum ('self', 'kicked', 'ticket_ended');
create type public.messages_kind as enum ('text', 'image');
create type public.reports_target_type as enum ('message', 'review', 'user');
create type public.reports_status as enum ('open', 'resolved');
create type public.push_tokens_platform as enum ('ios', 'android');

-- ---------------------------------------------------------------------------
-- chat_rooms (CHAT-01, DM-01). 단체 채팅방은 트레이너당 하나, 1:1 대화는 trainer_id가 없다.
-- ---------------------------------------------------------------------------

create table public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  type public.chat_rooms_type not null,
  trainer_id uuid references public.trainer_profiles (user_id),
  created_at timestamptz not null default now(),
  -- CHAT-01: 단체 채팅방은 트레이너마다 하나 (1:1 대화는 trainer_id가 비어 있어 걸리지 않는다)
  constraint chat_rooms_trainer_id_key unique (trainer_id),
  -- CHAT-01, DM-01: 단체 채팅방이면 trainer_id가 있고, 1:1 대화면 없다
  constraint chat_rooms_trainer_id_check check ((type = 'group') = (trainer_id is not null))
);

-- ---------------------------------------------------------------------------
-- chat_members (CHAT-02, CHAT-03, CHAT-06, CHAT-08, DM-06). (방, 사용자)마다 한 줄.
-- 다시 들어오면 서버가 그 줄의 joined_at을 새로 쓰고 left_at·left_reason을 비운다(erd 7장).
-- ---------------------------------------------------------------------------

create table public.chat_members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms (id),
  user_id uuid not null references public.users (id),
  member_role public.chat_members_member_role not null default 'member',
  muted boolean not null default false,
  -- CHAT-03: 메시지 읽기 범위의 기준. 서버가 넣은 값을 그대로 저장한다(기본값만 now()).
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  left_reason public.chat_members_left_reason,
  created_at timestamptz not null default now(),
  constraint chat_members_room_id_user_id_key unique (room_id, user_id),
  -- CHAT-03: 나간 이유는 나갔을 때만 있고, 나갔으면 반드시 있다
  constraint chat_members_left_reason_check check ((left_at is null) = (left_reason is null))
);

create index chat_members_user_id_idx on public.chat_members (user_id);

-- ---------------------------------------------------------------------------
-- messages (CHAT-04, CHAT-05, CHAT-06, DM-04). 텍스트·사진만. 고치거나 지우지 않는다.
-- ---------------------------------------------------------------------------

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.chat_rooms (id),
  sender_id uuid not null references public.users (id),
  kind public.messages_kind not null,
  body text,
  -- 저장 위치와 권한은 서버 함수 이슈에서 정한다(erd 10장). DB는 값이 있는지만 본다.
  image_url text,
  hidden_by uuid references public.users (id),
  -- CHAT-03: 메시지 읽기 범위의 기준. 서버가 넣은 값을 그대로 저장한다(기본값만 now()).
  created_at timestamptz not null default now(),
  -- CHAT-05, DM-04: 텍스트는 본문이 있고 사진 주소가 없다. 사진은 사진 주소가 있다.
  constraint messages_kind_check check (
    (kind = 'text' and body is not null and body <> '' and image_url is null)
    or (kind = 'image' and image_url is not null and image_url <> '')
  )
);

create index messages_room_id_created_at_idx on public.messages (room_id, created_at);
create index messages_sender_id_idx on public.messages (sender_id);

-- ---------------------------------------------------------------------------
-- reviews (REV-01~REV-05). 수강권마다 하나. 별점 없음.
-- ---------------------------------------------------------------------------

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.trainer_profiles (user_id),
  student_id uuid not null references public.users (id),
  ticket_id uuid not null references public.tickets (id),
  body text not null,
  hidden boolean not null default false,
  -- REV-04: DB가 넣는다(reviews_set_updated_at). 고친 적 없으면 비어 있다.
  updated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reviews_ticket_id_key unique (ticket_id),
  constraint reviews_body_check check (body <> '')
);

create index reviews_trainer_id_idx on public.reviews (trainer_id);
create index reviews_student_id_idx on public.reviews (student_id);

-- ---------------------------------------------------------------------------
-- review_replies (REV-06). 후기마다 하나(review_id가 PK). 후기를 지우면 함께 지워진다.
-- 그 후기의 트레이너만 쓰는지는 답글 쓰기 서버 함수가 지킨다(erd 7장 DB 제약, 10장).
-- ---------------------------------------------------------------------------

create table public.review_replies (
  review_id uuid primary key references public.reviews (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint review_replies_body_check check (body <> '')
);

-- ---------------------------------------------------------------------------
-- blocks (CHAT-07, DM-05). 차단 해제 없음.
-- ---------------------------------------------------------------------------

create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.users (id),
  blocked_id uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  constraint blocks_blocker_id_blocked_id_key unique (blocker_id, blocked_id),
  constraint blocks_not_self_check check (blocker_id <> blocked_id)
);

create index blocks_blocked_id_idx on public.blocks (blocked_id);

-- ---------------------------------------------------------------------------
-- reports (CHAT-07, DM-05, DM-07, REV-05, ADM-04). 대상은 메시지·후기·사용자(target_id는 FK가 아니다).
-- ---------------------------------------------------------------------------

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.users (id),
  target_type public.reports_target_type not null,
  target_id uuid not null,
  reason text not null,
  status public.reports_status not null default 'open',
  handled_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  constraint reports_reason_check check (reason <> ''),
  -- ADM-04: 처리한 신고에는 처리한 운영자가 있다(운영자인지는 트리거가 본다)
  constraint reports_handled_by_check check (status <> 'resolved' or handled_by is not null)
);

-- CHAT-07: 같은 사람이 같은 대상에 처리 대기 신고를 둘 내지 않는다(처리된 뒤 다시 신고는 된다)
create unique index reports_open_reporter_target_key
  on public.reports (reporter_id, target_type, target_id)
  where status = 'open';
create index reports_target_idx on public.reports (target_type, target_id);

-- ---------------------------------------------------------------------------
-- push_tokens (NOTI-01). 서버만 쓴다. 한 기기 토큰은 한 줄.
-- ---------------------------------------------------------------------------

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id),
  token text not null,
  platform public.push_tokens_platform not null,
  created_at timestamptz not null default now(),
  constraint push_tokens_token_key unique (token),
  constraint push_tokens_token_check check (token <> '')
);

create index push_tokens_user_id_idx on public.push_tokens (user_id);

-- ---------------------------------------------------------------------------
-- notifications (NOTI-02, C-06). 서버가 만든다. type은 enum이 아닌 문자열(값 목록은 알림 서버 함수 이슈).
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id),
  type text not null,
  -- 이동할 화면 정보. 형식은 알림 서버 함수 이슈에서 정한다(erd 10장).
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_type_check check (type <> '')
);

create index notifications_user_id_created_at_idx on public.notifications (user_id, created_at);

-- ---------------------------------------------------------------------------
-- 판정 함수 (RLS를 거치지 않고 읽는다. 정책끼리 서로 부르지 않게 한다)
-- ---------------------------------------------------------------------------

-- [CHAT-02, CHAT-04, DM-01] 로그인한 사용자가 그 방의 현재 참여자(left_at이 빈 줄)인가 (방·참여 행 읽기)
create function private.is_current_room_member(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chat_members m
    where m.room_id = target_room_id
      and m.user_id = auth.uid()
      and m.left_at is null
  )
$$;

-- [CHAT-03, CHAT-04, 팀장 결정 2] 로그인한 사용자가 그 방의 현재 참여자이면 참여 시각, 아니면 null.
-- 메시지는 자기 joined_at 이후의 것만 본다(나가면 null이라 아무것도 보지 않는다).
create function private.room_joined_at(target_room_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select m.joined_at
  from public.chat_members m
  where m.room_id = target_room_id
    and m.user_id = auth.uid()
    and m.left_at is null
$$;

-- [CHAT-06] 단체 채팅방의 트레이너. 1:1 대화(direct)와 없는 방은 null.
-- 내보내기·메시지 가리기 권한과 가린 메시지 읽기, 단체 채팅방인지 판정에 쓴다.
create function private.room_group_trainer_id(target_room_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.trainer_id from public.chat_rooms r where r.id = target_room_id and r.type = 'group'
$$;

-- [ADM-07, 결정 로그 2026-11-22] 그 방에 신고(target_type = message)된 메시지가 있는가.
-- 운영자는 이런 방(단체·1:1)의 방·참여자·메시지만 본다. 처리된 신고도 센다.
create function private.room_has_reported_message(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.reports r
    join public.messages m on m.id = r.target_id
    where r.target_type = 'message'
      and m.room_id = target_room_id
  )
$$;

-- [CHAT-07, DM-05] 로그인한 사용자가 그 사람을 차단했는가. 차단한 사람에게 차단당한 사람의 메시지를 숨긴다.
create function private.has_blocked(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.blocks b
    where b.blocker_id = auth.uid()
      and b.blocked_id = target_user_id
  )
$$;

-- ---------------------------------------------------------------------------
-- 트리거 (클라이언트·서버 모두에 걸리는 무결성 검사, erd 7장 "DB 제약", 팀장 결정 4)
-- 검사는 쓰는 사람의 RLS와 관계없이 같아야 하므로 security definer로 읽는다(아무 역할에도 실행 권한을 주지 않는다).
-- reviews_set_updated_at만 값을 채운다(REV-04).
-- ---------------------------------------------------------------------------

-- 참여 행 (CHAT-02, CHAT-03, CHAT-06, DM-01, DM-03, 팀장 결정 3·4)
--   - 단체 채팅방: 그 방의 트레이너는 admin, 나머지는 학생(role = student)이고 member다. 나간 줄에도 건다.
--     들어오는(다시 들어오는) 학생은 그 트레이너의
--     끝나지 않은(waiting_schedule·active) 수강권이 있다. 처음부터 나간 줄(left_at 있음)로 넣는 것과
--     나가기·알림 끄기에는 수강권 검사를 하지 않는다.
--   - 1:1 대화: 모두 member, 서로 다른 두 사람까지, 같은 두 사람의 1:1 대화는 하나.
--   동시에 넣어도 두 사람을 넘지 않게 방 행을, 같은 두 사람의 대화가 둘 생기지 않게 두 사람 쌍을 잠근다.
create function private.chat_members_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_type public.chat_rooms_type;
  room_trainer_id uuid;
  entering boolean := new.left_at is null and (tg_op = 'INSERT' or old.left_at is not null);
  other_user_id uuid;
  other_count integer;
begin
  select r.type, r.trainer_id into room_type, room_trainer_id
  from public.chat_rooms r
  where r.id = new.room_id
  for no key update;

  -- 없는 방은 FK가 막는다
  if room_type is null then
    return new;
  end if;

  if room_type = 'group' then
    if new.user_id = room_trainer_id then
      if new.member_role <> 'admin' then
        raise exception '단체 채팅방의 트레이너는 admin이다'
          using errcode = 'check_violation';
      end if;
      return new;
    end if;

    if new.member_role <> 'member' then
      raise exception '단체 채팅방의 admin은 그 방의 트레이너뿐이다'
        using errcode = 'check_violation';
    end if;

    -- 그 방의 트레이너가 아닌 참여자는 학생이다. 나간 줄(left_at 있음)에도 건다(다른 트레이너·운영자 불가).
    if private.user_role(new.user_id) is distinct from 'student' then
      raise exception '단체 채팅방의 참여자는 그 방의 트레이너와 학생뿐이다'
        using errcode = 'check_violation';
    end if;

    -- 상품의 트레이너는 수강 관계의 트레이너와 같다(tickets_before_write). 상품으로 좁혀 찾는다.
    if entering and not exists (
      select 1
      from public.lesson_products p
      join public.tickets t on t.product_id = p.id
      where p.trainer_id = room_trainer_id
        and t.status in ('waiting_schedule', 'active')
        and private.enrollment_trainer_id(t.enrollment_id) = room_trainer_id
        and private.enrollment_student_id(t.enrollment_id) = new.user_id
    ) then
      raise exception '단체 채팅방에 들어오는 학생은 그 트레이너의 끝나지 않은 수강권이 있어야 한다'
        using errcode = 'check_violation';
    end if;

    return new;
  end if;

  -- 1:1 대화
  if new.member_role <> 'member' then
    raise exception '1:1 대화의 두 사람은 member다'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE'
    and new.room_id = old.room_id
    and new.user_id = old.user_id
  then
    return new;
  end if;

  select count(*)::integer, min(m.user_id::text)::uuid
  into other_count, other_user_id
  from public.chat_members m
  where m.room_id = new.room_id
    and m.user_id <> new.user_id;

  if other_count >= 2 then
    raise exception '1:1 대화는 두 사람까지다'
      using errcode = 'check_violation';
  end if;

  if other_count = 1 then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'chat_members:direct:'
          || least(new.user_id, other_user_id)::text
          || ':'
          || greatest(new.user_id, other_user_id)::text,
        0
      )
    );
    if exists (
      select 1
      from public.chat_rooms r
      join public.chat_members a on a.room_id = r.id and a.user_id = new.user_id
      join public.chat_members b on b.room_id = r.id and b.user_id = other_user_id
      where r.type = 'direct'
        and r.id <> new.room_id
    ) then
      raise exception '같은 두 사람의 1:1 대화는 하나다'
        using errcode = 'unique_violation';
    end if;
  end if;

  return new;
end
$$;

create trigger chat_members_before_write
before insert or update of room_id, user_id, member_role, left_at on public.chat_members
for each row execute function private.chat_members_before_write();

-- 메시지 (CHAT-02, CHAT-03, CHAT-06, DM-01, ADM-04, 팀장 결정 4)
--   - 보내는 사람은 그 방의 현재 참여자다(보낼 때만 본다).
--   - 가린 사람(hidden_by)은 그 단체 채팅방의 트레이너나 운영자다. 1:1 대화는 운영자만.
--   클라이언트의 가리기에서는 정책이 먼저 행을 거르고, hidden_by가 자기 자신인지는 정책 with check가 본다.
create function private.messages_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
    or new.room_id is distinct from old.room_id
    or new.sender_id is distinct from old.sender_id
  then
    if not exists (
      select 1
      from public.chat_members m
      where m.room_id = new.room_id
        and m.user_id = new.sender_id
        and m.left_at is null
    ) then
      raise exception '메시지는 그 방의 현재 참여자가 보낸다'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.hidden_by is not null
    and (tg_op = 'INSERT' or new.hidden_by is distinct from old.hidden_by)
    and private.user_role(new.hidden_by) is distinct from 'admin'
    and new.hidden_by is distinct from private.room_group_trainer_id(new.room_id)
  then
    raise exception '메시지는 그 단체 채팅방의 트레이너나 운영자가 가린다'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

create trigger messages_before_write
before insert or update of room_id, sender_id, hidden_by on public.messages
for each row execute function private.messages_before_write();

-- 후기 (REV-02, 팀장 결정 4): trainer_id·student_id는 그 수강권의 트레이너·학생이고, 그 수강권에
-- 출석(present)이나 보강(makeup) 참여 행이 있다. 본문만 고칠 때는 다시 보지 않는다(출결 수정과 무관하게 남는다).
create function private.reviews_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ticket_enrollment_id uuid;
begin
  select t.enrollment_id into ticket_enrollment_id
  from public.tickets t
  where t.id = new.ticket_id;

  -- 없는 수강권은 FK가 막는다
  if ticket_enrollment_id is null then
    return new;
  end if;

  if private.enrollment_trainer_id(ticket_enrollment_id) is distinct from new.trainer_id
    or private.enrollment_student_id(ticket_enrollment_id) is distinct from new.student_id
  then
    raise exception '후기의 트레이너·학생은 그 수강권의 트레이너·학생이어야 한다'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1
    from public.session_attendees a
    where a.ticket_id = new.ticket_id
      and a.attendance in ('present', 'makeup')
  ) then
    raise exception '후기는 그 수강권으로 출석이나 보강이 1회 이상 있어야 쓴다'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

create trigger reviews_before_write
before insert or update of trainer_id, student_id, ticket_id on public.reviews
for each row execute function private.reviews_before_write();

-- [REV-04] updated_at은 DB가 넣는다. 처음 쓸 때는 비우고, 본문이 바뀔 때만 지금 시각으로 바꾼다.
-- 운영자의 가리기(hidden)는 후기를 고친 것이 아니라 그대로 둔다. 서버가 준 값은 쓰지 않는다.
create function private.reviews_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.updated_at := null;
  elsif new.body is distinct from old.body then
    new.updated_at := pg_catalog.now();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end
$$;

create trigger reviews_set_updated_at
before insert or update on public.reviews
for each row execute function private.reviews_set_updated_at();

-- 신고 (CHAT-07, DM-05, REV-05, ADM-04, 팀장 결정 4·8)
--   - 대상이 있고, 자기 자신·자기 메시지·자기 후기는 신고하지 않는다.
--   - handled_by는 운영자다.
--   신고한 사람이 그 대상을 볼 수 있는지는 클라이언트 insert에서 authorize_client_insert가 먼저 본다(#38).
create function private.reports_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_owner_id uuid;
begin
  if tg_op = 'INSERT'
    or new.reporter_id is distinct from old.reporter_id
    or new.target_type is distinct from old.target_type
    or new.target_id is distinct from old.target_id
  then
    if new.target_type = 'message' then
      select m.sender_id into target_owner_id from public.messages m where m.id = new.target_id;
    elsif new.target_type = 'review' then
      select r.student_id into target_owner_id from public.reviews r where r.id = new.target_id;
    else
      select u.id into target_owner_id from public.users u where u.id = new.target_id;
    end if;

    if target_owner_id is null then
      raise exception '신고 대상이 없다'
        using errcode = 'check_violation';
    end if;

    if target_owner_id = new.reporter_id then
      raise exception '자기 자신과 자기 글은 신고하지 않는다'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.handled_by is not null
    and (tg_op = 'INSERT' or new.handled_by is distinct from old.handled_by)
    and private.user_role(new.handled_by) is distinct from 'admin'
  then
    raise exception '신고는 운영자가 처리한다'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

create trigger reports_before_write
before insert or update of reporter_id, target_type, target_id, handled_by on public.reports
for each row execute function private.reports_before_write();

-- ---------------------------------------------------------------------------
-- 클라이언트 insert 권한 판정 (#38). blocks·reports를 더한다. 판정은 각 insert 정책과 같다.
--   blocks   blocker_id = auth.uid() 그리고 활성 사용자 (blocks_insert_own)
--   reports  reporter_id = auth.uid() 그리고 활성 사용자 (reports_insert_own), 그리고 신고한 사람이
--            그 대상을 읽을 수 있다(팀장 결정 8). 대상 읽기는 이 함수가 security invoker라서 신고한 사람의
--            RLS(messages_select, reviews_select*, users_select)를 그대로 거친다. 읽을 수 없는 대상과 없는 대상은
--            RLS 거부와 같은 코드·문구(42501)로 막는다.
-- 기존 6개 테이블의 판정은 20261122090000과 같다.
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

-- 같은 시점 트리거는 이름순으로 돈다. <테이블>_authorize_insert가 <테이블>_before_write보다 앞이다.
create trigger blocks_authorize_insert
before insert on public.blocks
for each row execute function private.authorize_client_insert();

create trigger reports_authorize_insert
before insert on public.reports
for each row execute function private.authorize_client_insert();

-- ---------------------------------------------------------------------------
-- 함수 실행 권한
-- ---------------------------------------------------------------------------

-- 기존 규칙: 그 함수를 부르는 정책이 쓰는 역할에만 준다. 트리거 함수는 아무 역할에도 주지 않는다.
-- anon이 거치는 정책(후기·답글)은 private 함수를 부르지 않는다.
revoke all on function
  private.is_current_room_member(uuid),
  private.room_joined_at(uuid),
  private.room_group_trainer_id(uuid),
  private.room_has_reported_message(uuid),
  private.has_blocked(uuid),
  private.chat_members_before_write(),
  private.messages_before_write(),
  private.reviews_before_write(),
  private.reviews_set_updated_at(),
  private.reports_before_write(),
  private.authorize_client_insert()
from public, anon, authenticated, service_role;

grant execute on function
  private.is_current_room_member(uuid),
  private.room_joined_at(uuid),
  private.room_group_trainer_id(uuid),
  private.room_has_reported_message(uuid),
  private.has_blocked(uuid)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS 켜기
-- ---------------------------------------------------------------------------

alter table public.chat_rooms enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages enable row level security;
alter table public.reviews enable row level security;
alter table public.review_replies enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;
alter table public.push_tokens enable row level security;
alter table public.notifications enable row level security;

-- ---------------------------------------------------------------------------
-- 권한: 기본 권한을 모두 회수한 뒤 필요한 것만 준다.
-- ---------------------------------------------------------------------------

revoke all on table
  public.chat_rooms,
  public.chat_members,
  public.messages,
  public.reviews,
  public.review_replies,
  public.blocks,
  public.reports,
  public.push_tokens,
  public.notifications
from anon, authenticated;

-- chat_rooms ----------------------------------------------------------------
-- 팀장 결정 1: 만들기·고치기·지우기는 서버만.
grant select on public.chat_rooms to authenticated;

-- CHAT-04, DM-01, ADM-07: 그 방의 현재 참여자, 그리고 운영자는 신고된 메시지가 있는 방만.
create policy chat_rooms_select on public.chat_rooms
for select to authenticated
using (
  private.is_current_room_member(id)
  or ((select private.is_admin()) and private.room_has_reported_message(id))
);

-- chat_members --------------------------------------------------------------
grant select on public.chat_members to authenticated;
-- 팀장 결정 1·5: 클라이언트는 muted와 나가기·내보내기(left_at, left_reason)만. 참여 행 만들기·다시 들어오기·
-- 지우기와 joined_at·member_role은 서버.
grant update (muted, left_at, left_reason) on public.chat_members to authenticated;

-- CHAT-03, CHAT-04, ADM-07: 자기 참여 행(나간 뒤에도), 같은 방의 현재 참여자, 운영자는 신고된 메시지가 있는 방.
create policy chat_members_select on public.chat_members
for select to authenticated
using (
  user_id = (select auth.uid())
  or private.is_current_room_member(room_id)
  or ((select private.is_admin()) and private.room_has_reported_message(room_id))
);

-- CHAT-03, CHAT-08, DM-06, S-21, AUTH-07: 현재 참여자는 자기 알림을 끄고 켠다. 단체 채팅방의 학생(member)은
-- 스스로 나간다(self). 1:1 대화에는 나가기가 없고, 트레이너(admin)는 자기 단체 채팅방을 나가지 않는다.
-- 다시 참여 상태로 바꾸기와 ticket_ended는 서버만 한다(using이 나간 줄을 거르고, with check가 self만 받는다).
create policy chat_members_update_own on public.chat_members
for update to authenticated
using (
  user_id = (select auth.uid())
  and left_at is null
  and (select private.is_active_user((select auth.uid())))
)
with check (
  user_id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
  and (
    (left_at is null and left_reason is null)
    or (
      left_at is not null
      and left_reason = 'self'
      and member_role = 'member'
      and private.room_group_trainer_id(room_id) is not null
    )
  )
);

-- CHAT-06, ADM-02, AUTH-07: 트레이너는 자기 단체 채팅방의 다른 현재 참여자를 내보낸다(kicked). 정지 트레이너도
-- 내보내고(팀장 결정 7), 탈퇴한 트레이너는 못 한다. 다른 사람의 알림 설정은 바꾸지 못한다.
create policy chat_members_update_kick on public.chat_members
for update to authenticated
using (
  private.room_group_trainer_id(room_id) = (select auth.uid())
  and user_id <> (select auth.uid())
  and left_at is null
  and (select private.is_active_user((select auth.uid())))
)
with check (
  private.room_group_trainer_id(room_id) = (select auth.uid())
  and user_id <> (select auth.uid())
  and left_at is not null
  and left_reason = 'kicked'
  and (select private.is_active_user((select auth.uid())))
);

-- messages ------------------------------------------------------------------
grant select on public.messages to authenticated;
-- 팀장 결정 1·6: 보내기는 서버, 고치는 것은 가리기(hidden_by)뿐. 수정·삭제·가리기 되돌리기 없음.
grant update (hidden_by) on public.messages to authenticated;

-- CHAT-03, CHAT-04, CHAT-06, CHAT-07, DM-05, ADM-07 (팀장 결정 2, PM 질문 1 A):
--   - 현재 참여자가 자기 joined_at 이후의 메시지를 본다. 차단한 사람이 보낸 메시지는 보지 않는다.
--   - 가린 메시지는 그 단체 채팅방의 트레이너만 본다(1:1 대화의 가린 메시지는 참여자도 보지 않는다).
--   - 운영자는 신고된 메시지가 있는 방(단체·1:1)의 메시지를 모두 본다.
create policy messages_select on public.messages
for select to authenticated
using (
  (
    created_at >= private.room_joined_at(room_id)
    and (hidden_by is null or private.room_group_trainer_id(room_id) = (select auth.uid()))
    and not private.has_blocked(sender_id)
  )
  or ((select private.is_admin()) and private.room_has_reported_message(room_id))
);

-- CHAT-06, ADM-04, ADM-02, AUTH-07: 가리지 않은 메시지를 자기 이름(hidden_by = 자기 자신)으로 가린다.
-- 트레이너는 자기 단체 채팅방(현재 참여 중)의 메시지, 운영자는 읽을 수 있는(신고된 메시지가 있는) 방의 메시지.
create policy messages_update_hide on public.messages
for update to authenticated
using (
  hidden_by is null
  and (select private.is_active_user((select auth.uid())))
  and (
    (
      private.room_group_trainer_id(room_id) = (select auth.uid())
      and private.is_current_room_member(room_id)
    )
    or ((select private.is_admin()) and private.room_has_reported_message(room_id))
  )
)
with check (
  hidden_by = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
);

-- reviews -------------------------------------------------------------------
grant select on public.reviews to anon, authenticated;
-- 팀장 결정 1: 쓰기·고치기는 서버(금칙어 필터, NFR-02). 운영자는 가리기(hidden)만, 작성자는 지우기만.
grant update (hidden) on public.reviews to authenticated;
grant delete on public.reviews to authenticated;

-- REV-03, ADM-02: 가리지 않은 후기는 그 트레이너 프로필을 읽을 수 있는 사람(로그인하지 않은 사용자 포함)이 읽는다.
-- trainer_profiles 읽기 정책을 거쳐 정지 트레이너 기준(본인·운영자·수강 관계 학생)까지 같게 따른다.
create policy reviews_select on public.reviews
for select to anon, authenticated
using (
  not hidden
  and exists (
    select 1 from public.trainer_profiles tp where tp.user_id = reviews.trainer_id
  )
);

-- REV-05, ADM-04: 작성자는 자기 후기(가린 것 포함), 운영자는 전부 읽는다.
create policy reviews_select_author_admin on public.reviews
for select to authenticated
using (
  student_id = (select auth.uid())
  or (select private.is_admin())
);

-- REV-05, ADM-04, AUTH-07: 운영자는 가리지 않은 후기를 가린다. 되돌리기 없음.
create policy reviews_update_admin_hide on public.reviews
for update to authenticated
using (
  not hidden
  and (select private.is_admin())
  and (select private.is_active_user((select auth.uid())))
)
with check (
  hidden
  and (select private.is_admin())
  and (select private.is_active_user((select auth.uid())))
);

-- REV-04, AUTH-07: 작성자는 자기 후기를 지운다(답글도 함께 지워진다).
create policy reviews_delete_author on public.reviews
for delete to authenticated
using (
  student_id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
);

-- review_replies ------------------------------------------------------------
-- 팀장 결정 1·6: 답글 쓰기는 서버, 수정·삭제 없음(후기를 지우면 함께 지워진다).
grant select on public.review_replies to anon, authenticated;

-- REV-03, REV-05, REV-06: 그 후기를 읽을 수 있는 사람이 읽는다. reviews의 RLS를 그대로 거친다.
create policy review_replies_select on public.review_replies
for select to anon, authenticated
using (
  exists (select 1 from public.reviews r where r.id = review_replies.review_id)
);

-- blocks --------------------------------------------------------------------
grant select on public.blocks to authenticated;
-- 팀장 결정 6: 차단 해제·대상 바꾸기 없음.
grant insert (blocker_id, blocked_id) on public.blocks to authenticated;

-- CHAT-07, DM-05: 차단한 사람만 본다(차단당한 사람·운영자는 보지 않는다).
create policy blocks_select on public.blocks
for select to authenticated
using (blocker_id = (select auth.uid()));

-- CHAT-07, DM-05, AUTH-07: 자기 이름으로만. blocks_authorize_insert가 같은 기준으로 먼저 본다.
create policy blocks_insert_own on public.blocks
for insert to authenticated
with check (
  blocker_id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
);

-- reports -------------------------------------------------------------------
grant select on public.reports to authenticated;
-- 팀장 결정 1·6·8: 신고자는 대상·사유만 넣는다(상태는 open, 처리자는 비어 있다). 철회·사유 고치기 없음.
grant insert (reporter_id, target_type, target_id, reason) on public.reports to authenticated;
-- ADM-04: 운영자는 상태와 처리자만 고친다.
grant update (status, handled_by) on public.reports to authenticated;

-- CHAT-07, ADM-04: 신고한 사람과 운영자만 본다(신고된 사람·트레이너는 보지 않는다).
create policy reports_select on public.reports
for select to authenticated
using (
  reporter_id = (select auth.uid())
  or (select private.is_admin())
);

-- CHAT-07, DM-05, DM-07, REV-05, AUTH-07: 자기 이름으로 처리 대기 신고만. 대상을 읽을 수 있는지는
-- reports_authorize_insert, 대상이 자기 것인지는 reports_before_write가 본다.
create policy reports_insert_own on public.reports
for insert to authenticated
with check (
  reporter_id = (select auth.uid())
  and status = 'open'
  and handled_by is null
  and (select private.is_active_user((select auth.uid())))
);

-- ADM-04, AUTH-07: 운영자는 처리 대기 신고를 자기 이름으로 처리한다.
create policy reports_update_admin on public.reports
for update to authenticated
using (
  status = 'open'
  and (select private.is_admin())
  and (select private.is_active_user((select auth.uid())))
)
with check (
  status = 'resolved'
  and handled_by = (select auth.uid())
  and (select private.is_admin())
  and (select private.is_active_user((select auth.uid())))
);

-- push_tokens ---------------------------------------------------------------
-- NOTI-01: 서버만 쓴다(한 기기에서 다른 계정으로 로그인하면 이전 사용자의 줄을 정리해야 한다).
grant select on public.push_tokens to authenticated;

create policy push_tokens_select_own on public.push_tokens
for select to authenticated
using (user_id = (select auth.uid()));

-- notifications -------------------------------------------------------------
grant select on public.notifications to authenticated;
-- NOTI-02, C-06: 만들기는 서버, 받은 사람은 read_at만 채운다. 지우기 없음.
grant update (read_at) on public.notifications to authenticated;

create policy notifications_select_own on public.notifications
for select to authenticated
using (user_id = (select auth.uid()));

-- NOTI-02, C-06, AUTH-07: 받은 사람이 읽지 않은 알림에 한 번 read_at을 채운다. 되돌리기 없음.
create policy notifications_update_read on public.notifications
for update to authenticated
using (
  user_id = (select auth.uid())
  and read_at is null
  and (select private.is_active_user((select auth.uid())))
)
with check (
  user_id = (select auth.uid())
  and read_at is not null
  and (select private.is_active_user((select auth.uid())))
);
