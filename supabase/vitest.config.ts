import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // 파일마다 PGlite(Postgres) 하나를 띄워 마이그레이션과 seed를 적용한다.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
