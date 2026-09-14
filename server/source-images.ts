import type {ImageAsset} from "../lib/podcast.ts";
import {PublicError} from "./core.ts";
import type {AudioBucket} from "./store.ts";

const MAX_BYTES=2*1024*1024;
const imagePath=/^\/api\/source-images\/([a-f0-9-]{36}\.(png|jpg|webp))$/;
const mimeTypes={png:"image/png",jpg:"image/jpeg",webp:"image/webp"} as const;
function imageExtension(bytes:Uint8Array):keyof typeof mimeTypes|null {
  if(bytes.length<12)return null;
  if([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return "png";
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return "jpg";
  const text=new TextDecoder();
  if(text.decode(bytes.slice(0,4))==="RIFF"&&text.decode(bytes.slice(8,12))==="WEBP")return "webp";
  return null;
}
export async function uploadSourceImage(request:Request,bucket:AudioBucket,owner:string) {
  if(Number(request.headers.get("Content-Length"))>MAX_BYTES)throw new PublicError("每张图片不能超过 2 MB。",413);
  const reader=request.body?.getReader();if(!reader)throw new PublicError("请选择图片。");
  const chunks:Uint8Array[]=[];let size=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES){await reader.cancel();throw new PublicError("每张图片不能超过 2 MB。",413);}chunks.push(value);}} finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const extension=imageExtension(bytes);
  if(!extension||request.headers.get("Content-Type")?.split(";")[0]!==mimeTypes[extension])throw new PublicError("请选择 PNG、JPG 或 WebP 图片。",415);
  const id=`${crypto.randomUUID()}.${extension}`;
  await bucket.put(`source-images/${owner}/${id}`,bytes,{httpMetadata:{contentType:mimeTypes[extension]}});
  return {id,url:`/api/source-images/${id}`,alt:"自制播客配图"};
}
export async function readSourceImage(path:string,bucket:AudioBucket,owner:string) {
  const match=path.match(imagePath);if(!match)throw new PublicError("没有找到这张图片。",404);
  const object=await bucket.get(`source-images/${owner}/${match[1]}`);
  if(!object)throw new PublicError("没有找到这张图片。",404);
  return new Response(object.body,{headers:{"Content-Type":mimeTypes[match[2] as keyof typeof mimeTypes],"Content-Length":String(object.size),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
}
export async function customSourceImages(input:unknown,bucket:AudioBucket,owner:string):Promise<ImageAsset[]> {
  if(input===undefined)return [];
  if(!Array.isArray(input)||input.length>4)throw new PublicError("最多添加 4 张图片。");
  const images:ImageAsset[]=[];
  for(const value of input){
    const match=typeof value?.url==="string"?value.url.match(imagePath):null;
    if(!match||!await bucket.get(`source-images/${owner}/${match[1]}`))throw new PublicError("图片未上传或已不可用，请重新添加。");
    if(images.some(image=>image.id===match[1]))continue;
    images.push({id:match[1],url:value.url,alt:"自制播客配图",summary:"用户上传配图；图片内容未识别，请以文字素材中的说明为准，不得推断图片事实。",status:"available"});
  }
  return images;
}
