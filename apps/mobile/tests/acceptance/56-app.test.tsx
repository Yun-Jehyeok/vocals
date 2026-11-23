// #56 앱 기본 틀·카카오 로그인 인수 테스트(QA) — 렌더 테스트.
// 근거: 이슈 #56 완료 조건 "자동 확인", docs/tech-stack.md 3.12, docs/screens.md 1장, docs/design.md C-02 아트보드, docs/decisions.md 2026-11-23.
//
// 테스트 대역(제품 코드의 mock이 아니다): 앱이 밖과 만나는 라이브러리 경계만 바꾼다.
//   @supabase/supabase-js createClient → 아래 가짜 클라이언트(auth만. from·rpc는 부르면 실패)
//   expo-web-browser openAuthSessionAsync, expo-auth-session makeRedirectUri, expo-secure-store,
//   @react-native-async-storage/async-storage(공식 jest 대역)
// 가짜 클라이언트는 앱이 createClient에 넘긴 저장소(options.auth.storage)로 세션을 읽고 쓴다(supabase-js처럼).
// 그래서 "앱을 다시 켜도 로그인 유지"는 앱의 저장소 어댑터를 그대로 거친다.
// 앱 재시작은 jest.resetModules() 뒤 ./app 을 다시 렌더해 흉내 낸다. 대역 상태는 globalThis에 두어 재시작 뒤에도 남는다(= 기기에 남은 값).
import * as routerTesting from "expo-router/testing-library";
import type * as ReactNativeModule from "react-native";

jest.mock("@supabase/supabase-js", () => mockSupabaseModule());
jest.mock("expo-web-browser", () => mockWebBrowserModule());
jest.mock("expo-auth-session", () => mockAuthSessionModule());
jest.mock("expo-secure-store", () => mockSecureStoreModule());
jest.mock("@react-native-async-storage/async-storage", () => mockAsyncStorageModule());

// ---------------------------------------------------------------------------
// 테스트 대역
// ---------------------------------------------------------------------------

const TEST_SUPABASE_URL = "https://qa56testref.supabase.co";
const TEST_PUBLISHABLE_KEY = "sb_publishable_qa56_test_key";
/** makeRedirectUri 대역이 돌려주는 주소(Expo Go 모양) */
const EXPO_GO_REDIRECT = "exp://127.0.0.1:8081/--/auth/callback";
const KAKAO_AUTHORIZE_URL =
  "https://qa56testref.supabase.co/auth/v1/authorize?provider=kakao&code_challenge=qa56&code_challenge_method=s256";

/** 화면·로그에 나오면 안 되는 값(세션 대역에 넣는다) */
const SECRET = {
  accessToken: "qa56-access-token-SHOULD-NOT-LEAK",
  refreshToken: "qa56-refresh-token-SHOULD-NOT-LEAK",
  userId: "0f56a0a0-0000-4000-8000-0000000qa056",
  nickname: "큐에이닉네임",
  email: "qa56-kakao@example.com",
  kakaoSub: "4100000056",
} as const;

/** 화면에 보이면 안 되는 오류 코드·영문 메시지(대역이 돌려준다) */
const RAW_ERRORS = [
  "access_denied",
  "User denied access",
  "invalid_grant",
  "Invalid code verifier",
  "Network request failed",
];

function fakeSession(provider = "kakao") {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: SECRET.accessToken,
    refresh_token: SECRET.refreshToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user: {
      id: SECRET.userId,
      aud: "authenticated",
      role: "authenticated",
      email: "",
      app_metadata: { provider, providers: [provider] },
      user_metadata: {
        name: SECRET.nickname,
        full_name: SECRET.nickname,
        preferred_username: SECRET.nickname,
        email: SECRET.email,
        sub: SECRET.kakaoSub,
        provider_id: SECRET.kakaoSub,
      },
      identities: [
        {
          id: SECRET.kakaoSub,
          provider,
          identity_data: { email: SECRET.email, name: SECRET.nickname },
        },
      ],
      created_at: "2026-11-23T00:00:00Z",
    },
  };
}
type FakeSession = ReturnType<typeof fakeSession>;
type AuthListener = (event: string, session: FakeSession | null) => void;
type StorageAdapter = {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
  removeItem: (key: string) => Promise<void> | void;
};
type ClientOptions = {
  auth?: {
    storage?: StorageAdapter;
    storageKey?: string;
    persistSession?: boolean;
    autoRefreshToken?: boolean;
    detectSessionInUrl?: boolean;
    flowType?: string;
  };
};
type OAuthResult = { data: { provider: string; url: string | null }; error: unknown };
type ExchangeResult = { data: { session: FakeSession | null; user: unknown }; error: unknown };
type AuthSessionResult = { type: string; url?: string };
type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };

function deferred<T = void>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function createDoubles() {
  return {
    /** createClient(url, key, options) 호출 기록 */
    createClientCalls: [] as [string, string, ClientOptions | undefined][],
    /** 세션 확인(getSession·getUser·INITIAL_SESSION)을 붙잡아 두는 문. null이면 바로 연다 */
    sessionGate: null as Deferred<void> | null,
    signInImpl: async (): Promise<OAuthResult> => ({
      data: { provider: "kakao", url: KAKAO_AUTHORIZE_URL },
      error: null,
    }),
    exchangeImpl: async (_code: string): Promise<ExchangeResult> => {
      const session = fakeSession();
      return { data: { session, user: session.user }, error: null };
    },
    openAuthSessionImpl: async (
      _url: string,
      redirect?: string | null,
    ): Promise<AuthSessionResult> => ({
      type: "success",
      url: `${redirect ?? EXPO_GO_REDIRECT}?code=qa56-auth-code`,
    }),
    secureStore: {} as Record<string, string>,
    asyncStore: {} as Record<string, string>,
    memoryStore: {} as Record<string, string>,
    listeners: new Set<AuthListener>(),
    // 호출 기록
    makeRedirectUri: jest.fn((_options?: unknown) => EXPO_GO_REDIRECT),
    openAuthSessionAsync: jest.fn(),
    secureSet: jest.fn(),
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
      signInWithOAuth: jest.fn(),
      exchangeCodeForSession: jest.fn(),
      signOut: jest.fn(),
      startAutoRefresh: jest.fn(),
      stopAutoRefresh: jest.fn(),
    },
    from: jest.fn(),
    rpc: jest.fn(),
  };
}
type Doubles = ReturnType<typeof createDoubles>;
const DOUBLES_KEY = "__qa56_doubles__";

function mockDoubles(): Doubles {
  const g = globalThis as unknown as Record<string, Doubles | undefined>;
  if (!g[DOUBLES_KEY]) g[DOUBLES_KEY] = createDoubles();
  return g[DOUBLES_KEY] as Doubles;
}
const d = mockDoubles;

function resetDoubles() {
  (globalThis as unknown as Record<string, Doubles | undefined>)[DOUBLES_KEY] = createDoubles();
}

/** supabase-js 기본 저장 키. 옵션에 storageKey가 있으면 그것 */
function storageKeyOf(url: string, options?: ClientOptions) {
  return options?.auth?.storageKey ?? `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
}

function lastClient(): [string, string, ClientOptions | undefined] | undefined {
  const calls = d().createClientCalls;
  return calls[calls.length - 1];
}

function mockSupabaseModule() {
  return {
    createClient: (url: string, key: string, options?: ClientOptions) => {
      const s = mockDoubles();
      s.createClientCalls.push([url, key, options]);
      const storageKey = storageKeyOf(url, options);
      // 저장소를 넘기지 않으면 기기에 남지 않는다(React Native에는 localStorage가 없다): 메모리에만 둔다.
      const storage: StorageAdapter = options?.auth?.storage ?? {
        getItem: (k) => s.memoryStore[k] ?? null,
        setItem: (k, v) => void (s.memoryStore[k] = v),
        removeItem: (k) => void delete s.memoryStore[k],
      };
      const gate = async () => {
        if (s.sessionGate) await s.sessionGate.promise;
      };
      const read = async (): Promise<FakeSession | null> => {
        const raw = await storage.getItem(storageKey);
        return raw ? (JSON.parse(raw) as FakeSession) : null;
      };
      const emit = (event: string, session: FakeSession | null) => {
        for (const l of [...s.listeners]) l(event, session);
      };
      const denied =
        (name: "from" | "rpc") =>
        (...args: unknown[]) => {
          s[name](...args);
          throw new Error(`QA 대역: #56은 DB 테이블을 읽거나 쓰지 않는다(${name})`);
        };
      return {
        auth: {
          getSession: async () => {
            s.auth.getSession();
            await gate();
            return { data: { session: await read() }, error: null };
          },
          getUser: async () => {
            await gate();
            const session = await read();
            return { data: { user: session?.user ?? null }, error: null };
          },
          onAuthStateChange: (cb: AuthListener) => {
            s.auth.onAuthStateChange(cb);
            s.listeners.add(cb);
            void (async () => {
              await gate();
              const session = await read();
              if (s.listeners.has(cb)) cb("INITIAL_SESSION", session);
            })();
            return {
              data: {
                subscription: {
                  id: "qa56",
                  callback: cb,
                  unsubscribe: () => void s.listeners.delete(cb),
                },
              },
            };
          },
          signInWithOAuth: async (args: unknown) => {
            s.auth.signInWithOAuth(args);
            return s.signInImpl();
          },
          exchangeCodeForSession: async (code: string) => {
            s.auth.exchangeCodeForSession(code);
            const result = await s.exchangeImpl(code);
            if (result.data.session) {
              await storage.setItem(storageKey, JSON.stringify(result.data.session));
              emit("SIGNED_IN", result.data.session);
            }
            return result;
          },
          signOut: async (args?: unknown) => {
            s.auth.signOut(args);
            await storage.removeItem(storageKey);
            emit("SIGNED_OUT", null);
            return { error: null };
          },
          startAutoRefresh: async () => void s.auth.startAutoRefresh(),
          stopAutoRefresh: async () => void s.auth.stopAutoRefresh(),
        },
        from: denied("from"),
        rpc: denied("rpc"),
      };
    },
  };
}

function mockWebBrowserModule() {
  return {
    openAuthSessionAsync: (url: string, redirect?: string | null) => {
      mockDoubles().openAuthSessionAsync(url, redirect);
      return mockDoubles().openAuthSessionImpl(url, redirect);
    },
    maybeCompleteAuthSession: () => ({ type: "failed", message: "QA 대역" }),
    warmUpAsync: async () => ({}),
    coolDownAsync: async () => ({}),
    dismissAuthSession: () => undefined,
    dismissBrowser: () => undefined,
    openBrowserAsync: async () => ({ type: "opened" }),
    WebBrowserResultType: {
      CANCEL: "cancel",
      DISMISS: "dismiss",
      OPENED: "opened",
      LOCKED: "locked",
    },
  };
}

function mockAuthSessionModule() {
  return {
    ...jest.requireActual("expo-auth-session"),
    makeRedirectUri: (options?: unknown) => mockDoubles().makeRedirectUri(options),
  };
}

function mockSecureStoreModule() {
  const store = () => mockDoubles().secureStore;
  const set = (k: string, v: string) => {
    mockDoubles().secureSet(k);
    store()[k] = v;
  };
  return {
    isAvailableAsync: async () => true,
    getItemAsync: async (k: string) => store()[k] ?? null,
    setItemAsync: async (k: string, v: string) => set(k, v),
    deleteItemAsync: async (k: string) => void delete store()[k],
    getItem: (k: string) => store()[k] ?? null,
    setItem: (k: string, v: string) => set(k, v),
    canUseBiometricAuthentication: () => false,
    AFTER_FIRST_UNLOCK: 0,
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
    ALWAYS: 2,
    WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 3,
    ALWAYS_THIS_DEVICE_ONLY: 4,
    WHEN_UNLOCKED: 5,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  };
}

/** AsyncStorage 공식 jest 대역. 앱을 다시 읽어도 값이 남도록 저장 칸을 대역 상태로 바꿔 끼운다 */
function mockAsyncStorageModule() {
  const mock = jest.requireActual(
    "@react-native-async-storage/async-storage/jest/async-storage-mock",
  );
  Object.defineProperty(mock, "__INTERNAL_MOCK_STORAGE__", {
    configurable: true,
    get: () => mockDoubles().asyncStore,
    set: () => undefined,
  });
  return mock;
}

// ---------------------------------------------------------------------------
// 앱 켜기(재시작)와 화면 읽기
// ---------------------------------------------------------------------------

type TestingLibrary = typeof routerTesting;
type ReactNative = typeof ReactNativeModule;
type App = { lib: TestingLibrary; rn: ReactNative; screen: TestingLibrary["screen"] };
/** 렌더 트리 요소(test-renderer 인스턴스) */
type Node = {
  type: unknown;
  props: Record<string, unknown>;
  parent: Node | null;
  children: (Node | string)[];
};

// 앱 재시작 흉내: jest.resetModules()로 앱 코드(app/, src/)와 그 모듈 상태를 새로 읽는다.
// 테스트 도구(expo-router/testing-library)와 같은 React·내비게이션 인스턴스를 써야 하므로 아래 라이브러리만 그대로 둔다.
const SHARED_LIBRARIES = [
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-native",
  "expo-router",
  "expo-router/tabs",
  "expo-router/stack",
  "expo-router/head",
  "expo-router/ui",
  "react-native-safe-area-context",
  "react-native-screens",
  "expo-linking",
  "expo-constants",
  "expo-modules-core",
];
const shared = new Map<string, unknown>();
for (const name of SHARED_LIBRARIES) {
  try {
    shared.set(name, jest.requireActual(name));
  } catch {
    // 설치되지 않은 하위 경로는 건너뛴다
  }
}
const sharedRN = shared.get("react-native") as ReactNative;

let current: App | null = null;

/** 앱을 새로 켠다: 앞의 앱을 내리고 앱 모듈을 새로 읽은 뒤 ./app 을 첫 화면("/")으로 렌더한다. 저장소 대역의 값은 남는다 */
async function startApp(options: { beforeRender?: (rn: ReactNative) => void } = {}) {
  await stopApp();
  jest.resetModules();
  for (const [name, mod] of shared) jest.doMock(name, () => mod);
  options.beforeRender?.(sharedRN);
  await routerTesting.renderRouter("./app", { initialUrl: "/" });
  current = { lib: routerTesting, rn: sharedRN, screen: routerTesting.screen };
  return current;
}

async function stopApp() {
  if (!current) return;
  current = null;
  await routerTesting.cleanup();
}

/** 누르고 핸들러가 끝날 때까지 기다린다 */
async function press(app: App, node: Node) {
  await app.lib.fireEvent.press(node as never);
}

/** 누르기만 하고 핸들러 끝을 기다리지 않는다(대역이 응답을 붙잡아 둔 로딩 상태용) */
// fireEvent.press는 act 안에서 핸들러를 부른 뒤 핸들러가 돌려준 Promise를 기다린다. act가 닫힐 때까지만 흘려보낸다.
async function pressNoWait(app: App, node: Node) {
  void app.lib.fireEvent.press(node as never);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await flush(app);
}

/** 대기 중인 Promise 처리를 흘려보낸다(타이머 없이) */
async function flush(app: App) {
  await app.lib.act(async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  });
}

/** 요소와 그 아래 모든 요소 */
function selfAndDescendants(node: Node): Node[] {
  const out: Node[] = [];
  const walk = (n: Node | string) => {
    if (typeof n === "string") return;
    out.push(n);
    n.children.forEach(walk);
  };
  walk(node);
  return out;
}

/** 요소와 조상들 */
function lineage(node: Node | null): Node[] {
  const out: Node[] = [];
  for (let n: Node | null = node; n; n = n.parent) out.push(n);
  return out;
}

function flat(app: App, node: Node): Record<string, unknown> {
  return (app.rn.StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
}

/** 요소나 조상 중 스타일 조건을 만족하는 것이 있는가 */
function someStyled(app: App, node: Node, pred: (s: Record<string, unknown>) => boolean) {
  return lineage(node).some((n) => pred(flat(app, n)));
}

const color = (v: unknown) =>
  String(v ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();

function rootOf(app: App): Node {
  return app.screen.root as unknown as Node;
}

/** 트리의 모든 요소(트리 순서) */
function allNodes(app: App): Node[] {
  const out: Node[] = [];
  const walk = (n: Node | string) => {
    if (typeof n === "string") return;
    out.push(n);
    (n.children as (Node | string)[]).forEach(walk);
  };
  walk(rootOf(app));
  return out;
}

/** 화면 전체 글자(트리 순서로 이어 붙임) */
function allText(app: App): string {
  const parts: string[] = [];
  const walk = (n: Node | string) => {
    if (typeof n === "string") parts.push(n);
    else (n.children as (Node | string)[]).forEach(walk);
  };
  walk(rootOf(app));
  return parts.join("\n");
}

function setEnv(url: string | undefined, key: string | undefined) {
  if (url === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  else process.env.EXPO_PUBLIC_SUPABASE_URL = url;
  if (key === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  else process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = key;
}

// 화면 문구(docs/design.md C-02 아트보드, decisions 2026-11-23, 이슈 #56)
const KAKAO_LABEL = "카카오로 시작하기";
const KAKAO_LOADING_LABEL = "로그인하는 중…";
const SPINNER_LABEL = "불러오는 중";
const INTRO = /숙제를 내고, 연습을 올리고,\s*피드백을 받는 보컬 레슨/;
const TERMS = "시작하면 이용약관과 개인정보 처리방침에 동의하게 돼요.";
const LOGIN_ERROR = "로그인하지 못했어요. 다시 시도해 주세요.";
const LOGGED_IN_KAKAO = "카카오로 로그인됨";
const IDENTITY_PENDING = "본인인증은 준비 중이에요";
const LOGOUT = "로그아웃";
const CONFIG_MISSING = "설정 값이 없어요";
const TAB_PREVIEW = "탭 미리보기";

const kakaoButton = (app: App) => app.screen.getByRole("button", { name: KAKAO_LABEL });
const findKakaoButton = (app: App) => app.screen.findByRole("button", { name: KAKAO_LABEL });

/** 첫 화면이 C-02로 정해질 때까지 */
async function startAtLogin(options?: Parameters<typeof startApp>[0]) {
  const app = await startApp(options);
  await findKakaoButton(app);
  return app;
}

/** 카카오 버튼을 눌러 로그인까지(기본 대역: 성공) */
async function loginWithKakao(app: App) {
  await press(app, kakaoButton(app));
  await app.screen.findByText(LOGGED_IN_KAKAO);
}

/** 기기에 로그인 세션이 남은 상태를 만든다: 실제 로그인 흐름으로 저장한 뒤 앱을 내린다 */
async function seedStoredSession() {
  const app = await startAtLogin();
  await loginWithKakao(app);
  await stopApp();
}

/** 오류 안내(버튼 위 빨간 안내)가 보이고 버튼은 다시 누를 수 있다 */
async function expectLoginErrorShown(app: App) {
  const alert = await app.screen.findByText(LOGIN_ERROR);
  // 빨간 안내: 글자 danger-ink 또는 바탕 danger-soft/danger (design 2.1, C-02 오류 아트보드)
  expect(
    someStyled(
      app,
      alert,
      (s) =>
        color(s.color) === "#A3221F" || ["#FDECEA", "#C9302C"].includes(color(s.backgroundColor)),
    ),
  ).toBe(true);
  // 버튼 위(트리 순서에서 안내가 버튼보다 앞)
  const nodes = allNodes(app);
  expect(nodes.indexOf(alert)).toBeLessThan(nodes.indexOf(kakaoButton(app)));
  // 오류 코드·영문 메시지는 보이지 않는다(design 5장 오류)
  const text = allText(app);
  for (const raw of RAW_ERRORS) expect(text).not.toContain(raw);
  // 다시 누를 수 있다
  const before = d().auth.signInWithOAuth.mock.calls.length;
  d().openAuthSessionImpl = async () => ({ type: "cancel" });
  await press(app, kakaoButton(app));
  await app.lib.waitFor(() => expect(d().auth.signInWithOAuth.mock.calls.length).toBe(before + 1));
}

// ---------------------------------------------------------------------------

// 앱 재시작·화면 이동이 많아 기본 5초보다 길게 둔다
jest.setTimeout(30_000);

beforeEach(() => {
  resetDoubles();
  setEnv(TEST_SUPABASE_URL, TEST_PUBLISHABLE_KEY);
});

afterEach(async () => {
  await stopApp();
  setEnv(undefined, undefined);
  jest.restoreAllMocks();
});

describe("#56 설정 값이 없을 때 — CLAUDE.md 작업 방식(mock 금지)", () => {
  it.each([
    ["EXPO_PUBLIC_SUPABASE_URL", undefined, TEST_PUBLISHABLE_KEY],
    ["EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY", TEST_SUPABASE_URL, undefined],
    ["둘 다", undefined, undefined],
  ])(
    "%s 이(가) 없으면 대체 값 없이 '설정 값이 없어요' 화면을 보여 주고 로그인 버튼을 그리지 않는다",
    async (_name, url, key) => {
      setEnv(url, key);
      const app = await startApp();
      expect(await app.screen.findByText(CONFIG_MISSING)).toBeOnTheScreen();
      expect(app.screen.queryByText(KAKAO_LABEL)).toBeNull();
      expect(app.screen.queryByRole("button", { name: KAKAO_LABEL })).toBeNull();
      // 대체 값으로 클라이언트를 만들지 않는다
      for (const [u, k] of d().createClientCalls) {
        expect(u).toBeTruthy();
        expect(k).toBeTruthy();
      }
    },
  );

  it("빈 문자열도 없는 것으로 본다", async () => {
    setEnv("", "");
    const app = await startApp();
    expect(await app.screen.findByText(CONFIG_MISSING)).toBeOnTheScreen();
    expect(app.screen.queryByText(KAKAO_LABEL)).toBeNull();
  });
});

describe("#56 C-02 로그인 화면 — AUTH-01", () => {
  it("AUTH-01 로그인 안 된 상태로 앱을 켜면 C-02: 글자 로고 'vocals', 한 줄 소개, 카카오 버튼, 약관 안내 문구 (결정 2·4)", async () => {
    const app = await startAtLogin();
    expect(app.screen.getByText("vocals")).toBeOnTheScreen();
    expect(app.screen.getByText(INTRO)).toBeOnTheScreen();
    expect(kakaoButton(app)).toBeOnTheScreen();
    expect(app.screen.getByText(TERMS)).toBeOnTheScreen();
    // 약관 안내는 버튼 아래(트리 순서에서 버튼 뒤)
    const nodes = allNodes(app);
    expect(nodes.indexOf(app.screen.getByText(TERMS))).toBeGreaterThan(
      nodes.indexOf(kakaoButton(app)),
    );
    // 로그인 안 된 상태에서는 자리 표시 화면이 아니다
    expect(app.screen.queryByText(LOGGED_IN_KAKAO)).toBeNull();
  });

  it("AUTH-01 카카오 버튼: 바탕 kakaoBg #FEE500, 글자 kakaoInk #191919, 높이 52 이상 (design 3장 SocialLoginButton)", async () => {
    const app = await startAtLogin();
    const button = kakaoButton(app);
    const label = app.screen.getByText(KAKAO_LABEL);
    expect(someStyled(app, label, (s) => color(s.backgroundColor) === "#FEE500")).toBe(true);
    expect(color(flat(app, label).color)).toBe("#191919");
    const heights = selfAndDescendants(button).map((n) => {
      const s = flat(app, n);
      return Math.max(Number(s.minHeight ?? 0), Number(s.height ?? 0));
    });
    expect(Math.max(...heights)).toBeGreaterThanOrEqual(52);
  });

  it.each(["ios", "android"])("AUTH-01 %s: 구글·애플 버튼은 그리지 않는다 (결정 3)", async (os) => {
    const app = await startAtLogin({
      beforeRender: (rn) => {
        jest.replaceProperty(rn.Platform, "OS", os as typeof rn.Platform.OS);
      },
    });
    expect(app.rn.Platform.OS).toBe(os);
    const text = allText(app);
    expect(text).not.toMatch(/apple|google|애플|구글/i);
    expect(
      app.screen.getAllByRole("button").map((b) => b.props.accessibilityLabel ?? ""),
    ).not.toEqual(expect.arrayContaining([expect.stringMatching(/apple|google|애플|구글/i)]));
  });

  it.each(["이용약관", "개인정보 처리방침"])(
    "AUTH-01 약관 링크 '%s'를 누르면 '준비 중' 안내가 나온다 (결정 4)",
    async (word) => {
      let alertSpy: jest.SpyInstance | undefined;
      const app = await startAtLogin({
        beforeRender: (rn) => {
          alertSpy = jest.spyOn(rn.Alert, "alert").mockImplementation(() => undefined);
        },
      });
      await press(app, app.screen.getByText(word));
      await app.lib.waitFor(() => {
        const alerted = (alertSpy?.mock.calls ?? []).some((args) =>
          JSON.stringify(args).includes("준비 중"),
        );
        const onScreen = app.screen.queryAllByText(/준비 중/).length > 0;
        expect(alerted || onScreen).toBe(true);
      });
      // 로그인을 시작하지 않는다
      expect(d().auth.signInWithOAuth).not.toHaveBeenCalled();
    },
  );
});

describe("#56 카카오 로그인 흐름 — AUTH-01 (결정 5·8)", () => {
  it("AUTH-01 카카오 버튼을 누르면 signInWithOAuth(provider kakao, 앱 scheme …/auth/callback, skipBrowserRedirect)가 한 번 불리고 받은 주소로 웹 인증 세션을 연다", async () => {
    const app = await startAtLogin();
    await press(app, kakaoButton(app));
    await app.lib.waitFor(() => expect(d().openAuthSessionAsync).toHaveBeenCalledTimes(1));

    expect(d().auth.signInWithOAuth).toHaveBeenCalledTimes(1);
    const args = d().auth.signInWithOAuth.mock.calls[0][0] as {
      provider: string;
      options?: { redirectTo?: string; skipBrowserRedirect?: boolean };
    };
    expect(args.provider).toBe("kakao");
    expect(args.options?.skipBrowserRedirect).toBe(true);
    const redirectTo = args.options?.redirectTo ?? "";
    expect(redirectTo).toMatch(/auth\/callback$/);
    // makeRedirectUri를 쓰면 scheme "vocals", path "auth/callback" (tech-stack 3.12)
    for (const [opts] of d().makeRedirectUri.mock.calls) {
      expect(opts).toEqual(expect.objectContaining({ scheme: "vocals", path: "auth/callback" }));
    }
    // 받은 주소로 웹 인증 세션, 돌아올 주소는 같은 redirectTo
    const [url, redirect] = d().openAuthSessionAsync.mock.calls[0];
    expect(url).toBe(KAKAO_AUTHORIZE_URL);
    expect(redirect).toBe(redirectTo);
  });

  it("AUTH-01 진행 중에는 카카오 버튼에 스피너가 보이고, 다시 눌러도 두 번째 호출이 없다 (design C-02 로딩)", async () => {
    const pending = deferred<AuthSessionResult>();
    d().openAuthSessionImpl = () => pending.promise;
    const app = await startAtLogin();
    await pressNoWait(app, kakaoButton(app));
    await app.lib.waitFor(() => expect(d().openAuthSessionAsync).toHaveBeenCalledTimes(1));

    expect(await app.screen.findByText(KAKAO_LOADING_LABEL)).toBeOnTheScreen();
    expect(app.screen.getByLabelText(SPINNER_LABEL)).toBeOnTheScreen();
    // 스피너는 카카오 버튼 안(로딩 문구와 같은 버튼)
    const spinner = app.screen.getByLabelText(SPINNER_LABEL);
    const loadingLabel = app.screen.getByText(KAKAO_LOADING_LABEL);
    const buttonOfLabel = lineage(loadingLabel).find(
      (n) => n.props.accessibilityRole === "button" || n.props.role === "button",
    );
    expect(buttonOfLabel).toBeDefined();
    expect(lineage(spinner)).toContain(buttonOfLabel);

    // 다시 누르기
    await pressNoWait(app, loadingLabel);
    await pressNoWait(app, buttonOfLabel as Node);
    expect(d().auth.signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(d().openAuthSessionAsync).toHaveBeenCalledTimes(1);

    await app.lib.act(async () => pending.resolve({ type: "cancel" }));
    expect(await findKakaoButton(app)).toBeOnTheScreen();
  });

  it("AUTH-01 돌아온 주소에 code가 있으면 exchangeCodeForSession을 한 번 부르고, 성공하면 자리 표시 화면으로 간다", async () => {
    const app = await startAtLogin();
    await press(app, kakaoButton(app));
    expect(await app.screen.findByText(LOGGED_IN_KAKAO)).toBeOnTheScreen();
    expect(d().auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(d().auth.exchangeCodeForSession).toHaveBeenCalledWith("qa56-auth-code");
    expect(app.screen.queryByRole("button", { name: KAKAO_LABEL })).toBeNull();
  });

  it("AUTH-01 Expo Go 모양 주소(exp://…/--/auth/callback?code=…)와 앱 scheme 주소(vocals://auth/callback?code=…) 모두 코드를 꺼낸다", async () => {
    for (const back of [
      `${EXPO_GO_REDIRECT}?code=qa56-code-expo`,
      "vocals://auth/callback?code=qa56-code-scheme",
    ]) {
      resetDoubles();
      d().openAuthSessionImpl = async () => ({ type: "success", url: back });
      const app = await startAtLogin();
      await press(app, kakaoButton(app));
      expect(await app.screen.findByText(LOGGED_IN_KAKAO)).toBeOnTheScreen();
      expect(d().auth.exchangeCodeForSession).toHaveBeenCalledWith(
        new URL(back.replace(/^exp:\/\/[^/]+\/--/, "https://x")).searchParams.get("code"),
      );
      await stopApp();
    }
  });

  it("AUTH-01 돌아온 주소에 error가 있으면 버튼 위 빨간 안내, 코드 교환 없음, 오류 코드·영문 메시지 없음, 다시 누를 수 있다 (design C-02 오류, 5장)", async () => {
    d().openAuthSessionImpl = async (_u, redirect) => ({
      type: "success",
      url: `${redirect ?? EXPO_GO_REDIRECT}?error=access_denied&error_description=User+denied+access`,
    });
    const app = await startAtLogin();
    await press(app, kakaoButton(app));
    await expectLoginErrorShown(app);
    expect(d().auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(app.screen.queryByText(LOGGED_IN_KAKAO)).toBeNull();
  });

  it("AUTH-01 코드 교환이 실패하면(error 결과) 빨간 안내가 보이고 다시 누를 수 있다", async () => {
    d().exchangeImpl = async () => ({
      data: { session: null, user: null },
      error: { name: "AuthApiError", code: "invalid_grant", message: "Invalid code verifier" },
    });
    const app = await startAtLogin();
    await press(app, kakaoButton(app));
    await expectLoginErrorShown(app);
    expect(app.screen.queryByText(LOGGED_IN_KAKAO)).toBeNull();
  });

  it("AUTH-01 코드 교환이 예외(네트워크 오류)로 끝나도 빨간 안내가 보이고 앱이 멈추지 않는다", async () => {
    d().exchangeImpl = async () => {
      throw new TypeError("Network request failed");
    };
    const app = await startAtLogin();
    await press(app, kakaoButton(app));
    await expectLoginErrorShown(app);
  });

  it("AUTH-01 signInWithOAuth가 네트워크 오류로 실패하면 빨간 안내가 보이고 인증 창을 열지 않는다", async () => {
    d().signInImpl = async () => {
      throw new TypeError("Network request failed");
    };
    const app = await startAtLogin();
    await press(app, kakaoButton(app));
    await expectLoginErrorShown(app);
    expect(d().openAuthSessionAsync).not.toHaveBeenCalled();
  });

  it("AUTH-01 signInWithOAuth가 error 결과를 돌려주면 빨간 안내가 보이고 인증 창을 열지 않는다", async () => {
    d().signInImpl = async () => ({
      data: { provider: "kakao", url: null },
      error: { name: "AuthApiError", code: "access_denied", message: "User denied access" },
    });
    const app = await startAtLogin();
    await press(app, kakaoButton(app));
    await expectLoginErrorShown(app);
    expect(d().openAuthSessionAsync).not.toHaveBeenCalled();
  });

  it.each(["cancel", "dismiss"])(
    "AUTH-01 카카오 창을 닫으면(인증 세션 %s) 오류 안내 없이 C-02 기본 상태로 돌아온다 (결정 8)",
    async (type) => {
      d().openAuthSessionImpl = async () => ({ type });
      const app = await startAtLogin();
      await press(app, kakaoButton(app));
      await app.lib.waitFor(() => expect(d().openAuthSessionAsync).toHaveBeenCalledTimes(1));
      expect(await findKakaoButton(app)).toBeOnTheScreen();
      expect(app.screen.queryByText(KAKAO_LOADING_LABEL)).toBeNull();
      expect(app.screen.queryByText(LOGIN_ERROR)).toBeNull();
      expect(d().auth.exchangeCodeForSession).not.toHaveBeenCalled();
    },
  );
});

describe("#56 Supabase 클라이언트·세션 저장 — AUTH-01 (결정 6)", () => {
  it("AUTH-01 클라이언트는 공개 URL·publishable key와 persistSession·autoRefreshToken·detectSessionInUrl false·PKCE·저장소로 만든다", async () => {
    await startAtLogin();
    await current!.lib.waitFor(() => expect(d().createClientCalls.length).toBeGreaterThan(0));
    for (const [url, key, options] of d().createClientCalls) {
      expect(url).toBe(TEST_SUPABASE_URL);
      expect(key).toBe(TEST_PUBLISHABLE_KEY);
      expect(options?.auth).toEqual(
        expect.objectContaining({
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          flowType: "pkce",
        }),
      );
      expect(options?.auth?.storage).toBeDefined();
    }
  });

  it("AUTH-01 세션 저장소는 암호화 키를 SecureStore에, 암호화한 세션을 AsyncStorage에 둔다: AsyncStorage에 토큰 평문이 없고 다시 읽으면 원래 값이다", async () => {
    await startAtLogin();
    await current!.lib.waitFor(() => expect(lastClient()?.[2]?.auth?.storage).toBeDefined());
    const storage = lastClient()![2]!.auth!.storage!;
    const key = "qa56-storage-key";
    const value = JSON.stringify(fakeSession());

    await storage.setItem(key, value);
    // SecureStore에 무언가(암호화 키)를 둔다
    expect(d().secureSet).toHaveBeenCalled();
    // AsyncStorage에 무언가(암호문)를 두되, 평문 토큰·사용자 정보는 어디에도 없다
    const asyncDump = JSON.stringify(d().asyncStore);
    expect(Object.keys(d().asyncStore).length).toBeGreaterThan(0);
    for (const secret of [SECRET.accessToken, SECRET.refreshToken, SECRET.email, SECRET.nickname]) {
      expect(asyncDump).not.toContain(secret);
    }
    // SecureStore에는 세션 통째가 아니라 키만(값 크기 한도 약 2KB)
    for (const v of Object.values(d().secureStore)) {
      expect(v).not.toContain(SECRET.accessToken);
    }
    // 다시 읽으면 원래 값
    expect(await storage.getItem(key)).toBe(value);
    // 지우면 없다
    await storage.removeItem(key);
    expect(await storage.getItem(key)).toBeNull();
  });

  it("AUTH-01 앱을 다시 켜도(모듈을 새로 읽어도) 저장한 세션을 읽는다", async () => {
    await startAtLogin();
    await current!.lib.waitFor(() => expect(lastClient()?.[2]?.auth?.storage).toBeDefined());
    const value = JSON.stringify(fakeSession());
    await lastClient()![2]!.auth!.storage!.setItem("qa56-restart-key", value);

    await startApp();
    await current!.lib.waitFor(() => expect(d().createClientCalls.length).toBeGreaterThan(1));
    expect(await lastClient()![2]!.auth!.storage!.getItem("qa56-restart-key")).toBe(value);
  });

  it("AUTH-01 자동 갱신은 앱이 앞으로 오면(active) 시작하고 뒤로 가면 멈춘다", async () => {
    const handlers: ((state: string) => void)[] = [];
    await startAtLogin({
      beforeRender: (rn) => {
        jest.spyOn(rn.AppState, "addEventListener").mockImplementation((type, handler) => {
          if (type === "change") handlers.push(handler as (state: string) => void);
          return { remove: () => undefined } as ReturnType<typeof rn.AppState.addEventListener>;
        });
      },
    });
    await current!.lib.waitFor(() => expect(handlers.length).toBeGreaterThan(0));

    d().auth.startAutoRefresh.mockClear();
    d().auth.stopAutoRefresh.mockClear();
    await current!.lib.act(async () => handlers.forEach((h) => h("active")));
    expect(d().auth.startAutoRefresh).toHaveBeenCalled();
    expect(d().auth.stopAutoRefresh).not.toHaveBeenCalled();

    d().auth.startAutoRefresh.mockClear();
    await current!.lib.act(async () => handlers.forEach((h) => h("background")));
    expect(d().auth.stopAutoRefresh).toHaveBeenCalled();
    expect(d().auth.startAutoRefresh).not.toHaveBeenCalled();
  });
});

describe("#56 첫 화면 분기·자리 표시·로그아웃 — AUTH-01, AUTH-03 (결정 1·2)", () => {
  it("AUTH-01 저장된 세션이 있으면 세션 확인 동안 C-02가 깜빡이지 않고, 확인이 끝나면 바로 자리 표시 화면이 보인다 (결정 2)", async () => {
    await seedStoredSession();

    d().sessionGate = deferred();
    const app = await startApp();
    // 세션 확인 중: C-02도 자리 표시 화면도 아니다(스플래시 유지)
    await flush(app);
    expect(app.screen.queryByText(KAKAO_LABEL)).toBeNull();
    expect(app.screen.queryByText(TERMS)).toBeNull();

    // 확인하는 동안 C-02가 한 번도 그려지지 않았는지: 이후 렌더에서도 보지 않는다
    let sawLogin = false;
    const gate = d().sessionGate!;
    await app.lib.act(async () => gate.resolve());
    await app.lib.waitFor(() => {
      if (app.screen.queryByText(KAKAO_LABEL)) sawLogin = true;
      expect(app.screen.getByText(LOGGED_IN_KAKAO)).toBeOnTheScreen();
    });
    expect(sawLogin).toBe(false);
  });

  it("AUTH-01 로그인 안 된 상태에서 세션 확인 중에는 C-02를 그리지 않고, 확인이 끝나면 C-02 (결정 2)", async () => {
    d().sessionGate = deferred();
    const app = await startApp();
    await flush(app);
    expect(app.screen.queryByText(KAKAO_LABEL)).toBeNull();
    const gate = d().sessionGate!;
    await app.lib.act(async () => gate.resolve());
    expect(await findKakaoButton(app)).toBeOnTheScreen();
  });

  it("AUTH-03 자리 표시 화면: '카카오로 로그인됨', '본인인증은 준비 중이에요', [로그아웃]. 닉네임·이메일·사용자 id는 보여 주지 않는다 (결정 1)", async () => {
    await seedStoredSession();
    const app = await startApp();
    expect(await app.screen.findByText(LOGGED_IN_KAKAO)).toBeOnTheScreen();
    expect(app.screen.getByText(new RegExp(IDENTITY_PENDING))).toBeOnTheScreen();
    expect(app.screen.getByRole("button", { name: LOGOUT })).toBeOnTheScreen();
    const text = allText(app);
    for (const v of [SECRET.nickname, SECRET.email, SECRET.userId, SECRET.kakaoSub]) {
      expect(text).not.toContain(v);
    }
  });

  it("AUTH-01 [로그아웃]을 누르면 signOut이 불리고 저장된 세션이 지워지고 C-02로 간다. 앱을 다시 켜도 C-02다", async () => {
    await seedStoredSession();
    const storedBefore = Object.keys(d().asyncStore).length + Object.keys(d().memoryStore).length;
    expect(storedBefore).toBeGreaterThan(0);

    const app = await startApp();
    await press(app, await app.screen.findByRole("button", { name: LOGOUT }));
    expect(await findKakaoButton(app)).toBeOnTheScreen();
    expect(d().auth.signOut).toHaveBeenCalledTimes(1);
    expect(app.screen.queryByText(LOGGED_IN_KAKAO)).toBeNull();

    // 저장된 세션이 지워졌다: 저장소 어댑터로 읽으면 없다
    const [url, , options] = lastClient()!;
    const storage = options?.auth?.storage;
    expect(storage).toBeDefined();
    expect(await storage!.getItem(storageKeyOf(url, options))).toBeNull();

    // 다시 켜도 C-02
    const again = await startApp();
    expect(await findKakaoButton(again)).toBeOnTheScreen();
    expect(again.screen.queryByText(LOGGED_IN_KAKAO)).toBeNull();
  });

  it("AUTH-01 로그인한 뒤 앱을 완전히 껐다 켜도 로그인 상태가 그대로다", async () => {
    await seedStoredSession();
    const app = await startApp();
    expect(await app.screen.findByText(LOGGED_IN_KAKAO)).toBeOnTheScreen();
    expect(app.screen.queryByText(KAKAO_LABEL)).toBeNull();
  });
});

describe("#56 역할별 탭 뼈대·탭 미리보기 — screens 1장, design 3장 TabBar (결정 1)", () => {
  const TABS: Record<string, { button: string; labels: string[] }> = {
    student: { button: "학생", labels: ["홈", "찾기", "레슨", "채팅", "내 정보"] },
    trainer: { button: "트레이너", labels: ["홈", "학생", "일정", "채팅", "내 정보"] },
    admin: { button: "운영자", labels: ["트레이너", "신고", "정산", "내 정보"] },
  };

  it.each(Object.entries(TABS))(
    "screens 1장 탭 미리보기에서 %s 역할을 고르면 탭이 이 순서로 보인다. 라벨 maxFontSizeMultiplier 1.5, 탭바 높이 64 + safe area",
    async (_role, { button, labels }) => {
      await seedStoredSession();
      const app = await startApp();
      await press(app, await app.screen.findByRole("button", { name: TAB_PREVIEW }));
      await press(app, await app.screen.findByRole("button", { name: button }));

      // 탭 라벨 = maxFontSizeMultiplier 1.5인 글자(design 1장 원칙 3: 탭바 라벨·상태 배지만 1.5)
      let tabLabels: Node[] = [];
      await app.lib.waitFor(() => {
        tabLabels = allNodes(app).filter(
          (n) =>
            n.type === "Text" &&
            n.props.maxFontSizeMultiplier === 1.5 &&
            labels.includes(
              (n.children as (Node | string)[])
                .map((c) => (typeof c === "string" ? c : ""))
                .join(""),
            ),
        );
        expect(tabLabels.length).toBe(labels.length);
      });
      const shown = tabLabels.map((n) =>
        (n.children as (Node | string)[]).map((c) => (typeof c === "string" ? c : "")).join(""),
      );
      expect(shown).toEqual(labels);

      // 탭바 높이: 라벨들을 모두 품은 가장 가까운 조상의 높이(또는 minHeight)가 64 + safe area(테스트 환경 0) 이상
      const ancestorsOfFirst = lineage(tabLabels[0] ?? null);
      const bar = ancestorsOfFirst.find((a) => tabLabels.every((l) => lineage(l).includes(a)));
      expect(bar).toBeDefined();
      const barHeights = lineage(bar!)
        .slice(0, 4)
        .map((n) => {
          const s = flat(app, n);
          return Math.max(Number(s.height ?? 0), Number(s.minHeight ?? 0));
        });
      expect(barHeights.some((h) => h >= 64)).toBe(true);
    },
  );

  it("결정 1 탭 미리보기 진입점은 개발 모드(__DEV__)에서만 보인다", async () => {
    await seedStoredSession();
    const app = await startApp();
    await app.screen.findByText(LOGGED_IN_KAKAO);
    expect(app.screen.getByRole("button", { name: TAB_PREVIEW })).toBeOnTheScreen();
  });

  it("결정 1 운영 번들(__DEV__ = false)로 렌더하면 탭 미리보기 진입점이 없다", async () => {
    await seedStoredSession();
    const g = globalThis as unknown as { __DEV__: boolean };
    const original = g.__DEV__;
    try {
      g.__DEV__ = false;
      const app = await startApp();
      await app.screen.findByText(LOGGED_IN_KAKAO);
      expect(app.screen.queryByText(TAB_PREVIEW)).toBeNull();
      expect(app.screen.queryByRole("button", { name: TAB_PREVIEW })).toBeNull();
    } finally {
      g.__DEV__ = original;
    }
  });
});

describe("#56 로그에 세션·토큰·사용자 정보를 남기지 않는다 — CLAUDE.md 보안", () => {
  it("로그인 → 재시작 → 로그아웃 동안 console 출력에 토큰·사용자 id·닉네임·이메일이 없다", async () => {
    const logged: string[] = [];
    for (const method of ["log", "info", "debug", "warn", "error"] as const) {
      jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(
          args
            .map((a) => {
              try {
                return typeof a === "string" ? a : JSON.stringify(a);
              } catch {
                return String(a);
              }
            })
            .join(" "),
        );
      });
    }
    const app = await startAtLogin();
    await loginWithKakao(app);
    const again = await startApp();
    await press(again, await again.screen.findByRole("button", { name: LOGOUT }));
    await findKakaoButton(again);

    const dump = logged.join("\n");
    for (const v of Object.values(SECRET)) expect(dump).not.toContain(v);
  });
});
