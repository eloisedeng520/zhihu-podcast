import type { Episode } from "../lib/podcast.ts";
export type Statement = {bind(...args:unknown[]):Statement; run():Promise<{meta:{changes:number}}> ;first<T>():Promise<T|null>;all<T>():Promise<{results:T[]}>};
export type Database = {prepare(sql:string):Statement};
export type AudioObject = {body:ReadableStream;size:number;arrayBuffer():Promise<ArrayBuffer>;range?:{offset:number;length:number}};
export type AudioBucket = {get(key:string,options?:{range?:Headers}):Promise<AudioObject|null>;put(key:string,body:Uint8Array,options?:{httpMetadata:{contentType:string}}):Promise<unknown>};
export type EpisodeQuestion = {id:string;episodeId:string;positionSeconds:number;questionText:string;answerText:string|null;sourceIds:string[];status:"transcribing"|"answering"|"ready"|"failed";errorCode:string|null;createdAt:string;updatedAt:string};
export type LibraryType = "favorite" | "later";
export type LibraryItem = { itemType: LibraryType; itemId: string; payload: Record<string, unknown>; createdAt: string; updatedAt: string };
export async function initDb(db:Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS episodes (id TEXT PRIMARY KEY, owner_key TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL, created_at TEXT NOT NULL, lock_token TEXT, lock_until INTEGER NOT NULL DEFAULT 0)`).run();
  // Existing deployments predate per-user episode ownership. SQLite allows adding
  // the column with a default so old rows remain readable without being exposed to
  // authenticated users until they are explicitly migrated.
  try { await db.prepare("ALTER TABLE episodes ADD COLUMN owner_key TEXT NOT NULL DEFAULT ''").run(); } catch { /* column already exists */ }
  await db.prepare(`CREATE TABLE IF NOT EXISTS episode_questions (id TEXT PRIMARY KEY, episode_id TEXT NOT NULL, owner_key TEXT NOT NULL, position_seconds REAL NOT NULL, question_text TEXT NOT NULL, answer_text TEXT, source_ids TEXT NOT NULL, status TEXT NOT NULL, error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS episode_questions_owner_episode_created ON episode_questions (owner_key, episode_id, created_at DESC)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS episode_questions_owner_status ON episode_questions (owner_key, status)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS library_items (owner_key TEXT NOT NULL, item_type TEXT NOT NULL, item_id TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner_key, item_type, item_id))`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS library_items_owner_type_updated ON library_items (owner_key, item_type, updated_at DESC)`).run();
}
const presentQuestion=(row:{id:string;episode_id:string;position_seconds:number;question_text:string;answer_text:string|null;source_ids:string;status:EpisodeQuestion["status"];error_code:string|null;created_at:string;updated_at:string}):EpisodeQuestion=>({id:row.id,episodeId:row.episode_id,positionSeconds:row.position_seconds,questionText:row.question_text,answerText:row.answer_text,sourceIds:JSON.parse(row.source_ids),status:row.status,errorCode:row.error_code,createdAt:row.created_at,updatedAt:row.updated_at});
type QuestionRow=Parameters<typeof presentQuestion>[0];
export async function readQuestion(db:Database,id:string,ownerKey:string) {
  const row=await db.prepare("SELECT id,episode_id,position_seconds,question_text,answer_text,source_ids,status,error_code,created_at,updated_at FROM episode_questions WHERE id = ? AND owner_key = ?").bind(id,ownerKey).first<QuestionRow>();return row?presentQuestion(row):null;
}
export async function listQuestions(db:Database,episodeId:string,ownerKey:string,limit=50) {
  const rows=await db.prepare("SELECT id,episode_id,position_seconds,question_text,answer_text,source_ids,status,error_code,created_at,updated_at FROM episode_questions WHERE episode_id = ? AND owner_key = ? ORDER BY created_at DESC LIMIT ?").bind(episodeId,ownerKey,limit).all<QuestionRow>();return rows.results.map(presentQuestion);
}
/**
 * Count productions that have reached audio generation for one owner.
 * Failed jobs and drafts that stop before synthesizing do not consume quota.
 */
export async function countBillableProductions(db:Database,ownerKey:string) {
  const rows=ownerKey==="legacy"
    ? await db.prepare("SELECT payload FROM episodes WHERE owner_key = ? OR owner_key = ''").bind(ownerKey).all<{payload:string}>()
    : await db.prepare("SELECT payload FROM episodes WHERE owner_key = ?").bind(ownerKey).all<{payload:string}>();
  let count=0;
  for(const row of rows.results){
    try {
      const episode=JSON.parse(row.payload) as Partial<Episode>;
      if(episode.creationSource!=="podcast-create" || episode.status==="failed") continue;
      if(episode.stage==="synthesizing" || episode.stage==="ready") count++;
    } catch { /* Ignore malformed legacy rows. */ }
  }
  return count;
}
export async function deleteOwnerQuestions(db:Database,ownerKey:string) {return db.prepare("DELETE FROM episode_questions WHERE owner_key = ?").bind(ownerKey).run();}
const presentLibrary=(row:{item_type:LibraryType;item_id:string;payload:string;created_at:string;updated_at:string}):LibraryItem=>({itemType:row.item_type,itemId:row.item_id,payload:JSON.parse(row.payload||"{}"),createdAt:row.created_at,updatedAt:row.updated_at});
export async function listLibrary(db:Database,ownerKey:string,itemType?:LibraryType){
  const rows=itemType
    ? await db.prepare("SELECT item_type,item_id,payload,created_at,updated_at FROM library_items WHERE owner_key = ? AND item_type = ? ORDER BY updated_at DESC LIMIT 200").bind(ownerKey,itemType).all<{item_type:LibraryType;item_id:string;payload:string;created_at:string;updated_at:string}>()
    : await db.prepare("SELECT item_type,item_id,payload,created_at,updated_at FROM library_items WHERE owner_key = ? ORDER BY updated_at DESC LIMIT 500").bind(ownerKey).all<{item_type:LibraryType;item_id:string;payload:string;created_at:string;updated_at:string}>();
  return rows.results.map(presentLibrary);
}
export async function upsertLibrary(db:Database,ownerKey:string,itemType:LibraryType,itemId:string,payload:Record<string,unknown>={}){
  const now=new Date().toISOString();
  await db.prepare("INSERT INTO library_items (owner_key,item_type,item_id,payload,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(owner_key,item_type,item_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind(ownerKey,itemType,itemId,JSON.stringify(payload),now,now).run();
  const row=await db.prepare("SELECT item_type,item_id,payload,created_at,updated_at FROM library_items WHERE owner_key = ? AND item_type = ? AND item_id = ?").bind(ownerKey,itemType,itemId).first<{item_type:LibraryType;item_id:string;payload:string;created_at:string;updated_at:string}>();
  return row?presentLibrary(row):null;
}
export async function removeLibrary(db:Database,ownerKey:string,itemType:LibraryType,itemId:string){
  const r=await db.prepare("DELETE FROM library_items WHERE owner_key = ? AND item_type = ? AND item_id = ?").bind(ownerKey,itemType,itemId).run();
  return r.meta.changes>0;
}
export async function readLibrary(db:Database,ownerKey:string,itemType:LibraryType,itemId:string){
  const row=await db.prepare("SELECT item_type,item_id,payload,created_at,updated_at FROM library_items WHERE owner_key = ? AND item_type = ? AND item_id = ?").bind(ownerKey,itemType,itemId).first<{item_type:LibraryType;item_id:string;payload:string;created_at:string;updated_at:string}>();
  return row?presentLibrary(row):null;
}
export async function readEpisode(db:Database,id:string,ownerKey?:string) {
  const row=ownerKey === undefined
    ? await db.prepare("SELECT payload FROM episodes WHERE id = ?").bind(id).first<{payload:string}>()
    : await db.prepare("SELECT payload FROM episodes WHERE id = ? AND owner_key = ?").bind(id,ownerKey).first<{payload:string}>()
      ?? await db.prepare("SELECT payload FROM episodes WHERE id = ? AND owner_key = ''").bind(id).first<{payload:string}>();
  return row?JSON.parse(row.payload) as Episode:null;
}
/**
 * Find the canonical episode for a knowledge item. Episodes are shared across
 * users, so this lookup must not be limited to the current user's history (or
 * to the first page of the library).
 */
export async function findSharedEpisode(db:Database,answerId:string,minutes:3|8) {
  try {
    const row=await db.prepare("SELECT payload FROM episodes WHERE json_extract(payload, '$.answerId') = ? AND CAST(json_extract(payload, '$.minutes') AS INTEGER) = ? AND json_extract(payload, '$.status') <> 'failed' ORDER BY created_at ASC LIMIT 1").bind(answerId,minutes).first<{payload:string}>();
    return row?JSON.parse(row.payload) as Episode:null;
  } catch {
    // Some local SQLite builds may not have JSON1 enabled. Keep the shared
    // cache functional there by falling back to a bounded payload scan.
    const rows=await db.prepare("SELECT payload FROM episodes ORDER BY created_at ASC LIMIT 5000").all<{payload:string}>();
    for(const row of rows.results){
      try {
        const episode=JSON.parse(row.payload) as Episode;
        if(episode.answerId===answerId&&episode.minutes===minutes&&episode.status!=="failed")return episode;
      } catch { /* Ignore malformed legacy rows. */ }
    }
    return null;
  }
}
export async function saveEpisode(db:Database,episode:Episode,token:string,ownerKey?:string) {
  episode.updatedAt=new Date().toISOString();
  const r=ownerKey === undefined
    ? await db.prepare("UPDATE episodes SET payload = ?, lock_token = NULL, lock_until = 0 WHERE id = ? AND lock_token = ?").bind(JSON.stringify(episode),episode.id,token).run()
    : await db.prepare("UPDATE episodes SET payload = ?, lock_token = NULL, lock_until = 0 WHERE id = ? AND owner_key = ? AND lock_token = ?").bind(JSON.stringify(episode),episode.id,ownerKey,token).run();
  return r.meta.changes===1;
}
