-- 이슈 #38: 무결성 트리거 오류 코드로 관계가 드러나는 문제 (#35, PR #37 후속)
--
-- 문제
--   클라이언트 insert에서 BEFORE 무결성 트리거(security definer, 20261121210000)가 RLS with check보다
--   먼저 돈다. 권한 없는 사람이 남의 부모 행(숙제·제출·트레이너)에 쓰려 하면, 대상이 관계 조건을
--   만족할 때는 트리거를 지나 RLS에서 42501, 아닐 때는 트리거에서 23514가 나서 읽을 수 없는 관계
--   (회차 참여, 영상 주인·용도·상태, 회차 취소, 영상 길이, 행이 있는가)가 오류 코드로 드러난다.
--
-- 고치는 방식
--   - 6개 테이블에 "쓰는 사람이 그 부모 행에 쓸 권한이 있는가"를 보는 BEFORE INSERT 트리거를 더한다.
--     판정은 각 테이블의 insert 정책(with check)과 같다. 없으면 RLS와 같은 코드·문구(42501)로 거부한다.
--   - 같은 시점(BEFORE INSERT, FOR EACH ROW)의 트리거는 이름의 알파벳 순서로 돈다. 새 트리거 이름
--     `<테이블>_authorize_insert`는 기존 `<테이블>_before_write`보다 앞이라 무결성 검사보다 먼저 돈다.
--   - RLS가 걸리지 않는 쓰기(service_role 등 BYPASSRLS, 테이블 주인)는 판정을 건너뛰고 기존 무결성
--     검사만 받는다. 그래서 트리거 함수는 security invoker로 두고 row_security_active()로 본다
--     (security definer면 current_user가 함수 주인이 되어 RLS 여부를 알 수 없다).
--
-- 바꾸지 않는 것
--   - 기존 정책과 무결성 트리거(무엇이 23514인가). 권한 있는 사람의 무결성 위반은 그대로 23514다.
--   - update 경로: 클라이언트 update grant가 있는 컬럼에는 무결성 트리거가 걸리지 않고(homeworks의
--     description·due_at, trainer_profile_videos의 sort_order), RLS using이 먼저 행을 거른다.
--
-- 판정 기준(insert 정책과 같아야 한다. 정책을 바꾸면 여기도 같이 바꾼다)
--   homework_targets       private.homework_trainer_id(homework_id) = auth.uid() 그리고 활성 사용자
--                          (homework_targets_insert_trainer)
--   homework_videos        private.homework_trainer_id(homework_id) = auth.uid() 그리고 활성 사용자
--                          (homework_videos_insert_trainer)
--   homeworks              trainer_id = auth.uid() 그리고 활성 사용자 (homeworks_insert_trainer)
--   submissions            student_id = auth.uid() 그리고 활성 사용자 (submissions_insert_student)
--   feedback_comments      author_id = auth.uid() 그리고 활성 사용자 (feedback_comments_insert_trainer)
--   trainer_profile_videos trainer_id = auth.uid() 그리고 활성 사용자 (trainer_profile_videos_insert_own)

-- [HW-01, HW-03, HW-04, HW-06, HW-10, TRN-07, AUTH-07] 클라이언트 insert 권한 판정.
-- 각 테이블에서 "누구의 이름으로 쓰는가"를 구하고, 그 사람이 로그인한 활성 사용자가 아니면 거부한다.
-- 테이블마다 컬럼이 달라 new.<컬럼>은 그 테이블 분기에서만 읽는다(plpgsql은 실행하는 문장만 해석한다).
create function private.authorize_client_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  writer_id uuid;
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

  return new;
end
$$;

create trigger homework_targets_authorize_insert
before insert on public.homework_targets
for each row execute function private.authorize_client_insert();

create trigger homework_videos_authorize_insert
before insert on public.homework_videos
for each row execute function private.authorize_client_insert();

create trigger homeworks_authorize_insert
before insert on public.homeworks
for each row execute function private.authorize_client_insert();

create trigger submissions_authorize_insert
before insert on public.submissions
for each row execute function private.authorize_client_insert();

create trigger feedback_comments_authorize_insert
before insert on public.feedback_comments
for each row execute function private.authorize_client_insert();

create trigger trainer_profile_videos_authorize_insert
before insert on public.trainer_profile_videos
for each row execute function private.authorize_client_insert();

-- 트리거 함수는 트리거로만 실행된다. 아무 역할에도 실행 권한을 주지 않는다(트리거 실행에는 필요 없다).
revoke all on function private.authorize_client_insert() from public, anon, authenticated, service_role;
