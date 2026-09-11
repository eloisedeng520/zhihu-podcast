import {readdirSync,readFileSync,writeFileSync} from "node:fs";
import {basename,dirname,join,resolve} from "node:path";

const source=resolve(process.argv[2]||"../../妙脆角-data/MediaCrawler/data");
const target=resolve(process.argv[3]||"server/local-content.generated.json");
const roots=[
  {folder:"zhihu_hot",category:"hot",text:"answer.txt",id:"answer_id",title:"question_title",sourceName:"热榜"},
  {folder:"zhihu_columns_top10",category:"columns",text:"article.txt",id:"article_id",title:"title",sourceName:"column_name"},
  {folder:"zhihu_rings_top10",category:"rings",text:"post.txt",id:"post_id",title:"title",sourceName:"circle_name"},
];
const records=[];
const seen=new Set();
for(const config of roots){
  const pending=[join(source,config.folder)];
  while(pending.length){
    const folder=pending.pop();
    for(const entry of readdirSync(folder,{withFileTypes:true})){
      const path=join(folder,entry.name);
      if(entry.isDirectory()){pending.push(path);continue;}
      if(entry.name!=="metadata.json")continue;
      const meta=JSON.parse(readFileSync(path,"utf8"));
      const rawId=String(meta[config.id]||"");
      const textPath=join(dirname(path),config.text);
      let content="";try{content=readFileSync(textPath,"utf8").trim();}catch{continue;}
      if(!rawId||seen.has(`${config.category}:${rawId}`)||content.length<180||content.length>30000)continue;
      seen.add(`${config.category}:${rawId}`);
      const firstLine=content.split(/\n+/).find(Boolean)?.trim()||"未命名内容";
      const rawTitle=String(meta[config.title]||"").trim()||firstLine;
      const sourceName=config.sourceName==="热榜"?"知乎热榜":String(meta[config.sourceName]||"").trim();
      const author=String(meta.author||"知乎用户").trim();
      const url=String(meta.answer_url||meta.article_url||meta.post_url||meta.question_url||"");
      const metric=Number(meta.voteup_count||meta.favorite_count||meta.like_count||0);
      const title=rawTitle.replace(/\s+/g," ").slice(0,200);
      const description=content.replace(/\s+/g," ").slice(0,110);
      records.push({id:`local_${config.category}_${rawId}`,category:config.category,title,description,author,sourceName,url,metric,content,fetchedAt:String(meta.fetched_at||new Date(0).toISOString())});
    }
  }
}
records.sort((a,b)=>a.category.localeCompare(b.category)||b.metric-a.metric||a.id.localeCompare(b.id));
writeFileSync(target,JSON.stringify(records));
console.log(`Imported ${records.length} podcast-ready items to ${target}`);
