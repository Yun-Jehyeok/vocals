# QA 메모리 — 반복되는 함정

- RLS 매트릭스의 insert 칸: 대상 행이 이미 있으면 정책이 허용할 때 중복 키(23505)로 "판정 불가" 오류가 난다. setup에서 그 행을 먼저 지워 권한만으로 판정되게 한다(#16 `removeBusinessProfile`).
- `OpCase.setup`/`withActor` setup은 관리자(postgres)로 돈다. "서버가 처리한 상태"로 만들려면 setup 안에서 `set local role service_role` → 작업 → `reset role`. service_role은 auth 스키마 테이블에도 쓸 수 있다(shim).
- 상태를 바꾸는 setup을 쓰면 "준비 상태 확인" 테스트를 같이 둔다. setup이 아무것도 안 하면 차단 칸이 개발 뒤에도 원인 모를 실패로 남는다.
- 한 파일에 매트릭스가 여러 개면 최상위 `beforeAll`로 DB 하나를 띄우고 `describeRlsMatrix(m, { db: () => db })`로 넘긴다(매트릭스마다 DB를 띄우면 느리다).
- 컬럼 단위 판정은 매트릭스 밖에서 `attempt()`를 그대로 써서 판정 규칙(0행·42501 = 차단)을 맞춘다.
