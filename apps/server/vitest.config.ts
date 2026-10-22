import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Each test file starts its own in-memory PostgreSQL and hashes passwords; with every
    // file running in parallel, the default 5 s can run out on a busy machine.
    testTimeout: 20_000,
  },
});
