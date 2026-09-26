"use client";
import {useCallback,useEffect,useRef,useState,type CSSProperties} from 'react';
import {addCloudBookmark,getCloudSession,loadCloudPreferences,openCloudBook,removeCloudBookmark,saveCloudPreferences,saveCloudProgress,signInCloud,signOutCloud,signUpCloud,type CloudSession} from './paper-cloud';

type Provider={id:string;name:string;model:string;configured:boolean;voices:{id:string;name:string}[]};
type Mode='idle'|'loading'|'playing'|'paused';
type PdfTextItem={str?:string;hasEOL?:boolean};
type PdfViewportLike={width:number;height:number};
type PdfRenderTask={promise:Promise<void>;cancel:()=>void};
type PdfTextLayerTask={promise:Promise<void>;cancel?:()=>void};
type PdfPageLike={
 getTextContent:()=>Promise<{items:PdfTextItem[]}>;
 getViewport:(options:{scale:number})=>PdfViewportLike;
 render:(options:{canvasContext:CanvasRenderingContext2D;viewport:PdfViewportLike;transform?:number[]})=>PdfRenderTask;
};
type PdfDocLike={numPages:number;getPage:(n:number)=>Promise<PdfPageLike>;destroy:()=>Promise<void>|void};
type PdfJsClassic={
 version:string;
 GlobalWorkerOptions:{workerSrc:string};
 getDocument:(options:{data:Uint8Array;cMapUrl?:string;cMapPacked?:boolean;standardFontDataUrl?:string})=>{promise:Promise<PdfDocLike>};
 renderTextLayer:(options:{textContentSource:{items:PdfTextItem[]};container:HTMLElement;viewport:PdfViewportLike;textDivs?:HTMLElement[];textContentItemsStr?:string[]})=>PdfTextLayerTask;
};

const PDFJS_VERSION='3.11.174';
const PDFJS_BASE='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/'+PDFJS_VERSION+'/';

const shell:CSSProperties={minHeight:'100dvh',background:'#f3efe6',color:'#17202a',fontFamily:'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',display:'flex',flexDirection:'column'};
const top:CSSProperties={position:'sticky',top:0,zIndex:10,background:'#fffdf8',borderBottom:'1px solid #d8d0c2',padding:'calc(10px + env(safe-area-inset-top, 0px)) 12px 10px',paddingLeft:'calc(12px + env(safe-area-inset-left, 0px))',paddingRight:'calc(12px + env(safe-area-inset-right, 0px))',display:'flex',alignItems:'center',gap:10};
const button:CSSProperties={border:'1px solid #cfc7b9',background:'#fffdf8',borderRadius:12,padding:'10px 13px',fontSize:15,color:'#17202a'};
const primary:CSSProperties={...button,background:'#17202a',color:'#fffdf8',borderColor:'#17202a',fontWeight:600};
const card:CSSProperties={background:'#fffdf8',border:'1px solid #d8d0c2',borderRadius:14,padding:12};
const small:CSSProperties={fontSize:12,color:'#657080'};

function isAppleTouch(){
 if(typeof navigator==='undefined')return false;
 const ua=navigator.userAgent||'';
 return /iPad|iPhone|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
}

function splitSentences(text:string){
 const clean=text.replace(/\s+/g,' ').trim();
 if(!clean)return [];
 const out:string[]=[];let start=0;
 const abbreviations=new Set(['dr','dra','sr','sra','prof','profa','etc','fig','tab','vs','cf','cap','aprox','mín','máx','obs','ref','ed','vol','art','mg','ml','kg','mcg','mmol','mmhg','min','seg','hr','hrs','dl','ui']);
 for(let i=0;i<clean.length;i++){
  const ch=clean[i];if(ch!=='.'&&ch!=='!'&&ch!=='?')continue;
  const next=clean[i+1];if(next&&next!==' ')continue;
  if(ch==='.'){
   const before=clean.slice(Math.max(0,i-16),i),m=before.match(/([0-9A-Za-zÀ-ÿ]+)$/),word=(m?.[1]||'').toLowerCase();
   if(word.length===1||abbreviations.has(word))continue;
  }
  const sentence=clean.slice(start,i+1).trim();if(sentence)out.push(sentence);
  start=i+1;while(clean[start]===' ')start++;
 }
 const tail=clean.slice(start).trim();if(tail)out.push(tail);
 return out.filter(s=>s.length>1);
}

async function fileBytes(file:File){
 if(typeof file.arrayBuffer==='function')return file.arrayBuffer();
 return new Promise<ArrayBuffer>((resolve,reject)=>{
  const r=new FileReader();
  r.onload=()=>resolve(r.result as ArrayBuffer);
  r.onerror=()=>reject(r.error||new Error('Falha ao ler o arquivo.'));
  r.readAsArrayBuffer(file);
 });
}

let pdfJsPromise:Promise<PdfJsClassic>|null=null;
function loadClassicPdfJs(){
 if(typeof window==='undefined')return Promise.reject(new Error('Navegador indisponível.'));
 const existing=(window as Window & {pdfjsLib?:PdfJsClassic}).pdfjsLib;
 if(existing){
  existing.GlobalWorkerOptions.workerSrc=PDFJS_BASE+'pdf.worker.min.js';
  return Promise.resolve(existing);
 }
 if(pdfJsPromise)return pdfJsPromise;
 pdfJsPromise=new Promise<PdfJsClassic>((resolve,reject)=>{
  const win=window as Window & {pdfjsLib?:PdfJsClassic};
  const finish=()=>{
   const lib=win.pdfjsLib;
   if(!lib){reject(new Error('PDF.js clássico não ficou disponível.'));return;}
   lib.GlobalWorkerOptions.workerSrc=PDFJS_BASE+'pdf.worker.min.js';
   resolve(lib);
  };
  const old=document.querySelector<HTMLScriptElement>('script[data-paper-voice-pdfjs="classic"]');
  if(old){
   if(win.pdfjsLib){finish();return;}
   old.addEventListener('load',finish,{once:true});
   old.addEventListener('error',()=>reject(new Error('Falha ao carregar o PDF.js clássico.')),{once:true});
   return;
  }
  const script=document.createElement('script');
  script.src=PDFJS_BASE+'pdf.min.js';
  script.async=true;
  script.crossOrigin='anonymous';
  script.dataset.paperVoicePdfjs='classic';
  script.onload=finish;
  script.onerror=()=>reject(new Error('Falha ao carregar o PDF.js clássico.'));
  document.head.appendChild(script);
 });
 return pdfJsPromise;
}

export default function IpadReader(){
 const [doc,setDoc]=useState<PdfDocLike|null>(null);
 const [name,setName]=useState('Nenhum PDF aberto');
 const [page,setPage]=useState(1),[pages,setPages]=useState(0),[jumpValue,setJumpValue]=useState('1');
 const [sentences,setSentences]=useState<string[]>([]),[index,setIndex]=useState(0);
 const [mode,setMode]=useState<Mode>('idle'),[error,setError]=useState('');
 const [voices,setVoices]=useState<{id:string;name:string}[]>([]),[voice,setVoice]=useState('marin'),[speed,setSpeed]=useState(1);
 const [connected,setConnected]=useState(false),[stage,setStage]=useState('Pronto'),[compact,setCompact]=useState(false),[compactControls,setCompactControls]=useState(true);
 const [selectedText,setSelectedText]=useState('');
 const [bookmarks,setBookmarks]=useState<number[]>([]);
 const [highlightEnabled,setHighlightEnabled]=useState(true);
 const [cloudSession,setCloudSession]=useState<CloudSession|null>(null),[cloudStatus,setCloudStatus]=useState('Somente neste aparelho');
 const [accountOpen,setAccountOpen]=useState(false),[accountEmail,setAccountEmail]=useState(''),[accountPassword,setAccountPassword]=useState(''),[accountBusy,setAccountBusy]=useState(false),[accountMessage,setAccountMessage]=useState('');
 const highlightEnabledRef=useRef(true),cloudSessionRef=useRef<CloudSession|null>(null),cloudBookIdRef=useRef('');
 const currentFileRef=useRef<{name:string;size:number}|null>(null);
 const fileRef=useRef<HTMLInputElement>(null),canvasRef=useRef<HTMLCanvasElement>(null),canvasWrap=useRef<HTMLDivElement>(null),pageStageRef=useRef<HTMLDivElement>(null),textLayerRef=useRef<HTMLDivElement>(null);
 const docRef=useRef<PdfDocLike|null>(null),pageRef=useRef(1),sentencesRef=useRef<string[]>([]),indexRef=useRef(0);
 const renderTask=useRef<PdfRenderTask|null>(null),textLayerTask=useRef<PdfTextLayerTask|null>(null);
 const textItemsRef=useRef<PdfTextItem[]>([]),textDivsRef=useRef<HTMLElement[]>([]),sentenceRangesRef=useRef<Array<{start:number;end:number}>>([]),selectionStartRef=useRef({item:0,offset:0}),selectionEndRef=useRef({item:0,offset:0});
 const audioRef=useRef<HTMLAudioElement|null>(null),playWanted=useRef(false),token=useRef(0);
 const cache=useRef(new Map<string,string>()),fileKey=useRef('');

 useEffect(()=>{pageRef.current=page;},[page]);
 useEffect(()=>{sentencesRef.current=sentences;},[sentences]);
 useEffect(()=>{indexRef.current=index;},[index]);
 useEffect(()=>{if(audioRef.current)audioRef.current.playbackRate=speed;},[speed]);

 useEffect(()=>{
  try{
   const prefs=JSON.parse(localStorage.getItem('paper-voice-preferences')||'{}') as {voice?:string;speed?:number;highlightEnabled?:boolean};
   if(typeof prefs.voice==='string'&&prefs.voice)setVoice(prefs.voice);
   if(typeof prefs.speed==='number'&&[0.75,1,1.25,1.5,1.75,2].includes(prefs.speed))setSpeed(prefs.speed);
   if(typeof prefs.highlightEnabled==='boolean'){setHighlightEnabled(prefs.highlightEnabled);highlightEnabledRef.current=prefs.highlightEnabled;}
  }catch{}
 },[]);

 function persistPreferences(next:{voice?:string;speed?:number;highlightEnabled?:boolean}){
  try{
   const current=JSON.parse(localStorage.getItem('paper-voice-preferences')||'{}');
   localStorage.setItem('paper-voice-preferences',JSON.stringify({...current,...next}));
  }catch{}
  if(cloudSessionRef.current){
   void saveCloudPreferences({
    ...(typeof next.voice==='string'?{voice:next.voice}:{}),
    ...(typeof next.speed==='number'?{speed:next.speed}:{}),
    ...(typeof next.highlightEnabled==='boolean'?{highlight_enabled:next.highlightEnabled}:{})
   }).catch(()=>setCloudStatus('Nuvem temporariamente indisponível'));
  }
 }

 function applyCloudPrefs(prefs:Awaited<ReturnType<typeof loadCloudPreferences>>){
  if(!prefs)return;
  if(prefs.voice){setVoice(prefs.voice);persistPreferences({voice:prefs.voice});}
  if(typeof prefs.speed==='number'){setSpeed(Number(prefs.speed));persistPreferences({speed:Number(prefs.speed)});}
  if(typeof prefs.highlight_enabled==='boolean'){
   highlightEnabledRef.current=prefs.highlight_enabled;
   setHighlightEnabled(prefs.highlight_enabled);
   persistPreferences({highlightEnabled:prefs.highlight_enabled});
   if(!prefs.highlight_enabled)clearSpokenHighlight();
  }
 }

 async function attachCloudSession(session:CloudSession){
  cloudSessionRef.current=session;setCloudSession(session);setCloudStatus('Sincronização ativa');
  try{
   const prefs=await loadCloudPreferences();
   if(prefs)applyCloudPrefs(prefs);
   else{
    let local:{voice?:string;speed?:number;highlightEnabled?:boolean}={};
    try{local=JSON.parse(localStorage.getItem('paper-voice-preferences')||'{}');}catch{}
    await saveCloudPreferences({voice:local.voice||voice,speed:local.speed||speed,highlight_enabled:typeof local.highlightEnabled==='boolean'?local.highlightEnabled:highlightEnabledRef.current});
   }
  }catch{setCloudStatus('Conta conectada · sincronização pendente');}
 }

 async function syncCurrentBookFromCloud(){
  const d=docRef.current,file=currentFileRef.current;
  if(!d||!file||!fileKey.current||!cloudSessionRef.current)return;
  setCloudStatus('Sincronizando livro…');
  try{
   const localMarks=bookmarks;
   const remote=await openCloudBook({fingerprint:fileKey.current,fileName:file.name,fileSize:file.size,totalPages:d.numPages});
   cloudBookIdRef.current=remote.bookId;
   const merged=[...new Set([...localMarks,...remote.bookmarks])].sort((a,b)=>a-b);
   setBookmarks(merged);
   try{localStorage.setItem('paper-voice-bookmarks:'+fileKey.current,JSON.stringify(merged));}catch{}
   for(const mark of merged)if(!remote.bookmarks.includes(mark))void addCloudBookmark(remote.bookId,mark).catch(()=>{});
   if(remote.progress&&remote.progress.page>=1&&remote.progress.page<=d.numPages){
    await extractPage(d,remote.progress.page,remote.progress.sentence_index||0);
   }else{
    void saveCloudProgress(remote.bookId,pageRef.current,indexRef.current).catch(()=>{});
   }
   setCloudStatus('Sincronização ativa');
  }catch{setCloudStatus('Conta conectada · usando dados locais');}
 }

 async function handleSignIn(){
  if(!accountEmail.trim()||!accountPassword){setAccountMessage('Digite e-mail e senha.');return;}
  setAccountBusy(true);setAccountMessage('');
  try{
   const session=await signInCloud(accountEmail.trim(),accountPassword);
   await attachCloudSession(session);
   setAccountPassword('');
   setAccountMessage('Conta conectada. Progresso e preferências serão sincronizados.');
   await syncCurrentBookFromCloud();
  }catch(e){setAccountMessage(e instanceof Error?e.message:'Não foi possível entrar.');}
  finally{setAccountBusy(false);}
 }

 async function handleSignUp(){
  if(!accountEmail.trim()||accountPassword.length<8){setAccountMessage('Use um e-mail válido e uma senha com pelo menos 8 caracteres.');return;}
  setAccountBusy(true);setAccountMessage('');
  try{
   const result=await signUpCloud(accountEmail.trim(),accountPassword);
   if(result.session){
    await attachCloudSession(result.session);
    setAccountMessage('Conta criada e conectada.');
    await syncCurrentBookFromCloud();
   }else setAccountMessage('Conta criada. Confirme o e-mail recebido e depois toque em Entrar.');
  }catch(e){setAccountMessage(e instanceof Error?e.message:'Não foi possível criar a conta.');}
  finally{setAccountBusy(false);}
 }

 async function handleSignOut(){
  setAccountBusy(true);
  await signOutCloud();
  cloudSessionRef.current=null;cloudBookIdRef.current='';
  setCloudSession(null);setCloudStatus('Somente neste aparelho');setAccountPassword('');setAccountMessage('Sessão encerrada.');
  setAccountBusy(false);
 }

 useEffect(()=>{
  void getCloudSession().then(session=>{
   if(session)void attachCloudSession(session);
  }).catch(()=>{});
 },[]);

 useEffect(()=>{
  fetch('/api/speech').then(r=>r.json()).then((d:{providers:Provider[]})=>{
   const o=d.providers?.find(p=>p.id==='openai');
   if(!o)return;
   setConnected(Boolean(o.configured));setVoices(o.voices||[]);
   let savedVoice='';
   try{savedVoice=JSON.parse(localStorage.getItem('paper-voice-preferences')||'{}').voice||'';}catch{}
   const preferred=o.voices?.find(v=>v.id===savedVoice)||o.voices?.find(v=>v.id==='marin')||o.voices?.[0];
   if(preferred)setVoice(preferred.id);
  }).catch(()=>setError('Não foi possível verificar a conexão com a voz OpenAI.'));
  return()=>{
   token.current++;
   audioRef.current?.pause();
   renderTask.current?.cancel();
   textLayerTask.current?.cancel?.();
   void docRef.current?.destroy();
   for(const url of cache.current.values())URL.revokeObjectURL(url);
  };
 },[]);

 function clearSpokenHighlight(){
  for(const span of textDivsRef.current)span.classList.remove('ipad-speaking');
 }

 function highlightRange(range:{start:number;end:number}|undefined){
  clearSpokenHighlight();
  if(!highlightEnabledRef.current||!range)return;
  for(let n=range.start;n<=range.end;n++)textDivsRef.current[n]?.classList.add('ipad-speaking');
 }

 function highlightSentence(i:number){
  highlightRange(sentenceRangesRef.current[i]);
 }

 function buildRangesForSegment(startItem:number,endItem:number,startOffset=0,endOffset?:number){
  const items=textItemsRef.current;
  const start=Math.max(0,Math.min(startItem,items.length-1));
  const end=Math.max(start,Math.min(endItem,items.length-1));
  let text='',normalized='',cursor=0;
  const charRanges:Array<{item:number;start:number;end:number}>=[];
  for(let i=start;i<=end;i++){
   const it=items[i];let part=it?.str||'';
   if(i===start&&startOffset>0)part=part.slice(Math.min(startOffset,part.length));
   if(i===end&&typeof endOffset==='number')part=part.slice(0,Math.min(endOffset,part.length));
   if(!part)continue;
   text+=part+(it?.hasEOL?'\n':' ');
   const clean=part.replace(/\s+/g,' ').trim();
   if(!clean)continue;
   if(normalized.length)normalized+=' ';
   const charStart=normalized.length;
   normalized+=clean;
   charRanges.push({item:i,start:charStart,end:normalized.length});
  }
  const list=splitSentences(text);
  const ranges:Array<{start:number;end:number}>=[];
  for(const sentence of list){
   const found=normalized.indexOf(sentence,cursor);
   const sentenceStart=found>=0?found:cursor;
   const sentenceEnd=sentenceStart+sentence.length;
   const hits=charRanges.filter(r=>r.end>sentenceStart&&r.start<sentenceEnd);
   ranges.push(hits.length?{start:hits[0].item,end:hits[hits.length-1].item}:{start,end:start});
   cursor=sentenceEnd;
  }
  return {list,ranges};
 }

 function stop(reset=false){
  token.current++;playWanted.current=false;
  const a=audioRef.current;if(a){a.pause();a.onended=null;a.onerror=null;}
  setMode('idle');clearSpokenHighlight();
  if(reset){setIndex(0);indexRef.current=0;}
 }

 const clearSelection=useCallback(()=>{
  setSelectedText('');
  selectionStartRef.current={item:0,offset:0};
  selectionEndRef.current={item:0,offset:0};
  try{window.getSelection()?.removeAllRanges();}catch{}
 },[]);

 const captureSelection=useCallback(()=>{
  const layer=textLayerRef.current,selection=window.getSelection();
  if(!layer||!selection||selection.rangeCount===0||selection.isCollapsed){setSelectedText('');return;}
  const range=selection.getRangeAt(0);
  if(!layer.contains(range.commonAncestorContainer)){return;}
  const text=selection.toString().replace(/\s+/g,' ').trim();
  if(!text){setSelectedText('');return;}
  const rawStart=range.startContainer,rawEnd=range.endContainer;
  const startElement=(rawStart.nodeType===Node.ELEMENT_NODE?rawStart as Element:rawStart.parentElement)?.closest<HTMLElement>('[data-item]');
  const endElement=(rawEnd.nodeType===Node.ELEMENT_NODE?rawEnd as Element:rawEnd.parentElement)?.closest<HTMLElement>('[data-item]');
  const startItem=Number(startElement?.dataset.item||0),endItem=Number(endElement?.dataset.item||startItem);
  const startOffset=rawStart.nodeType===Node.TEXT_NODE?range.startOffset:0;
  const endText=(endElement?.textContent||'');
  const endOffset=rawEnd.nodeType===Node.TEXT_NODE?range.endOffset:endText.length;
  selectionStartRef.current={item:Number.isFinite(startItem)?startItem:0,offset:Math.max(0,startOffset)};
  selectionEndRef.current={item:Number.isFinite(endItem)?endItem:selectionStartRef.current.item,offset:Math.max(0,endOffset)};
  setSelectedText(text);
  setCompactControls(true);
 },[]);

 async function extractPage(current:PdfDocLike,n:number,restoreIndex=0){
  setStage('Carregando página '+n+'…');setError('');
  renderTask.current?.cancel();
  textLayerTask.current?.cancel?.();
  clearSelection();
  const pdfPage=await current.getPage(n);

  const canvas=canvasRef.current;
  if(!canvas)throw new Error('Área de visualização do PDF indisponível.');
  const base=pdfPage.getViewport({scale:1});
  const wrap=canvasWrap.current;
  const availableWidth=Math.max(280,(wrap?.clientWidth||Math.min(window.innerWidth-24,900))-8);
  const availableHeight=Math.max(320,(wrap?.clientHeight||Math.floor(window.innerHeight*.72))-8);
  const cssScale=Math.min(availableWidth/base.width,availableHeight/base.height);
  const viewport=pdfPage.getViewport({scale:cssScale});
  const dpr=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.max(1,Math.floor(viewport.width*dpr));
  canvas.height=Math.max(1,Math.floor(viewport.height*dpr));
  canvas.style.width=Math.floor(viewport.width)+'px';
  canvas.style.height=Math.floor(viewport.height)+'px';
  const stage=pageStageRef.current;
  if(stage){stage.style.width=Math.floor(viewport.width)+'px';stage.style.height=Math.floor(viewport.height)+'px';}
  const context=canvas.getContext('2d');
  if(!context)throw new Error('Canvas indisponível.');
  context.setTransform(1,0,0,1,0,0);
  context.clearRect(0,0,canvas.width,canvas.height);
  const task=pdfPage.render({canvasContext:context,viewport,transform:dpr===1?undefined:[dpr,0,0,dpr,0,0]});
  renderTask.current=task;
  await task.promise;

  const tc=await pdfPage.getTextContent();
  textItemsRef.current=tc.items;
  const layer=textLayerRef.current;
  if(layer){
   layer.replaceChildren();
   layer.style.width=Math.floor(viewport.width)+'px';
   layer.style.height=Math.floor(viewport.height)+'px';
   layer.style.setProperty('--scale-factor',String(viewport.width/base.width));
   layer.style.setProperty('--total-scale-factor',String(viewport.width/base.width));
   const textDivs:HTMLElement[]=[];
   const pdfjs=await loadClassicPdfJs();
   const textTask=pdfjs.renderTextLayer({textContentSource:tc,container:layer,viewport,textDivs,textContentItemsStr:[]});
   textLayerTask.current=textTask;
   await textTask.promise;
   textDivs.forEach((span,i)=>span.dataset.item=String(i));
   textDivsRef.current=textDivs;
  }
  let text='',normalized='',cursor=0;
  const itemCharRanges:Array<{start:number;end:number}|null>=[];
  for(let itemIndex=0;itemIndex<tc.items.length;itemIndex++){
   const it=tc.items[itemIndex];
   if(!it.str){itemCharRanges[itemIndex]=null;continue;}
   text+=it.str+(it.hasEOL?'\n':' ');
   const part=it.str.replace(/\s+/g,' ').trim();
   if(!part){itemCharRanges[itemIndex]=null;continue;}
   if(normalized.length)normalized+=' ';
   const start=normalized.length;
   normalized+=part;
   itemCharRanges[itemIndex]={start,end:normalized.length};
  }
  const list=splitSentences(text);
  const mapped:Array<{start:number;end:number}>=[];
  for(const sentence of list){
   const startChar=normalized.indexOf(sentence,cursor);
   const safeStart=startChar>=0?startChar:cursor;
   const endChar=safeStart+sentence.length;
   let first=-1,last=-1;
   for(let itemIndex=0;itemIndex<itemCharRanges.length;itemIndex++){
    const r=itemCharRanges[itemIndex];if(!r)continue;
    if(r.end>safeStart&&r.start<endChar){if(first<0)first=itemIndex;last=itemIndex;}
   }
   mapped.push({start:Math.max(0,first),end:Math.max(Math.max(0,first),last)});
   cursor=endChar;
  }
  sentenceRangesRef.current=mapped;
  const safeIndex=Math.max(0,Math.min(restoreIndex,Math.max(0,list.length-1)));
  pageRef.current=n;sentencesRef.current=list;indexRef.current=safeIndex;
  setPage(n);setJumpValue(String(n));setSentences(list);setIndex(safeIndex);
  setStage(list.length?'Página pronta para leitura':'Página sem texto selecionável');
  if(fileKey.current){
   try{localStorage.setItem('paper-voice-ios:'+fileKey.current,JSON.stringify({page:n,index:safeIndex}));}catch{}
  }
  if(cloudBookIdRef.current)void saveCloudProgress(cloudBookIdRef.current,n,safeIndex).catch(()=>setCloudStatus('Nuvem temporariamente indisponível'));
  return list;
 }

 async function openFile(file:File){
  stop();setError('');setStage('Preparando PDF…');setSentences([]);setIndex(0);
  let stageName='início';
  try{
   stageName='carregar PDF.js clássico';
   const pdfjs=await loadClassicPdfJs();
   stageName='ler arquivo';
   const bytes=new Uint8Array(await fileBytes(file));
   stageName='abrir PDF para extração';
   const next=await pdfjs.getDocument({
    data:bytes,
    cMapUrl:PDFJS_BASE+'cmaps/',
    cMapPacked:true,
    standardFontDataUrl:PDFJS_BASE+'standard_fonts/'
   }).promise;
   await docRef.current?.destroy();
   docRef.current=next;setDoc(next);setName(file.name);setPages(next.numPages);setCompactControls(true);setCompact(true);
   currentFileRef.current={name:file.name,size:file.size};
   cloudBookIdRef.current='';
   fileKey.current=(file.name+':'+file.size).replace(/[^a-zA-Z0-9._:-]/g,'_');
   let localMarks:number[]=[];
   try{
    const savedMarks=JSON.parse(localStorage.getItem('paper-voice-bookmarks:'+fileKey.current)||'[]');
    localMarks=Array.isArray(savedMarks)?savedMarks.filter((n:unknown)=>Number.isInteger(n)&&Number(n)>=1&&Number(n)<=next.numPages).map(Number).sort((a:number,b:number)=>a-b):[];
    setBookmarks(localMarks);
   }catch{setBookmarks([]);}
   let start=1,savedIndex=0;
   try{
    const saved=JSON.parse(localStorage.getItem('paper-voice-ios:'+fileKey.current)||'{}');
    if(Number.isInteger(saved.page)&&saved.page>=1&&saved.page<=next.numPages)start=saved.page;
    if(Number.isInteger(saved.index)&&saved.index>=0)savedIndex=saved.index;
   }catch{}
   if(cloudSessionRef.current){
    try{
     setCloudStatus('Sincronizando livro…');
     const remote=await openCloudBook({fingerprint:fileKey.current,fileName:file.name,fileSize:file.size,totalPages:next.numPages});
     cloudBookIdRef.current=remote.bookId;
     const merged=[...new Set([...localMarks,...remote.bookmarks])].sort((a,b)=>a-b);
     setBookmarks(merged);
     try{localStorage.setItem('paper-voice-bookmarks:'+fileKey.current,JSON.stringify(merged));}catch{}
     for(const mark of merged)if(!remote.bookmarks.includes(mark))void addCloudBookmark(remote.bookId,mark).catch(()=>{});
     if(remote.progress&&remote.progress.page>=1&&remote.progress.page<=next.numPages){
      start=remote.progress.page;savedIndex=remote.progress.sentence_index||0;
     }
     setCloudStatus('Sincronização ativa');
    }catch{setCloudStatus('Conta conectada · usando dados locais');}
   }
   stageName='extrair texto';
   await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
   await extractPage(next,start,savedIndex);
  }catch(e){
   setError('Falha ao abrir o PDF em "'+stageName+'": '+(e instanceof Error?e.message:String(e)));
   setStage('Falha');
  }
 }

 async function audioUrl(text:string){
  const key=voice+'|'+text;if(cache.current.has(key))return cache.current.get(key)!;
  const res=await fetch('/api/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'openai',text,voice})});
  if(!res.ok){
   let msg='Falha ao gerar voz ('+res.status+').';
   try{const j=await res.json() as {error?:string};if(j.error)msg=j.error;}catch{}
   throw new Error(msg);
  }
  const blob=await res.blob(),url=URL.createObjectURL(blob);cache.current.set(key,url);
  if(cache.current.size>80){
   const first=cache.current.keys().next().value as string|undefined;
   if(first){const old=cache.current.get(first);if(old)URL.revokeObjectURL(old);cache.current.delete(first);}
  }
  return url;
 }

 async function playAt(i:number,list=sentencesRef.current,currentToken=++token.current,continueDocument=true,trackIndex=true,customRanges?:Array<{start:number;end:number}>){
  if(!playWanted.current||currentToken!==token.current)return;
  if(i>=list.length){
   if(!continueDocument){playWanted.current=false;setMode('idle');clearSpokenHighlight();setStage('Seleção concluída');return;}
   const d=docRef.current,n=pageRef.current;
   if(d&&n<d.numPages){
    try{
     const next=await extractPage(d,n+1);
     if(playWanted.current&&currentToken===token.current)void playAt(0,next,currentToken,continueDocument,customRanges?true:trackIndex,customRanges?undefined:customRanges);
    }catch(e){
     setError(e instanceof Error?e.message:'Falha ao avançar página.');
     stop();
    }
   }else{
    playWanted.current=false;setMode('idle');clearSpokenHighlight();setStage('Fim do documento');
   }
   return;
  }
  if(trackIndex){indexRef.current=i;setIndex(i);highlightSentence(i);}else if(customRanges){highlightRange(customRanges[i]);}else{clearSpokenHighlight();}setMode('loading');setStage('Gerando voz…');
  try{
   const current=audioUrl(list[i]);
   if(i+1<list.length)void audioUrl(list[i+1]).catch(()=>{});
   const url=await current;
   if(!playWanted.current||currentToken!==token.current)return;
   let audio=audioRef.current;
   if(!audio){audio=new Audio();audio.preload='auto';audioRef.current=audio;}
   audio.pause();audio.src=url;audio.playbackRate=speed;audio.currentTime=0;
   audio.onended=()=>{if(playWanted.current&&currentToken===token.current)void playAt(i+1,list,currentToken,continueDocument,trackIndex,customRanges);};
   audio.onerror=()=>{setError('O Safari não conseguiu reproduzir este trecho.');stop();};
   await audio.play();
   if(currentToken===token.current){setMode('playing');setStage('Lendo');}
   if(fileKey.current){
    try{localStorage.setItem('paper-voice-ios:'+fileKey.current,JSON.stringify({page:pageRef.current,index:i}));}catch{}
   }
   if(cloudBookIdRef.current)void saveCloudProgress(cloudBookIdRef.current,pageRef.current,i).catch(()=>setCloudStatus('Nuvem temporariamente indisponível'));
  }catch(e){
   setError(e instanceof Error?e.message:'Falha na narração.');
   stop();
  }
 }

 function readSelectionOnly(){
  const text=selectedText.trim();if(!text)return;
  const start=selectionStartRef.current,end=selectionEndRef.current;
  const built=buildRangesForSegment(start.item,end.item,start.offset,end.offset);
  const list=splitSentences(text);
  if(!list.length)return;
  const ranges=built.ranges.length===list.length?built.ranges:Array.from({length:list.length},()=>({start:start.item,end:end.item}));
  stop();setSelectedText('');try{window.getSelection()?.removeAllRanges();}catch{}
  playWanted.current=true;setStage('Lendo seleção');
  const currentToken=++token.current;
  void playAt(0,list,currentToken,false,false,ranges);
 }

 function readFromSelection(){
  const items=textItemsRef.current,{item,offset}=selectionStartRef.current;
  if(!items.length)return;
  const built=buildRangesForSegment(item,items.length-1,offset);
  if(!built.list.length)return;
  stop();setSelectedText('');try{window.getSelection()?.removeAllRanges();}catch{}
  playWanted.current=true;setStage('Lendo a partir da seleção');
  const currentToken=++token.current;
  void playAt(0,built.list,currentToken,true,false,built.ranges);
 }

 async function testVoice(){
  setError('');setStage('Testando voz…');
  try{
   const url=await audioUrl('Teste de voz do leitor. Tudo certo.');
   let a=audioRef.current;
   if(!a){a=new Audio();a.preload='auto';audioRef.current=a;}
   a.pause();a.src=url;a.playbackRate=1;a.currentTime=0;
   await a.play();setStage('Voz OpenAI funcionando');
  }catch(e){
   setError(e instanceof Error?e.message:'Falha no teste de voz.');
   setStage('Falha no teste de voz');
  }
 }

 function toggle(){
  const a=audioRef.current;
  if(mode==='playing'){
   playWanted.current=false;a?.pause();setMode('paused');setStage('Pausado');return;
  }
  if(mode==='paused'&&a&&a.src){
   playWanted.current=true;
   void a.play().then(()=>{setMode('playing');setStage('Lendo');}).catch(()=>{
    playWanted.current=false;setError('Toque novamente em Ler para liberar o áudio no Safari.');
   });
   return;
  }
  if(!sentencesRef.current.length)return;
  playWanted.current=true;void playAt(indexRef.current,sentencesRef.current);
 }

 async function goPage(n:number){
  const d=docRef.current;if(!d)return;
  const target=Math.trunc(n);
  if(!Number.isFinite(target)||target<1||target>d.numPages){setError('Digite uma página entre 1 e '+d.numPages+'.');return;}
  stop();
  try{await extractPage(d,target);}catch(e){setError(e instanceof Error?e.message:'Falha ao carregar página.');}
 }

 function jumpToPage(){
  const target=Number(jumpValue.replace(/[^0-9]/g,''));
  if(!target){setError('Digite o número da página.');return;}
  void goPage(target);
 }

 function saveBookmarks(next:number[]){
  const sorted=[...new Set(next)].sort((a,b)=>a-b);
  setBookmarks(sorted);
  if(fileKey.current){try{localStorage.setItem('paper-voice-bookmarks:'+fileKey.current,JSON.stringify(sorted));}catch{}}
 }

 function toggleBookmark(){
  if(!doc)return;
  const exists=bookmarks.includes(page);
  saveBookmarks(exists?bookmarks.filter(n=>n!==page):[...bookmarks,page]);
  if(cloudBookIdRef.current){
   const action=exists?removeCloudBookmark(cloudBookIdRef.current,page):addCloudBookmark(cloudBookIdRef.current,page);
   void action.catch(()=>setCloudStatus('Nuvem temporariamente indisponível'));
  }
 }

 function openBookmark(value:string){
  const target=Number(value);
  if(target)void goPage(target);
 }

 function toggleHighlight(){
  const next=!highlightEnabledRef.current;
  highlightEnabledRef.current=next;
  setHighlightEnabled(next);
  persistPreferences({highlightEnabled:next});
  if(!next)clearSpokenHighlight();
  else if(mode==='playing'||mode==='loading')highlightSentence(indexRef.current);
 }

 useEffect(()=>{
  if(!doc)return;
  let timer:number|undefined;
  const rerender=()=>{
   if(timer)window.clearTimeout(timer);
   timer=window.setTimeout(()=>{
    const d=docRef.current;
    if(d)void extractPage(d,pageRef.current,indexRef.current).catch(()=>{});
   },120);
  };
  window.addEventListener('resize',rerender);
  return()=>{if(timer)window.clearTimeout(timer);window.removeEventListener('resize',rerender);};
 },[doc,compact]);

 useEffect(()=>{
  if(!doc)return;
  let timer:number|undefined;
  const onSelectionChange=()=>{
   if(timer)window.clearTimeout(timer);
   timer=window.setTimeout(captureSelection,120);
  };
  document.addEventListener('selectionchange',onSelectionChange);
  return()=>{if(timer)window.clearTimeout(timer);document.removeEventListener('selectionchange',onSelectionChange);};
 },[doc,page,captureSelection]);



 function moveSentence(delta:number){
  const list=sentencesRef.current;if(!list.length)return;
  const next=Math.max(0,Math.min(list.length-1,indexRef.current+delta));
  const was=mode==='playing';
  stop();setIndex(next);indexRef.current=next;
  if(was){playWanted.current=true;void playAt(next,list);}
 }

 const active=sentences[index]||'';

 return <main style={{...shell,height:compact&&doc?'100dvh':undefined,overflow:compact&&doc?'hidden':undefined}}>
  {(!compact||!doc)&&<header style={top}>
   <div style={{minWidth:0,flex:1}}>
    <div style={{fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{name}</div>
    <div style={small}>{pages?'Página '+page+' de '+pages:'Leitor PDF para iPad'} · {connected?'OpenAI conectada':'OpenAI não conectada'} · {cloudStatus}</div>
   </div>
   {doc&&<button style={button} onClick={()=>{setCompactControls(true);setCompact(true);}}>Modo leitura</button>}
   <button style={button} onClick={()=>{setAccountMessage('');setAccountOpen(true);}}>{cloudSession?.user.email?'Conta':'Entrar'}</button>
   <button style={button} onClick={()=>void testVoice()}>Testar voz</button>
   <button style={button} onClick={()=>fileRef.current?.click()}>Abrir PDF</button>
   <input ref={fileRef} hidden type="file" accept="application/pdf,.pdf" onChange={e=>{const f=e.target.files?.[0];if(f)void openFile(f);e.currentTarget.value='';}}/>
  </header>}

  <section style={compact&&doc?{padding:0,display:'block',flex:1,minHeight:0}:{padding:12,display:'grid',gap:10,flex:1}}>
   {error&&<div role="alert" style={{...card,borderColor:'#b84a4a',color:'#8c2727'}}>{error}</div>}
   <div ref={canvasWrap} style={compact&&doc?{height:'100dvh',width:'100%',overflow:'hidden',background:'#111',display:'grid',placeItems:'center'}:{...card,padding:8,minHeight:'58dvh',height:'68dvh',overflow:'auto'}}>
    <div ref={pageStageRef} style={{position:'relative',display:doc?'block':'none',margin:'0 auto',flex:'0 0 auto'}}>
     <canvas ref={canvasRef} aria-label={'Página '+page+' do PDF'} style={{position:'absolute',inset:0,display:'block',background:'white',width:'100%',height:'100%'}}/>
     <div
      ref={textLayerRef}
      className="textLayer ipad-text-layer"
      onPointerUp={()=>window.setTimeout(captureSelection,0)}
      onTouchEnd={()=>window.setTimeout(captureSelection,0)}
      onClick={()=>{const s=window.getSelection();if(compact&&(!s||s.isCollapsed))setCompactControls(v=>!v);}}
     />
    </div>
    {!doc&&<div style={{padding:'48px 18px',textAlign:'center'}}>
     <h2 style={{margin:'0 0 8px'}}>Paper Voice para iPad</h2>
     <p style={{margin:0,color:'#657080'}}>Abra um PDF. Cada página será exibida individualmente e poderá ser acessada diretamente pelo número.</p>
    </div>}
   </div>
   {doc&&!compact&&<div style={{...card,background:'#fff7dc'}}>
    <div style={{...small,marginBottom:5}}>TRECHO ATUAL {sentences.length?index+1:0}/{sentences.length}</div>
    <div style={{fontFamily:'Georgia,serif',fontSize:18,lineHeight:1.55}}>{active||'Esta página não possui texto selecionável. Se for uma página digitalizada, será necessário OCR.'}</div>
   </div>}
  </section>

  {!compact&&<footer style={{position:'sticky',bottom:0,zIndex:10,background:'#fffdf8',borderTop:'1px solid #d8d0c2',padding:'9px 10px calc(9px + env(safe-area-inset-bottom, 0px))'}}>
   <form onSubmit={e=>{e.preventDefault();jumpToPage();}} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:7,marginBottom:8}}>
    <span style={{...small,fontWeight:600}}>Ir para página</span>
    <input
     aria-label="Número da página"
     inputMode="numeric"
     pattern="[0-9]*"
     value={jumpValue}
     onChange={e=>setJumpValue(e.target.value.replace(/[^0-9]/g,''))}
     disabled={!doc}
     style={{...button,padding:'7px 9px',width:92,textAlign:'center'}}
    />
    <span style={small}>{pages?'de '+pages:''}</span>
    <button type="submit" style={{...button,padding:'7px 12px'}} disabled={!doc}>Ir</button>
   </form>
   <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:7,flexWrap:'wrap'}}>
    <button style={button} disabled={!doc||page<=1} onClick={()=>void goPage(page-1)}>Página anterior</button>
    <button style={button} disabled={!sentences.length||index<=0} onClick={()=>moveSentence(-1)}>Trecho anterior</button>
    <button style={primary} disabled={!sentences.length} onClick={toggle}>{mode==='playing'?'Pausar':mode==='paused'?'Continuar':'Ler'}</button>
    <button style={button} disabled={!sentences.length||index>=sentences.length-1} onClick={()=>moveSentence(1)}>Próximo trecho</button>
    <button style={button} disabled={!doc||page>=pages} onClick={()=>void goPage(page+1)}>Próxima página</button>
   </div>
   <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginTop:8}}>
    <select aria-label="Voz" value={voice} onChange={e=>{stop();setVoice(e.target.value);persistPreferences({voice:e.target.value});}} style={{...button,padding:'7px 9px',maxWidth:'28%'}}>
     {voices.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
    </select>
    <button type="button" style={{...button,padding:'7px 10px',whiteSpace:'nowrap'}} onClick={toggleBookmark}>{bookmarks.includes(page)?'Desmarcar página':'Marcar página'}</button>
    <button type="button" style={{...button,padding:'7px 10px',whiteSpace:'nowrap'}} onClick={toggleHighlight}>{highlightEnabled?'Destaque ligado':'Destaque desligado'}</button>
    <select aria-label="Marcadores" value="" onChange={e=>openBookmark(e.target.value)} style={{...button,padding:'7px 9px',maxWidth:'25%'}}>
     <option value="">{bookmarks.length?'Marcadores ('+bookmarks.length+')':'Sem marcadores'}</option>
     {bookmarks.map(n=><option key={n} value={n}>Página {n}</option>)}
    </select>
    <span style={{...small,textAlign:'center',flex:1}}>{stage}{isAppleTouch()?' · Safari/iPad':''}</span>
    <select aria-label="Velocidade" value={speed} onChange={e=>{const next=Number(e.target.value);setSpeed(next);persistPreferences({speed:next});}} style={{...button,padding:'7px 9px'}}>
     {[0.75,1,1.25,1.5,1.75,2].map(v=><option key={v} value={v}>{v}×</option>)}
    </select>
   </div>
  </footer>}

  {accountOpen&&<div style={{position:'fixed',inset:0,zIndex:70,background:'rgba(0,0,0,.48)',display:'grid',placeItems:'center',padding:18}} onClick={()=>setAccountOpen(false)}>
   <div style={{...card,width:'min(430px,94vw)',padding:18,boxShadow:'0 18px 60px rgba(0,0,0,.28)'}} onClick={e=>e.stopPropagation()}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,marginBottom:12}}>
     <div>
      <div style={{fontSize:20,fontWeight:750}}>Conta Paper Voice</div>
      <div style={small}>{cloudSession?'Sincronização entre aparelhos ativada':'Entre para sincronizar leitura e preferências'}</div>
     </div>
     <button type="button" style={{...button,padding:'7px 10px'}} onClick={()=>setAccountOpen(false)}>Fechar</button>
    </div>
    {cloudSession?<div style={{display:'grid',gap:10}}>
     <div style={{...card,background:'#f7f7f4'}}>
      <div style={{fontWeight:650}}>{cloudSession.user.email||'Conta conectada'}</div>
      <div style={{...small,marginTop:4}}>Página, trecho, marcadores, voz, velocidade e destaque são sincronizados.</div>
     </div>
     {accountMessage&&<div style={small}>{accountMessage}</div>}
     <button type="button" style={button} disabled={accountBusy} onClick={()=>void handleSignOut()}>{accountBusy?'Aguarde…':'Sair da conta'}</button>
    </div>:<div style={{display:'grid',gap:10}}>
     <label style={{display:'grid',gap:5,fontSize:13,fontWeight:600}}>E-mail
      <input type="email" autoComplete="email" value={accountEmail} onChange={e=>setAccountEmail(e.target.value)} style={{...button,width:'100%',boxSizing:'border-box',background:'white'}}/>
     </label>
     <label style={{display:'grid',gap:5,fontSize:13,fontWeight:600}}>Senha
      <input type="password" autoComplete="current-password" value={accountPassword} onChange={e=>setAccountPassword(e.target.value)} style={{...button,width:'100%',boxSizing:'border-box',background:'white'}}/>
     </label>
     {accountMessage&&<div style={{...small,color:accountMessage.includes('Não')||accountMessage.includes('Digite')||accountMessage.includes('Use um')?'#8c2727':'#40505f'}}>{accountMessage}</div>}
     <div style={{display:'flex',gap:8}}>
      <button type="button" style={{...primary,flex:1}} disabled={accountBusy} onClick={()=>void handleSignIn()}>{accountBusy?'Aguarde…':'Entrar'}</button>
      <button type="button" style={{...button,flex:1}} disabled={accountBusy} onClick={()=>void handleSignUp()}>Criar conta</button>
     </div>
     <div style={small}>Ao criar uma conta, você poderá usar o mesmo e-mail e senha em outros aparelhos.</div>
    </div>}
   </div>
  </div>}

  {selectedText&&<div style={{position:'fixed',left:'50%',bottom:compact?'calc(72px + env(safe-area-inset-bottom, 0px))':'150px',transform:'translateX(-50%)',zIndex:45,display:'flex',alignItems:'center',gap:6,background:'rgba(18,22,28,.94)',color:'white',borderRadius:14,padding:'6px 8px',boxShadow:'0 5px 22px rgba(0,0,0,.3)',whiteSpace:'nowrap'}}>
   <span style={{fontSize:12,padding:'0 4px'}}>Texto selecionado</span>
   <button type="button" onPointerDown={e=>e.preventDefault()} style={{...primary,padding:'7px 10px'}} onClick={readSelectionOnly}>Ler seleção</button>
   <button type="button" onPointerDown={e=>e.preventDefault()} style={{...button,padding:'7px 10px'}} onClick={readFromSelection}>Ler daqui</button>
   <button type="button" onPointerDown={e=>e.preventDefault()} style={{...button,padding:'7px 9px'}} onClick={clearSelection}>Fechar</button>
  </div>}

  {compact&&doc&&compactControls&&<>
   <div style={{position:'fixed',top:'calc(8px + env(safe-area-inset-top, 0px))',left:'50%',transform:'translateX(-50%)',zIndex:30,background:'rgba(20,20,20,.78)',color:'white',borderRadius:16,padding:'5px 7px',fontSize:12,display:'flex',alignItems:'center',gap:6}}>
    <span style={{padding:'0 3px'}}>Página {page} de {pages}</span>
    <button type="button" onPointerDown={e=>e.preventDefault()} style={{...button,padding:'5px 8px',fontSize:12}} onClick={toggleBookmark}>{bookmarks.includes(page)?'Marcada':'Marcar'}</button>
    {bookmarks.length>0&&<select aria-label="Marcadores" value="" onChange={e=>openBookmark(e.target.value)} style={{...button,padding:'5px 7px',fontSize:12,width:'auto',margin:0}}>
     <option value="">Marcadores</option>
     {bookmarks.map(n=><option key={n} value={n}>Página {n}</option>)}
    </select>}
   </div>
   <form onSubmit={e=>{e.preventDefault();jumpToPage();}} style={{position:'fixed',left:'50%',bottom:'calc(8px + env(safe-area-inset-bottom, 0px))',transform:'translateX(-50%)',zIndex:30,display:'flex',alignItems:'center',gap:5,background:'rgba(255,253,248,.94)',border:'1px solid #cfc7b9',borderRadius:16,padding:5,boxShadow:'0 4px 18px rgba(0,0,0,.18)'}}>
    <button type="button" style={{...button,padding:'7px 9px'}} disabled={page<=1} onClick={()=>void goPage(page-1)}>Anterior</button>
    <input
     aria-label="Número da página"
     inputMode="numeric"
     pattern="[0-9]*"
     value={jumpValue}
     onChange={e=>setJumpValue(e.target.value.replace(/[^0-9]/g,''))}
     style={{...button,padding:'7px 6px',width:58,textAlign:'center'}}
    />
    <span style={{...small,whiteSpace:'nowrap'}}>/ {pages}</span>
    <button type="submit" style={{...button,padding:'7px 8px'}}>Ir</button>
    <button type="button" style={{...primary,padding:'7px 11px'}} disabled={!sentences.length} onClick={toggle}>{mode==='playing'?'Pausar':mode==='paused'?'Continuar':'Ler'}</button>
    <button type="button" style={{...button,padding:'7px 9px'}} onClick={toggleHighlight}>{highlightEnabled?'Destaque':'Sem destaque'}</button>
    <button type="button" style={{...button,padding:'7px 9px'}} disabled={page>=pages} onClick={()=>void goPage(page+1)}>Próxima</button>
    <button type="button" style={{...button,padding:'7px 9px'}} onClick={()=>setCompactControls(false)}>Ocultar</button>
    <button type="button" style={{...button,padding:'7px 9px'}} onClick={()=>setCompact(false)}>Menu</button>
   </form>
  </>}
 </main>;
}
