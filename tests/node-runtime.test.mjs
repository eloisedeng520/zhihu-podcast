import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeRuntimeTesting } from "../server/node-runtime.ts";

test("Node SQLite adapter persists rows and exposes the D1-shaped API", async () => {
  const root = mkdtempSync(join(tmpdir(), "tingjian-db-"));
  const db = new nodeRuntimeTesting.LocalDatabase(join(root, "app.db"));
  await db.prepare("CREATE TABLE items (id TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  const inserted = await db.prepare("INSERT INTO items (id,value) VALUES (?,?)").bind("one", "节目").run();
  assert.equal(inserted.meta.changes, 1);
  assert.deepEqual(await db.prepare("SELECT id,value FROM items WHERE id = ?").bind("one").first(), { id: "one", value: "节目" });
  assert.deepEqual((await db.prepare("SELECT id FROM items").all()).results, [{ id: "one" }]);
});

test("local audio storage persists bytes, serves ranges, and rejects traversal", async () => {
  const root = mkdtempSync(join(tmpdir(), "tingjian-audio-"));
  const bucket = new nodeRuntimeTesting.LocalAudioBucket(root);
  const original = Uint8Array.from([0, 1, 2, 3, 4, 5]);
  await bucket.put("episodes/demo/audio.wav", original);
  assert.deepEqual([...readFileSync(join(root, "episodes", "demo", "audio.wav"))], [...original]);

  const headers = new Headers({ Range: "bytes=2-4" });
  const object = await bucket.get("episodes/demo/audio.wav", { range: headers });
  assert.equal(object.size, 6);
  assert.deepEqual(object.range, { offset: 2, length: 3 });
  assert.deepEqual([...new Uint8Array(await new Response(object.body).arrayBuffer())], [2, 3, 4]);
  await assert.rejects(() => bucket.put("../escape.wav", original), /Invalid audio object key/);
});
