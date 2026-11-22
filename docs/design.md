# 디자인 규칙과 화면

- 상태: 초안 (이슈 #49)
- 기준: `docs/screens.md`의 화면 목록과 각 화면 요소. 이 문서는 디자인 규칙(토큰·컴포넌트)과 화면 디자인 링크를 모은다. 화면 목록·흐름은 `docs/screens.md`가 기준이다.
- 디자인 파일(Claude 디자인 아티팩트, PM 결정 2026-11-22: Figma 대신 사용)
  - 디자인 시스템 **vocals 디자인 시스템**: https://claude.ai/artifact/5MGMPfBoWvA48XwPhS5XiQ
  - 화면 캔버스 **vocals 핵심 화면 (#49)**: https://claude.ai/artifact/PUswzb8Yft4ytPKsd5DKv8
- 앱(Expo / React Native)에는 아래 값을 그대로 옮긴다. px로 적은 값은 dp(React Native 기본 단위)로 같은 숫자다.

## 1. 원칙

1. **한 손으로.** 화면의 주요 행동은 아래쪽(하단 고정 버튼, 탭바)에 둔다. 앱바에는 뒤로 가기와 제목만.
2. **크게 누른다.** 모든 터치 영역은 48 이상(`touch-min`). 작게 보이는 아이콘·글자 버튼은 `hitSlop`으로 48을 맞춘다.
3. **글자를 키워도 깨지지 않는다.** 고정 `height` 대신 `minHeight`, 글자는 줄바꿈. `allowFontScaling`을 끄지 않는다. 탭바 라벨·상태 배지만 `maxFontSizeMultiplier` 1.5.
4. **색만으로 알리지 않는다.** 상태는 항상 글자 배지로도 쓴다. 글자 대비 4.5:1 이상, 컨트롤 테두리·아이콘 3:1 이상(아래 색 표에 대비 값).
5. **상태 화면을 모두 그린다.** 화면마다 기본·빈 화면·로딩·오류, 볼 권한이 없을 수 있는 화면은 권한 없음까지.

## 2. 토큰

### 2.1 색 (라이트 테마)

다크 테마는 이번 범위가 아니다. 이름은 디자인 시스템의 토큰 이름과 같다(코드에서는 `colors.primary`처럼 쓰면 된다).

| 토큰 | 값 | 쓰임 |
|---|---|---|
| `primary` | `#5B3FD0` | 주요 행동(채운 버튼), 선택된 탭, 링크 글자. 흰 글자 대비 6.9:1, surface 위 글자 6.9:1. |
| `primary-pressed` | `#4A31B0` | primary를 누른 상태. primary-soft 위 글자색(7.6:1). |
| `primary-soft` | `#EFEBFC` | 선택·강조 바탕. '진행 중'·'보강'·'피드백' 배지 바탕. |
| `on-primary` | `#FFFFFF` | primary·danger 채움 위 글자와 아이콘. |
| `ink` | `#18161D` | 기본 글자·아이콘. surface 위 17.9:1. |
| `ink-muted` | `#5C5866` | 보조 글자(날짜, 트레이너 이름, 남은 횟수), 선택 안 된 탭. surface 6.9:1, surface-sunken 6.4:1. |
| `ink-disabled` | `#A19CA8` | 비활성 버튼 글자 전용. 읽어야 하는 글자에는 쓰지 않는다. |
| `surface` | `#FFFFFF` | 카드, 시트, 앱바, 탭바, 하단 고정 버튼 영역 바탕. |
| `surface-sunken` | `#F6F5F8` | 화면 바탕(카드 뒤), 비활성 버튼 바탕. |
| `line` | `#E6E3EA` | 카드 테두리, 목록 구분선. 장식용이라 대비 기준 없음. |
| `line-control` | `#8C8794` | 보조 버튼·입력 테두리, 화살표 아이콘. surface 위 3.5:1(컨트롤 3:1 기준 충족). |
| `success-soft` | `#E3F5EB` | '제출됨'·'출석' 배지 바탕. |
| `success-ink` | `#1B6B43` | success-soft 위 글자(5.7:1). |
| `warning-soft` | `#FFF1DB` | '마감 임박'·'일정 대기'·'출결 미체크' 배지, 재결제 배너 바탕. |
| `warning-ink` | `#8A4B00` | warning-soft 위 글자·아이콘(6.1:1). |
| `danger` | `#C9302C` | 오류·되돌릴 수 없는 행동 채움. 흰 글자 5.3:1. |
| `danger-soft` | `#FDECEA` | '결석'·'마감 지남' 배지, 오류 화면 아이콘 바탕. |
| `danger-ink` | `#A3221F` | danger-soft 위 글자·아이콘(6.5:1). |
| `neutral-soft` | `#EEECF1` | '미제출'·'종료'·'사전 취소' 배지 바탕. 글자는 ink-muted(5.9:1). |
| `video-bg` | `#1E1B24` | 영상 썸네일·플레이어 바탕. |
| `scrim` | `rgba(24,22,29,0.64)` | 썸네일 위 재생 시간 칩 바탕. 위 글자는 on-primary. |
| `skeleton` | `#ECEAF0` | 로딩 중 자리 표시(스켈레톤) 블록. |

### 2.2 글자

- 글꼴: **Noto Sans KR** 400·500·700(Google Fonts). 앱에서는 `@expo-google-fonts/noto-sans-kr`로 불러오는 것을 제안한다(라이브러리 선택은 개발).
- 줄 높이는 px 값 그대로 `lineHeight`에 넣는다.

| 스타일 | fontSize | lineHeight | fontWeight | 쓰임 |
|---|---|---|---|---|
| `display` | 26 | 34 | 700 | 홈 화면 인사말 한 줄. |
| `title-1` | 22 | 30 | 700 | 화면 큰 제목(트레이너 이름, 숙제 제목). |
| `title-2` | 18 | 26 | 700 | 섹션 제목, 앱바 제목. |
| `body` | 16 | 24 | 400 | 본문, 설명, 소개글, 후기. |
| `body-strong` | 16 | 24 | 700 | 버튼 글자, 목록 항목 제목, 가격. |
| `label` | 14 | 20 | 500 | 보조 버튼, 칩, 섹션의 '전체 보기'. |
| `caption` | 13 | 18 | 400 | 메타 정보(날짜, 트레이너, 남은 횟수, 영상 길이). |
| `micro` | 12 | 16 | 500 | 탭바 라벨, 상태 배지. 12px보다 작은 글자는 쓰지 않는다. |

### 2.3 간격

4 단위. 화면 좌우 여백은 항상 `screen-x` 20, 섹션 사이 `space-8` 32, 카드 안 `space-4` 16.

| 토큰 | 값 | 쓰임 |
|---|---|---|
| `space-1` | 4 | 아이콘과 글자 사이, 배지 안 위아래. |
| `space-2` | 8 | 배지 좌우, 칩 사이, 같은 묶음의 줄 사이. |
| `space-3` | 12 | 목록 항목 안 요소 사이, 카드 안 줄 묶음 사이. |
| `space-4` | 16 | 카드 안 여백, 카드와 카드 사이. |
| `screen-x` | 20 | 화면 좌우 여백. 모든 화면 같은 값. |
| `space-6` | 24 | 섹션 제목과 내용 사이 묶음, 하단 고정 영역 위아래. |
| `space-8` | 32 | 섹션과 섹션 사이. |
| `space-10` | 40 | 빈 화면·오류 화면 위쪽 여백. |

### 2.4 크기

| 토큰 | 값 | 쓰임 |
|---|---|---|
| `touch-min` | 48 | 모든 터치 영역의 최소 높이·너비. 작게 보이는 요소는 hitSlop으로 48을 맞춘다. |
| `button-lg` | 52 | 화면의 주요 버튼(하단 고정 CTA) 높이. |
| `button-md` | 48 | 카드 안 버튼, 보조 버튼 높이. |
| `app-bar` | 56 | 상단 앱바 높이(상태 표시줄 safe area 제외). |
| `tab-bar` | 64 | 하단 탭바 높이(홈 인디케이터 safe area 제외). |
| `list-item-min` | 64 | 목록 항목 최소 높이. 글자 확대 시 늘어난다. |
| `avatar-sm` | 40 | 목록·후기의 프로필 사진. |
| `avatar-lg` | 80 | 트레이너 프로필 상단 사진. |
| `icon` | 24 | 기본 아이콘. 선 굵기 2px. |
| `play-button` | 56 | 영상 썸네일 가운데 재생 버튼. |

### 2.5 모서리

| 토큰 | 값 | 쓰임 |
|---|---|---|
| `radius-sm` | 6 | 상태 배지. |
| `radius-md` | 10 | 버튼, 영상 썸네일, 배너. |
| `radius-lg` | 16 | 카드, 바텀 시트 위 모서리. |
| `radius-full` | 999 | 프로필 사진, 칩, 재생 버튼. |

### 2.6 그림자

React Native에서는 iOS `shadowColor/Offset/Opacity/Radius`, Android `elevation`으로 옮긴다. 카드에는 그림자를 쓰지 않고 테두리(`line`)로 구분한다.

| 토큰 | 값(CSS) | 쓰임 |
|---|---|---|
| `shadow-bottom-bar` | `0 -4px 16px rgba(24,22,29,0.06)` | 하단 고정 버튼 영역·탭바 위쪽 그림자. |
| `shadow-play` | `0 2px 8px rgba(24,22,29,0.24)` | 썸네일 위 재생 버튼. |

## 3. 컴포넌트

미리보기와 지침은 디자인 시스템의 Components에 있다. 아래는 요약이다.

| 컴포넌트 | 요약 |
|---|---|
| Button | primary(화면당 하나) · secondary · text · disabled. 높이 52(`button-lg`) / 48(`button-md`), 모서리 10, 글자 body-strong. 누르면 `primary-pressed` |
| Card | 바탕 `surface`, 테두리 1 `line`, 모서리 16, 안 여백 16, 줄 묶음 사이 12. 그림자·왼쪽 색 띠 없음 |
| ListItem | 최소 높이 64, 여백 12/16. [사진 40·아이콘] · 제목(body-strong 2줄)+메타(caption) · [배지 또는 화살표] |
| TabBar | 높이 64 + safe area. 아이콘 24 + 라벨 12. 선택: `primary`+굵게, 나머지 `ink-muted`. 학생: 홈·찾기·레슨·채팅·내 정보 / 트레이너: 홈·학생·일정·채팅·내 정보 |
| AppBar | 높이 56 + safe area. 뒤로 가기(48) + 제목(title-2). 오른쪽 행동 없음 |
| VideoThumbnail | 16:9, 모서리 10, 바탕 `video-bg`, 가운데 재생 버튼 56, 오른쪽 아래 재생 시간 칩(`scrim`). 너비 160 미만은 재생 버튼 없이 시간만 |
| StatusBadge | 높이 24, 좌우 8, 모서리 6, micro 12. 톤 5개(아래 표) |
| StateView | 아이콘 원 64 + 제목(title-2) + 설명(body, `ink-muted`) + 버튼. 빈 화면 inbox, 오류 alert(`danger-soft`), 권한 없음 lock |
| Skeleton | `skeleton` 블록(모서리 6). 실제 내용과 같은 자리·크기. 300ms 안의 로딩에는 안 보여 준다 |

상태 배지:

| 영역 | 글자 | 값 | 톤 |
|---|---|---|---|
| 수강권 | 일정 대기 | tickets.status = waiting_schedule | warning |
| 수강권 | 진행 중 | tickets.status = active | primary |
| 수강권 | 종료 | tickets.status = ended | neutral |
| 숙제 | 미제출 | 제출 기록 없음 (HW-11) | neutral |
| 숙제 | 제출됨 | 제출 기록 1개 이상 (HW-11) | success |
| 숙제 마감 | 마감 임박 | 마감 24시간 이내·미제출 (디자인 표시) | warning |
| 숙제 마감 | 마감 지남 | 마감 지남·미제출 (디자인 표시, 결정 필요 1) | danger |
| 출결 | 미체크 | lesson_participants.attendance = none (지난 회차) | warning |
| 출결 | 출석 | attendance = present | success |
| 출결 | 결석 | attendance = absent | danger |
| 출결 | 보강 | attendance = makeup | primary |
| 출결 | 사전 취소 | attendance = pre_canceled | neutral |
| 환불 요청 | 요청됨 | refund_requests.status = requested | warning |
| 피드백 | 피드백 n개 | feedback_comments 수 | primary |

톤: neutral = `neutral-soft`/`ink-muted`, primary = `primary-soft`/`primary-pressed`, success = `success-soft`/`success-ink`, warning = `warning-soft`/`warning-ink`, danger = `danger-soft`/`danger-ink`.

아이콘: 24px, 선 굵기 2, 둥근 끝의 선 아이콘(예: lucide-react-native, 제안). home, search, music(레슨 탭), chat, user, users(학생 탭), calendar(일정), chevron-left/right, clock, pin, video, message, check, refund, alert, lock, inbox, refresh, play(채운 삼각형).

## 4. 화면 (모바일 390 폭 아트보드)

캔버스의 행마다 화면 하나, 열마다 상태 하나다. 기본 상태의 아트보드는 스크롤 끝까지 길게 그렸다.

| 화면 | 아트보드(상태) | 근거 |
|---|---|---|
| S-01 트레이너 프로필 | [기본](https://claude.ai/artifact/PUswzb8Yft4ytPKsd5DKv8#artboard-Main) · [빈 화면](https://claude.ai/artifact/PUswzb8Yft4ytPKsd5DKv8#artboard-S01-empty) · [로딩](https://claude.ai/artifact/PUswzb8Yft4ytPKsd5DKv8#artboard-S01-loading) · [오류](https://claude.ai/artifact/PUswzb8Yft4ytPKsd5DKv8#artboard-S01-error) · [볼 수 없음](https://claude.ai/artifact/PUswzb8Yft4ytPKsd5DKv8#artboard-S01-unavailable) · [파일럿 링크(시작하기)](https://claude.ai/artifact/PUswzb8Yft4ytPKsd5DKv8#artboard-S01-pilot) | TRN-01~09, PAY-02, DM-01, PLT-02, PLT-07, ADM-02 |
| S-04 학생 홈 | [기본](https://claude.ai/artifact/PUswzb8Yft4ytPKsd5DKv8#artboard-S04-default) · [빈 화면(일정 대기)](https://claude.ai/artifact/PUswzb8Yft4ytPKsd5DKv8#artboard-S04-empty) · [로딩](https://claude.ai/artifact/PUswzb8Yft4ytPKsd5DKv8#artboard-S04-loading) · [오류](https://claude.ai/artifact/PUswzb8Yft4ytPKsd5DKv8#artboard-S04-error) | SCH-09, HW-11, PAY-05, PAY-07 |
| S-14 숙제 상세 | [기본](https://claude.ai/artifact/PUswzb8Yft4ytPKsd5DKv8#artboard-S14-default) · [빈 화면(예시 영상·제출 없음)](https://claude.ai/artifact/PUswzb8Yft4ytPKsd5DKv8#artboard-S14-empty) · [로딩](https://claude.ai/artifact/PUswzb8Yft4ytPKsd5DKv8#artboard-S14-loading) · [오류](https://claude.ai/artifact/PUswzb8Yft4ytPKsd5DKv8#artboard-S14-error) · [권한 없음](https://claude.ai/artifact/PUswzb8Yft4ytPKsd5DKv8#artboard-S14-forbidden) | HW-02, HW-07, HW-12 |
| T-06 트레이너 홈 | [기본](https://claude.ai/artifact/PUswzb8Yft4ytPKsd5DKv8#artboard-T06-default) · [빈 화면](https://claude.ai/artifact/PUswzb8Yft4ytPKsd5DKv8#artboard-T06-empty) · [로딩](https://claude.ai/artifact/PUswzb8Yft4ytPKsd5DKv8#artboard-T06-loading) · [오류](https://claude.ai/artifact/PUswzb8Yft4ytPKsd5DKv8#artboard-T06-error) | ATT-04, PAY-05, PAY-10 |

화면별 요소(`docs/screens.md` 항목과 대응):

- **S-01**: 사진·이름·지역·장르·후기 수 → 소개·노래 영상(가로 스크롤, 최대 3개) → 소개글 → 경력 → 레슨 장소 → 레슨 상품(1:1 / 그룹 전환, 정기권 회차별 가격·일회권 가격, 레슨 길이, 유효기간 1년) → 후기(최신 2개 + 'n개 모두 보기' → S-22) → 하단 고정 [문의하기 → S-21] [상품 고르기]. 상품 줄을 누르면 S-02. 파일럿 링크로 들어오면 레슨 상품 섹션이 없고 하단이 [문의하기] [시작하기 → S-03]. 볼 수 없는 프로필(정지·잘못된 링크, ADM-02)은 '볼 수 없음' 상태.
- **S-04**: 인사말 → 재결제 배너(수강권 1회 남음일 때만) → 다가오는 레슨(→ S-11, 전체 → S-10) → 해야 할 숙제(미제출, 마감 임박 순, → S-14, 전체 → S-13) → 새로 온 피드백(→ S-16). 빈 화면은 정기권 결제 후 일정 대기 상태(6장 표: “트레이너가 일정을 입력하면 알려 드려요”). 수강 중인 트레이너가 없는 홈은 S-05(이번 범위 밖).
- **S-14**: 상태 배지(미제출/제출됨, 마감 임박) → 숙제 제목·트레이너·레슨 회차·마감일 → 예시 영상(있을 때) → 설명 → 내 제출 기록(→ S-16) → 하단 고정 [제출하기 → S-15]. 권한 없음은 HW-12(숙제를 받은 학생·트레이너·운영자만).
- **T-06**: 인사말·오늘 날짜 → 오늘의 레슨(→ T-12) → 출결 체크가 필요한 회차([출결 체크] → T-13) → 일정 입력이 필요한 학생([일정 입력] → T-09) → 새 숙제 제출(→ T-18) → 환불 요청(→ T-20). 섹션 제목 옆에 건수. 오늘의 레슨은 항상 보이고, 나머지 섹션은 항목이 없으면 숨기며, 모두 없으면 빈 화면의 '확인할 일이 모두 끝났어요' 카드.

## 5. 개발이 알아야 할 점

- **상태 전환**: 로딩 → 내용/빈 화면/오류는 150ms 페이드. 스켈레톤과 실제 내용의 자리·크기를 맞춰 레이아웃이 튀지 않게 한다. 300ms 안에 끝나는 로딩은 스켈레톤을 보여 주지 않는다.
- **스켈레톤 애니메이션**: 투명도 1 → 0.5 → 1, 1.2초 반복. 기기의 '동작 줄이기'(Reduce Motion) 설정이면 멈춘다. 스크린 리더에는 “불러오는 중” 하나만 읽힌다.
- **오류**: 화면 전체를 못 불러오면 StateView + [다시 시도]. 탭 화면(S-04, T-06)은 당겨서 새로고침도 된다. 일부 섹션만 실패하면 그 섹션 자리에만 “이 부분을 불러오지 못했어요 · 다시 시도” 한 줄. 오류 코드·기술 용어는 보여 주지 않는다.
- **로딩 중 버튼**: 하단 고정 버튼은 자리를 유지하고 disabled로 그린다(누를 수 없음).
- **누름 피드백**: 100ms 안에 바탕색(primary → `primary-pressed`) 또는 투명도 0.85.
- **S-01 [상품 고르기]**: 화면 안의 레슨 상품 섹션으로 스크롤만 한다(새 화면 없음). 결제는 상품 줄을 눌러 S-02로 간다.
- **S-01 영상**: 가로 스크롤, 끝 카드가 화면 오른쪽 밖으로 살짝 보이게(다음 영상이 있다는 신호). 누르면 전체 화면 플레이어.
- **S-14 하단 [제출하기]**: 제출 기록이 있어도 계속 보인다(HW-07 여러 번 제출).
- **safe area**: 아트보드에는 상태 표시줄·홈 인디케이터를 그리지 않았다. 앱바·탭바·하단 고정 영역에 safe area를 더한다.
- **이름**: 학생은 닉네임만, 트레이너는 프로필 이름. 아트보드의 이름·가격·장소·날짜는 모두 예시(더미)다.

## 6. 결정 필요

1. **마감이 지난 숙제의 제출** — `docs/prd.md` HW-02는 마감일만 정하고, 마감 뒤 제출이 되는지는 없다. 추천: 제출은 허용하고 S-14·S-13에 '마감 지남' 배지만 단다(연습을 막지 않음). 되돌릴 수 있음: 예. 막히는 작업: 없음(아트보드에는 마감 전 상태만 그림).
2. **'마감 임박' 배지 기준** — 문서에 없다. 추천: 마감 24시간 이내이고 미제출인 숙제. 되돌릴 수 있음: 예.
3. **S-04 '새로 온 피드백'의 '새로'** — 문서에 기준이 없고 `feedback_comments`에 읽음 표시가 없다. 추천: 학생이 아직 읽지 않은 피드백 알림(`notifications.read_at`이 빈 `feedback_added`)이 있는 제출. 되돌릴 수 있음: 예. 막히는 작업: S-04 구현의 데이터 조회.
4. **T-06 '새 숙제 제출'의 '새'** — 문서에 기준이 없다. 추천: 트레이너 피드백이 아직 하나도 없는 제출. 되돌릴 수 있음: 예. 막히는 작업: T-06 구현의 데이터 조회.
5. **S-04 재결제 배너를 누르면 가는 화면** — `docs/screens.md`에 없다. 추천: S-07 수강권 상세(재결제 버튼이 있는 화면). 되돌릴 수 있음: 예.
