// 로그인 세션 저장소(결정 6, docs/tech-stack.md 3.12): 기기에 평문으로 두지 않는다.
// - 암호화 키(32바이트)는 기기 보안 저장소(expo-secure-store)에, AES-256-GCM으로 암호화한 세션은 AsyncStorage에 둔다.
//   SecureStore는 값 크기 한도(약 2KB)가 있어 세션 통째로는 넣지 않는다.
// - 쓸 때마다 새 키와 새 nonce를 만든다. 읽다가 키가 없거나 복호화가 실패하면 값을 지우고 null(다시 로그인).
// - 값·토큰은 로그에 남기지 않는다(CLAUDE.md 보안).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { gcm } from "@noble/ciphers/aes";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { fromHex, toHex, utf8Decode, utf8Encode } from "./bytes";

const FORMAT = "v1";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;

/** SecureStore 키 이름은 영숫자·`.`·`-`·`_`만 된다 */
export function secureKeyName(key: string): string {
  return `vocals.session-key.${key.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

export function encrypt(plain: string, key: Uint8Array, nonce: Uint8Array): string {
  const sealed = gcm(key, nonce).encrypt(utf8Encode(plain));
  return `${FORMAT}.${toHex(nonce)}.${toHex(sealed)}`;
}

/** 형식이 다르거나 키가 맞지 않으면(위·변조 포함) 예외 */
export function decrypt(stored: string, key: Uint8Array): string {
  const [format, nonceHex, sealedHex, ...rest] = stored.split(".");
  if (format !== FORMAT || !nonceHex || !sealedHex || rest.length > 0) {
    throw new Error("알 수 없는 저장 형식");
  }
  return utf8Decode(gcm(key, fromHex(nonceHex)).decrypt(fromHex(sealedHex)));
}

/** supabase-js `auth.storage` 모양의 저장소 */
export const encryptedStorage = {
  async getItem(key: string): Promise<string | null> {
    const stored = await AsyncStorage.getItem(key);
    if (stored === null) return null;
    const keyHex = await SecureStore.getItemAsync(secureKeyName(key));
    try {
      if (!keyHex) throw new Error("키 없음");
      return decrypt(stored, fromHex(keyHex));
    } catch {
      await encryptedStorage.removeItem(key);
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    const secret = Crypto.getRandomBytes(KEY_BYTES);
    const nonce = Crypto.getRandomBytes(NONCE_BYTES);
    await SecureStore.setItemAsync(secureKeyName(key), toHex(secret));
    await AsyncStorage.setItem(key, encrypt(value, secret, nonce));
  },

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(secureKeyName(key));
  },
};
