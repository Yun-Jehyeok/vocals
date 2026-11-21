# 결정 로그

PM과 팀장이 정한 것을 한 줄씩 모은다. 요구사항 문장은 `docs/prd.md`·`docs/idea.md`가 기준이고, 이 로그는 "무엇을 언제 누가 정했는지"를 찾는 색인이다.

- PM에게 묻기 전에 이 로그를 먼저 확인한다. 이미 정한 것은 다시 묻지 않는다.
- PM·팀장이 결정하면 기획이 표 맨 위에 한 줄 추가한다. 팀장 결정은 PM에게 사후 공유한다(`.claude/rules/team.md`).
- 결정을 바꾸면 기존 줄을 지우지 않고 새 줄을 위에 추가하고, 결정 칸에 무엇을 바꿨는지 적는다.
- 되돌릴 수 있음: 예(설정·코드만 바꾸면 됨) / 조건부(이미 쌓인 데이터·외부 계약·돈·법에 영향) / 아니오.
- 2026-11-19 줄 중 출처가 PR #1·#2·#5인 것은 초기 기획 문서에서 옮긴 것이다. 정한 날짜는 문서 merge 날짜로 묶었다.

## 결정

| 날짜 | 결정 | 이유 | 되돌릴 수 있음 | 결정한 사람 | 출처 |
| --- | --- | --- | --- | --- | --- |
| 2026-11-21 | 회차 `starts_at`·`ends_at`은 `timestamptz`로 저장하고, 요일·고정 일정 시각·화면 표시는 Asia/Seoul 기준. `weekday`는 0 = 일요일 ~ 6 = 토요일 (후보 5, 추가) | 문서 빈 곳. Postgres `extract(dow)`·JS `getDay()`와 같은 기준이라 변환이 없음 | 예 | 팀장 | [#32](https://github.com/Yun-Jehyeok/vocals/issues/32) |
| 2026-11-21 | 고정 일정·회차 만들기·취소·삭제·출결(사전 취소·차감·회차 금액)은 서버 함수가 쓴다. 클라이언트 직접 쓰기는 트레이너의 회차 시간 변경뿐이고, `scheduled`이며 차감된 참여 행이 없는 회차만 된다. 정지 트레이너도 된다 (후보 1·6) | 차감·금액·24시간 마감은 공유 규칙 함수라 DB에 다시 만들지 않음. 차감된 회차의 시간을 바꾸면 정산 월이 흐려짐 | 예 | 팀장 | [#32](https://github.com/Yun-Jehyeok/vocals/issues/32) |
| 2026-11-21 | 학생은 자기 참여 행이 있는 회차와 자기 참여 행만 본다 (후보 2) | S-10·S-11은 자기 회차·출결만 보여 주고, 다른 학생 출결 공개는 개인정보 공개 범위 문제 | 예 | 팀장 | [#32](https://github.com/Yun-Jehyeok/vocals/issues/32) |
| 2026-11-21 | 일정·출결 세 테이블에 값 범위·관계 DB 제약을 건다(차감·금액은 검사 안 함). 회차는 차감된 참여 행이 없을 때만 서버가 지우고 참여 행도 함께 지워진다 (후보 3·4) | 서버 함수 버그가 차감·정산으로 번지는 것을 막고, 차감 기록은 정산이 가리킴 | 예 | 팀장 | [#32](https://github.com/Yun-Jehyeok/vocals/issues/32) |
| 2026-11-21 | 학생이 앱에서 환불을 요청할 수 있는 수강권은 결제한 수강권 중 `waiting_schedule`·`active`만이다(파일럿 무료·끝난 수강권 제외) | 파일럿 무료는 돌려줄 금액이 없고, 만료 회차 처리는 `docs/idea.md` 결정 필요 2에서 정함 | 예 | PM | [#28](https://github.com/Yun-Jehyeok/vocals/issues/28) |
| 2026-11-21 | 트레이너는 `payments`(결제 수단·PG 거래번호·결제 시각)를 보지 않는다. 학생이 낸 금액은 `tickets.price_paid`로 본다 | T-08·T-20·T-22에 필요한 것은 수강권으로 충분하고, 학생 결제 정보는 최소로 연다 | 예 | PM | [#28](https://github.com/Yun-Jehyeok/vocals/issues/28) |
| 2026-11-21 | 상품은 지우지 않고 `active = false`로 판매 중지한다. 비활성 상품은 그 트레이너·운영자만 본다 (후보 1) | `payments`·`tickets`가 상품을 가리키고, 학생에게 보일 이유가 없음 | 예 | 팀장 | [#28](https://github.com/Yun-Jehyeok/vocals/issues/28) |
| 2026-11-21 | 상품 값 검사(`session_count` ≥ 1, `price` > 0, `duration_min` > 0, 일회권 1회)와 `tickets` 값 검사(횟수 범위, 일회권 1회, `ended` ⇔ `end_reason`, 상품·반이 같은 트레이너)를 DB 제약으로 건다. 금액 계산은 하지 않는다 (후보 2·3) | 0원 상품은 결제·회차 금액이 무의미하고, 서버 함수 버그가 남은 횟수·정산으로 번지는 것을 막음 | 예 | 팀장 | [#28](https://github.com/Yun-Jehyeok/vocals/issues/28) |
| 2026-11-21 | 파일럿 무료 수강권의 `tickets.fee_rate`는 비워 둔다(null). 정산 계산의 null 처리는 정산 서버 함수 이슈에서 승인과 함께 다룬다 (후보 4) | 복사할 수수료율이 없고 `price_paid = 0`이라 정산 항목이 없음 | 예 | 팀장 | [#28](https://github.com/Yun-Jehyeok/vocals/issues/28) |
| 2026-11-21 | 반 배정은 트레이너가 `tickets.group_class_id` 컬럼만 직접 고친다(컬럼 권한 + RLS + 정원 검사). 파일럿 수강권 발급은 서버 함수로 하고 #28 범위 밖이다 (후보 5) | 반 배정은 돈과 무관하고, 파일럿 조건은 `packages/shared` 규칙이라 RLS로 다시 구현하지 않음 | 예 | 팀장 | [#28](https://github.com/Yun-Jehyeok/vocals/issues/28) |
| 2026-11-21 | 그룹 반: 정원은 끝나지 않은 수강권이 배정된 서로 다른 학생 수로 세고 배정 인원보다 줄일 수 없다. 배정된 수강권이 없을 때만 트레이너가 지운다. 반은 상품과 연결하지 않는다(screens T-10 문구 수정) (후보 6·8·12) | 재결제로 같은 학생 수강권이 둘일 수 있음, 잘못 만든 반 정리, 한 반에 회차가 다른 수강권이 섞일 수 있음 | 예 | 팀장 | [#28](https://github.com/Yun-Jehyeok/vocals/issues/28) |
| 2026-11-21 | 정지 트레이너의 상품·장르는 프로필과 같은 기준(수강 관계 학생)으로 공개한다. 그룹 반은 그 트레이너·운영자·배정된 학생만 본다 (후보 7) | S-01에 상품·장르가 함께 나오고, 트레이너 정보라 학생 개인정보와 무관 | 예 | 팀장 | [#28](https://github.com/Yun-Jehyeok/vocals/issues/28) |
| 2026-11-21 | 환불 요청은 수강권당 처리 대기(`requested`) 하나, 학생의 철회·수정 없음. `processed`로 바꾸는 것은 서버 (후보 9) | erd 상태가 `requested, processed`뿐이고 철회는 S-08에 없음 | 예 | 팀장 | [#28](https://github.com/Yun-Jehyeok/vocals/issues/28) |
| 2026-11-21 | `fee_policies`는 운영자만 읽고 쓰기는 마이그레이션·서버만. `trainer_link` 0.08은 마이그레이션 기준 데이터, `marketplace`는 seed 더미만. `id`는 int(erd 1장 표기 규칙에 추가) (후보 10·11) | 수수료율 설정 화면이 없고, 마켓플레이스 수수료율 결정 전 잘못된 값으로 결제되는 것을 막음. 다른 테이블이 FK로 가리키지 않는 기준 데이터 | 예 | 팀장 | [#28](https://github.com/Yun-Jehyeok/vocals/issues/28) |
| 2026-11-21 | 하네스 주간 보고를 예약 작업으로 매주 토 09:45 KST에 `pnpm harness:report` 결과를 #17 댓글로 남긴다(첫 실행 2026-11-28) | 차단·반려·CI 실패 추이를 정기적으로 보려고 | 예 | 팀장 | [#17](https://github.com/Yun-Jehyeok/vocals/issues/17) |
| 2026-11-21 | 서브에이전트 worktree 격리는 클라우드에서 권한으로 막혀 있으므로 developer frontmatter의 `isolation`을 빼고, 병렬 작업은 수동 `git worktree add /tmp/wt-<이슈>`로 한다 | `isolation: worktree`로 띄우면 권한 거부, 동기화되면 developer 실행이 막힐 위험 | 예 | 팀장 | [#17](https://github.com/Yun-Jehyeok/vocals/issues/17), [PR #25](https://github.com/Yun-Jehyeok/vocals/pull/25) |
| 2026-11-21 | 트레일러가 본문에 붙어 git 트레일러로 인식되지 않은 커밋(ce4853a)은 강제 push로 고치지 않고 둔다. 이후 지시는 "본문과 트레일러 사이 빈 줄 하나, 트레일러끼리는 빈 줄 없이"로 쓴다 | 기능 영향 없음, 강제 push 금지 | 아니오 | 팀장 | [#17](https://github.com/Yun-Jehyeok/vocals/issues/17), [PR #24](https://github.com/Yun-Jehyeok/vocals/pull/24) |
| 2026-11-21 | `.claude/agent-memory/`와 `.claude/logs/`는 `harness` 라벨 검사에서 제외한다. 메모리 내용은 팀장이 merge 요청 전 PR diff로 확인한다 | 평소 작업 PR에서 바뀌는 파일이라 라벨을 매번 요구할 수 없음 | 예 | 팀장 | [#17](https://github.com/Yun-Jehyeok/vocals/issues/17), [PR #23](https://github.com/Yun-Jehyeok/vocals/pull/23), [PR #25](https://github.com/Yun-Jehyeok/vocals/pull/25) |
| 2026-11-21 | `docs/`는 CI로 보호하지 않고, 팀장이 merge 요청 전에 PR 파일 목록을 확인한다 | docs 변경은 기획 담당의 정상 작업이라 CI로 막을 수 없음 | 예 | 팀장 | [#17](https://github.com/Yun-Jehyeok/vocals/issues/17) |
| 2026-11-21 | `harness-change` 검사를 main 규칙 세트의 필수 검사로 지정(설정은 PM이 GitHub Rulesets에서) | 하네스 변경이 라벨 없이 merge되지 않게 | 예 | PM | [#17](https://github.com/Yun-Jehyeok/vocals/issues/17) |
| 2026-11-21 | 하네스 자체 수정은 CODEOWNERS 대신 `harness` 라벨 CI 검사로 통제, 라벨은 팀장이 붙인다 | 추천안 C(CI 표시) 채택 | 예 | PM | [#17](https://github.com/Yun-Jehyeok/vocals/issues/17), [PR #20](https://github.com/Yun-Jehyeok/vocals/pull/20) |
| 2026-11-21 | 워크플로에 쓰기 권한을 주지 않는다. 라벨 유지 문제는 merge 직전 하네스 diff 재확인으로 대응 | CI 권한 최소화 | 예 | 팀장 | [#17](https://github.com/Yun-Jehyeok/vocals/issues/17), [PR #21](https://github.com/Yun-Jehyeok/vocals/pull/21) |
| 2026-11-20 | acceptance-guard는 인수 테스트 최종 내용이 마지막 `Acceptance: qa` 커밋(없으면 merge-base)과 같은지로 판정 | 잘못 바꾼 커밋은 revert로 복구 가능 | 예 | 팀장 | [#17](https://github.com/Yun-Jehyeok/vocals/issues/17), [PR #18](https://github.com/Yun-Jehyeok/vocals/pull/18) |
| 2026-11-20 | `tickets`의 enum 타입은 `tickets_lesson_type`·`tickets_ticket_type`으로 따로 둔다(`lesson_products_*` 재사용 안 함) | 이름 규칙 `<테이블>_<컬럼>` 유지 | 예 | 팀장 | [#17](https://github.com/Yun-Jehyeok/vocals/issues/17), [PR #14](https://github.com/Yun-Jehyeok/vocals/pull/14) |
| 2026-11-20 | 팀장 직접 결정 범위: 되돌릴 수 있고 승인 항목이 아닌 것. 돈(가격·수수료·환불·정산), 법·약관, 개인정보 공개 범위, 범위 변경은 PM | PM 병목 줄이기 | 예 | PM | [#17](https://github.com/Yun-Jehyeok/vocals/issues/17) |
| 2026-11-20 | 하네스 보강 계획(1~7단계)과 CI 변경(fetch-depth, 인수 테스트 보호, 기존 마이그레이션 diff 실패) 승인 | 클라우드에서 확실히 강제되는 곳은 CI뿐 | 예 | PM | [#17](https://github.com/Yun-Jehyeok/vocals/issues/17) |
| 2026-11-20 | 강제 위치: 클라우드는 플러그인 훅 + CI, 로컬은 `.claude/settings.json` | 클라우드 스레드는 settings 훅을 적용하지 않음 | 예 | PM | [#17](https://github.com/Yun-Jehyeok/vocals/issues/17) |
| 2026-11-20 | 측정 로그는 세션별 JSONL로 남기고 작업 PR에 커밋한다 | 클라우드 컨테이너 파일은 세션이 끝나면 사라짐 | 예 | PM | [#17](https://github.com/Yun-Jehyeok/vocals/issues/17) |
| 2026-11-20 | 모니터링 에이전트는 플러그인 훅으로 읽기 전용 강제. 7단계는 Sentry·운영 환경이 생길 때까지 멈춤 | 전제(앱, Sentry, 운영 Supabase)가 없음 | 예 | PM | [#17](https://github.com/Yun-Jehyeok/vocals/issues/17) |
| 2026-11-20 | "자기 학생" = 그 트레이너의 끝나지 않은 수강권(`waiting_schedule`·`active`)이 있는 학생 (AUTH-09) | 수강이 끝나면 개인정보 열람도 끝나야 함 | 예 | PM | [PR #14](https://github.com/Yun-Jehyeok/vocals/pull/14) |
| 2026-11-20 | 정지된 트레이너도 자기 프로필은 고칠 수 있다(공개만 안 됨) (ADM-02) | 정지 해제 뒤 이어 쓸 수 있게 | 예 | PM | [#16](https://github.com/Yun-Jehyeok/vocals/issues/16), [PR #14](https://github.com/Yun-Jehyeok/vocals/pull/14) |
| 2026-11-20 | 탈퇴한 사용자(삭제 전 보관 중)는 자기 정보를 고칠 수 없다 (AUTH-07) | 탈퇴는 계정 삭제 | 예 | PM | [#16](https://github.com/Yun-Jehyeok/vocals/issues/16), [PR #14](https://github.com/Yun-Jehyeok/vocals/pull/14) |
| 2026-11-20 | 전국 시·군·구 데이터는 별도 이슈. PM이 code.go.kr 법정동코드 원본을 올린 뒤 새 마이그레이션으로 넣는다 | 원본 없이 지역 목록을 지어내지 않음 | 예 | PM | [#15](https://github.com/Yun-Jehyeok/vocals/issues/15) |
| 2026-11-19 | 권한 테스트는 CI 설정을 바꾸지 않고 기존 `pnpm test`(PGlite) 안에서 PR마다 돈다 | CI 변경 승인 없이 PR마다 실행 | 예 | 팀장 | [#11](https://github.com/Yun-Jehyeok/vocals/issues/11), [PR #13](https://github.com/Yun-Jehyeok/vocals/pull/13) |
| 2026-11-19 | 로그인은 Supabase Auth(`users.id` = auth 사용자 id), `auth_identities` 테이블 없음. 개인정보는 `user_private_profiles`·`user_account_records`·`trainer_business_profiles`로 분리 | 행 단위 RLS로 숨길 정보를 나누려고 | 조건부 | 팀장 | [#11](https://github.com/Yun-Jehyeok/vocals/issues/11), [PR #12](https://github.com/Yun-Jehyeok/vocals/pull/12) |
| 2026-11-19 | ERD 표기: enum 타입 이름 `<테이블>_<컬럼>`, `id`는 uuid(기준 데이터 `regions`·`genres`만 int) | 화면·API·DB 이름 통일 | 조건부 | 팀장 | [PR #12](https://github.com/Yun-Jehyeok/vocals/pull/12) |
| 2026-11-19 | 정지된 트레이너 프로필은 본인·운영자·수강 관계가 있는 학생만 본다 (ADM-02) | 기존 수강생은 계속 수업 정보가 필요 | 예 | PM | [#11](https://github.com/Yun-Jehyeok/vocals/issues/11), [PR #12](https://github.com/Yun-Jehyeok/vocals/pull/12) |
| 2026-11-19 | 트레이너는 자기 학생의 실명·생년월일·휴대폰만 본다. 연계정보·탈퇴 일정은 본인·운영자만 (AUTH-09) | 레슨 연락에 필요한 만큼만 | 예 | PM | [#11](https://github.com/Yun-Jehyeok/vocals/issues/11), [PR #12](https://github.com/Yun-Jehyeok/vocals/pull/12) |
| 2026-11-19 | 사업자 유형·번호는 승인 전(`pending`)까지만 본인이, 그 뒤에는 운영자만 고친다 (AUTH-04) | 원천징수 여부가 정산에 영향 | 예 | PM | [#11](https://github.com/Yun-Jehyeok/vocals/issues/11), [PR #12](https://github.com/Yun-Jehyeok/vocals/pull/12) |
| 2026-11-19 | 트레이너 프로필 링크(`link_slug`)는 서버가 자동 생성하고 바꿀 수 없다 (TRN-02) | 이미 보낸 링크가 깨지지 않게 | 조건부 | PM | [#11](https://github.com/Yun-Jehyeok/vocals/issues/11), [PR #12](https://github.com/Yun-Jehyeok/vocals/pull/12) |
| 2026-11-19 | 지역은 전국 시·도와 시·군·구, 시 단위(일반구 없음), 세종은 한 줄 (TRN-08) | 필터를 단순하게 | 예 | PM | [#11](https://github.com/Yun-Jehyeok/vocals/issues/11), [PR #12](https://github.com/Yun-Jehyeok/vocals/pull/12) |
| 2026-11-19 | 정산 계좌는 승인 때가 아니라 가입 신청할 때 받는다 (AUTH-04) | PRD·T-01과 맞춤 | 예 | PM | [#11](https://github.com/Yun-Jehyeok/vocals/issues/11), [PR #12](https://github.com/Yun-Jehyeok/vocals/pull/12) |
| 2026-11-19 | Supabase 테스트 프로젝트 전까지 로컬 DB와 seed 더미 데이터로 개발·테스트, 원격 프로젝트는 만들지 않는다(다른 외부 서비스는 mock 금지 유지) | 테스트 프로젝트는 PM이 나중에 만듦 | 예 | PM | [PR #9](https://github.com/Yun-Jehyeok/vocals/pull/9) |
| 2026-11-19 | 회차 금액 = 결제 금액 ÷ 총 횟수의 1원 미만 버림, 남는 금액은 마지막 차감 회차에 더한다 (STL-02) | 합계가 결제 금액과 정확히 같게 | 조건부 | PM | [PR #7](https://github.com/Yun-Jehyeok/vocals/pull/7) |
| 2026-11-19 | 기술 스택: Expo, Supabase, Mux, 포트원 V2 + 파트너 정산, 채팅은 Supabase Realtime 직접 구현, Expo Notifications, 운영자 웹 Next.js, 딥링크 Airbridge | 적은 인원으로 관리형 서비스 사용 | 조건부 | PM | [PR #5](https://github.com/Yun-Jehyeok/vocals/pull/5) |
| 2026-11-19 | 단계: 1단계 레슨 관리·앱 내 결제·트레이너 찾기·채팅·후기·운영자, 2단계 기본기 클래스·연습 영상 피드백·온라인 일회성 클래스. AI 영상 분석 보류 | 결제·마켓플레이스를 1단계로 합침 | 예 | PM | [PR #1](https://github.com/Yun-Jehyeok/vocals/pull/1), [PR #2](https://github.com/Yun-Jehyeok/vocals/pull/2) |
| 2026-11-19 | 모바일 우선, iOS·Android 동시 출시(크로스플랫폼), 웹은 나중(운영자 웹만 1단계) | — | 예 | PM | [PR #1](https://github.com/Yun-Jehyeok/vocals/pull/1) |
| 2026-11-19 | 모든 수업은 오프라인, 숙제는 앱. 온라인 수업은 2단계 기본기 클래스만 | — | 예 | PM | [PR #1](https://github.com/Yun-Jehyeok/vocals/pull/1) |
| 2026-11-19 | 개인 트레이너만, 가입 신청 후 운영자 승인. 본인 확인은 휴대폰 본인인증 | — | 예 | PM | [PR #1](https://github.com/Yun-Jehyeok/vocals/pull/1) |
| 2026-11-19 | 미성년자(만 19세 미만)는 받지 않는다 | — | 조건부 | PM | [PR #1](https://github.com/Yun-Jehyeok/vocals/pull/1), [PR #2](https://github.com/Yun-Jehyeok/vocals/pull/2) |
| 2026-11-19 | 한 계정은 트레이너이면서 학생일 수 없다. 학생은 여러 트레이너에게 동시에 배울 수 있다 | — | 조건부 | PM | [PR #1](https://github.com/Yun-Jehyeok/vocals/pull/1) |
| 2026-11-19 | 로그인: 카카오, 구글, iOS는 애플 추가 | 앱스토어 지침 4.8 | 예 | PM | [PR #1](https://github.com/Yun-Jehyeok/vocals/pull/1) |
| 2026-11-19 | 학생 합류: 트레이너 링크로 가입하고 수강권을 결제하면 수강 관계가 생긴다 | — | 예 | PM | [PR #1](https://github.com/Yun-Jehyeok/vocals/pull/1) |
| 2026-11-19 | 수강권은 정기권(4·8·12회 또는 직접 입력)과 일회권(체험). 유효기간은 결제일부터 1년. 가격은 트레이너가 정한다 | — | 조건부 | PM | [PR #1](https://github.com/Yun-Jehyeok/vocals/pull/1) |
| 2026-11-19 | 결제는 앱 안 PG 결제(인앱 결제 아님). 플랫폼이 받고 PG 지급대행으로 정산 | 오프라인 서비스는 인앱 결제 불가(지침 3.1.3(e)) | 조건부 | PM | [PR #1](https://github.com/Yun-Jehyeok/vocals/pull/1) |
| 2026-11-19 | 수수료: 트레이너 링크 유입 8%(PG 포함, 부가세 별도), 마켓플레이스 유입은 더 높게(비율 미정). 수강 관계에 유입 경로 기록 | — | 조건부 | PM | [PR #1](https://github.com/Yun-Jehyeok/vocals/pull/1) |
| 2026-11-19 | 정산은 회차 차감(출석·결석·보강) 때 대상이 되고, 월 1회 지난달분을 지급한다 | — | 조건부 | PM | [PR #1](https://github.com/Yun-Jehyeok/vocals/pull/1) |
| 2026-11-19 | 환불은 남은 회차만큼이 기본. 금액 계산 등 세부는 미정 | — | 조건부 | PM | [PR #1](https://github.com/Yun-Jehyeok/vocals/pull/1) |
| 2026-11-19 | 파일럿: 지정 트레이너와 그 링크로 온 학생은 무료. 목록 유입 학생은 결제. 종료 뒤 받은 수강권은 유효기간까지 | — | 조건부 | PM | [PR #1](https://github.com/Yun-Jehyeok/vocals/pull/1) |
| 2026-11-19 | 일정은 고정이고 변경은 트레이너만. 학생 취소는 24시간 전까지(사전 취소), 트레이너 취소는 사전 취소로 처리 | — | 예 | PM | [PR #1](https://github.com/Yun-Jehyeok/vocals/pull/1) |
| 2026-11-19 | 출결은 출석·결석·사전 취소·보강 4가지. 사전 취소만 차감 안 함. 체크는 트레이너만 | — | 조건부 | PM | [PR #1](https://github.com/Yun-Jehyeok/vocals/pull/1) |
| 2026-11-19 | 숙제는 레슨 회차에 묶는다. 제출은 연습 영상 필수(음성만 불가), 여러 번 제출 가능. 영상은 5분 이하로 시작 | 얼굴·몸 움직임까지 봐야 함 | 예 | PM | [PR #1](https://github.com/Yun-Jehyeok/vocals/pull/1) |
| 2026-11-19 | 피드백은 텍스트와 영상 시점 코멘트. 음성·영상 답장, 나란히 보기는 나중 | — | 예 | PM | [PR #1](https://github.com/Yun-Jehyeok/vocals/pull/1) |
| 2026-11-19 | 1단계 숙제 영상은 해당 트레이너·학생·운영자만 본다 | — | 조건부 | PM | [PR #1](https://github.com/Yun-Jehyeok/vocals/pull/1) |
| 2026-11-19 | 단체 채팅방은 트레이너당 하나(그룹 레슨별 방 없음). 텍스트·사진만, 닉네임·프로필 사진만 보인다 | 영상은 저장 비용 때문에 나중 | 예 | PM | [PR #1](https://github.com/Yun-Jehyeok/vocals/pull/1) |
| 2026-11-19 | 알림은 앱 푸시만. 카카오 알림톡은 나중 | — | 예 | PM | [PR #1](https://github.com/Yun-Jehyeok/vocals/pull/1) |
| 2026-11-19 | 트레이너 찾기는 출시와 함께 연다. 필터는 지역·장르·가격대. 후기는 있고 별점은 없다. 등록 전 문의용 1:1 대화를 1단계에 넣는다 | — | 예 | PM | [PR #1](https://github.com/Yun-Jehyeok/vocals/pull/1) |
