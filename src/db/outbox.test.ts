import { describe, it, expect } from "vitest";
import { MemoryWordStore } from "./memory-store";

describe("outbox & history", () => {
  it("round-trips outbox entries", async () => {
    const store = new MemoryWordStore();
    await store.addOutbox("favorite", "favorite.add", JSON.stringify({ wordId: "w1" }));
    await store.addOutbox("history", "history.view", JSON.stringify({ wordId: "w2" }));
    const pending = await store.pendingOutbox();
    expect(pending.length).toBe(2);
    await store.markOutboxSynced(pending[0]!.id);
    const still = await store.pendingOutbox();
    expect(still.length).toBe(1);
  });

  it("persists and lists history", async () => {
    const store = new MemoryWordStore();
    await store.addHistory("w1", new Date().toISOString());
    await store.addHistory("w2", new Date(Date.now() + 1000).toISOString());
    const ids = await store.listHistory(10);
    expect(ids).toContain("w1");
    expect(ids).toContain("w2");
    expect(ids[0]).toBe("w2"); // most recent first
  });

  it("clears history", async () => {
    const store = new MemoryWordStore();
    await store.addHistory("w1", new Date().toISOString());
    await store.clearHistory();
    expect((await store.listHistory(10)).length).toBe(0);
  });
});