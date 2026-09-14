"use client";
import {useRef} from "react";
import type {ImageAsset} from "../lib/podcast";

export function CustomSource({title,text,images,anonymousId,uploading,disabled,onTitle,onText,onImages,onUploading,onError}:{
  title:string;text:string;images:ImageAsset[];anonymousId:string;uploading:boolean;disabled:boolean;
  onTitle:(value:string)=>void;onText:(value:string)=>void;onImages:(value:ImageAsset[])=>void;onUploading:(value:boolean)=>void;onError:(value:string)=>void;
}) {
  const fileInput=useRef<HTMLInputElement>(null),busy=useRef(false);
  const upload=async(files:File[])=>{
    if(disabled||busy.current||uploading||!files.length)return;
    if(images.length+files.length>4){onError("最多添加 4 张图片，请减少数量后重试。");return;}
    if(files.some(file=>!["image/png","image/jpeg","image/webp"].includes(file.type))){onError("请选择 PNG、JPG 或 WebP 图片。");return;}
    if(files.some(file=>file.size>2*1024*1024)){onError("每张图片不能超过 2 MB，请缩小后重试。");return;}
    busy.current=true;onUploading(true);onError("");const added:ImageAsset[]=[];
    try {
      for(const file of files){
        const response=await fetch("/api/source-images",{method:"POST",headers:{"Content-Type":file.type,"X-Anonymous-Id":anonymousId},body:file});
        const result=await response.json();if(!response.ok)throw new Error(result.error||"图片上传失败，请重试。");
        added.push(result);onImages([...images,...added]);
      }
    }catch(error){onError(error instanceof Error?error.message:"图片上传失败，请重试。");}
    finally{busy.current=false;onUploading(false);}
  };
  return <div className="custom-source">
    <p>把文字和配图粘贴到同一个框里，下一步生成播客稿并合成声音。</p>
    <label className="field-title" htmlFor="custom-title">节目标题（可选）</label>
    <input disabled={disabled} id="custom-title" className="text-input" value={title} onChange={event=>onTitle(event.target.value)} placeholder="例如：关于长期主义的思考" maxLength={120}/>
    <label className="field-title" htmlFor="custom-text">图文素材</label>
    <div className={`material-editor ${disabled?"is-disabled":""}`} onPaste={event=>{
      if(disabled){event.preventDefault();return;}
      const files=Array.from(event.clipboardData.items).filter(item=>item.kind==="file").map(item=>item.getAsFile()).filter((file):file is File=>!!file);
      if(files.length){if(!event.clipboardData.getData("text/plain"))event.preventDefault();void upload(files);}
    }} onDragOver={event=>{if(event.dataTransfer.types.includes("Files"))event.preventDefault();}} onDrop={event=>{
      if(event.dataTransfer.files.length){event.preventDefault();void upload(Array.from(event.dataTransfer.files));}
    }}>
      <textarea disabled={disabled} id="custom-text" className="script-input" value={text} onChange={event=>onText(event.target.value)} placeholder="在这里粘贴文字、截图或图片…" rows={10} maxLength={50000} aria-describedby="custom-text-help custom-image-help"/>
      {images.length>0&&<div className="custom-image-grid">{images.map((image,index)=><figure key={image.id}><img src={`${image.url}?anonymous_id=${encodeURIComponent(anonymousId)}`} alt={`素材图片 ${index+1}`}/><figcaption>图片 {index+1}<button type="button" disabled={disabled||uploading} onClick={()=>onImages(images.filter(item=>item.id!==image.id))} aria-label={`移除图片 ${index+1}`}>移除</button></figcaption></figure>)}</div>}
      {uploading&&<p className="material-upload-status" role="status">正在保存图片…</p>}
      <div className="material-toolbar">
        <button type="button" className="text-button" disabled={disabled||uploading||images.length>=4||!anonymousId} onClick={()=>fileInput.current?.click()}>＋ 添加图片</button>
        <span id="custom-text-help">{text.length} / 50000 字 · {images.length} / 4 张</span>
      </div>
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event=>{void upload(Array.from(event.target.files||[]));event.target.value="";}}/>
    </div>
    <p id="custom-image-help" className="image-help">至少输入 20 字。支持 PNG、JPG、WebP 图片，每张不超过 2 MB。配图会随节目保存；暂不自动识字，需要播出的图片内容请补充为文字。</p>
  </div>;
}
