# 보컬 레슨 플랫폼 기술 스택 — 1단계

- 상태: 초안 (모든 항목 확정)
- 기준 문서: `docs/prd.md`(PR #2), `docs/screens.md`(PR #3), `docs/erd.md`(PR #4). 괄호 안의 `HW-06` 같은 ID가 그 선택이 다루는 요구사항이다.
- 가격과 버전은 2026년 11월 기준으로 조사했다. 계약·도입 전에 각 서비스 페이지에서 다시 확인한다.
- 표기: **[결정 n]**은 이 문서 끝 "결정 필요" n번과 연결된 항목이다.

## 1. 고르는 기준

1. **적은 인원으로 빨리 만들 수 있을 것** — 직접 서버를 운영하기보다 관리형 서비스를 쓴다.
2. **React 경험을 그대로 쓸 수 있을 것** — 앱, 운영자 웹, 공용 코드가 모두 TypeScript·React로 이어지게 한다.
3. **한국 서비스에 맞을 것** — 카카오 로그인, 휴대폰 본인인증, 국내 PG 결제, 법에 맞는 정산.
4. **처음에는 싸고, 커질 때 비용을 예측할 수 있을 것**

## 2. 한눈에 보기 (확정)

| 영역 | 추천 | 대안 | 관련 요구사항 |
|---|---|---|---|
| 앱 | Expo (React Native) | Flutter | NFR-01 |
| 백엔드·DB·로그인 | Supabase (Postgres) | Firebase, 직접 구축 | AUTH, 전체 데이터 |
| 영상 | Mux | Cloudflare Stream | HW, TRN-07, NFR-03, NFR-04 |
| 결제·본인인증·정산 | 포트원(PortOne) V2 + 파트너 정산 | PG사 직접 연동(토스페이먼츠 등) | PAY, AUTH-03, STL |
| 채팅 | Supabase Realtime으로 직접 구현 | Sendbird | CHAT, DM |
| 푸시 알림 | Expo Notifications | FCM·APNs 직접 | NOTI |
| 딥링크 | Airbridge DeepLink Plan | Branch, AppsFlyer | NFR-05 |
| 운영자 웹 | Next.js | Supabase 대시보드 직접 사용 | ADM |
| 오류 추적 | Sentry | — | — |
| 빌드·배포·CI | EAS Build·Submit + GitHub Actions | — | — |

## 3. 영역별 비교

### 3.1 앱: Expo (React Native)

- **Expo**: React Native 위에서 빌드, 푸시, 카메라, 업데이트 같은 기능을 묶어 주는 도구다. npm 기준 최신은 Expo SDK 58(React Native 0.88)이고, React Native는 0.82부터 New Architecture만으로 돌아간다. 예전처럼 "성능 때문에 네이티브가 낫다"는 차이는 거의 없다.
- **Flutter**: 성능과 완성도는 비슷하지만 Dart를 새로 배워야 하고, 운영자 웹(React)과 코드를 나눠 쓸 수 없다.
- **추천: Expo**
  - React·TypeScript로 앱과 운영자 웹을 같이 만들 수 있고, 타입과 도메인 로직을 공용 패키지로 나눠 쓸 수 있다.
  - 이 앱에 필요한 카메라 촬영(HW-09), 푸시(NOTI), 딥링크(NFR-05)를 Expo 기본 기능으로 처리할 수 있다.
  - 주의: 원격 푸시 테스트는 Expo Go 앱으로 안 되고, 개발용 빌드(development build)가 필요하다.

### 3.2 백엔드·DB·로그인: Supabase

| | Supabase | Firebase | 직접 구축 (예: NestJS + Postgres) |
|---|---|---|---|
| DB | Postgres (관계형) | Firestore (문서형) | Postgres |
| 이 서비스와 맞는 정도 | 수강권·회차·출결·정산처럼 서로 얽힌 데이터에 맞음 | 관계가 많은 데이터는 다루기 불편 | 맞음 |
| 로그인 | 카카오, 구글, 애플 기본 지원 | 카카오는 직접 연동 | 직접 연동 |
| 권한 | DB 정책(RLS)으로 "내 학생 숙제만" 같은 규칙 | 보안 규칙 | 코드로 직접 |
| 실시간 | Realtime (채팅) | 기본 제공 | 직접 구축 |
| 서버 운영 | 없음 | 없음 | 직접 |

- **추천: Supabase**
  - `docs/erd.md`의 모델이 그대로 Postgres 테이블이 된다.
  - 숙제 영상 열람 권한(HW-12)처럼 "누가 무엇을 볼 수 있는지"를 DB 정책(RLS)으로 한 곳에서 강제할 수 있다.
  - 결제 확인, 본인인증 결과 저장, 월 정산 계산, 출결 미체크 알림처럼 서버에서 해야 하는 일은 Edge Functions와 예약 작업(pg_cron)으로 처리한다.
- **비용**: Pro 플랜 월 25달러부터 시작한다. 무료 플랜은 일주일 동안 접속이 없으면 멈추므로 실제 서비스에는 Pro가 필요하다.
- **주의**: Realtime 동시 접속 수는 플랜별 한도가 있다(Pro 500). 처음에는 충분하지만, 채팅 사용자가 크게 늘면 한도를 다시 본다.

### 3.3 영상: Mux

두 서비스 모두 이 앱에 필요한 기능을 갖췄다: 끊겨도 이어 올리기(NFR-03), 인코딩 자동 처리, 서명된 주소로만 재생(NFR-04, 영상 주소를 알아도 남은 못 보게).

| | Mux | Cloudflare Stream |
|---|---|---|
| 인코딩 | 무료 (기본 화질) | 무료 |
| 저장 | 분당 월 0.0024달러(720p) ~ 0.003달러(1080p), 오래 안 본 영상은 더 싸짐 | 1,000분당 월 5달러 (분당 0.005달러) |
| 재생 | 매달 10만 분 무료, 이후 분당 0.0008달러(720p)부터 | 1,000분당 1달러 |

- 이 앱의 영상은 **많이 쌓이고 적게 본다**. 연습 영상은 그 학생과 트레이너만 몇 번 본다. 그래서 저장 단가가 낮고 재생이 매달 10만 분까지 무료인 Mux가 유리하다.
- 예시 계산 (가정: 트레이너 50명 × 학생 10명 × 매주 3분짜리 연습 영상 1개)
  - 1년 뒤 쌓인 영상: 약 78,000분
  - Mux(1080p): 저장 월 약 230달러, 재생은 무료 구간 안
  - Cloudflare Stream: 저장 월 약 390달러 + 재생
  - 720p로 저장하면 Mux는 더 싸진다.
  - 연습 영상은 수강권이 끝나고 1년 뒤 지운다(6장). 그래서 위 예시처럼 끝없이 쌓이지 않는다.
- **추천: Mux**. 비용이 예측하기 쉬운 쪽을 원하면 Cloudflare Stream도 충분하다.

### 3.4 결제·본인인증·정산: 포트원 V2 + 파트너 정산

이 영역은 법 규정이 선택을 좌우한다.

- **정산은 PG 라이선스가 있는 곳을 거쳐야 한다.** 전자금융거래법 제28조에 따라, 파트너에게 정산금을 지급하는 플랫폼은 PG 라이선스를 가진 제3자를 통해 지급해야 한다. 플랫폼 통장에서 트레이너 통장으로 직접 보내면 안 된다. `docs/idea.md`에서 정한 "PG 지급대행"이 이 때문에 필요하다.
- **PG사 지급대행만으로는 막히는 부분이 두 가지 있다.**
  - 간편결제(카카오페이, 네이버페이, 토스페이)는 지급대행을 제공하지 않는다. 간편결제로 받은 돈을 PG 지급대행 계좌로 옮기려면 플랫폼이 직접 돈을 움직여야 해서 규정에 걸린다. 1단계에서 간편결제를 넣기로 했으므로(PAY-01) 이 문제가 생긴다.
  - PG사 지급대행은 사업자등록이 없는 개인에게 지급하지 못하는 경우가 많다. 개인 보컬 트레이너 중에는 사업자등록이 없는 사람이 많다. 사업자등록이 없는 개인 트레이너도 받기로 했다(6장).
- **포트원**
  - 여러 PG와 간편결제를 한 번에 연동한다. React Native SDK가 있다.
  - 휴대폰 본인인증을 같은 방식으로 붙일 수 있다(앱에서 인증 → 서버가 포트원 API로 결과 확인). 본인인증 업체와 결제 PG사가 달라도 된다.
  - "파트너 정산" 서비스가 정산금 계산, 지급대행, 세금계산서 역발행, 개인 파트너의 원천징수(3.3%) 처리, 계좌·예금주 검증까지 해 준다. 간편결제 대금까지 모아서 적법하게 지급한다.
- **추천: 포트원 V2 결제 + 본인인증 + 파트너 정산**. 실제 결제 PG사(카드)와 본인인증 업체는 포트원 상담 때 수수료를 비교해 고른다.
- **`docs/erd.md`에 주는 영향**: `trainer_business_profiles.payout_seller_id`는 "포트원 파트너 ID"가 된다. 정산 계좌는 그대로 포트원에만 맡기고 우리는 ID와 "은행명·끝 4자리"만 저장한다. 트레이너의 사업자 유형 필드가 추가된다(6장).
- **주의**: 포트원 React Native SDK가 지금 쓰는 Expo SDK 버전에서 동작하는지 첫 구현 때 확인한다.

### 3.5 채팅: Supabase Realtime으로 직접 구현

| | Supabase Realtime 직접 구현 | Sendbird |
|---|---|---|
| 비용 | Supabase 요금에 포함 | 무료 개발 플랜은 MAU 100명, 유료는 월 수백 달러부터 |
| 금칙어 필터·신고·차단 | 직접 만든다 (ERD에 이미 `reports`, `blocks` 있음) | 기본 제공 |
| 데이터 위치 | 우리 DB (운영자 열람, 탈퇴 처리와 한곳에서) | Sendbird 서버 |

- **추천: 직접 구현**. 1단계 채팅은 텍스트와 사진만 보내는 단체방과 1:1 대화라 기능이 단순하다. 운영자 화면, 탈퇴 처리, 수강권 종료 시 자동 퇴장(CHAT-03)을 우리 DB와 한곳에서 다루는 게 쉽다.
- 금칙어 필터(CHAT-07, DM-05)는 메시지를 저장하기 전에 서버 함수에서 금칙어 목록으로 거른다. 후기와 후기 답글도 사용자 생성 콘텐츠라(NFR-02) 같은 서버 함수 방식으로 거른다. 신고가 많아지면 AI 판별을 붙이거나 Sendbird로 옮기는 것을 다시 검토한다.

### 3.6 푸시 알림: Expo Notifications

- Expo Notifications가 Android(FCM)와 iOS(APNs)를 하나의 토큰과 API로 묶어 준다. 서버(Supabase Edge Functions)에서 Expo 푸시 서비스로 보낸다. (NOTI-01, NOTI-02)
- 알림을 누르면 해당 화면으로 가도록 `notifications.payload`에 이동할 화면 정보를 넣는다.

### 3.7 딥링크: Airbridge DeepLink Plan

- 앱이 없는 학생이 트레이너 링크를 누르면 설치 후 그 트레이너 프로필로 바로 가야 한다(NFR-05). 이걸 "디퍼드 딥링크"라고 한다.
- 예전에 많이 쓰던 Firebase Dynamic Links는 2025년 8월 25일에 서비스가 끝났다. 지금은 Branch, AppsFlyer, Airbridge 같은 딥링크 서비스를 쓰거나, OS 기본 기능(Universal Links / App Links)으로 직접 만든다. OS 기본 기능만으로는 설치 후 이어지기가 안 된다.
- **Airbridge DeepLink Plan**: 월 사용자 1만 명까지 무료이고, 그 뒤로 1,000명당 월 3달러다. 디퍼드 딥링크, 우리 도메인 링크, QR 코드, 클릭·설치 통계를 준다. 국내 회사라 카카오톡 공유 환경을 잘 안다.
- **추천: Airbridge**. 도입 전에 Expo 환경 SDK 지원을 확인한다. 이로써 PRD 결정 필요 1(딥링크 방식)이 정해진다.

### 3.8 운영자 웹: Next.js

- 운영자 기능은 앱 안(운영자 계정)과 별도 웹 양쪽에 있다(ADM-06).
- 웹은 Next.js(React)로 만들고 Supabase에 바로 연결한다. 앱과 같은 공용 타입·로직 패키지를 쓴다. 운영자만 쓰는 화면이라 디자인보다 표·검색·필터 위주로 만든다.

### 3.9 오류 추적·빌드·CI

- **Sentry**: 앱과 운영자 웹의 오류·크래시를 모은다.
- **EAS Build·Submit**: 앱 빌드와 스토어 제출. **EAS Update**로 심사 없이 JS 코드만 고쳐 배포할 수 있다(긴급 수정용).
- **GitHub Actions**: PR마다 lint, 타입 검사, 테스트를 돌린다. main 브랜치 보호로 통과하지 못한 PR은 merge할 수 없게 한다. 구현 단계에 들어갈 때 CLAUDE.md, 훅과 함께 세팅한다.

### 3.10 레포 구조

하나의 레포(모노레포)에 아래처럼 둔다.

```
apps/
  mobile/      Expo 앱 (학생·트레이너·운영자)
  admin/       Next.js 운영자 웹
packages/
  shared/      타입, 도메인 규칙(차감·정산 계산 등), 상수(장르·지역)
supabase/
  migrations/  DB 스키마 (docs/erd.md 기준)
  functions/   Edge Functions (결제 확인, 정산, 알림, 금칙어 필터)
docs/
```

- 차감·정산 같은 규칙을 `packages/shared`에 한 번만 쓰고 앱·웹·서버 함수가 같이 쓴다.
- 규칙을 Supabase 전용 기능에 덜 기대게 해 두면, 사용자가 크게 늘었을 때 API만 Express·NestJS 같은 직접 구축 서버로 옮길 수 있다. DB는 같은 Postgres라 그대로 쓴다.

### 3.11 보안 기본 원칙

- 모든 테이블에 DB 정책(RLS)을 켠다. 정책이 없는 테이블은 앱에서 바로 읽힐 수 있으므로, 새 테이블을 만들 때 정책을 함께 만든다.
- "다른 트레이너의 학생 숙제를 볼 수 없다" 같은 권한 테스트를 CI에서 돌린다. 테스트가 실패하면 merge하지 않는다.
- 관리자 권한 키(service role key)는 서버 함수에서만 쓰고, 앱과 운영자 웹 코드에는 절대 넣지 않는다.
- 연습 영상(얼굴이 나옴)은 해외 서비스(Mux)에 저장되므로, 개인정보 처리방침에 해외 이전 사실을 적는다. Supabase 프로젝트 리전은 서울로 둘 수 있는지 확인한다.

### 3.12 앱 설정 값과 로그인 연결 (이슈 #56, 제안 — 결정 후 확정)

앱(`apps/mobile`)이 Supabase와 소셜 로그인에 붙는 방법이다. 여기 값은 모두 공개 값이다.

- **환경 변수**: 앱은 아래 두 값만 읽는다. Expo는 앱 폴더의 `.env`에서 `EXPO_PUBLIC_`로 시작하는 변수를 빌드할 때 코드에 넣으므로, 이 이름에는 공개 값만 둔다. 비밀 키(service role key, `sb_secret_…`)를 이 이름으로 두면 앱에 그대로 들어간다(3.11).

  | 이름 | 값 |
  |---|---|
  | `EXPO_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL (`https://<프로젝트 ref>.supabase.co`) |
  | `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key (`sb_publishable_…`) |

- **`.env` 다루기**: 키 이름은 `.env.example`에만 적고, 값이 든 `apps/mobile/.env`는 사람이 만든다(CLAUDE.md 보안). 값이 없으면 앱은 대체 값 없이 설정 오류 화면을 보여 준다.
- **로그인과 `users` 행**: 로그인·세션은 Supabase Auth만 쓴다. `users` 행은 본인인증(C-03) 뒤에 만든다(`docs/erd.md` 2장).
- **소셜 로그인 방식**: Supabase `signInWithOAuth` + 기기 웹 브라우저 인증 세션 + PKCE. 로그인이 끝나면 앱 scheme 주소로 앱에 돌아와 코드를 세션으로 바꾼다.
- **앱 scheme**: `vocals`. 돌아오는 주소는 `vocals://auth/callback`.
- **Supabase Auth Redirect URLs**(대시보드 Authentication → URL Configuration)

  | 주소 | 쓰임 | 넣는 프로젝트 |
  |---|---|---|
  | `exp://**` | Expo Go 실기기 테스트. 돌아오는 주소가 `exp://<컴퓨터 IP>:8081/--/auth/callback`처럼 네트워크마다 바뀐다 | 테스트 프로젝트만 |
  | `vocals://auth/callback` | 개발용 빌드·출시 앱 | 테스트·운영 |

  허용 목록에 없는 주소로 돌아오려 하면 Supabase가 Site URL로 보내 앱으로 돌아오지 못한다.
- **소셜 로그인 공급자 콘솔**: 카카오 디벨로퍼스의 Redirect URI는 Supabase 콜백(`https://<프로젝트 ref>.supabase.co/auth/v1/callback`)이다. 앱 scheme이 아니다.
- **세션 저장**: 기기에 평문으로 두지 않는다. 암호화 키는 `expo-secure-store`(기기 보안 저장소), 암호화한 세션은 AsyncStorage에 둔다(SecureStore 값 크기 한도 때문). 세션 자동 갱신은 앱이 앞에 있을 때만 돈다. 토큰·사용자 정보는 로그에 남기지 않는다.

## 4. 검토한 대안: Express 직접 구축

Express + PostgreSQL(AWS RDS) + Cloudflare R2 + Mux로 백엔드를 직접 만드는 안과 비교했고, 1단계는 Supabase로 가기로 했다.

| | Supabase (선택) | Express 직접 구축 |
|---|---|---|
| 인프라 비용 (파일럿) | 월 약 25달러 | 월 약 40달러 |
| 인프라 비용 (1년 뒤 가정) | 월 약 30~75달러 | 월 약 150~200달러 (서버 2대, 로드밸런서, 다중 AZ DB, NAT, Redis) |
| 개발·운영 시간 | 로그인·권한·실시간·업로드·예약 작업 제공 | 전부 직접 구현·운영 |
| 보안 | 위험이 RLS 설정에 모여 있음 | 통제권이 크지만 실수할 지점이 많음 |
| 확장성 | 1단계 규모에 충분, Realtime 동시 접속은 플랜 한도 | 수평 확장 자유, 대신 직접 구성 |

- 직접 구축할 때 S3에 둔 영상을 Cloudflare CDN으로 내보내는 것은 Cloudflare 약관상 제한된다(Stream, Images, R2에 올린 것만 허용).
- 아이폰은 기본적으로 HEVC(.mov)로 촬영해 일부 안드로이드에서 재생되지 않으므로, 영상 변환은 어느 안이든 Mux 같은 서비스에 맡긴다.

## 5. 초기 고정 비용 (대략)

| 항목 | 비용 |
|---|---|
| Supabase Pro | 월 25달러부터 |
| Mux | 쓰는 만큼 (처음에는 몇 달러 수준) |
| Airbridge | 월 사용자 1만 명까지 무료 |
| Apple Developer Program | 연 99달러 |
| Google Play 개발자 등록 | 25달러 (한 번) |
| 포트원·PG·본인인증 | 결제·인증 건별 수수료 (상담 후 확정) |

## 6. 함께 정한 운영 규칙

- **개인 트레이너**: 사업자등록이 없는 개인 트레이너도 받는다. 정산할 때 3.3%를 원천징수하고 신고한다(포트원 파트너 정산이 처리를 돕는다). 트레이너의 사업자 유형(개인 / 개인사업자 / 법인)과 사업자등록번호를 저장한다.
- **연습 영상 보관 기간**: 수강권이 끝나고 1년이 지나면 그 수강권의 연습 영상을 지운다. 지우기 한 달 전에 학생에게 알린다. 예시 영상(영상 보관함)과 프로필 영상은 지우지 않는다.
- **레포 구조**: 3.10의 모노레포.

## 7. 결정 필요

지금은 없다.

## 참고 자료

- Expo New Architecture 안내: https://docs.expo.dev/guides/new-architecture
- Supabase 소셜 로그인(카카오 포함): https://supabase.com/docs/guides/auth/social-login
- Mux 가격: https://www.mux.com/docs/pricing
- Cloudflare Stream 가격: https://developers.cloudflare.com/stream/pricing
- 포트원 React Native SDK: https://github.com/portone-io/react-native-sdk
- 포트원 본인인증 안내: https://blog.portone.io/authorization-payment-2
- 포트원 파트너 정산(교육 플랫폼, 전자금융거래법 제28조): https://blog.portone.io/ps_industry-series_education/
- PG 지급대행과 간편결제 정산 문제: https://blog.portone.io/ps_public-hearing/
- Firebase Dynamic Links 종료: https://www.appsflyer.com/?p=364599
- Airbridge DeepLink Plan: https://airbridge.io/deeplink-plan
- Sendbird 가격: https://www.featurebase.app/blog/sendbird-pricing
- Cloudflare 약관 변경(CDN 영상 제한): https://blog.cloudflare.com/updated-tos/
- Supabase 가격: https://supabase.com/pricing
- Cloudflare R2 가격: https://developers.cloudflare.com/r2/pricing
