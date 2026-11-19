-- 로컬 개발·테스트용 더미 데이터. 운영 DB에는 넣지 않는다.
-- 실명·생년월일·휴대폰·연계정보·사업자등록번호·계좌는 모두 실제 사람 것이 아닌 가짜 값이다.
-- id는 supabase/tests/helpers/seed-ids.ts와 같다.

-- 지역: 전체 시·군·구 목록을 넣기 전까지 쓰는 일부 (TRN-08)
insert into public.regions (id, sido, sigungu)
overriding system value
values
  (1, '서울특별시', '강남구'),
  (2, '서울특별시', '마포구'),
  (3, '경기도', '성남시'),
  (4, '경기도', '수원시'),
  (5, '부산광역시', '해운대구');

select setval(pg_get_serial_sequence('public.regions', 'id'), (select max(id) from public.regions));

-- Supabase Auth 사용자 (로컬에서는 tests/supabase-shim.sql의 auth.users)
insert into auth.users (id, email)
values
  ('00000000-0000-4000-8000-000000000001', 'student1@example.test'),
  ('00000000-0000-4000-8000-000000000002', 'student2@example.test'),
  ('00000000-0000-4000-8000-000000000011', 'trainer.approved@example.test'),
  ('00000000-0000-4000-8000-000000000012', 'trainer.unlisted@example.test'),
  ('00000000-0000-4000-8000-000000000013', 'trainer.pilot@example.test'),
  ('00000000-0000-4000-8000-000000000014', 'trainer.pending@example.test'),
  ('00000000-0000-4000-8000-000000000015', 'trainer.rejected@example.test'),
  ('00000000-0000-4000-8000-000000000016', 'trainer.suspended@example.test'),
  ('00000000-0000-4000-8000-000000000099', 'admin@example.test');

insert into public.users (id, role, nickname, legal_name, birth_date, phone, identity_key)
values
  ('00000000-0000-4000-8000-000000000001', 'student', '더미학생1', '가짜학생일', '2000-01-01', '01000000001', 'dummy-identity-key-student-1'),
  ('00000000-0000-4000-8000-000000000002', 'student', '더미학생2', '가짜학생이', '2000-01-02', '01000000002', 'dummy-identity-key-student-2'),
  ('00000000-0000-4000-8000-000000000011', 'trainer', '더미승인트레이너', '가짜트레이너일', '1990-01-01', '01000000011', 'dummy-identity-key-trainer-11'),
  ('00000000-0000-4000-8000-000000000012', 'trainer', '더미비노출트레이너', '가짜트레이너이', '1990-01-02', '01000000012', 'dummy-identity-key-trainer-12'),
  ('00000000-0000-4000-8000-000000000013', 'trainer', '더미파일럿트레이너', '가짜트레이너삼', '1990-01-03', '01000000013', 'dummy-identity-key-trainer-13'),
  ('00000000-0000-4000-8000-000000000014', 'trainer', '더미대기트레이너', '가짜트레이너사', '1990-01-04', '01000000014', 'dummy-identity-key-trainer-14'),
  ('00000000-0000-4000-8000-000000000015', 'trainer', '더미거절트레이너', '가짜트레이너오', '1990-01-05', '01000000015', 'dummy-identity-key-trainer-15'),
  ('00000000-0000-4000-8000-000000000016', 'trainer', '더미정지트레이너', '가짜트레이너육', '1990-01-06', '01000000016', 'dummy-identity-key-trainer-16'),
  ('00000000-0000-4000-8000-000000000099', 'admin', '더미운영자', '가짜운영자', '1985-01-01', '01000000099', 'dummy-identity-key-admin-99');

insert into public.trainer_profiles (
  user_id, display_name, bio, career, lesson_place, region_id, link_slug,
  approval_status, is_pilot, listed, business_type, business_registration_no,
  payout_seller_id, payout_account_masked, approved_at
)
values
  ('00000000-0000-4000-8000-000000000011', '더미 승인 트레이너', '더미 소개글', '더미 경력', '더미 연습실 1호', 1, 'seed-approved',
   'approved', false, true, 'individual', null,
   'dummy-seller-11', '테스트은행 0011', '2026-11-01 00:00:00+09'),
  ('00000000-0000-4000-8000-000000000012', '더미 비노출 트레이너', '더미 소개글', '더미 경력', '더미 연습실 2호', 2, 'seed-unlisted',
   'approved', false, false, 'sole_proprietor', '000-00-00012',
   'dummy-seller-12', '테스트은행 0012', '2026-11-01 00:00:00+09'),
  ('00000000-0000-4000-8000-000000000013', '더미 파일럿 트레이너', '더미 소개글', '더미 경력', '더미 연습실 3호', 3, 'seed-pilot',
   'approved', true, true, 'individual', null,
   'dummy-seller-13', '테스트은행 0013', '2026-11-01 00:00:00+09'),
  ('00000000-0000-4000-8000-000000000014', '더미 대기 트레이너', '더미 소개글', null, null, 3, 'seed-pending',
   'pending', false, true, 'individual', null,
   null, null, null),
  ('00000000-0000-4000-8000-000000000015', '더미 거절 트레이너', '더미 소개글', null, null, 4, 'seed-rejected',
   'rejected', false, true, 'corporation', '000-00-00015',
   null, null, null),
  ('00000000-0000-4000-8000-000000000016', '더미 정지 트레이너', '더미 소개글', '더미 경력', '더미 연습실 6호', 5, 'seed-suspended',
   'suspended', false, true, 'individual', null,
   'dummy-seller-16', '테스트은행 0016', '2026-11-01 00:00:00+09');

-- 장르 id는 마이그레이션 순서: 1 발라드, 2 R&B, 3 팝, 4 록, 5 인디, 6 재즈, 7 뮤지컬, 8 트로트, 9 힙합, 10 입시·오디션
insert into public.trainer_genres (trainer_id, genre_id)
values
  ('00000000-0000-4000-8000-000000000011', 1),
  ('00000000-0000-4000-8000-000000000011', 2),
  ('00000000-0000-4000-8000-000000000012', 3),
  ('00000000-0000-4000-8000-000000000013', 7),
  ('00000000-0000-4000-8000-000000000014', 1),
  ('00000000-0000-4000-8000-000000000015', 4),
  ('00000000-0000-4000-8000-000000000016', 9);
