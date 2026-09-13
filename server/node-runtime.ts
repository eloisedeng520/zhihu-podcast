import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { AppEnv } from "./api.ts";
import type { AudioBucket, AudioObject, Database, Statement } from "./store.ts";

function configuredPath(value: string | undefined, fallback: string): string {
  const selected = value?.trim() || fallback;
  return isAbsolute(selected) ? selected : resolve(process.cwd(), selected);
}

class SqliteStatement implements Statement {
  private readonly sqlite: DatabaseSync;
  private readonly sql: string;
  private readonly values: SQLInputValue[] = [];

  constructor(sqlite: DatabaseSync, sql: string) {
    this.sqlite = sqlite;
    this.sql = sql;
  }

  bind(...args: unknown[]): Statement {
    const values = args.map((value): SQLInputValue => {
      if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint" || value instanceof Uint8Array) return value;
      throw new TypeError("Unsupported SQLite parameter type");
    });
    this.values.splice(0, this.values.length, ...values);
    return this;
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const result = this.sqlite.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(result.changes) } };
  }

  async first<T>(): Promise<T | null> {
    const row = this.sqlite.prepare(this.sql).get(...this.values);
    return row ? ({ ...row } as T) : null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    const rows = this.sqlite.prepare(this.sql).all(...this.values);
    return { results: rows.map((row) => ({ ...row }) as T) };
  }
}

class LocalDatabase implements Database {
  private readonly sqlite: DatabaseSync;

  constructor(filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o750 });
    this.sqlite = new DatabaseSync(filePath);
    this.sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;");
  }

  prepare(sql: string): Statement {
    return new SqliteStatement(this.sqlite, sql);
  }
}

type ByteRange = { offset: number; length: number };

function requestedRange(headers: Headers | undefined, size: number): ByteRange | undefined {
  const raw = headers?.get("range")?.trim();
  const match = raw?.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || size === 0) return undefined;

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return undefined;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return undefined;
    end = Math.min(end, size - 1);
  }
  return { offset: start, length: end - start + 1 };
}

class LocalAudioBucket implements AudioBucket {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
    mkdirSync(root, { recursive: true, mode: 0o750 });
  }

  private pathFor(key: string): string {
    const normalized = key.replaceAll("\\", "/");
    if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
      throw new Error("Invalid audio object key");
    }
    const filePath = resolve(this.root, normalized);
    const fromRoot = relative(this.root, filePath);
    if (fromRoot.startsWith(`..${sep}`) || fromRoot === ".." || isAbsolute(fromRoot)) {
      throw new Error("Audio object key escaped its storage directory");
    }
    return filePath;
  }

  async get(key: string, options?: { range?: Headers }): Promise<AudioObject | null> {
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(this.pathFor(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const size = bytes.byteLength;
    const range = requestedRange(options?.range, size);
    const selected = range ? bytes.subarray(range.offset, range.offset + range.length) : bytes;
    const copy = Uint8Array.from(selected);
    return {
      size,
      range,
      body: new Blob([copy]).stream(),
      async arrayBuffer() {
        return copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength);
      },
    };
  }

  async put(key: string, body: Uint8Array): Promise<void> {
    const filePath = this.pathFor(key);
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o750 });
    writeFileSync(filePath, body, { mode: 0o640 });
  }
}

const providerEnvironment = (): Omit<AppEnv, "DB" | "AUDIO"> => ({
  LLM_URL: process.env.LLM_URL,
  LLM_API_KEY: process.env.LLM_API_KEY,
  LLM_MODEL: process.env.LLM_MODEL,
  TTS_PROVIDER: process.env.TTS_PROVIDER,
  TENCENT_SECRET_ID: process.env.TENCENT_SECRET_ID,
  TENCENT_SECRET_KEY: process.env.TENCENT_SECRET_KEY,
  TENCENT_SESSION_TOKEN: process.env.TENCENT_SESSION_TOKEN,
  TTS_URL: process.env.TTS_URL,
  TTS_API_KEY: process.env.TTS_API_KEY,
  TTS_MODEL: process.env.TTS_MODEL,
  TTS_HOST_VOICE: process.env.TTS_HOST_VOICE,
  TTS_GUEST_VOICE: process.env.TTS_GUEST_VOICE,
  TTS_GUEST_VOICES: process.env.TTS_GUEST_VOICES,
  DOUBAO_API_KEY: process.env.DOUBAO_API_KEY,
  DOUBAO_RESOURCE_ID: process.env.DOUBAO_RESOURCE_ID,
  DOUBAO_HOST_VOICE: process.env.DOUBAO_HOST_VOICE,
  ZHIHU_APP_ID: process.env.ZHIHU_APP_ID,
  ZHIHU_APP_KEY: process.env.ZHIHU_APP_KEY,
  ZHIHU_OAUTH_APP_KEY: process.env.ZHIHU_OAUTH_APP_KEY,
  ZHIHU_REDIRECT_URI: process.env.ZHIHU_REDIRECT_URI,
  DOUBAO_GUEST_VOICE: process.env.DOUBAO_GUEST_VOICE,
  DOUBAO_GUEST_VOICES: process.env.DOUBAO_GUEST_VOICES,
  ASR_PROVIDER: process.env.ASR_PROVIDER,
  DOUBAO_ASR_API_KEY: process.env.DOUBAO_ASR_API_KEY,
  DOUBAO_ASR_RESOURCE_ID: process.env.DOUBAO_ASR_RESOURCE_ID,
});

let nodeEnvironment: AppEnv | undefined;

export function getNodeEnvironment(): AppEnv {
  if (!nodeEnvironment) {
    const databasePath = configuredPath(process.env.SQLITE_DATABASE_PATH, ".runtime/app.db");
    const audioPath = configuredPath(process.env.AUDIO_STORAGE_PATH, ".runtime/audio");
    nodeEnvironment = {
      ...providerEnvironment(),
      DB: new LocalDatabase(databasePath),
      AUDIO: new LocalAudioBucket(audioPath),
    };
  }
  return nodeEnvironment;
}

export const nodeRuntimeTesting = { LocalDatabase, LocalAudioBucket, requestedRange };
