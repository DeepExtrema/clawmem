import { describe, it, expect } from "vitest";

describe("@clawmem/openclaw — placeholder", () => {
  it("package loads", async () => {
    const mod = await import("../src/index.js");
    expect(mod.version).toBe("0.1.0");
  });
});
