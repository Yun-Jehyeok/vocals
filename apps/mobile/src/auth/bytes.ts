// 글자 ↔ 바이트(UTF-8)와 바이트 ↔ 16진수. 기기 JS 엔진(Hermes)에 TextDecoder가 있는지에 기대지 않으려고 직접 둔다.

export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0) as number;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000)
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
  }
  return new Uint8Array(out);
}

/** 잘못된 UTF-8이면 예외 */
export function utf8Decode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  const cont = () => {
    const b = bytes[i++];
    if (b === undefined || (b & 0xc0) !== 0x80) throw new Error("잘못된 UTF-8");
    return b & 0x3f;
  };
  while (i < bytes.length) {
    const b = bytes[i++] as number;
    let cp: number;
    if (b < 0x80) cp = b;
    else if ((b & 0xe0) === 0xc0) cp = ((b & 0x1f) << 6) | cont();
    else if ((b & 0xf0) === 0xe0) cp = ((b & 0x0f) << 12) | (cont() << 6) | cont();
    else if ((b & 0xf8) === 0xf0) cp = ((b & 0x07) << 18) | (cont() << 12) | (cont() << 6) | cont();
    else throw new Error("잘못된 UTF-8");
    out += String.fromCodePoint(cp);
  }
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

/** 16진수가 아니면 예외 */
export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new Error("잘못된 16진수");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
