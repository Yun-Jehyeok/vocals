import { fromHex, toHex, utf8Decode, utf8Encode } from "./bytes";

describe("UTF-8·16진수 변환 (#56 세션 암호화)", () => {
  it.each(["", "abc", "카카오로 로그인됨", "émoji 🎤 mixed ✓", '{"a":"b"}'])(
    "글자 → 바이트 → 글자가 같다: %s",
    (text) => {
      expect(utf8Decode(utf8Encode(text))).toBe(text);
    },
  );

  it("알려진 UTF-8 바이트와 같다(1·2·3·4바이트 글자)", () => {
    expect([...utf8Encode("aé카🎤")]).toEqual([
      0x61, 0xc3, 0xa9, 0xec, 0xb9, 0xb4, 0xf0, 0x9f, 0x8e, 0xa4,
    ]);
  });

  it("잘못된 UTF-8은 예외", () => {
    expect(() => utf8Decode(new Uint8Array([0xe0, 0x41]))).toThrow();
    expect(() => utf8Decode(new Uint8Array([0xff]))).toThrow();
  });

  it("16진수 왕복", () => {
    const bytes = new Uint8Array([0, 1, 15, 16, 255]);
    expect(toHex(bytes)).toBe("00010f10ff");
    expect([...fromHex("00010F10ff")]).toEqual([...bytes]);
  });

  it("잘못된 16진수는 예외", () => {
    expect(() => fromHex("abc")).toThrow();
    expect(() => fromHex("zz")).toThrow();
  });
});
