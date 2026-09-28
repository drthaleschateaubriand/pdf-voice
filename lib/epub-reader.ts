import {splitIpadSpeech} from './ipad-speech';

export type EpubBlock={
 kind:'heading'|'paragraph'|'list';
 text:string;
 clips:string[];
};

export type EpubChapter={
 id:string;
 href:string;
 title:string;
 blocks:EpubBlock[];
 clips:string[];
};

export type EpubBookData={
 title:string;
 chapters:EpubChapter[];
};

type ZipFileLike={
 async:(type:'text'|'blob'|'uint8array')=>Promise<string|Blob|Uint8Array>;
};

type ZipLike={
 file:(path:string)=>ZipFileLike|null;
};

type JsZipStatic={
 loadAsync:(data:ArrayBuffer|Uint8Array)=>Promise<ZipLike>;
};

declare global{
 interface Window{JSZip?:JsZipStatic}
}

const JSZIP_URL='https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
let jsZipPromise:Promise<JsZipStatic>|null=null;

function loadJsZip(){
 if(typeof window==='undefined')return Promise.reject(new Error('Leitura EPUB indisponível fora do navegador.'));
 if(window.JSZip)return Promise.resolve(window.JSZip);
 if(jsZipPromise)return jsZipPromise;
 jsZipPromise=new Promise<JsZipStatic>((resolve,reject)=>{
  const finish=()=>{
   if(window.JSZip)resolve(window.JSZip);
   else reject(new Error('O mecanismo EPUB não ficou disponível.'));
  };
  const old=document.querySelector<HTMLScriptElement>('script[data-meu-foco-jszip="1"]');
  if(old){
   old.addEventListener('load',finish,{once:true});
   old.addEventListener('error',()=>reject(new Error('Falha ao carregar o mecanismo EPUB.')),{once:true});
   return;
  }
  const script=document.createElement('script');
  script.src=JSZIP_URL;
  script.async=true;
  script.crossOrigin='anonymous';
  script.dataset.meuFocoJszip='1';
  script.onload=finish;
  script.onerror=()=>reject(new Error('Falha ao carregar o mecanismo EPUB.'));
  document.head.appendChild(script);
 });
 return jsZipPromise;
}

function normalizeZipPath(path:string){
 const clean=decodeURIComponent(path.split('#')[0].split('?')[0]).replace(/\\/g,'/').replace(/^\/+/, '');
 const out:string[]=[];
 for(const part of clean.split('/')){
  if(!part||part==='.')continue;
  if(part==='..')out.pop();
  else out.push(part);
 }
 return out.join('/');
}

function dirname(path:string){
 const clean=normalizeZipPath(path);
 const idx=clean.lastIndexOf('/');
 return idx>=0?clean.slice(0,idx):'';
}

function resolvePath(baseFile:string,relative:string){
 const rel=relative.split('#')[0].split('?')[0];
 if(!rel)return normalizeZipPath(baseFile);
 if(rel.startsWith('/'))return normalizeZipPath(rel);
 const base=dirname(baseFile);
 return normalizeZipPath((base?base+'/':'')+rel);
}

function xml(text:string){
 const parsed=new DOMParser().parseFromString(text,'application/xml');
 if(parsed.querySelector('parsererror'))throw new Error('O EPUB contém um arquivo de estrutura inválido.');
 return parsed;
}

function attr(element:Element|null,name:string){
 return element?.getAttribute(name)||'';
}

function localElements(root:Document|Element,name:string){
 return Array.from(root.getElementsByTagName('*')).filter(el=>el.localName===name);
}

function cleanText(value:string|null|undefined){
 return (value||'').replace(/\u00ad/g,'').replace(/\s+/g,' ').trim();
}

function fileStem(path:string){
 const name=path.split('/').pop()||'Capítulo';
 try{return decodeURIComponent(name.replace(/\.(xhtml?|html?|xml)$/i,'')).replace(/[_-]+/g,' ').trim()||'Capítulo';}
 catch{return name.replace(/\.(xhtml?|html?|xml)$/i,'').replace(/[_-]+/g,' ').trim()||'Capítulo';}
}

function extractBlocks(document:Document){
 const body=document.body||document.documentElement;
 const selector='h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption';
 const candidates=Array.from(body.querySelectorAll(selector));
 const blocks:EpubBlock[]=[];
 for(const node of candidates){
  const parent=node.parentElement?.closest(selector);
  if(parent&&body.contains(parent))continue;
  const text=cleanText(node.textContent);
  if(!text)continue;
  const tag=node.tagName.toLowerCase();
  const kind:EpubBlock['kind']=tag.startsWith('h')?'heading':tag==='li'?'list':'paragraph';
  const clips=splitIpadSpeech(text);
  if(clips.length)blocks.push({kind,text,clips});
 }
 if(!blocks.length){
  const text=cleanText(body.textContent);
  const clips=splitIpadSpeech(text);
  if(clips.length)blocks.push({kind:'paragraph',text,clips});
 }
 return blocks;
}

async function readText(zip:ZipLike,path:string){
 const entry=zip.file(normalizeZipPath(path));
 if(!entry)throw new Error('Arquivo ausente dentro do EPUB: '+path);
 const value=await entry.async('text');
 return typeof value==='string'?value:new TextDecoder().decode(value as Uint8Array);
}

async function buildNavTitles(zip:ZipLike,manifest:Map<string,{href:string;mediaType:string;properties:string}>,opfPath:string){
 const titles=new Map<string,string>();
 const nav=Array.from(manifest.values()).find(item=>item.properties.split(/\s+/).includes('nav'));
 if(nav){
  try{
   const navPath=resolvePath(opfPath,nav.href);
   const text=await readText(zip,navPath);
   const doc=new DOMParser().parseFromString(text,'text/html');
   for(const link of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))){
    const label=cleanText(link.textContent);
    const target=resolvePath(navPath,link.getAttribute('href')||'');
    if(label&&target&&!titles.has(target))titles.set(target,label);
   }
  }catch{}
 }
 if(titles.size)return titles;

 const ncx=Array.from(manifest.values()).find(item=>/application\/x-dtbncx\+xml/i.test(item.mediaType));
 if(ncx){
  try{
   const ncxPath=resolvePath(opfPath,ncx.href);
   const doc=xml(await readText(zip,ncxPath));
   for(const point of localElements(doc,'navPoint')){
    const content=localElements(point,'content')[0];
    const label=localElements(point,'text')[0];
    const target=resolvePath(ncxPath,attr(content,'src'));
    const value=cleanText(label?.textContent);
    if(target&&value&&!titles.has(target))titles.set(target,value);
   }
  }catch{}
 }
 return titles;
}

export async function parseEpub(file:File):Promise<EpubBookData>{
 const JSZip=await loadJsZip();
 const zip=await JSZip.loadAsync(await file.arrayBuffer());

 const container=xml(await readText(zip,'META-INF/container.xml'));
 const rootfile=localElements(container,'rootfile')[0];
 const opfPath=normalizeZipPath(attr(rootfile,'full-path'));
 if(!opfPath)throw new Error('Não foi possível localizar o conteúdo principal do EPUB.');

 const packageDoc=xml(await readText(zip,opfPath));
 const manifest=new Map<string,{href:string;mediaType:string;properties:string}>();
 for(const item of localElements(packageDoc,'item')){
  const id=attr(item,'id');
  const href=attr(item,'href');
  if(id&&href)manifest.set(id,{href,mediaType:attr(item,'media-type'),properties:attr(item,'properties')});
 }

 const titleElement=localElements(packageDoc,'title')[0];
 const bookTitle=cleanText(titleElement?.textContent)||file.name.replace(/\.epub$/i,'');
 const navTitles=await buildNavTitles(zip,manifest,opfPath);
 const chapters:EpubChapter[]=[];

 const itemRefs=localElements(packageDoc,'itemref');
 for(const ref of itemRefs){
  const idref=attr(ref,'idref');
  const item=manifest.get(idref);
  if(!item)continue;
  if(item.mediaType&&!/xhtml|html|xml/i.test(item.mediaType))continue;
  const chapterPath=resolvePath(opfPath,item.href);
  try{
   const source=await readText(zip,chapterPath);
   const doc=new DOMParser().parseFromString(source,'text/html');
   for(const unsafe of Array.from(doc.querySelectorAll('script,iframe,object,embed,noscript')))unsafe.remove();
   const blocks=extractBlocks(doc);
   const clips=blocks.flatMap(block=>block.clips);
   if(!clips.length)continue;
   const firstHeading=blocks.find(block=>block.kind==='heading')?.text;
   const title=navTitles.get(chapterPath)||firstHeading||fileStem(chapterPath);
   chapters.push({id:idref||chapterPath,href:chapterPath,title,blocks,clips});
  }catch{}
 }

 if(!chapters.length)throw new Error('Este EPUB não possui capítulos de texto que o Meu Foco consiga ler.');
 return {title:bookTitle,chapters};
}
