import { describe, it, expect, afterEach } from "vitest";
import { SqliteHistoryStore } from "../src/backends/sqlite-history.js";

describe("SqliteHistoryStore", () => {
  let store: SqliteHistoryStore;

  afterEach(() => {
    store?.close();
  });

  function createStore() {
    store = new SqliteHistoryStore({ dbPath: ":memory:" });
    return store;
  }

  it("records and retrieves history entries", async () => {
    const s = createStore();
    await s.add({
      memoryId: "mem1",
      action: "add",
      previousValue: null,
      newValue: "User likes TypeScript",
      userId: "u1",
    });

    const history = await s.getHistory("mem1");
    expect(history.length).toBe(1);
    expect(history[0]!.action).toBe("add");
    expect(history[0]!.newValue).toBe("User likes TypeScript");
    expect(history[0]!.memoryId).toBe("mem1");
  });

  it("returns empty array for nonexistent memoryId", async () => {
    const s = createStore();
    const history = await s.getHistory("nonexistent");
    expect(history).toEqual([]);
  });

  it("records update history with previous value", async () => {
    const s = createStore();
    await s.add({
      memoryId: "mem1",
      action: "add",
      previousValue: null,
      newValue: "Original",
      userId: "u1",
    });
    await s.add({
      memoryId: "mem1",
      action: "update",
      previousValue: "Original",
      newValue: "Updated",
      userId: "u1",
    });

    const history = await s.getHistory("mem1");
    expect(history.length).toBe(2);
    expect(history[1]!.action).toBe("update");
    expect(history[1]!.previousValue).toBe("Original");
    expect(history[1]!.newValue).toBe("Updated");
  });

  it("reset clears all history for a user", async () => {
    const s = createStore();
    await s.add({ memoryId: "m1", action: "add", previousValue: null, newValue: "A", userId: "u1" });
    await s.add({ memoryId: "m2", action: "add", previousValue: null, newValue: "B", userId: "u2" });

    await s.reset("u1");

    expect((await s.getHistory("m1")).length).toBe(0);
    expect((await s.getHistory("m2")).length).toBe(1);
  });

  it("reset without userId clears everything", async () => {
    const s = createStore();
    await s.add({ memoryId: "m1", action: "add", previousValue: null, newValue: "A", userId: "u1" });
    await s.add({ memoryId: "m2", action: "add", previousValue: null, newValue: "B", userId: "u2" });

    await s.reset();

    expect((await s.getHistory("m1")).length).toBe(0);
    expect((await s.getHistory("m2")).length).toBe(0);
  });
});
