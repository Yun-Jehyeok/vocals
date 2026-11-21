-- 묶음 4: 숙제·영상·피드백 (docs/erd.md 2·5장, 이슈 #35)
--
-- 만드는 것: videos, homeworks, homework_targets, homework_videos, submissions, feedback_comments,
--           trainer_profile_videos (+ enum 3개, 제약, 무결성 트리거, RLS, private 판정 함수)
-- 쓰기 경로 (이슈 #35 팀장 결정 1, erd 5장 "쓰기 경로")
--   - videos 행 만들기·지우기와 upload_status·duration_sec·storage_key·ticket_id·purge_after·purge_notified_at은
--     서버(service_role, 업로드·업로드 완료 처리)가 쓴다. 클라이언트는 트레이너의 자기 예시 영상 hidden_in_library만.
--   - 클라이언트 직접: 트레이너의 숙제 만들기와 description·due_at 고치기, 대상·예시 영상 연결 만들기,
--     학생의 제출 만들기, 트레이너의 피드백 달기, 트레이너의 프로필 영상 연결(붙이기·순서·빼기).
--     모두 탈퇴하지 않은 사용자만(private.is_active_user, AUTH-07). 정지 트레이너는 막지 않는다(팀장 결정 7).
-- 만들지 않는 것
--   - Mux 업로드·웹훅·서명 재생 토큰(NFR-03, NFR-04), 알림(NOTI-02), 예약 작업
--   - 보관 기한 계산: DB는 purge_after를 계산하거나 채우지 않는다(트리거·함수·기본값 없음). 서버가
--     packages/shared의 날짜 규칙으로 계산해 넣은 값을 그대로 저장하고, purge_notified_at ⇒ purge_after만 검사한다
--     (HW-14, AUTH-08, CLAUDE.md 도메인 규칙). 탈퇴 규칙은 용도와 관계없이 적용되므로 purge_after는 모든 용도에 넣을 수 있다.
--   - 영상 삭제 실행(삭제 배치). 그때 제출·연결 행 처리를 정한다. 여기서는 FK가 지우기를 막는다.
--
-- 권한 원칙은 20261119170000·20261121150000·20261121180000 머리말과 같다. 판정은 private 함수에 두고,
-- 회차·참여·수강권 판정은 기존 함수(lesson_session_trainer_id, enrollment_student_id, user_role)를 다시 쓴다.
-- 프로필 영상 읽기는 trainer_genres_select처럼 trainer_profiles 읽기 정책을 거쳐 정지 트레이너 기준까지 같게 따른다.
-- 제출에 딸린 피드백, 숙제에 딸린 예시 영상 연결은 부모 테이블의 RLS를 그대로 거친다(판정이 한 곳에 모인다).

-- ---------------------------------------------------------------------------
-- enum. 이름은 "<테이블>_<컬럼>", 값은 erd 5장과 packages/shared/src/domain.ts와 같다.
-- ---------------------------------------------------------------------------

create type public.videos_purpose as enum ('profile', 'example', 'practice');
create type public.videos_upload_status as enum ('uploading', 'ready', 'failed');
-- 2단계 대비(erd 9장). 1단계에는 private만 있다.
create type public.videos_visibility as enum ('private');

-- ---------------------------------------------------------------------------
-- videos (HW-04~HW-09, HW-12, HW-14, TRN-07, NFR-03, NFR-04). 행은 서버가 만들고 지운다.
-- ---------------------------------------------------------------------------

create table public.videos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users (id),
  purpose public.videos_purpose not null,
  -- Mux 재생 키. 재생은 서버가 발급한 서명 토큰으로만 한다(NFR-04).
  storage_key text,
  duration_sec integer,
  upload_status public.videos_upload_status not null default 'uploading',
  visibility public.videos_visibility not null default 'private',
  hidden_in_library boolean not null default false,
  ticket_id uuid references public.tickets (id),
  -- 서버가 계산해 넣는 값. DB는 계산하지 않는다(HW-14, AUTH-08).
  purge_after timestamptz,
  purge_notified_at timestamptz,
  created_at timestamptz not null default now(),
  -- NFR-04: 영상마다 다른 재생 키
  constraint videos_storage_key_key unique (storage_key),
  -- HW-08, TRN-07: 5분(300초) 이하. packages/shared MAX_VIDEO_DURATION_SEC와 같다
  constraint videos_duration_sec_check check (duration_sec is null or duration_sec between 1 and 300),
  -- HW-09: 업로드가 끝난 영상은 길이와 재생 키가 있다
  constraint videos_ready_check check (
    upload_status <> 'ready' or (duration_sec is not null and storage_key is not null)
  ),
  -- HW-14: 연습 영상만 수강권에 붙고, 연습 영상은 반드시 수강권이 있다
  constraint videos_ticket_id_check check ((purpose = 'practice') = (ticket_id is not null)),
  -- HW-14: 삭제 예고는 삭제 예정일이 있을 때만
  constraint videos_purge_notified_at_check check (
    purge_notified_at is null or purge_after is not null
  )
);

create index videos_owner_id_purpose_idx on public.videos (owner_id, purpose);
create index videos_ticket_id_idx on public.videos (ticket_id);

-- ---------------------------------------------------------------------------
-- homeworks (HW-01, HW-02). 회차에 묶인다. 상태 컬럼은 없다(HW-11: submissions 유무로 판단).
-- ---------------------------------------------------------------------------

create table public.homeworks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.lesson_sessions (id),
  trainer_id uuid not null references public.trainer_profiles (user_id),
  description text not null,
  -- 기본값 "다음 레슨 전"은 숙제 등록 화면·서버가 정한다(erd 10장). DB는 기본값·검사 없음.
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint homeworks_description_check check (description <> '')
);

create index homeworks_session_id_idx on public.homeworks (session_id);
create index homeworks_trainer_id_idx on public.homeworks (trainer_id);

-- ---------------------------------------------------------------------------
-- homework_targets (HW-01, HW-03). 받는 학생. (숙제, 학생)마다 하나.
-- ---------------------------------------------------------------------------

create table public.homework_targets (
  id uuid primary key default gen_random_uuid(),
  homework_id uuid not null references public.homeworks (id),
  student_id uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  constraint homework_targets_homework_id_student_id_key unique (homework_id, student_id)
);

create index homework_targets_student_id_idx on public.homework_targets (student_id);

-- ---------------------------------------------------------------------------
-- homework_videos (HW-02, HW-04, HW-05). 숙제의 예시 영상. (숙제, 영상)마다 하나.
-- ---------------------------------------------------------------------------

create table public.homework_videos (
  id uuid primary key default gen_random_uuid(),
  homework_id uuid not null references public.homeworks (id),
  video_id uuid not null references public.videos (id),
  created_at timestamptz not null default now(),
  constraint homework_videos_homework_id_video_id_key unique (homework_id, video_id)
);

create index homework_videos_video_id_idx on public.homework_videos (video_id);

-- ---------------------------------------------------------------------------
-- submissions (HW-06, HW-07, HW-13). 여러 번 제출하면 줄이 쌓인다. 영상 하나는 제출 하나에만 쓰인다.
-- ---------------------------------------------------------------------------

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  homework_id uuid not null references public.homeworks (id),
  student_id uuid not null references public.users (id),
  video_id uuid not null references public.videos (id),
  question text,
  -- HW-07, HW-11: DB가 넣는 시각. 클라이언트에는 이 컬럼의 쓰기 권한이 없다.
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint submissions_video_id_key unique (video_id)
);

create index submissions_homework_id_student_id_idx on public.submissions (homework_id, student_id);
create index submissions_student_id_idx on public.submissions (student_id);

-- ---------------------------------------------------------------------------
-- feedback_comments (HW-10). at_sec이 있으면 시점 코멘트, 없으면 텍스트 코멘트.
-- ---------------------------------------------------------------------------

create table public.feedback_comments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id),
  author_id uuid not null references public.users (id),
  body text not null,
  at_sec integer,
  created_at timestamptz not null default now(),
  constraint feedback_comments_body_check check (body <> ''),
  -- 영상 길이 이하인지는 트리거가 본다
  constraint feedback_comments_at_sec_check check (at_sec is null or at_sec >= 0)
);

create index feedback_comments_submission_id_idx on public.feedback_comments (submission_id);

-- ---------------------------------------------------------------------------
-- trainer_profile_videos (TRN-07, erd 2장). 프로필 영상 3개까지. 빼도 videos 행은 남는다.
-- ---------------------------------------------------------------------------

create table public.trainer_profile_videos (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references public.trainer_profiles (user_id),
  video_id uuid not null references public.videos (id),
  sort_order integer not null,
  created_at timestamptz not null default now(),
  constraint trainer_profile_videos_sort_order_check check (sort_order between 1 and 3),
  constraint trainer_profile_videos_trainer_id_sort_order_key unique (trainer_id, sort_order),
  -- 영상의 올린 사람이 그 트레이너이므로 영상마다 하나면 (트레이너, 영상)마다 하나다
  constraint trainer_profile_videos_video_id_key unique (video_id)
);

-- ---------------------------------------------------------------------------
-- 판정 함수 (RLS를 거치지 않고 읽는다. 정책끼리 서로 부르지 않게 한다)
-- ---------------------------------------------------------------------------

-- [HW-11, HW-12] 숙제의 트레이너 (대상·예시 영상 연결 쓰기, 대상·제출 읽기)
create function private.homework_trainer_id(target_homework_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select h.trainer_id from public.homeworks h where h.id = target_homework_id
$$;

-- [HW-03, HW-12] 로그인한 학생이 그 숙제의 대상인가 (숙제 읽기)
create function private.is_homework_target(target_homework_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.homework_targets t
    where t.homework_id = target_homework_id
      and t.student_id = auth.uid()
  )
$$;

-- [HW-12, NFR-04, 팀장 결정 2] 로그인한 사용자가 숙제를 통해 그 영상을 읽는가.
--   - 예시 영상: 그 영상이 붙은 숙제의 대상 학생(보관함에서 숨겨도 계속, HW-05)
--   - 연습 영상: 그 영상이 붙은 제출의 숙제 트레이너(제출 전 영상은 아님). 수강권이 끝나도 계속(PM 결정 2026-11-21)
-- 올린 사람·운영자·프로필 영상은 정책에서 따로 본다.
create function private.can_read_homework_video(target_video_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.homework_videos hv
    join public.homework_targets t on t.homework_id = hv.homework_id
    where hv.video_id = target_video_id
      and t.student_id = auth.uid()
  )
  or exists (
    select 1
    from public.submissions s
    join public.homeworks h on h.id = s.homework_id
    where s.video_id = target_video_id
      and h.trainer_id = auth.uid()
  )
$$;

-- ---------------------------------------------------------------------------
-- 트리거 (클라이언트·서버 모두에 걸리는 무결성 검사. 값은 바꾸거나 채우지 않는다)
-- 클라이언트가 직접 쓰는 테이블이 많아 RLS만으로는 관계를 지킬 수 없다(팀장 결정 4).
-- 검사는 쓰는 사람의 RLS와 관계없이 같아야 하므로 security definer로 읽는다(아무 역할에도 실행 권한을 주지 않는다).
-- ---------------------------------------------------------------------------

-- 영상: 올린 사람의 역할이 용도와 맞고(profile·example은 트레이너, practice는 학생), 연습 영상의 수강권은
-- 올린 학생의 것이다(HW-04, HW-06, HW-14, TRN-07). 올린 사람·용도·수강권은 바꾸지 않는다.
-- 클라이언트의 hidden_in_library 수정에는 걸리지 않는다(update of).
create function private.videos_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_role public.users_role;
  ticket_enrollment_id uuid;
begin
  if tg_op = 'UPDATE' then
    if new.owner_id is distinct from old.owner_id
      or new.purpose is distinct from old.purpose
      or new.ticket_id is distinct from old.ticket_id
    then
      raise exception 'videos의 owner_id·purpose·ticket_id는 바꿀 수 없다'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  owner_role := private.user_role(new.owner_id);
  -- 없는 사용자는 FK가 막는다
  if owner_role is null then
    return new;
  end if;

  if new.purpose = 'practice' then
    if owner_role <> 'student' then
      raise exception '연습 영상은 학생이 올린다'
        using errcode = 'check_violation';
    end if;
    select t.enrollment_id into ticket_enrollment_id
    from public.tickets t
    where t.id = new.ticket_id;
    if ticket_enrollment_id is not null
      and private.enrollment_student_id(ticket_enrollment_id) is distinct from new.owner_id
    then
      raise exception '연습 영상의 수강권은 올린 학생의 수강권이어야 한다'
        using errcode = 'check_violation';
    end if;
  elsif owner_role <> 'trainer' then
    raise exception '프로필·예시 영상은 트레이너가 올린다'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

create trigger videos_before_write
before insert or update of owner_id, purpose, ticket_id on public.videos
for each row execute function private.videos_before_write();

-- 숙제: trainer_id는 회차의 트레이너이고, 취소된 회차에는 만들 수 없다(HW-01).
-- session_id·trainer_id는 바꾸지 않는다(erd 5장 쓰기 경로, 팀장 결정 6).
create function private.homeworks_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_status public.lesson_sessions_status;
begin
  if tg_op = 'UPDATE' then
    if new.session_id is distinct from old.session_id
      or new.trainer_id is distinct from old.trainer_id
    then
      raise exception 'homeworks의 session_id·trainer_id는 바꿀 수 없다'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if private.lesson_session_trainer_id(new.session_id) is distinct from new.trainer_id then
    raise exception '숙제의 트레이너는 회차의 트레이너여야 한다'
      using errcode = 'check_violation';
  end if;

  select s.status into session_status
  from public.lesson_sessions s
  where s.id = new.session_id;
  if session_status = 'canceled' then
    raise exception '취소된 회차에는 숙제를 낼 수 없다'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

create trigger homeworks_before_write
before insert or update of session_id, trainer_id on public.homeworks
for each row execute function private.homeworks_before_write();

-- 숙제 대상: 그 숙제 회차에 참여 행이 있는 학생이다(HW-01, HW-03).
create function private.homework_targets_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.homeworks h
    join public.session_attendees a on a.session_id = h.session_id
    where h.id = new.homework_id
      and a.student_id = new.student_id
  ) then
    raise exception '숙제 대상은 그 회차에 참여하는 학생이어야 한다'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger homework_targets_before_write
before insert or update of homework_id, student_id on public.homework_targets
for each row execute function private.homework_targets_before_write();

-- 숙제 예시 영상: 그 숙제 트레이너가 올린 example 영상이다(HW-04, HW-05). 숨긴 영상도 붙일 수 있다.
create function private.homework_videos_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.homeworks h
    join public.videos v on v.owner_id = h.trainer_id
    where h.id = new.homework_id
      and v.id = new.video_id
      and v.purpose = 'example'
  ) then
    raise exception '숙제에는 그 숙제 트레이너의 예시 영상만 붙인다'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger homework_videos_before_write
before insert or update of homework_id, video_id on public.homework_videos
for each row execute function private.homework_videos_before_write();

-- 제출 (HW-03, HW-06, HW-12, HW-14, 팀장 결정 4·5):
--   - 학생은 그 숙제의 대상이다.
--   - 영상은 그 학생이 올린 practice·ready 영상이고, 그 수강권은 그 학생의 숙제 회차 참여 행의 수강권이다.
--   마감·수강권 상태는 보지 않는다(마감 뒤·수강 종료 뒤에도 제출, 팀장 결정 5).
create function private.submissions_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  video_owner_id uuid;
  video_purpose public.videos_purpose;
  video_upload_status public.videos_upload_status;
  video_ticket_id uuid;
  attendee_ticket_id uuid;
begin
  if not exists (
    select 1
    from public.homework_targets t
    where t.homework_id = new.homework_id
      and t.student_id = new.student_id
  ) then
    raise exception '제출하는 학생은 그 숙제의 대상이어야 한다'
      using errcode = 'check_violation';
  end if;

  select v.owner_id, v.purpose, v.upload_status, v.ticket_id
  into video_owner_id, video_purpose, video_upload_status, video_ticket_id
  from public.videos v
  where v.id = new.video_id;

  if video_owner_id is distinct from new.student_id
    or video_purpose is distinct from 'practice'
    or video_upload_status is distinct from 'ready'
  then
    raise exception '제출 영상은 제출하는 학생이 올린, 업로드가 끝난 연습 영상이어야 한다'
      using errcode = 'check_violation';
  end if;

  select a.ticket_id into attendee_ticket_id
  from public.homeworks h
  join public.session_attendees a on a.session_id = h.session_id
  where h.id = new.homework_id
    and a.student_id = new.student_id;

  if attendee_ticket_id is distinct from video_ticket_id then
    raise exception '제출 영상의 수강권은 그 숙제 회차에 참여한 수강권이어야 한다'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

create trigger submissions_before_write
before insert or update of homework_id, student_id, video_id on public.submissions
for each row execute function private.submissions_before_write();

-- 피드백: 작성자는 그 제출 숙제의 트레이너이고, 시점 코멘트는 영상 길이 이하다(HW-10).
-- 수강 관계 없는 트레이너의 피드백은 2단계다(erd 9장).
create function private.feedback_comments_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  submission_trainer_id uuid;
  video_duration_sec integer;
begin
  select h.trainer_id, v.duration_sec
  into submission_trainer_id, video_duration_sec
  from public.submissions s
  join public.homeworks h on h.id = s.homework_id
  join public.videos v on v.id = s.video_id
  where s.id = new.submission_id;

  if submission_trainer_id is distinct from new.author_id then
    raise exception '피드백은 그 숙제의 트레이너가 단다'
      using errcode = 'check_violation';
  end if;

  if new.at_sec is not null
    and (video_duration_sec is null or new.at_sec > video_duration_sec)
  then
    raise exception '시점 코멘트는 영상 길이 안이어야 한다'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

create trigger feedback_comments_before_write
before insert or update of submission_id, author_id, at_sec on public.feedback_comments
for each row execute function private.feedback_comments_before_write();

-- 프로필 영상: 그 트레이너가 올린 profile·ready 영상이다(TRN-07). 순서만 바꿀 때는 조회하지 않는다.
create function private.trainer_profile_videos_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.videos v
    where v.id = new.video_id
      and v.owner_id = new.trainer_id
      and v.purpose = 'profile'
      and v.upload_status = 'ready'
  ) then
    raise exception '프로필에는 그 트레이너의 업로드가 끝난 프로필 영상만 붙인다'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger trainer_profile_videos_before_write
before insert or update of trainer_id, video_id on public.trainer_profile_videos
for each row execute function private.trainer_profile_videos_before_write();

-- ---------------------------------------------------------------------------
-- 함수 실행 권한
-- ---------------------------------------------------------------------------

-- 기존 규칙: 그 함수를 부르는 정책이 쓰는 역할에만 준다. 트리거 함수는 아무 역할에도 주지 않는다.
-- anon이 거치는 정책(프로필 영상)은 private 함수를 부르지 않는다.
revoke all on function
  private.homework_trainer_id(uuid),
  private.is_homework_target(uuid),
  private.can_read_homework_video(uuid),
  private.videos_before_write(),
  private.homeworks_before_write(),
  private.homework_targets_before_write(),
  private.homework_videos_before_write(),
  private.submissions_before_write(),
  private.feedback_comments_before_write(),
  private.trainer_profile_videos_before_write()
from public, anon, authenticated, service_role;

grant execute on function
  private.homework_trainer_id(uuid),
  private.is_homework_target(uuid),
  private.can_read_homework_video(uuid)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS 켜기
-- ---------------------------------------------------------------------------

alter table public.videos enable row level security;
alter table public.homeworks enable row level security;
alter table public.homework_targets enable row level security;
alter table public.homework_videos enable row level security;
alter table public.submissions enable row level security;
alter table public.feedback_comments enable row level security;
alter table public.trainer_profile_videos enable row level security;

-- ---------------------------------------------------------------------------
-- 권한: 기본 권한을 모두 회수한 뒤 필요한 것만 준다.
-- ---------------------------------------------------------------------------

revoke all on table
  public.videos,
  public.homeworks,
  public.homework_targets,
  public.homework_videos,
  public.submissions,
  public.feedback_comments,
  public.trainer_profile_videos
from anon, authenticated;

-- videos --------------------------------------------------------------------
-- anon은 프로필에 붙은 영상만 읽는다(아래 videos_select_profile).
grant select on public.videos to anon, authenticated;
-- 팀장 결정 1: 클라이언트가 고치는 컬럼은 hidden_in_library뿐이다. 행 만들기·지우기는 서버.
grant update (hidden_in_library) on public.videos to authenticated;

-- HW-09, HW-12, ADM-07, NFR-04(팀장 결정 2): 올린 사람(상태와 관계없이), 운영자, 숙제로 연결된 사람.
create policy videos_select on public.videos
for select to authenticated
using (
  owner_id = (select auth.uid())
  or (select private.is_admin())
  or private.can_read_homework_video(id)
);

-- TRN-07, ADM-02: 프로필에 붙은 영상은 그 트레이너 프로필을 읽을 수 있는 사람이 읽는다.
-- trainer_profile_videos_select → trainer_profiles_select를 거쳐 정지 트레이너 기준까지 같게 따른다.
-- 붙지 않은 프로필 영상은 위 정책(올린 트레이너·운영자)만 읽는다.
create policy videos_select_profile on public.videos
for select to anon, authenticated
using (
  purpose = 'profile'
  and exists (
    select 1 from public.trainer_profile_videos p where p.video_id = videos.id
  )
);

-- HW-05, T-16, AUTH-07: 트레이너는 자기 예시 영상의 보관함 숨김만 고친다. 탈퇴하면 못 고친다.
create policy videos_update_trainer on public.videos
for update to authenticated
using (
  owner_id = (select auth.uid())
  and purpose = 'example'
  and (select private.is_active_user((select auth.uid())))
)
with check (
  owner_id = (select auth.uid())
  and purpose = 'example'
  and (select private.is_active_user((select auth.uid())))
);

-- homeworks -----------------------------------------------------------------
grant select on public.homeworks to authenticated;
grant insert (session_id, trainer_id, description, due_at) on public.homeworks to authenticated;
-- 팀장 결정 6: 고치는 것은 설명·마감뿐. 지우기 없음.
grant update (description, due_at) on public.homeworks to authenticated;

-- HW-03, HW-11, HW-12, ADM-07: 트레이너는 자기 숙제, 학생은 자기가 대상인 숙제(끝난 수강권 회차 포함), 운영자는 전부.
create policy homeworks_select on public.homeworks
for select to authenticated
using (
  trainer_id = (select auth.uid())
  or (select private.is_admin())
  or private.is_homework_target(id)
);

-- HW-01, ADM-02, AUTH-07: 자기 이름으로만. 회차의 트레이너인지·취소 회차는 트리거가 본다.
-- 정지 트레이너도 쓰고(팀장 결정 7), 탈퇴한 트레이너는 못 쓴다.
create policy homeworks_insert_trainer on public.homeworks
for insert to authenticated
with check (
  trainer_id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
);

create policy homeworks_update_trainer on public.homeworks
for update to authenticated
using (
  trainer_id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
)
with check (
  trainer_id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
);

-- homework_targets ----------------------------------------------------------
grant select on public.homework_targets to authenticated;
grant insert (homework_id, student_id) on public.homework_targets to authenticated;

-- HW-11, HW-12, ADM-07(팀장 결정 3): 학생은 자기 줄만, 트레이너는 자기 숙제의 줄 전부, 운영자는 전부.
create policy homework_targets_select on public.homework_targets
for select to authenticated
using (
  student_id = (select auth.uid())
  or (select private.is_admin())
  or private.homework_trainer_id(homework_id) = (select auth.uid())
);

-- HW-01, HW-03, AUTH-07: 숙제 트레이너만. 회차 참여 학생인지는 트리거가 본다.
create policy homework_targets_insert_trainer on public.homework_targets
for insert to authenticated
with check (
  private.homework_trainer_id(homework_id) = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
);

-- homework_videos -----------------------------------------------------------
grant select on public.homework_videos to authenticated;
grant insert (homework_id, video_id) on public.homework_videos to authenticated;

-- HW-02, HW-12: 그 숙제를 읽을 수 있는 사람이 읽는다. homeworks의 RLS를 그대로 거친다.
create policy homework_videos_select on public.homework_videos
for select to authenticated
using (
  exists (select 1 from public.homeworks h where h.id = homework_videos.homework_id)
);

-- HW-04, HW-05, AUTH-07: 숙제 트레이너만. 자기 예시 영상인지는 트리거가 본다.
create policy homework_videos_insert_trainer on public.homework_videos
for insert to authenticated
with check (
  private.homework_trainer_id(homework_id) = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
);

-- submissions ---------------------------------------------------------------
grant select on public.submissions to authenticated;
-- HW-07: submitted_at은 DB가 넣는다. 고치기·지우기 없음(기록이 남는다).
grant insert (homework_id, student_id, video_id, question) on public.submissions to authenticated;

-- HW-11, HW-12, ADM-07: 학생은 자기 제출만, 트레이너는 자기 숙제의 제출 전부, 운영자는 전부.
create policy submissions_select on public.submissions
for select to authenticated
using (
  student_id = (select auth.uid())
  or (select private.is_admin())
  or private.homework_trainer_id(homework_id) = (select auth.uid())
);

-- HW-06, HW-13, AUTH-07: 학생 자신의 이름으로만. 대상·영상·수강권은 트리거가 본다.
create policy submissions_insert_student on public.submissions
for insert to authenticated
with check (
  student_id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
);

-- feedback_comments ---------------------------------------------------------
grant select on public.feedback_comments to authenticated;
-- 팀장 결정 6: 고치기·지우기 없음.
grant insert (submission_id, author_id, body, at_sec) on public.feedback_comments to authenticated;

-- HW-10, HW-12, ADM-07: 그 제출을 읽을 수 있는 사람(제출 학생, 숙제 트레이너, 운영자). submissions의 RLS를 거친다.
create policy feedback_comments_select on public.feedback_comments
for select to authenticated
using (
  exists (select 1 from public.submissions s where s.id = feedback_comments.submission_id)
);

-- HW-10, ADM-02, AUTH-07: 자기 이름으로만. 숙제 트레이너인지·시점 범위는 트리거가 본다.
create policy feedback_comments_insert_trainer on public.feedback_comments
for insert to authenticated
with check (
  author_id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
);

-- trainer_profile_videos ----------------------------------------------------
grant select on public.trainer_profile_videos to anon, authenticated;
grant insert (trainer_id, video_id, sort_order) on public.trainer_profile_videos to authenticated;
grant update (sort_order) on public.trainer_profile_videos to authenticated;
-- 프로필에서 빼기(T-03). 행 단위라 테이블 권한으로 준다(trainer_genres와 같다).
grant delete on public.trainer_profile_videos to authenticated;

-- TRN-07, ADM-02: 그 트레이너 프로필을 읽을 수 있는 사람이 읽는다(trainer_genres_select와 같은 방식).
create policy trainer_profile_videos_select on public.trainer_profile_videos
for select to anon, authenticated
using (
  exists (
    select 1 from public.trainer_profiles tp where tp.user_id = trainer_profile_videos.trainer_id
  )
);

-- TRN-07, T-03, ADM-02, AUTH-07: 트레이너 본인만. 정지 트레이너도 되고, 탈퇴한 트레이너는 못 한다.
create policy trainer_profile_videos_insert_own on public.trainer_profile_videos
for insert to authenticated
with check (
  trainer_id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
);

create policy trainer_profile_videos_update_own on public.trainer_profile_videos
for update to authenticated
using (
  trainer_id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
)
with check (
  trainer_id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
);

create policy trainer_profile_videos_delete_own on public.trainer_profile_videos
for delete to authenticated
using (
  trainer_id = (select auth.uid())
  and (select private.is_active_user((select auth.uid())))
);
