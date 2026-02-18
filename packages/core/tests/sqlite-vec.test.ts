import { describe, it, expect, afterEach } from "vitest";
import { SqliteVecStore } from "../src/backends/sqlite-vec.js";

describe("SqliteVecStore", () => {
  let store: SqliteVecStore;

  afterEach(() => {
    store?.close();
  });

  function createStore() {
    store = new SqliteVecStore({ dbPath: ":memory:", dimension: 4 });
    return store;
  }

  const vec1 = [1, 0, 0, 0];
  const vec2 = [0, 1, 0, 0];
  const payload1 = {
    memory: "User likes TypeScript",
    userId: "u1",
    hash: "abc123",
    isLatest: true,
    category: "technical",
  };

  it("insert and get by ID", async () => {
    const s = createStore();
    await s.insert([vec1], ["id1"], [payload1]);
    const result = await s.get("id1");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("id1");
    expect(result!.payload["memory"]).toBe("User likes TypeScript");
  });

  it("get returns null for nonexistent ID", async () => {
    const s = createStore();
    const result = await s.get("nonexistent");
    expect(result).toBeNull();
  });

  it("search returns results sorted by similarity", async () => {
    const s = createStore();
    await s.insert([vec1, vec2], ["id1", "id2"], [
      { ...payload1, hash: "h1" },
      { memory: "User uses Python", userId: "u1", hash: "h2", isLatest: true },
    ]);

    const results = await s.search(vec1, 5, { userId: "u1" });
    expect(results.length).toBe(2);
    expect(results[0]!.id).toBe("id1"); // exact match has highest score
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it("search filters by userId", async () => {
    const s = createStore();
    await s.insert([vec1, vec2], ["id1", "id2"], [
      { memory: "A", userId: "u1", hash: "h1", isLatest: true },
      { memory: "B", userId: "u2", hash: "h2", isLatest: true },
    ]);

    const results = await s.search(vec1, 5, { userId: "u1" });
    expect(results.length).toBe(1);
    expect(results[0]!.id).toBe("id1");
  });

  it("search filters by isLatest", async () => {
    const s = createStore();
    await s.insert([vec1, vec2], ["id1", "id2"], [
      { memory: "Old", userId: "u1", hash: "h1", isLatest: false },
      { memory: "New", userId: "u1", hash: "h2", isLatest: true },
    ]);

    const results = await s.search(vec1, 5, { userId: "u1", isLatest: true });
    expect(results.length).toBe(1);
    expect(results[0]!.payload["memory"]).toBe("New");
  });

  it("search pushes down category and memoryType filters", async () => {
    const s = createStore();
    await s.insert([vec1, vec2], ["id1", "id2"], [
      {
        memory: "TypeScript preference",
        userId: "u1",
        hash: "h1",
        isLatest: true,
        category: "technical",
        memoryType: "preference",
      },
      {
        memory: "Travel plan",
        userId: "u1",
        hash: "h2",
        isLatest: true,
        category: "life_events",
        memoryType: "episode",
      },
    ]);

    const results = await s.search(vec1, 5, {
      userId: "u1",
      category: "technical",
      memoryType: "preference",
    });
    expect(results.length).toBe(1);
    expect(results[0]!.payload["memory"]).toBe("TypeScript preference");
  });

  it("search pushes down date range filters", async () => {
    const s = createStore();
    await s.insert([vec1, vec2], ["id1", "id2"], [
      {
        memory: "Old memory",
        userId: "u1",
        hash: "h1",
        isLatest: true,
        createdAt: "2020-01-01T00:00:00.000Z",
      },
      {
        memory: "Recent memory",
        userId: "u1",
        hash: "h2",
        isLatest: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const results = await s.search(vec1, 5, {
      userId: "u1",
      fromDate: "2025-01-01T00:00:00.000Z",
      toDate: "2027-01-01T00:00:00.000Z",
    });
    expect(results.length).toBe(1);
    expect(results[0]!.payload["memory"]).toBe("Recent memory");
  });

  it("delete removes from all tables", async () => {
    const s = createStore();
    await s.insert([vec1], ["id1"], [payload1]);
    await s.delete("id1");
    expect(await s.get("id1")).toBeNull();
    const [results] = await s.list({ userId: "u1" });
    expect(results.length).toBe(0);
  });

  it("list with pagination", async () => {
    const s = createStore();
    const payloads = Array.from({ length: 5 }, (_, i) => ({
      memory: `Memory ${i}`,
      userId: "u1",
      hash: `hash${i}`,
      isLatest: true,
    }));
    const vecs = payloads.map(() => [Math.random(), 0, 0, 0]);
    await s.insert(
      vecs,
      payloads.map((_, i) => `id${i}`),
      payloads,
    );

    const [page1, total] = await s.list({ userId: "u1" }, 2, 0);
    expect(page1.length).toBe(2);
    expect(total).toBe(5);

    const [page2] = await s.list({ userId: "u1" }, 2, 2);
    expect(page2.length).toBe(2);
  });

  it("update modifies payload without losing data", async () => {
    const s = createStore();
    await s.insert([vec1], ["id1"], [payload1]);
    await s.update("id1", vec2, { ...payload1, memory: "Updated content" });
    const result = await s.get("id1");
    expect(result!.payload["memory"]).toBe("Updated content");
  });

  it("updatePayload changes payload without vector change", async () => {
    const s = createStore();
    await s.insert([vec1], ["id1"], [payload1]);
    await s.updatePayload("id1", { ...payload1, isLatest: false });
    const result = await s.get("id1");
    expect(result!.payload["isLatest"]).toBe(false);
  });

  it("findByHash returns matching memory", async () => {
    const s = createStore();
    await s.insert([vec1], ["id1"], [payload1]);
    const result = await s.findByHash("abc123", "u1");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("id1");
  });

  it("findByHash returns null for nonexistent hash", async () => {
    const s = createStore();
    await s.insert([vec1], ["id1"], [payload1]);
    expect(await s.findByHash("nonexistent", "u1")).toBeNull();
  });

  it("findByHash scopes by userId", async () => {
    const s = createStore();
    await s.insert([vec1], ["id1"], [payload1]);
    expect(await s.findByHash("abc123", "other-user")).toBeNull();
  });

  it("deleteAll with userId removes only that user", async () => {
    const s = createStore();
    await s.insert([vec1, vec2], ["id1", "id2"], [
      { memory: "A", userId: "u1", hash: "h1", isLatest: true },
      { memory: "B", userId: "u2", hash: "h2", isLatest: true },
    ]);
    await s.deleteAll({ userId: "u1" });
    expect(await s.get("id1")).toBeNull();
    expect(await s.get("id2")).not.toBeNull();
  });

  it("deleteAll without filter removes everything", async () => {
    const s = createStore();
    await s.insert([vec1, vec2], ["id1", "id2"], [
      { memory: "A", userId: "u1", hash: "h1", isLatest: true },
      { memory: "B", userId: "u2", hash: "h2", isLatest: true },
    ]);
    await s.deleteAll();
    const [results, total] = await s.list();
    expect(results.length).toBe(0);
    expect(total).toBe(0);
  });

  it("keywordSearch returns FTS results", async () => {
    const s = createStore();
    await s.insert([vec1, vec2], ["id1", "id2"], [
      { memory: "TypeScript developer", userId: "u1", hash: "h1", isLatest: true },
      { memory: "Python developer", userId: "u1", hash: "h2", isLatest: true },
    ]);
    const results = await s.keywordSearch("TypeScript", 5, { userId: "u1" });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.payload["memory"]).toContain("TypeScript");
  });
});
