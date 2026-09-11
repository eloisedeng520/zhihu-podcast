import raw from "./local-content.generated.json" with {type:"json"};
import type {Answer,KnowledgeItem,KnowledgeCategory} from "../lib/podcast.ts";
import {PublicError,normalizeAnswer} from "./core.ts";

type LocalRecord={id:string;category:KnowledgeCategory;title:string;description:string;author:string;sourceName:string;url:string;metric:number;content:string;fetchedAt:string};
const records=raw as LocalRecord[];
const byId=new Map(records.map(record=>[record.id,record]));

export function localKnowledgeItems():KnowledgeItem[]{
  return records.map(({content,fetchedAt,url,...item})=>({...item,labels:[item.sourceName,item.author,item.category]}));
}

export function localAnswer(id:string):Answer{
  const record=byId.get(id);
  if(!record)throw new PublicError("没有找到这篇本地内容。",404);
  const content=record.content.split(/\n/).map(line=>line.trim()).filter(Boolean).join("\n");
  const answer=normalizeAnswer({content,title:record.title,author:record.author},record.id,{});
  answer.url=record.url;
  answer.fetchedAt=record.fetchedAt;
  return answer;
}
