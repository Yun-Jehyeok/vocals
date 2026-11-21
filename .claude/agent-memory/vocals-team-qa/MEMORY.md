# QA 메모리 — 반복되는 함정

- RLS 매트릭스의 insert 칸: 대상 행이 이미 있으면 정책이 허용할 때 중복 키(23505)로 "판정 불가" 오류가 난다. setup에서 그 행을 먼저 지워 권한만으로 판정되게 한다(#16 `removeBusinessProfile`).
- `OpCase.setup`/`withActor` setup은 관리자(postgres)로 돈다. "서버가 처리한 상태"로 만들려면 setup 안에서 `set local role service_role` → 작업 → `reset role`. service_role은 auth 스키마 테이블에도 쓸 수 있다(shim).
- 상태를 바꾸는 setup을 쓰면 "준비 상태 확인" 테스트를 같이 둔다. setup이 아무것도 안 하면 차단 칸이 개발 뒤에도 원인 모를 실패로 남는다.
- 한 파일에 매트릭스가 여러 개면 최상위 `beforeAll`로 DB 하나를 띄우고 `describeRlsMatrix(m, { db: () => db })`로 넘긴다(매트릭스마다 DB를 띄우면 느리다).
- 컬럼 단위 판정은 매트릭스 밖에서 `attempt()`를 그대로 써서 판정 규칙(0행·42501 = 차단)을 맞춘다.
- 개발 전 인수 테스트에서 seed는 개발이 바꾼다. 판정용 행은 seed와 겹치지 않는 id로 `<이슈>-fixture.ts`에서 서버로 넣는다(#28). seed의 unique 쌍(예: enrollments 학생–트레이너)과 부딪히지 않게 사용자도 따로 만든다.
- 값 검사·정원·중복처럼 "막는 방법을 개발이 고르는" 조건은 `attemptWrite`(23xxx·42501·P0001·0행 = 거부)로 판정하고, 바른 값의 짝(허용)을 꼭 같이 둔다. `attempt`는 제약 오류를 던지므로 권한 칸에만 쓴다.
- `describeRlsMatrix`의 `title:`은 요구사항 추적 센서가 읽지 않는다(describe/it 문자열만 읽는다). ID를 세게 하려면 매트릭스 밖 describe/it 이름에도 넣는다(#28).
- 플러그인 훅은 /tmp 복사본에서도 QA의 마이그레이션 쓰기를 막는다. 구현 없이 인수 테스트를 미리 돌려 볼 수 없다. 준비 데이터가 바르다는 근거는 "준비 상태 확인" 테스트와 허용 짝으로 남긴다(#28).
