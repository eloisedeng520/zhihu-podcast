import {copyFileSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from "node:fs";
import {dirname,extname,join,resolve} from "node:path";

const source=resolve(process.argv[2]||"data/MediaCrawler/data");
const target=resolve(process.argv[3]||"server/local-content.generated.json");
const ringIconTarget=resolve("public/data/ring-icons");
const columnIconTarget=resolve("public/data/column-icons");
const imageTarget=resolve("public/data/content-images");
mkdirSync(ringIconTarget,{recursive:true});
mkdirSync(columnIconTarget,{recursive:true});
mkdirSync(imageTarget,{recursive:true});
const roots=[
  {folder:"zhihu_hot",category:"hot",text:"answer.txt",id:"answer_id",title:"question_title",sourceName:"热榜"},
  {folder:"zhihu_columns_top10",category:"columns",text:"article.txt",html:"article.html",id:"article_id",title:"title",sourceName:"column_name"},
  {folder:"zhihu_rings_top10",category:"rings",text:"post.txt",html:"post.html",id:"post_id",title:"title",sourceName:"circle_name"},
];
const records=[];
const seen=new Set();
const titleBeforeNumberedList=(value)=>{
  const text=String(value||"").replace(/\r/g,"").trim();
  // 列表有时被快照压成单行（如“1去看望…”，或“1. …”），按编号起点截断；年份等四位数字不视为列表。
  const match=text.search(/(?:^|\s)\d{1,2}\s*(?:[.．、)]|(?=[\u4e00-\u9fff]))/);
  return (match>0?text.slice(0,match):text).replace(/\s+/g," ").trim();
};
const htmlTitle=(file)=>{
  try {
    const html=readFileSync(file,"utf8");
    const match=html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const value=match?.[1]?.replace(/<[^>]*>/g,"").replace(/&(?:nbsp|amp|lt|gt|quot|apos);/g,m=>({"&nbsp;":" ","&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"',"&apos;":"'"})[m]||m).trim()||"";
    // MediaCrawler 的部分快照会把整篇正文放进 title；题目只取第一行。
    return value.split(/\r?\n/,1)[0].trim();
  } catch { return ""; }
};
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
      const htmlTitleValue=config.html?htmlTitle(join(dirname(path),config.html)):"";
      const rawTitle=(htmlTitleValue||String(meta[config.title]||"").trim()||firstLine);
      const sourceName=config.sourceName==="热榜"?"知乎热榜":String(meta[config.sourceName]||"").trim();
      const author=String(meta.author||"知乎用户").trim();
      const url=String(meta.answer_url||meta.article_url||meta.post_url||meta.question_url||"");
      const metric=Number(meta.voteup_count||meta.favorite_count||meta.like_count||0);
      const images=(Array.isArray(meta.images)?meta.images:[]).map((image,index)=>{
        const local=typeof image?.local_file==="string"?image.local_file:"";
        const sourceImage=local?join(dirname(path),local):"";
        if(!sourceImage) return null;
        try {
          const ext=extname(local).toLowerCase()||".jpg";
          const fileName=`${config.category}_${rawId}_${index+1}${ext}`;
          copyFileSync(sourceImage,join(imageTarget,fileName));
          return {id:`img_${rawId}_${index+1}`,url:`/data/content-images/${fileName}`,originalUrl:typeof image.original_url==="string"?image.original_url:undefined,alt:"原文配图",summary:"原文配图；当前版本未进行视觉识别，不能仅凭此字段推断图片中的事实。",status:"available"};
        } catch { return null; }
      }).filter(Boolean);
      const title=(config.category==="columns"||config.category==="rings"?titleBeforeNumberedList(rawTitle):rawTitle.replace(/\s+/g," ")).slice(0,200)||firstLine.slice(0,200);
      const description=content.replace(/\s+/g," ").slice(0,110);
      let ringData={};
      let hotData={};
      if(config.category==="hot")hotData={collectionId:String(meta.question_id||""),collectionRank:Number(meta.rank||999)};
      if(config.category==="rings"){
        const circleFolder=dirname(dirname(path));
        const iconFile=readdirSync(circleFolder).find(name=>/^circle_icon\.(jpg|png|webp)$/i.test(name));
        const collectionId=String(meta.circle_id||"");
        ringData={collectionId,collectionRank:Number(meta.circle_rank||999)};
        if(iconFile&&collectionId){
          const iconName=`${collectionId}${extname(iconFile).toLowerCase()}`;
          copyFileSync(join(circleFolder,iconFile),join(ringIconTarget,iconName));
          ringData={...ringData,iconPath:`/data/ring-icons/${iconName}`};
        }
      }
      let columnData={};
      if(config.category==="columns"){
        const columnFolder=dirname(dirname(path));
        const iconFile=readdirSync(columnFolder).find(name=>/^column_icon\.(jpg|png|webp)$/i.test(name));
        const columnSlug=String(meta.column_slug||"");
        columnData={collectionId:columnSlug||sourceName,collectionRank:Number(meta.column_rank||999)};
        const iconId=columnSlug||String(meta.column_id||meta.collection_id||sourceName);
        if(iconFile&&iconId){
          const iconName=`${iconId}${extname(iconFile).toLowerCase()}`;
          copyFileSync(join(columnFolder,iconFile),join(columnIconTarget,iconName));
          columnData={...columnData,iconPath:`/data/column-icons/${iconName}`};
        }
        if(!columnData.iconPath&&columnSlug){
          const existingIcon=readdirSync(columnIconTarget).find(name=>name.slice(0,name.lastIndexOf("."))===columnSlug);
          if(existingIcon)columnData={...columnData,iconPath:`/data/column-icons/${existingIcon}`};
        }
      }
      records.push({id:`local_${config.category}_${rawId}`,category:config.category,title,description,author,sourceName,url,metric,...hotData,...ringData,...columnData,content,images,fetchedAt:String(meta.fetched_at||new Date(0).toISOString())});
    }
  }
}
records.sort((a,b)=>a.category.localeCompare(b.category)||b.metric-a.metric||a.id.localeCompare(b.id));
writeFileSync(target,JSON.stringify(records));
console.log(`Imported ${records.length} podcast-ready items to ${target}`);
