import { describe, it, expect } from "vitest";

describe("@clawmem/openclaw", () => {
  it("exports a plugin with a setup function", async () => {
    const mod = await import("../src/index.js");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default.setup).toBe("function");
  });
});
