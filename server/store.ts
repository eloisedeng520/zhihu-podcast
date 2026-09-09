import type { Episode } from "../lib/podcast.ts";
export type Statement = {bind(...args:unknown[]):Statement; run():Promise<{meta:{changes:number}}> ;first<T>():Promise<T|null>;all<T>():Promise<{results:T[]}>};
export type Database = {prepare(sql:string):Statement};
export type AudioObject = {body:ReadableStream;size:number;arrayBuffer():Promise<ArrayBuffer>;range?:{offset:number;length:number}};
export type AudioBucket = {get(key:string,options?:{range?:Headers}):Promise<AudioObject|null>;put(key:string,body:Uint8Array,options?:{httpMetadata:{contentType:string}}):Promise<unknown>};
export type EpisodeQuestion = {id:string;episodeId:string;positionSeconds:number;questionText:string;answerText:string|null;sourceIds:string[];status:"transcribing"|"answering"|"ready"|"failed";errorCode:string|null;createdAt:string;updatedAt:string};
export async function initDb(db:Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS episodes (id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL, lock_token TEXT, lock_until INTEGER NOT NULL DEFAULT 0)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS episode_questions (id TEXT PRIMARY KEY, episode_id TEXT NOT NULL, owner_key TEXT NOT NULL, position_seconds REAL NOT NULL, question_text TEXT NOT NULL, answer_text TEXT, source_ids TEXT NOT NULL, status TEXT NOT NULL, error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS episode_questions_owner_episode_created ON episode_questions (owner_key, episode_id, created_at DESC)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS episode_questions_owner_status ON episode_questions (owner_key, status)`).run();
}
const presentQuestion=(row:{id:string;episode_id:string;position_seconds:number;question_text:string;answer_text:string|null;source_ids:string;status:EpisodeQuestion["status"];error_code:string|null;created_at:string;updated_at:string}):EpisodeQuestion=>({id:row.id,episodeId:row.episode_id,positionSeconds:row.position_seconds,questionText:row.question_text,answerText:row.answer_text,sourceIds:JSON.parse(row.source_ids),status:row.status,errorCode:row.error_code,createdAt:row.created_at,updatedAt:row.updated_at});
type QuestionRow=Parameters<typeof presentQuestion>[0];
export async function readQuestion(db:Database,id:string,ownerKey:string) {
  const row=await db.prepare("SELECT id,episode_id,position_seconds,question_text,answer_text,source_ids,status,error_code,created_at,updated_at FROM episode_questions WHERE id = ? AND owner_key = ?").bind(id,ownerKey).first<QuestionRow>();return row?presentQuestion(row):null;
}
export async function listQuestions(db:Database,episodeId:string,ownerKey:string,limit=50) {
  const rows=await db.prepare("SELECT id,episode_id,position_seconds,question_text,answer_text,source_ids,status,error_code,created_at,updated_at FROM episode_questions WHERE episode_id = ? AND owner_key = ? ORDER BY created_at DESC LIMIT ?").bind(episodeId,ownerKey,limit).all<QuestionRow>();return rows.results.map(presentQuestion);
}
export async function deleteOwnerQuestions(db:Database,ownerKey:string) {return db.prepare("DELETE FROM episode_questions WHERE owner_key = ?").bind(ownerKey).run();}
export async function readEpisode(db:Database,id:string) {
  const row=await db.prepare("SELECT payload FROM episodes WHERE id = ?").bind(id).first<{payload:string}>();return row?JSON.parse(row.payload) as Episode:null;
}
export async function saveEpisode(db:Database,episode:Episode,token:string) {
  episode.updatedAt=new Date().toISOString();
  const r=await db.prepare("UPDATE episodes SET payload = ?, lock_token = NULL, lock_until = 0 WHERE id = ? AND lock_token = ?").bind(JSON.stringify(episode),episode.id,token).run();
  return r.meta.changes===1;
}
