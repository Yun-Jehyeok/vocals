// 세션 저장소 단위 테스트(#56 결정 6). 기기 저장소 두 곳은 테스트 안에서만 메모리 대역으로 바꾼다.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { decrypt, encrypt, encryptedStorage, secureKeyName } from "./encryptedStorage";

const mockSecure = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => mockSecure.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockSecure.set(k, v),
  deleteItemAsync: async (k: string) => void mockSecure.delete(k),
}));
jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

const KEY = "sb-ref-auth-token";
const SESSION = JSON.stringify({ access_token: "secret-token-value", user: { email: "a@b.c" } });

beforeEach(async () => {
  mockSecure.clear();
  await AsyncStorage.clear();
});

describe("암호화 세션 저장소 (#56 결정 6)", () => {
  it("쓰면 SecureStore에는 키만, AsyncStorage에는 평문 없는 암호문이 남고, 읽으면 원래 값", async () => {
    await encryptedStorage.setItem(KEY, SESSION);
    const keyHex = mockSecure.get(secureKeyName(KEY));
    expect(keyHex).toMatch(/^[0-9a-f]{64}$/);
    const stored = await AsyncStorage.getItem(KEY);
    expect(stored).toMatch(/^v1\.[0-9a-f]{24}\.[0-9a-f]+$/);
    expect(stored).not.toContain("secret-token-value");
    expect(await encryptedStorage.getItem(KEY)).toBe(SESSION);
  });

  it("쓸 때마다 키와 암호문이 바뀐다", async () => {
    await encryptedStorage.setItem(KEY, SESSION);
    const first = [mockSecure.get(secureKeyName(KEY)), await AsyncStorage.getItem(KEY)];
    await encryptedStorage.setItem(KEY, SESSION);
    const second = [mockSecure.get(secureKeyName(KEY)), await AsyncStorage.getItem(KEY)];
    expect(second[0]).not.toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
  });

  it("지우면 두 곳 모두 없다", async () => {
    await encryptedStorage.setItem(KEY, SESSION);
    await encryptedStorage.removeItem(KEY);
    expect(mockSecure.size).toBe(0);
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    expect(await encryptedStorage.getItem(KEY)).toBeNull();
  });

  it("없는 값은 null", async () => {
    expect(await encryptedStorage.getItem(KEY)).toBeNull();
  });

  it("키가 없거나 암호문이 바뀌었으면 null을 돌려주고 남은 값을 지운다", async () => {
    await encryptedStorage.setItem(KEY, SESSION);
    mockSecure.clear();
    expect(await encryptedStorage.getItem(KEY)).toBeNull();
    expect(await AsyncStorage.getItem(KEY)).toBeNull();

    await encryptedStorage.setItem(KEY, SESSION);
    const stored = (await AsyncStorage.getItem(KEY)) as string;
    const last = stored.slice(-1) === "0" ? "1" : "0";
    await AsyncStorage.setItem(KEY, stored.slice(0, -1) + last);
    expect(await encryptedStorage.getItem(KEY)).toBeNull();
    expect(mockSecure.size).toBe(0);
  });

  it("SecureStore 키 이름은 허용 글자만 쓴다", () => {
    expect(secureKeyName("sb-ref-auth-token")).toBe("vocals.session-key.sb-ref-auth-token");
    expect(secureKeyName("a b/c")).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("암호화·복호화 왕복과 다른 키로는 풀리지 않음", () => {
    const key = new Uint8Array(32).fill(7);
    const nonce = new Uint8Array(12).fill(1);
    const sealed = encrypt("안녕", key, nonce);
    expect(decrypt(sealed, key)).toBe("안녕");
    expect(() => decrypt(sealed, new Uint8Array(32).fill(8))).toThrow();
    expect(() => decrypt("v0.00.00", key)).toThrow();
  });
});
