import raw from "./local-content.generated.json" with {type:"json"};
import type {Answer,KnowledgeItem,KnowledgeCategory} from "../lib/podcast.ts";
import {PublicError,normalizeAnswer} from "./core.ts";

type LocalRecord={id:string;category:KnowledgeCategory;title:string;description:string;author:string;sourceName:string;url:string;metric:number;collectionId?:string;collectionRank?:number;iconPath?:string;content:string;fetchedAt:string};
const records=raw as LocalRecord[];
const byId=new Map(records.map(record=>[record.id,record]));
const hotQuestionPrefix="local_hot_question_";
const hotGroups=new Map<string,LocalRecord[]>();
for(const record of records)if(record.category==="hot"&&record.collectionId){const group=hotGroups.get(record.collectionId)||[];group.push(record);hotGroups.set(record.collectionId,group);}
for(const group of hotGroups.values())group.sort((a,b)=>b.metric-a.metric||a.collectionRank!-b.collectionRank!);

export function localKnowledgeItems():KnowledgeItem[]{
  const singles=records.filter(record=>record.category!=="hot"||!record.collectionId).map(({content,fetchedAt,url,...item})=>({...item,labels:[item.sourceName,item.author,item.category]}));
  const questions=[...hotGroups.entries()].map(([questionId,answers])=>({id:`${hotQuestionPrefix}${questionId}`,category:"hot" as const,title:answers[0].title,description:answers.slice(0,3).map(answer=>answer.description).join(" ").slice(0,110),author:`${Math.min(3,answers.length)} 位代表答主`,sourceName:"知乎热榜",metric:Math.max(...answers.map(answer=>answer.metric)),collectionId:questionId,labels:["热榜","多观点",...answers.slice(0,3).map(answer=>answer.author)]}));
  return [...questions.sort((a,b)=>b.metric-a.metric),...singles];
}

export function localAnswer(id:string):Answer{
  if(id.startsWith(hotQuestionPrefix)){
    const questionId=id.slice(hotQuestionPrefix.length),answers=hotGroups.get(questionId)?.slice(0,3);
    if(!answers?.length)throw new PublicError("没有找到这个热榜问题。",404);
    const contributors=[];const paragraphs=[];
    for(const [answerIndex,record] of answers.entries()){
      const content=record.content.split(/\n/).map(line=>line.trim()).filter(Boolean).join("\n");
      const answer=normalizeAnswer({content,title:record.title,author:record.author},record.id,{});
      contributors.push({id:record.id,name:record.author,url:record.url});
      paragraphs.push(...answer.paragraphs.map((paragraph,index)=>({id:`a${answerIndex+1}p${index+1}`,text:paragraph.text})));
    }
    return {id,title:answers[0].title,author:`${contributors.length} 位答主`,url:`https://www.zhihu.com/question/${questionId}`,paragraphs,contributors,fetchedAt:answers[0].fetchedAt};
  }
  const record=byId.get(id);
  if(!record)throw new PublicError("没有找到这篇本地内容。",404);
  const content=record.content.split(/\n/).map(line=>line.trim()).filter(Boolean).join("\n");
  const answer=normalizeAnswer({content,title:record.title,author:record.author},record.id,{});
  answer.url=record.url;
  answer.fetchedAt=record.fetchedAt;
  return answer;
}
