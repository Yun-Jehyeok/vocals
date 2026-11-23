# apps/mobile — Expo 앱

학생·트레이너·운영자가 함께 쓰는 앱이다. Expo SDK 58(React Native 0.88), TypeScript, Expo Router(`app/` 폴더의 파일이 화면 주소). 지금은 실기기에서 **Expo Go**로 실행한다(개발용 빌드·스토어 빌드는 다른 이슈).

- 설정 값과 로그인 연결: `docs/tech-stack.md` 3.12
- 화면 목록: `docs/screens.md`, 디자인: `docs/design.md`

## 내 컴퓨터에서 실행하기 (Expo Go)

### 1. 준비

- Node 22 이상, pnpm 10(`corepack enable`이면 레포의 `packageManager` 버전을 쓴다)
- 휴대폰에 **Expo Go**(App Store·Google Play 최신). 앱 정보에서 SDK 58을 지원하는지 확인한다.

### 2. 설치

레포 루트에서:

```sh
pnpm install
```

### 3. `.env` 만들기

값은 사람이 직접 넣는다. `.env`는 커밋하지 않는다(`.gitignore`가 막는다).

```sh
cp apps/mobile/.env.example apps/mobile/.env
```

`apps/mobile/.env`를 열어 두 줄을 채운다.

| 이름                                   | 넣을 값                                                        | 어디서                                                                          |
| -------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`             | 테스트 프로젝트 URL. `https://<프로젝트 ref>.supabase.co` 모양 | Supabase 대시보드 → 테스트 프로젝트 → Project Settings → Data API의 Project URL |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable key. `sb_publishable_`로 시작                      | Supabase 대시보드 → 테스트 프로젝트 → Project Settings → API Keys               |

- `EXPO_PUBLIC_`으로 시작하는 값은 앱 코드에 그대로 들어간다. **비밀 키(`sb_secret_…`, service role key)는 절대 넣지 않는다.**
- 운영 프로젝트가 아니라 테스트 프로젝트의 값을 넣는다.
- `.env`를 고친 뒤에는 개발 서버를 껐다 켠다(`--clear`를 붙이면 캐시도 지운다).

### 4. Supabase 로그인 돌아오는 주소 (처음 한 번)

Supabase 대시보드 → 테스트 프로젝트 → Authentication → URL Configuration → Redirect URLs에 `exp://**`(Expo Go용)와 `vocals://auth/callback`을 넣는다. `exp://**`는 테스트 프로젝트에만 넣는다(`docs/tech-stack.md` 3.12). 빠지면 카카오 로그인 뒤 브라우저에 머물고 앱으로 돌아오지 않는다.

### 5. 개발 서버 켜기

레포 루트에서:

```sh
# 컴퓨터와 휴대폰이 같은 Wi-Fi일 때
pnpm --filter @vocals/mobile start

# 같은 Wi-Fi가 아니거나 QR로 열리지 않을 때(회사·카페 Wi-Fi 등)
pnpm --filter @vocals/mobile start --tunnel
```

- `--tunnel`을 처음 쓰면 `@expo/ngrok`를 설치할지 묻는다. 설치한다.
- 터미널에 QR 코드가 나온다.
  - iPhone: 기본 카메라 앱으로 QR을 찍고 Expo Go로 연다.
  - Android: Expo Go 앱의 "Scan QR code"로 찍는다.
- 코드를 고치면 앱이 바로 바뀐다. 터미널에서 `r`은 새로 고침, `Ctrl+C`는 종료.

### 문제가 생기면

- "Project is incompatible with this version of Expo Go": 휴대폰의 Expo Go를 최신으로 업데이트한다(SDK 58).
- QR을 찍어도 연결되지 않음: `--tunnel`로 다시 켠다.
- "설정 값이 없어요" 화면(로그인 기능이 들어간 뒤): `apps/mobile/.env`의 두 값을 확인하고 서버를 껐다 켠다.

## 테스트

앱 테스트는 jest(`jest-expo` 프리셋)와 React Native Testing Library로 돈다. 루트 `pnpm test`·`pnpm check`에 함께 들어간다. 테스트 범위는 `jest.config.js`가 정한다(하네스 파일, 바꾸면 `harness` 라벨).

```sh
pnpm --filter @vocals/mobile test                            # 앱 테스트 전체
pnpm --filter @vocals/mobile test -- tests/acceptance/56      # 경로·이름으로 거르기
pnpm --filter @vocals/mobile typecheck                       # 타입 검사
```

| 위치                                      | 누가 | 내용                                                                                            |
| ----------------------------------------- | ---- | ----------------------------------------------------------------------------------------------- |
| `tests/acceptance/<이슈번호>-*.test.tsx`  | QA   | 인수 테스트. 폴더 전체(테스트 대역·헬퍼 포함)가 보호 경로다(`Acceptance: qa`, acceptance-guard) |
| `tests/*.test.tsx`, `src/**/*.test.ts(x)` | 개발 | 단위·스모크 테스트                                                                              |

### 렌더하는 방법

실제 `app/` 라우트를 그대로 렌더하려면 `expo-router/testing-library`의 `renderRouter`를 쓴다. RNTL 14부터 렌더가 비동기라 `await`가 필요하다.

```tsx
import { renderRouter, screen } from "expo-router/testing-library";

it("첫 화면", async () => {
  await renderRouter("./app", { initialUrl: "/" }); // 경로는 apps/mobile 기준
  expect(await screen.findByText("vocals")).toBeOnTheScreen();
  expect(screen).toHavePathname("/");
});
```

- 화면 주소 확인은 `toHavePathname`·`toHaveSegments`, 이동은 `testRouter.push("/…")`. 딥링크로 돌아오는 경우는 `initialUrl`에 주소를 넣는다.
- 컴포넌트 하나만 볼 때는 `@testing-library/react-native`의 `render`(역시 `await`).
- 예: `tests/smoke.test.tsx`.

### 환경·외부 모듈

- jest는 `apps/mobile/.env`를 읽지 않는다. 설정 값은 테스트 안에서 `process.env.EXPO_PUBLIC_SUPABASE_URL = "…"`처럼 넣고 지운다(앱 코드는 실행할 때 읽는다).
- `__DEV__`는 jest에서 `true`다. 운영 번들 조건은 `globalThis.__DEV__ = false`로 바꿔 렌더한 뒤 되돌린다.
- 외부 연결은 테스트 안에서 라이브러리 경계를 `jest.mock`으로 대역을 둔다(제품 코드에는 mock이 없다). 앱이 쓰는 경계 라이브러리:
  - `@supabase/supabase-js`(`createClient`, `auth.*`)
  - `expo-web-browser`(`openAuthSessionAsync` 등), `expo-auth-session`(`makeRedirectUri`), `expo-linking`
  - `expo-secure-store`, `@react-native-async-storage/async-storage`(공식 대역: `@react-native-async-storage/async-storage/jest/async-storage-mock`)
