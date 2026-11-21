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
