#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const baseUrl=(process.env.WORKER_URL||'').replace(/\/$/,'');
const interval=Math.max(5,Number(process.env.SYNC_INTERVAL||15))*1000;
const outDir=path.resolve(process.env.LOG_DIR||'../output/generation-logs');
if(!baseUrl){console.error('请设置 WORKER_URL，例如：WORKER_URL=https://your-worker.example.com');process.exit(1);}
const headers={}; if(process.env.WORKER_TOKEN) headers.Authorization=`Bearer ${process.env.WORKER_TOKEN}`;
async function fetchJson(url){const r=await fetch(url,{headers});if(!r.ok)throw new Error(`${r.status} ${await r.text()}`);return r.json();}
async function sync(){
  const data=await fetchJson(`${baseUrl}/api/episodes`);
  for(const ep of data.episodes||[]){
    try{
      const full=await fetchJson(`${baseUrl}/api/episodes/${ep.id}/generation-log`);
      const dir=path.join(outDir,ep.id); await fs.mkdir(dir,{recursive:true});
      await fs.writeFile(path.join(dir,'generation-log.json'),JSON.stringify(full,null,2)+'\n');
      for(const stage of ['analyzing','writing','reviewing']){
        const entries=(full.generationLog||[]).filter(x=>x.stage===stage);
        if(entries.length) await fs.writeFile(path.join(dir,`${stage}.json`),JSON.stringify(entries,null,2)+'\n');
      }
      console.log(`${new Date().toISOString()} 已同步 ${ep.id}`);
    }catch(error){console.error(`同步 ${ep.id} 失败：${error.message}`);}
  }
}
await fs.mkdir(outDir,{recursive:true});
console.log(`同步目录：${outDir}；轮询间隔：${interval/1000} 秒`);
for(;;){try{await sync();}catch(error){console.error(`读取节目列表失败：${error.message}`);}await new Promise(r=>setTimeout(r,interval));}
