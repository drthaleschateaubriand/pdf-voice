"use client";
import {useCallback,useEffect,useRef,useState,type CSSProperties} from 'react';
import {clearPersistentAudioCache,deletePersistentAudio,formatAudioCacheBytes,getPersistentAudio,getPersistentAudioCacheStats,makeAudioCacheKey,putPersistentAudio,type AudioCacheStats} from './audio-cache';
import {addCloudBookmark,downloadCloudPdf,getCloudSession,listCloudLibrary,loadCloudPreferences,openCloudBook,removeCloudBookmark,saveCloudPreferences,saveCloudProgress,signInCloud,signOutCloud,signUpCloud,uploadCloudPdf,type CloudLibraryBook,type CloudSession} from './paper-cloud';
import {splitIpadSpeech} from '../lib/ipad-speech';

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

const shell:CSSProperties={minHeight:'100dvh',background:'#F7F3EB',color:'#1B1B1C',fontFamily:'"Plus Jakarta Sans",Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',display:'flex',flexDirection:'column'};
const top:CSSProperties={position:'sticky',top:0,zIndex:10,background:'rgba(247,243,235,.94)',backdropFilter:'blur(18px)',borderBottom:'1px solid #E5DED2',padding:'calc(10px + env(safe-area-inset-top, 0px)) 16px 10px',paddingLeft:'calc(16px + env(safe-area-inset-left, 0px))',paddingRight:'calc(16px + env(safe-area-inset-right, 0px))',display:'flex',alignItems:'center',gap:10};
const button:CSSProperties={border:'1px solid #E5DED2',background:'#FFFFFF',borderRadius:999,padding:'10px 15px',fontSize:15,color:'#1B3B2B',boxShadow:'0 4px 20px -8px rgba(60,48,30,.18)'};
const primary:CSSProperties={...button,background:'#1B3B2B',color:'#FFFFFF',borderColor:'#1B3B2B',fontWeight:700};
const card:CSSProperties={background:'#FFFFFF',border:'1px solid #E5DED2',borderRadius:24,padding:14,boxShadow:'0 4px 20px -2px rgba(60,48,30,.05)'};
const small:CSSProperties={fontSize:12,color:'#635F59'};

function PaperVoiceMark({size=42}:{size?:number}){
 return <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style={{display:'block',flex:'0 0 auto'}}>
  <rect x="3" y="3" width="94" height="94" rx="24" fill="#1B3B2B"/>
  <path d="M22 33c12 0 20 4 28 12v34c-8-7-17-10-28-10V33Z" fill="#F7F3EB"/>
  <path d="M78 33c-12 0-20 4-28 12v34c8-7 17-10 28-10V33Z" fill="#F7F3EB"/>
  <path d="M50 45v34" stroke="#e9dcc7" strokeWidth="2"/>
  <path d="M53 30c8-12 15-17 23-18-1 9-7 17-19 23Z" fill="#E76F3B"/>
  <path d="M51 31c-4-11-3-18 1-24 8 5 12 12 10 23Z" fill="#FD7F4A"/>
 </svg>;
}

function PageThumbnail({doc,page,current,onSelect,width}:{doc:PdfDocLike;page:number;current:boolean;onSelect:(page:number)=>void;width:number}){
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
  let cancelled=false,task:PdfRenderTask|null=null;
  void (async()=>{
   try{
    const pdfPage=await doc.getPage(page);
    if(cancelled||!canvas.current)return;
    const base=pdfPage.getViewport({scale:1});
    const cssWidth=Math.max(96,Math.min(220,width)),scale=cssWidth/Math.max(1,base.width),viewport=pdfPage.getViewport({scale});
    const dpr=Math.min(2,window.devicePixelRatio||1),target=canvas.current,ctx=target.getContext('2d');
    if(!ctx)return;
    target.width=Math.max(1,Math.round(viewport.width*dpr));target.height=Math.max(1,Math.round(viewport.height*dpr));
    target.style.width=Math.round(viewport.width)+'px';target.style.height=Math.round(viewport.height)+'px';
    task=pdfPage.render({canvasContext:ctx,viewport,transform:dpr!==1?[dpr,0,0,dpr,0,0]:undefined});
    await task.promise;
   }catch{}
  })();
  return()=>{cancelled=true;task?.cancel();};
 },[doc,page,width]);
 return <button type="button" className={current?'mf-page-thumb current':'mf-page-thumb'} aria-label={'Ir para página '+page} aria-current={current?'page':undefined} onClick={()=>onSelect(page)} style={{width:width+14}}>
  <span className="mf-page-thumb-canvas" style={{width}}><canvas ref={canvas}/></span>
  <span className="mf-page-thumb-number">{page}</span>
 </button>;
}

function BookNavigator({doc,pages,current,jumpValue,setJumpValue,onJump,onSelect,onClose}:{doc:PdfDocLike;pages:number;current:number;jumpValue:string;setJumpValue:(value:string)=>void;onJump:()=>void;onSelect:(page:number)=>void;onClose:()=>void}){
 const MIN_WIDTH=142,MAX_WIDTH=310,DEFAULT_WIDTH=178,BUFFER=4;
 const [width,setWidth]=useState(DEFAULT_WIDTH),widthRef=useRef(DEFAULT_WIDTH),resizeRef=useRef<{x:number;width:number}|null>(null),scrollRef=useRef<HTMLDivElement>(null);
 const thumbWidth=Math.max(104,Math.min(236,width-34)),ITEM=Math.max(160,Math.round(thumbWidth*1.42+28));
 const [range,setRange]=useState({start:1,end:Math.min(pages,12)});
 useEffect(()=>{
  try{
   const saved=Number(localStorage.getItem('meu-foco-book-nav-width'));
   if(Number.isFinite(saved)&&saved>=MIN_WIDTH&&saved<=MAX_WIDTH){widthRef.current=saved;setWidth(saved);}
  }catch{}
 },[]);
 useEffect(()=>{widthRef.current=width;},[width]);
 const recalc=useCallback(()=>{
  const el=scrollRef.current;if(!el)return;
  const first=Math.max(1,Math.floor(el.scrollTop/ITEM)+1-BUFFER);
  const last=Math.min(pages,Math.ceil((el.scrollTop+el.clientHeight)/ITEM)+BUFFER);
  setRange(r=>r.start===first&&r.end===last?r:{start:first,end:last});
 },[ITEM,pages]);
 useEffect(()=>{recalc();},[recalc]);
 useEffect(()=>{
  const el=scrollRef.current;if(!el||!pages)return;
  const target=Math.max(0,(current-1)*ITEM-(el.clientHeight-ITEM)/2);
  el.scrollTo({top:target,behavior:'smooth'});
  const timer=window.setTimeout(recalc,220);
  return()=>window.clearTimeout(timer);
 },[current,pages,ITEM,recalc]);
 useEffect(()=>{
  const move=(event:PointerEvent)=>{
   const resize=resizeRef.current;if(!resize)return;
   const next=Math.max(MIN_WIDTH,Math.min(MAX_WIDTH,resize.width+(event.clientX-resize.x)));
   widthRef.current=next;setWidth(next);
  };
  const stopResize=()=>{
   if(!resizeRef.current)return;
   resizeRef.current=null;
   document.documentElement.classList.remove('mf-resizing-book-nav');
   try{localStorage.setItem('meu-foco-book-nav-width',String(Math.round(widthRef.current)));}catch{}
  };
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',stopResize);
  window.addEventListener('pointercancel',stopResize);
  return()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',stopResize);window.removeEventListener('pointercancel',stopResize);document.documentElement.classList.remove('mf-resizing-book-nav');};
 },[]);
 const visible=Array.from({length:Math.max(0,range.end-range.start+1)},(_,i)=>range.start+i);
 return <aside className="mf-book-nav" aria-label="Navegar no livro" style={{width,flex:'0 0 '+width+'px',minWidth:width,maxWidth:width,height:'68dvh',display:'flex',flexDirection:'column',overflow:'hidden',position:'relative'}}>
  <div className="mf-book-nav-head">
   <div className="mf-book-nav-title"><span className="mf-book-nav-icon">▤</span><div><strong>Navegar</strong><span>Livro · {current} de {pages}</span></div></div>
   <button type="button" onClick={onClose} aria-label="Fechar navegação">×</button>
  </div>
  <div className="mf-book-nav-tools">
   <button className="mf-book-nav-home" type="button" onClick={()=>onSelect(1)}>⌂ <span>Início</span></button>
   <form onSubmit={e=>{e.preventDefault();onJump();}}><label htmlFor="mf-book-page-jump">Página</label><input id="mf-book-page-jump" aria-label="Ir para página" inputMode="numeric" pattern="[0-9]*" value={jumpValue} onChange={e=>setJumpValue(e.target.value.replace(/[^0-9]/g,''))}/><button type="submit">Ir</button></form>
  </div>
  <div ref={scrollRef} className="mf-book-nav-scroll" onScroll={recalc} style={{flex:1,minHeight:0,overflowY:'auto',overflowX:'hidden',position:'relative'}}>
   <div style={{height:pages*ITEM,position:'relative'}}>
    {visible.map(n=><div key={n} style={{position:'absolute',left:0,right:0,top:(n-1)*ITEM,height:ITEM,display:'grid',placeItems:'start center'}}><PageThumbnail doc={doc} page={n} current={n===current} onSelect={onSelect} width={thumbWidth}/></div>)}
   </div>
  </div>
  <div className="mf-book-nav-resizer" role="separator" aria-orientation="vertical" aria-label="Redimensionar navegação" title="Arraste para ajustar a largura" onPointerDown={e=>{if(window.matchMedia('(pointer: coarse)').matches)return;resizeRef.current={x:e.clientX,width:widthRef.current};document.documentElement.classList.add('mf-resizing-book-nav');e.preventDefault();}}><span/></div>
 </aside>;
}

function BookCover({book,index=0,compact=false}:{book:CloudLibraryBook;index?:number;compact?:boolean}){
 const palettes=[
  ['#1B3B2B','#f0a25f','#F7F3EB'],
  ['#e8d8bf','#c66c3e','#1B3B2B'],
  ['#d8e3dd','#8fae9c','#1B3B2B'],
  ['#f3d6bb','#E76F3B','#603b2a'],
  ['#d9d3c6','#2d4d43','#fff8ed'],
  ['#eedfcb','#c08854','#4d3425']
 ];
 const p=palettes[index%palettes.length];
 const title=(book.title||book.file_name.replace(/\.pdf$/i,'')).replace(/[_-]+/g,' ');
 return <div style={{height:compact?128:190,borderRadius:14,background:`linear-gradient(155deg,${p[0]},${p[2]})`,boxShadow:'0 10px 24px rgba(64,43,24,.15)',position:'relative',overflow:'hidden',padding:compact?12:16,boxSizing:'border-box',display:'flex',flexDirection:'column',justifyContent:'space-between'}}>
  <div style={{position:'absolute',right:-18,top:-18,width:84,height:84,borderRadius:'50%',background:p[1],opacity:.8}}/>
  <div style={{position:'absolute',left:-18,bottom:18,width:110,height:46,borderRadius:'50%',background:p[1],opacity:.22,transform:'rotate(-12deg)'}}/>
  <div style={{fontFamily:'Georgia,serif',fontSize:compact?15:20,lineHeight:1.05,fontWeight:800,color:p[2]==='#F7F3EB'||p[2]==='#fff8ed'?p[2]:p[2],maxWidth:'86%',position:'relative',zIndex:1}}>{title}</div>
  <div style={{fontSize:10,fontWeight:800,letterSpacing:'.12em',textTransform:'uppercase',color:p[2],position:'relative',zIndex:1}}>Meu Foco</div>
 </div>;
}

function isAppleTouch(){
 if(typeof navigator==='undefined')return false;
 const ua=navigator.userAgent||'';
 return /iPad|iPhone|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
}

const splitSentences=splitIpadSpeech;
const isPlaybackPermissionError=(value:unknown)=>{
 const error=value as {name?:string;message?:string}|null;
 return error?.name==='NotAllowedError'||/request is not allowed by the user agent|user denied permission/i.test(error?.message||'');
};

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
 const [pageSidebarOpen,setPageSidebarOpen]=useState(false);
 const [darkMode,setDarkMode]=useState(false);
 const [bookmarks,setBookmarks]=useState<number[]>([]);
 const [highlightEnabled,setHighlightEnabled]=useState(true);
 const [cloudSession,setCloudSession]=useState<CloudSession|null>(null),[cloudStatus,setCloudStatus]=useState('Somente neste aparelho');
 const [accountOpen,setAccountOpen]=useState(false),[accountEmail,setAccountEmail]=useState(''),[accountPassword,setAccountPassword]=useState(''),[accountBusy,setAccountBusy]=useState(false),[accountMessage,setAccountMessage]=useState('');
 const [audioCacheStats,setAudioCacheStats]=useState<AudioCacheStats>({entries:0,bytes:0});
 const [libraryOpen,setLibraryOpen]=useState(false),[libraryBooks,setLibraryBooks]=useState<CloudLibraryBook[]>([]),[libraryBusy,setLibraryBusy]=useState(false),[uploadProgress,setUploadProgress]=useState<number|null>(null),[currentCloudStored,setCurrentCloudStored]=useState(false);
 const highlightEnabledRef=useRef(true),cloudSessionRef=useRef<CloudSession|null>(null),cloudBookIdRef=useRef('');
 const currentFileRef=useRef<{name:string;size:number}|null>(null),currentPdfFileRef=useRef<File|null>(null);
 const cloudPickerModeRef=useRef<'add'|'attach'|null>(null),cloudPickerFingerprintRef=useRef('');
 const fileRef=useRef<HTMLInputElement>(null),canvasRef=useRef<HTMLCanvasElement>(null),canvasWrap=useRef<HTMLDivElement>(null),pageStageRef=useRef<HTMLDivElement>(null),textLayerRef=useRef<HTMLDivElement>(null);
 const docRef=useRef<PdfDocLike|null>(null),pageRef=useRef(1),sentencesRef=useRef<string[]>([]),indexRef=useRef(0);
 const renderTask=useRef<PdfRenderTask|null>(null),textLayerTask=useRef<PdfTextLayerTask|null>(null);
 const textItemsRef=useRef<PdfTextItem[]>([]),textDivsRef=useRef<HTMLElement[]>([]),sentenceRangesRef=useRef<Array<{start:number;end:number}>>([]),selectionStartRef=useRef({item:0,offset:0}),selectionEndRef=useRef({item:0,offset:0});
 const audioRef=useRef<HTMLAudioElement|null>(null),gestureAudioUrlRef=useRef(''),activeAudioUrlRef=useRef(''),playWanted=useRef(false),token=useRef(0),clipId=useRef(0);
 const cache=useRef(new Map<string,string>()),pendingAudio=useRef(new Map<string,Promise<string>>()),audioRequests=useRef(new Set<AbortController>()),pagePrefetch=useRef(new Map<string,Promise<string[]>>()),fileKey=useRef('');
 const pageRestartingRef=useRef(false);

 useEffect(()=>{
  const nav=navigator as Navigator & {standalone?:boolean};
  const standalone=window.matchMedia('(display-mode: standalone)').matches||nav.standalone===true;
  if(standalone)document.documentElement.classList.add('paper-voice-standalone');
  void getPersistentAudioCacheStats().then(setAudioCacheStats).catch(()=>{});
  try{void navigator.storage?.persist?.().catch(()=>false);}catch{}
  return()=>document.documentElement.classList.remove('paper-voice-standalone');
 },[]);

 useEffect(()=>{pageRef.current=page;},[page]);
 useEffect(()=>{sentencesRef.current=sentences;},[sentences]);
 useEffect(()=>{indexRef.current=index;},[index]);
 useEffect(()=>{if(audioRef.current)audioRef.current.playbackRate=speed;},[speed]);
 useEffect(()=>{
  let dark=false;
  try{
   const saved=localStorage.getItem('meu-foco-theme');
   dark=saved?saved==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;
  }catch{dark=window.matchMedia('(prefers-color-scheme: dark)').matches;}
  setDarkMode(dark);
  document.documentElement.dataset.theme=dark?'dark':'light';
 },[]);
 function toggleTheme(){
  const next=!darkMode;
  setDarkMode(next);
  document.documentElement.dataset.theme=next?'dark':'light';
  try{localStorage.setItem('meu-foco-theme',next?'dark':'light');}catch{}
  const meta=document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if(meta)meta.content=next?'#101713':'#1B3B2B';
 }


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

 function fingerprintForFile(file:File){
  return (file.name+':'+file.size).replace(/[^a-zA-Z0-9._:-]/g,'_');
 }

 function choosePdfForLibrary(book?:CloudLibraryBook){
  cloudPickerModeRef.current=book?'attach':'add';
  cloudPickerFingerprintRef.current=book?.fingerprint||'';
  setLibraryOpen(false);
  setError('');
  setCloudStatus(book?'Selecione o PDF correspondente para completar este livro':'Selecione o PDF para adicionar à biblioteca');
  window.setTimeout(()=>fileRef.current?.click(),0);
 }

 async function refreshCloudLibrary(){
  if(!cloudSessionRef.current){setLibraryBooks([]);return;}
  setLibraryBusy(true);
  try{setLibraryBooks(await listCloudLibrary());}
  catch{setCloudStatus('Conta conectada · biblioteca indisponível');}
  finally{setLibraryBusy(false);}
 }

 async function saveCurrentPdfToCloud(){
  const file=currentPdfFileRef.current;
  if(!file||!docRef.current||!cloudSessionRef.current){setAccountMessage('Abra um PDF e entre na sua conta primeiro.');return;}
  setAccountBusy(true);setUploadProgress(0);setAccountMessage('Preparando envio do livro…');
  try{
   if(!cloudBookIdRef.current)await syncCurrentBookFromCloud();
   if(!cloudBookIdRef.current)throw new Error('Não foi possível identificar o livro.');
   await uploadCloudPdf(file,cloudBookIdRef.current,p=>setUploadProgress(p));
   setCurrentCloudStored(true);setCloudStatus('Livro salvo na nuvem');setAccountMessage('PDF salvo na nuvem. Agora ele pode ser aberto em outros aparelhos.');
   await refreshCloudLibrary();
  }catch(e){setAccountMessage(e instanceof Error?e.message:'Falha ao salvar o PDF na nuvem.');}
  finally{setAccountBusy(false);setUploadProgress(null);}
 }

 async function openLibraryBook(book:CloudLibraryBook){
  if(!book.storage_path){setCloudStatus('Este livro ainda tem apenas o progresso sincronizado');return;}
  setLibraryBusy(true);setCloudStatus('Baixando livro da nuvem…');
  try{
   const file=await downloadCloudPdf(book);
   setLibraryOpen(false);
   await openFile(file);
   setCloudStatus('Sincronização ativa');
  }catch(e){setError(e instanceof Error?e.message:'Falha ao abrir livro da nuvem.');setCloudStatus('Conta conectada · falha ao baixar livro');}
  finally{setLibraryBusy(false);}
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
   await refreshCloudLibrary();
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
   setCurrentCloudStored(Boolean(remote.storagePath));
   setCloudStatus('Sincronização ativa');
   await refreshCloudLibrary();
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
  setCloudSession(null);setLibraryBooks([]);setLibraryOpen(false);setCurrentCloudStored(false);setCloudStatus('Somente neste aparelho');setAccountPassword('');setAccountMessage('Sessão encerrada.');
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
   if(gestureAudioUrlRef.current)URL.revokeObjectURL(gestureAudioUrlRef.current);
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
  token.current++;clipId.current++;playWanted.current=false;
  const a=audioRef.current;if(a){a.pause();a.onended=null;a.onerror=null;a.removeAttribute('src');try{a.load();}catch{}}
  activeAudioUrlRef.current='';
  setMode('idle');clearSpokenHighlight();
  if(reset){setIndex(0);indexRef.current=0;}
 }

 function disposeAudioEngine(){
  token.current++;clipId.current++;playWanted.current=false;
  for(const controller of audioRequests.current)controller.abort();
  audioRequests.current.clear();
  pendingAudio.current.clear();
  pagePrefetch.current.clear();

  const a=audioRef.current;
  audioRef.current=null;
  if(a){
   a.onended=null;a.onerror=null;
   try{a.pause();}catch{}
   try{a.currentTime=0;}catch{}
   a.removeAttribute('src');
   try{a.load();}catch{}
  }
  if(gestureAudioUrlRef.current){
   try{URL.revokeObjectURL(gestureAudioUrlRef.current);}catch{}
   gestureAudioUrlRef.current='';
  }
  for(const url of cache.current.values()){
   try{URL.revokeObjectURL(url);}catch{}
  }
  cache.current.clear();
  activeAudioUrlRef.current='';
  clearSpokenHighlight();
  setMode('idle');
 }

 async function stopAndClearAudio(){
  if(pageRestartingRef.current)return;
  pageRestartingRef.current=true;
  const currentDoc=docRef.current;
  const currentPage=pageRef.current;
  const problematicText=sentencesRef.current[indexRef.current]||'';

  // Equivalent to refreshing the reader page without losing the opened PDF.
  // Everything that can still speak is destroyed before rebuilding the page.
  disposeAudioEngine();
  renderTask.current?.cancel();
  textLayerTask.current?.cancel?.();
  textItemsRef.current=[];
  textDivsRef.current=[];
  sentenceRangesRef.current=[];
  try{window.getSelection()?.removeAllRanges();}catch{}
  setSelectedText('');
  selectionStartRef.current={item:0,offset:0};
  selectionEndRef.current={item:0,offset:0};
  setSentences([]);
  sentencesRef.current=[];
  setIndex(0);
  indexRef.current=0;
  setError('');

  // Refresh only the clip that was active when the problem occurred. Rebuilding
  // every clip on the page caused avoidable pauses between passages.
  if(problematicText)await invalidateAudioForText(problematicText);

  if(!currentDoc){
   setStage('Parado · motor de áudio reiniciado');
   pageRestartingRef.current=false;
   return;
  }

  setStage('Reiniciando página '+currentPage+'…');
  try{
   await extractPage(currentDoc,currentPage,0);
   setStage('Página '+currentPage+' reiniciada · pronta para nova leitura');
  }catch(e){
   const message=e instanceof Error?e.message:'Falha ao reiniciar a página.';
   if(!/Rendering cancelled|cancel/i.test(message))setError(message);
   setStage('Página reiniciada');
  }finally{
   pageRestartingRef.current=false;
  }
 }

 async function refreshAudioCacheStats(){
  setAudioCacheStats(await getPersistentAudioCacheStats());
 }

 async function clearSavedAudioCache(){
  const ok=typeof window==='undefined'||window.confirm('Apagar todo o áudio salvo neste aparelho? O Meu Foco poderá gerar esses trechos novamente quando necessário.');
  if(!ok)return;
  disposeAudioEngine();
  await clearPersistentAudioCache();
  setAudioCacheStats({entries:0,bytes:0});
  setAccountMessage('Áudio salvo neste aparelho foi apagado.');
  setStage('Cache de áudio salvo limpo');
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

 async function extractPage(current:PdfDocLike,n:number,restoreIndex=0,preservePlayback=false){
  if(!preservePlayback)setStage('Carregando página '+n+'…');
  setError('');
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
  const requestedIndex=preservePlayback?indexRef.current:restoreIndex;
  const safeIndex=Math.max(0,Math.min(requestedIndex,Math.max(0,list.length-1)));
  pageRef.current=n;sentencesRef.current=list;indexRef.current=safeIndex;
  setPage(n);setJumpValue(String(n));setSentences(list);setIndex(safeIndex);
  if(preservePlayback&&playWanted.current){highlightSentence(safeIndex);setMode('playing');setStage('Lendo');}
  else setStage(list.length?'Página pronta para leitura':'Página sem texto selecionável');
  if(fileKey.current){
   try{localStorage.setItem('paper-voice-ios:'+fileKey.current,JSON.stringify({page:n,index:safeIndex}));}catch{}
  }
  if(cloudBookIdRef.current)void saveCloudProgress(cloudBookIdRef.current,n,safeIndex).catch(()=>setCloudStatus('Nuvem temporariamente indisponível'));
  return list;
 }

 async function openFile(file:File){
  stop();pagePrefetch.current.clear();setError('');setStage('Preparando PDF…');setSentences([]);setIndex(0);
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
   currentPdfFileRef.current=file;
   cloudBookIdRef.current='';setCurrentCloudStored(false);
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
     cloudBookIdRef.current=remote.bookId;setCurrentCloudStored(Boolean(remote.storagePath));
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

 function trimTemporaryAudioCache(){
  if(cache.current.size<=80)return;
  for(const [key,url] of cache.current){
   if(cache.current.size<=64)break;
   if(url===activeAudioUrlRef.current)continue;
   URL.revokeObjectURL(url);
   cache.current.delete(key);
  }
 }

 function rememberTemporaryAudio(key:string,url:string){
  const previous=cache.current.get(key);
  if(previous&&previous!==url&&previous!==activeAudioUrlRef.current)URL.revokeObjectURL(previous);
  cache.current.set(key,url);
  trimTemporaryAudioCache();
 }

 async function loadAudioUrl(text:string,forceFresh=false,retry=0){
  const key=voice+'|'+text;
  if(!forceFresh&&cache.current.has(key))return cache.current.get(key)!;

  const persistentKey=await makeAudioCacheKey(voice,text);
  const saved=forceFresh?null:await getPersistentAudio(persistentKey);
  if(saved){
   if(saved.size<512){
    await deletePersistentAudio(persistentKey);
   }else{
    const savedUrl=URL.createObjectURL(saved);
    rememberTemporaryAudio(key,savedUrl);
    return savedUrl;
   }
  }

  const controller=new AbortController();audioRequests.current.add(controller);
  let timedOut=false;
  const requestTimeout=window.setTimeout(()=>{timedOut=true;controller.abort();},20000);
  try{
   const res=await fetch('/api/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'openai',text,voice}),signal:controller.signal});
   if(!res.ok){
    let msg='Falha ao gerar voz ('+res.status+').';
    try{const j=await res.json() as {error?:string};if(j.error)msg=j.error;}catch{}
    throw new Error(msg);
   }
   const blob=await res.blob();
   if(controller.signal.aborted)throw new DOMException('Leitura interrompida','AbortError');
   if(blob.size<512)throw new Error('A geração de voz retornou um áudio inválido.');

   const stats=await putPersistentAudio(persistentKey,blob);
   if(stats)setAudioCacheStats(stats);

   const url=URL.createObjectURL(blob);
   rememberTemporaryAudio(key,url);
   return url;
  }catch(e){
   if((timedOut||e instanceof TypeError)&&retry<1)return loadAudioUrl(text,true,retry+1);
   if(timedOut)throw new Error('A geração de voz demorou demais e foi interrompida.');
   throw e;
  }finally{
   window.clearTimeout(requestTimeout);
   audioRequests.current.delete(controller);
  }
 }

 function audioUrl(text:string,forceFresh=false):Promise<string>{
  const key=voice+'|'+text;
  if(!forceFresh){
   const ready=cache.current.get(key);
   if(ready)return Promise.resolve(ready);
  }
  // A fresh regeneration can also be prefetched. Always dedupe by clip so the
  // reader never launches a second request for the same text while one is active.
  const pending=pendingAudio.current.get(key);
  if(pending)return pending;
  const request=loadAudioUrl(text,forceFresh).finally(()=>{
   if(pendingAudio.current.get(key)===request)pendingAudio.current.delete(key);
  });
  pendingAudio.current.set(key,request);
  return request;
 }

 function prefetchNextPageFirstAudio(){
  const d=docRef.current,currentPage=pageRef.current;
  if(!d||currentPage>=d.numPages)return;
  const nextPage=currentPage+1;
  const key=(fileKey.current||'pdf')+'|'+voice+'|'+nextPage;
  if(pagePrefetch.current.has(key))return;
  const request=(async()=>{
   const pdfPage=await d.getPage(nextPage);
   const tc=await pdfPage.getTextContent();
   let text='';
   for(const item of tc.items)if(item.str)text+=item.str+(item.hasEOL?'\n':' ');
   const list=splitSentences(text);
   if(list[0])await audioUrl(list[0]);
   return list;
  })();
  pagePrefetch.current.set(key,request);
  void request.catch(()=>{pagePrefetch.current.delete(key);});
 }

 async function invalidateAudioForText(text:string){
  const key=voice+'|'+text;
  const currentUrl=cache.current.get(key);
  if(currentUrl)URL.revokeObjectURL(currentUrl);
  cache.current.delete(key);
  const persistentKey=await makeAudioCacheKey(voice,text);
  await deletePersistentAudio(persistentKey);
  void refreshAudioCacheStats();
 }

 function prepareAudioElement(url:string){
  const audio=audioRef.current||new Audio();audioRef.current=audio;
  audio.onended=null;audio.onerror=null;audio.pause();audio.preload='auto';
  // Safari/iPad can keep stale decoder state when the same media element swaps
  // between blob URLs. Fully detach the previous source before attaching the next.
  if(audio.getAttribute('src')){
   audio.removeAttribute('src');
   try{audio.load();}catch{}
  }
  activeAudioUrlRef.current=url;
  audio.src=url;
  audio.playbackRate=speed;
  try{audio.load();}catch{}
  try{audio.currentTime=0;}catch{}
  return audio;
 }

 // Safari grants playback to the media element touched by the user. Keep that
 // same element for every fetched clip, including subsequent sentences.
 function unlockAudioOnTap(){
  const audio=audioRef.current||new Audio();audioRef.current=audio;
  if(!gestureAudioUrlRef.current){
   const samples=1600,bytes=new Uint8Array(44+samples),view=new DataView(bytes.buffer);
   const write=(offset:number,value:string)=>{for(let n=0;n<value.length;n++)bytes[offset+n]=value.charCodeAt(n);};
   write(0,'RIFF');view.setUint32(4,36+samples,true);write(8,'WAVE');write(12,'fmt ');
   view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
   view.setUint32(24,8000,true);view.setUint32(28,8000,true);view.setUint16(32,1,true);view.setUint16(34,8,true);
   write(36,'data');view.setUint32(40,samples,true);bytes.fill(128,44);
   gestureAudioUrlRef.current=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
  }
  audio.pause();audio.onended=null;audio.onerror=null;
  audio.src=gestureAudioUrlRef.current;audio.volume=1;
  void audio.play().catch(()=>{});
 }

 async function playAt(i:number,list=sentencesRef.current,currentToken=++token.current,continueDocument=true,trackIndex=true,customRanges?:Array<{start:number;end:number}>){
  if(!playWanted.current||currentToken!==token.current)return;
  const currentClip=++clipId.current;
  if(i>=list.length){
   if(!continueDocument){playWanted.current=false;setMode('idle');clearSpokenHighlight();setStage('Seleção concluída');return;}
   const d=docRef.current,n=pageRef.current;
   if(d&&n<d.numPages){
    const nextPage=n+1;
    const prefetchKey=(fileKey.current||'pdf')+'|'+voice+'|'+nextPage;
    const prefetched=pagePrefetch.current.get(prefetchKey);
    if(prefetched){
     try{
      const next=await prefetched;
      pagePrefetch.current.delete(prefetchKey);
      if(next.length&&playWanted.current&&currentToken===token.current){
       clearSpokenHighlight();
       textDivsRef.current=[];sentenceRangesRef.current=[];
       pageRef.current=nextPage;sentencesRef.current=next;indexRef.current=0;
       setPage(nextPage);setJumpValue(String(nextPage));setSentences(next);setIndex(0);
       void playAt(0,next,currentToken,continueDocument,customRanges?true:trackIndex,customRanges?undefined:customRanges);
       window.setTimeout(()=>{void extractPage(d,nextPage,-1,true).catch(e=>{
        if(currentToken!==token.current)return;
        setError(e instanceof Error?e.message:'Falha ao renderizar a próxima página.');
       });},0);
       return;
      }
     }catch{}
    }
    try{
     const next=await extractPage(d,nextPage);
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
  if(trackIndex){indexRef.current=i;setIndex(i);highlightSentence(i);}else if(customRanges){highlightRange(customRanges[i]);}else{clearSpokenHighlight();}setMode('loading');setStage('Preparando áudio…');
  try{
   if(continueDocument&&i>=Math.max(0,list.length-2))prefetchNextPageFirstAudio();
   const current=audioUrl(list[i]);
   // Keep three clips ahead warm. With five sentences per clip this gives a
   // generous runway while avoiding the page-wide forced regeneration that
   // introduced audible gaps after the hard reset.
   for(let ahead=1;ahead<=3;ahead++){
    const nextIndex=i+ahead;
    if(nextIndex<list.length)void audioUrl(list[nextIndex]).catch(()=>{});
   }
   const url=await current;
   if(!playWanted.current||currentToken!==token.current||currentClip!==clipId.current)return;
   let audio=prepareAudioElement(url);
   let recovering=false,advanced=false,recoveryAttempts=0,watchdog:number|undefined,lastProgress=0,stalledTicks=0;
   const sameClip=()=>currentToken===token.current&&currentClip===clipId.current&&audioRef.current===audio;
   const isCurrent=()=>playWanted.current&&sameClip();
   function clearWatchdog(){if(watchdog!==undefined){window.clearInterval(watchdog);watchdog=undefined;}}
   function advanceToNext(){
    if(!isCurrent()||advanced||recovering)return;
    clearWatchdog();advanced=true;
    void playAt(i+1,list,currentToken,continueDocument,trackIndex,customRanges);
   }
   function startWatchdog(){
    clearWatchdog();lastProgress=audio.currentTime;stalledTicks=0;
    watchdog=window.setInterval(()=>{
     if(!sameClip()){clearWatchdog();return;}
     if(!playWanted.current||audio.paused){lastProgress=audio.currentTime;stalledTicks=0;return;}
     const now=audio.currentTime;
     // Never advance from the watchdog. Safari can briefly expose stale
     // ended/currentTime/duration values while this persistent element changes src.
     // Only the real onended handler is allowed to move to the next sentence.
     if(audio.ended){
      clearWatchdog();
      window.setTimeout(()=>{
       if(isCurrent()&&!advanced&&!recovering)void recoverPlayback();
      },180);
      return;
     }
     if(now>lastProgress+0.05){lastProgress=now;stalledTicks=0;return;}
     stalledTicks++;
     if(stalledTicks>=5){clearWatchdog();void recoverPlayback();}
    },1000);
   }
   function onEnded(){
    if(!isCurrent()||advanced||recovering)return;
    const now=audio.currentTime;
    const duration=audio.duration;
    if(now<0.25){void recoverPlayback();return;}
    if(Number.isFinite(duration)&&duration>0&&now+0.12<duration){void recoverPlayback();return;}
    advanceToNext();
   }
   async function recoverPlayback(){
    if(recovering||advanced||!isCurrent())return;
    recoveryAttempts++;
    if(recoveryAttempts>2){
     clearWatchdog();
     setError('Este trecho não conseguiu se recuperar automaticamente. Toque em Ler para tentar novamente.');
     stop();return;
    }
    recovering=true;clearWatchdog();
    setStage('Recuperando áudio…');
    try{
     audio.onended=null;audio.onerror=null;audio.pause();audio.removeAttribute('src');try{audio.load();}catch{}
     activeAudioUrlRef.current='';
     await invalidateAudioForText(list[i]);
     const freshUrl=await audioUrl(list[i],true);
     if(currentToken!==token.current||currentClip!==clipId.current||!playWanted.current)return;
     audio=prepareAudioElement(freshUrl);
     audio.onended=onEnded;
     audio.onerror=()=>{void recoverPlayback();};
     await audio.play();
     recovering=false;startWatchdog();
     if(isCurrent()&&!advanced){setMode('playing');setStage('Lendo');}
    }catch(recoveryError){
     if(currentToken!==token.current||currentClip!==clipId.current)return;
     if(isPlaybackPermissionError(recoveryError)){
      recovering=false;clearWatchdog();
      playWanted.current=false;setMode('paused');setStage('Toque em Continuar para liberar o áudio');return;
     }
     recovering=false;
     if(recoveryAttempts<2&&playWanted.current){void recoverPlayback();return;}
     setError(recoveryError instanceof Error?recoveryError.message:'Falha ao recuperar o áudio.');
     stop();
    }
   }
   audio.onended=onEnded;
   audio.onerror=()=>{void recoverPlayback();};
   try{
    await audio.play();
    startWatchdog();
   }catch(firstError){
    if(currentToken!==token.current||currentClip!==clipId.current)return;
    if(isPlaybackPermissionError(firstError)){
     clearWatchdog();playWanted.current=false;setMode('paused');setStage('Toque em Continuar para liberar o áudio');return;
    }
    const unsupported=firstError instanceof DOMException&&(firstError.name==='NotSupportedError'||/not supported/i.test(firstError.message));
    if(!unsupported)throw firstError;
    await recoverPlayback();
   }
   if(isCurrent()&&!advanced){setMode('playing');setStage('Lendo');}
   if(fileKey.current){
    try{localStorage.setItem('paper-voice-ios:'+fileKey.current,JSON.stringify({page:pageRef.current,index:i}));}catch{}
   }
   if(cloudBookIdRef.current)void saveCloudProgress(cloudBookIdRef.current,pageRef.current,i).catch(()=>setCloudStatus('Nuvem temporariamente indisponível'));
  }catch(e){
   if(e instanceof DOMException&&e.name==='AbortError')return;
   if(currentToken!==token.current||currentClip!==clipId.current)return;
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
  unlockAudioOnTap();
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
  unlockAudioOnTap();
  playWanted.current=true;setStage('Lendo a partir da seleção');
  const currentToken=++token.current;
  void playAt(0,built.list,currentToken,true,false,built.ranges);
 }

 async function testVoice(){
  const sample='Teste de voz do leitor. Tudo certo.';
  setError('');setStage('Testando voz…');
  unlockAudioOnTap();
  try{
   const playSample=async(forceFresh=false)=>{
    const url=await audioUrl(sample,forceFresh);
    const a=prepareAudioElement(url);
    a.playbackRate=1;
    await a.play();
   };
   try{
    await playSample(false);
   }catch(firstError){
    const unsupported=firstError instanceof DOMException&&(firstError.name==='NotSupportedError'||/not supported|operation is not supported/i.test(firstError.message));
    if(!unsupported)throw firstError;
    // A bad/stale blob can remain in IndexedDB and make every voice test fail.
    // Detach it, remove both caches and regenerate the sample once.
    const a=audioRef.current;
    if(a){
     a.pause();a.onended=null;a.onerror=null;a.removeAttribute('src');
     try{a.load();}catch{}
    }
    activeAudioUrlRef.current='';
    await invalidateAudioForText(sample);
    await playSample(true);
   }
   setStage('Voz OpenAI funcionando');
  }catch(e){
   const message=e instanceof Error?e.message:'Falha no teste de voz.';
   setError(/not supported|operation is not supported/i.test(message)?'O Safari não conseguiu abrir o áudio gerado. O cache foi renovado; toque em Testar voz novamente.':message);
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
  unlockAudioOnTap();
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
  if(was){unlockAudioOnTap();playWanted.current=true;void playAt(next,list);}
 }

 const active=sentences[index]||'';

 return <main className="mf-app-shell" style={{...shell,height:compact&&doc?'100dvh':undefined,overflow:compact&&doc?'hidden':undefined}}>
  {(!compact||!doc)&&<header className="paper-voice-topbar" style={top}>
   <div className="pv-brand" style={{display:'flex',alignItems:'center',gap:10,minWidth:0,flex:'1 1 260px'}}>
    <PaperVoiceMark size={42}/>
    <div style={{minWidth:0}}>
     <div style={{fontFamily:'Merriweather,Georgia,serif',fontWeight:800,fontSize:24,lineHeight:1,color:'#1B3B2B'}}>Meu <span style={{color:'#E76F3B'}}>Foco</span></div>
     <div style={{...small,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{pages?name+' · pág. '+page+' de '+pages:'Leitura & Atenção Serena'}</div>
    </div>
   </div>
   <nav className="pv-top-actions" style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',justifyContent:'flex-end'}}>
    {doc&&<button style={button} aria-pressed={pageSidebarOpen} onClick={()=>setPageSidebarOpen(v=>!v)}>{pageSidebarOpen?'Fechar navegação':'Navegar no livro'}</button>}
    {doc&&<button style={button} onClick={()=>{setCompactControls(true);setCompact(true);}}>Modo leitura</button>}
    {cloudSession&&<button style={button} onClick={()=>{void refreshCloudLibrary();setLibraryOpen(true);}}>Minha Biblioteca</button>}
    <button style={button} onClick={()=>{setAccountMessage('');void refreshAudioCacheStats();setAccountOpen(true);}}>{cloudSession?.user.email?'Conta':'Entrar'}</button>
    <button className="mf-theme-toggle" style={button} type="button" aria-pressed={darkMode} title={darkMode?'Usar modo dia':'Usar modo noite'} onClick={toggleTheme}>{darkMode?'☀ Dia':'☾ Noite'}</button>
    <button style={button} onClick={()=>void testVoice()}>Testar voz</button>
    <button style={primary} onClick={()=>fileRef.current?.click()}>Abrir PDF</button>
   </nav>
   <input ref={fileRef} hidden type="file" accept="application/pdf,.pdf" onChange={e=>{
    const picked=e.target.files?.[0];e.currentTarget.value='';if(!picked)return;
    const mode=cloudPickerModeRef.current,target=cloudPickerFingerprintRef.current;
    cloudPickerModeRef.current=null;cloudPickerFingerprintRef.current='';
    if(mode==='attach'&&target&&fingerprintForFile(picked)!==target){
     setError('Este não parece ser o mesmo PDF salvo na biblioteca. Selecione "'+(libraryBooks.find(b=>b.fingerprint===target)?.file_name||'o arquivo correspondente')+'".');
     setLibraryOpen(true);return;
    }
    void (async()=>{
     await openFile(picked);
     if(mode&&cloudSessionRef.current){
      await saveCurrentPdfToCloud();
     }
    })();
   }}/>
  </header>}

  <section style={compact&&doc?{padding:0,display:'block',flex:1,minHeight:0}:{padding:12,display:'grid',gap:10,flex:1}}>
   {error&&<div role="alert" style={{...card,borderColor:'#b84a4a',color:'#8c2727'}}>{error}</div>}
   <div className={doc&&pageSidebarOpen&&!compact?'mf-reader-layout pages-open':'mf-reader-layout'} style={{position:'relative',display:'flex',alignItems:'stretch',gap:12,minWidth:0}}>
    {doc&&pageSidebarOpen&&!compact&&<BookNavigator doc={doc} pages={pages} current={page} jumpValue={jumpValue} setJumpValue={setJumpValue} onJump={jumpToPage} onSelect={target=>{void goPage(target);if(window.matchMedia('(max-width: 850px)').matches)setPageSidebarOpen(false);}} onClose={()=>setPageSidebarOpen(false)}/>}
    <div className="mf-reader-main" style={{minWidth:0,flex:1}}>
   <div ref={canvasWrap} className="mf-reader-canvas-wrap" style={compact&&doc?{height:'100dvh',width:'100%',overflow:'hidden',background:'#111',display:'grid',placeItems:'center'}:{...card,padding:8,minHeight:'58dvh',height:'68dvh',overflow:'auto'}}>
    <div ref={pageStageRef} style={{position:'relative',display:doc?'block':'none',margin:'0 auto',flex:'0 0 auto'}}>
     <canvas ref={canvasRef} className="mf-pdf-canvas" aria-label={'Página '+page+' do PDF'} style={{position:'absolute',inset:0,display:'block',background:'white',width:'100%',height:'100%'}}/>
     <div
      ref={textLayerRef}
      className="textLayer ipad-text-layer"
      onPointerUp={()=>window.setTimeout(captureSelection,0)}
      onTouchEnd={()=>window.setTimeout(captureSelection,0)}
      onClick={()=>{const s=window.getSelection();if(compact&&(!s||s.isCollapsed))setCompactControls(v=>!v);}}
     />
    </div>
    {!doc&&<div className="pv-welcome pv-meu-foco-welcome" style={{width:'100%',boxSizing:'border-box',maxWidth:1220,margin:'0 auto',padding:'clamp(18px,3vw,34px)'}}>
     <section className="pv-focus-intro">
      <div className="pv-focus-badge"><span>●</span> LEITURA SERENA &amp; APOIO AO TDAH</div>
      <h1 className="pv-focus-title">Leia mais.<br/><em>Distraia-se menos.</em></h1>
      <div className="pv-focus-script">“Leitura guiada para uma mente que não gosta de ficar parada.”</div>
      <p className="pv-focus-lead">Transforme livros e PDFs em uma rotina suave com leitura guiada por voz, controle calmo de ritmo e recursos pensados para cultivar foco sem ansiedade.</p>
      <div className="pv-focus-features">
       <div className="pv-focus-feature"><div className="pv-feature-icon">◉</div><strong>Voz Guiada &amp; Ritmo</strong><span>Destaque dinâmico no seu próprio andamento.</span></div>
       <div className="pv-focus-feature"><div className="pv-feature-icon pv-green">▣</div><strong>Sem Distrações</strong><span>Ambiente silencioso, sem sobrecarga visual.</span></div>
       <div className="pv-focus-feature"><div className="pv-feature-icon">▤</div><strong>Sua Biblioteca</strong><span>Sincronize PDFs, progresso e marcadores.</span></div>
      </div>
      <div className="pv-focus-quote"><span className="pv-quote-icon">☕</span><div><strong>“Ler também é um jeito de cuidar da mente.”</strong><span>Pequenos momentos diários produzem grandes avanços.</span></div></div>
     </section>
     <section className="pv-focus-entry">
      <div className="pv-entry-accent"/>
      <div className="pv-entry-top"><span>ÁREA DO LEITOR</span>{!cloudSession&&<button type="button" className="pv-link-button" onClick={()=>{setAccountMessage('');void refreshAudioCacheStats();setAccountOpen(true);}}>Criar conta →</button>}</div>
      <h2>Bem-vindo de volta!</h2>
      <p>Continue sua jornada de leitura serena com foco, voz natural e um ritmo que acompanha você.</p>
      {cloudSession?<div className="pv-entry-session">
       <div className="pv-session-label">Conta conectada</div>
       <strong>{cloudSession.user.email||'Leitor Meu Foco'}</strong>
       <span>Seu progresso e seus marcadores estão sincronizados.</span>
      </div>:<div className="pv-entry-session pv-entry-guest">
       <div className="pv-session-label">SEU ESPAÇO DE LEITURA</div>
       <strong>Foco sem pressa.</strong>
       <span>Entre para sincronizar sua biblioteca ou experimente agora sem login.</span>
      </div>}
      <div className="pv-entry-actions">
       <button type="button" style={{...primary,width:'100%',padding:'14px 20px',fontSize:16}} onClick={()=>{setAccountMessage('');void refreshAudioCacheStats();setAccountOpen(true);}}>{cloudSession?'Minha conta':'Entrar no Meu Foco'} <span>→</span></button>
       <button type="button" style={{...button,width:'100%',padding:'13px 20px',fontSize:15}} onClick={()=>fileRef.current?.click()}>Experimentar Modo Convidado · Abrir PDF</button>
       {cloudSession&&<button type="button" style={{...button,width:'100%',padding:'13px 20px'}} onClick={()=>{void refreshCloudLibrary();setLibraryOpen(true);}}>Minha Biblioteca{libraryBooks.length?' · '+libraryBooks.length:''}</button>}
      </div>
      <div className="pv-entry-divider"><span>MEU FOCO</span></div>
      <div className="pv-entry-note">Leitura guiada, destaque sincronizado e biblioteca acolhedora.</div>
     </section>
    </div>}
   </div>
    </div>
   </div>
   {doc&&!compact&&<div className="mf-current-excerpt" style={{...card,background:'#fff7dc'}}>
    <div style={{...small,marginBottom:5}}>TRECHO ATUAL {sentences.length?index+1:0}/{sentences.length}</div>
    <div style={{fontFamily:'Georgia,serif',fontSize:18,lineHeight:1.55}}>{active||'Esta página não possui texto selecionável. Se for uma página digitalizada, será necessário OCR.'}</div>
   </div>}
  </section>

  {!compact&&<footer className="mf-reader-footer" style={{position:'sticky',bottom:0,zIndex:10,background:'#fffdf8',borderTop:'1px solid #d8d0c2',padding:'9px 10px calc(9px + env(safe-area-inset-bottom, 0px))'}}>
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
    <button type="button" style={{...button,borderColor:'#d46f51',color:'#a84d35',fontWeight:700}} disabled={!doc} onClick={stopAndClearAudio}>Parar</button>
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

  {doc&&mode==='loading'&&<div className="mf-audio-preparing" role="status" aria-live="polite">
   <div className="mf-audio-preparing-card">
    <span className="mf-audio-preparing-icon">♫</span>
    <div><strong>Aguarde, estamos preparando seu áudio</strong><span className="mf-audio-dots" aria-hidden="true"><i/><i/><i/></span></div>
   </div>
  </div>}

  {accountOpen&&<div className="pv-modal-backdrop" style={{position:'fixed',inset:0,zIndex:70,background:'rgba(30,37,31,.48)',backdropFilter:'blur(8px)',display:'grid',placeItems:'center',padding:18}} onClick={()=>setAccountOpen(false)}>
   <div className="pv-account-card" style={{...card,width:'min(460px,94vw)',padding:0,overflow:'hidden',boxShadow:'0 24px 80px rgba(38,28,17,.24)'}} onClick={e=>e.stopPropagation()}>
    <div style={{padding:'24px 24px 18px',background:'linear-gradient(180deg,#fffaf2,#fff7ed)'}}>
     <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12}}>
      <div style={{display:'flex',gap:12,alignItems:'center'}}><PaperVoiceMark size={48}/><div><div style={{fontFamily:'Georgia,serif',fontSize:28,fontWeight:800,lineHeight:1}}>Meu Foco</div><div style={{...small,marginTop:4}}>Leitura & Atenção Serena</div></div></div>
      <button type="button" style={{...button,padding:'7px 10px'}} onClick={()=>setAccountOpen(false)}>Fechar</button>
     </div>
    </div>
    {cloudSession?<div style={{padding:'22px 24px 26px',display:'grid',gap:12}}>
     <div>
      <div style={{fontFamily:'Georgia,serif',fontSize:28,fontWeight:800}}>Sua conta</div>
      <div style={{...small,marginTop:5}}>Sincronização entre aparelhos ativada.</div>
     </div>
     <div style={{...card,background:'#f5eee4',boxShadow:'none'}}>
      <div style={{fontWeight:800,color:'#1B3B2B'}}>{cloudSession.user.email||'Conta conectada'}</div>
      <div style={{...small,marginTop:5}}>Página, trecho, marcadores, voz, velocidade e destaque ficam sincronizados.</div>
     </div>
     {doc&&<button type="button" style={currentCloudStored?button:primary} disabled={accountBusy||currentCloudStored} onClick={()=>void saveCurrentPdfToCloud()}>{currentCloudStored?'Livro atual salvo na nuvem':uploadProgress!==null?'Enviando '+uploadProgress+'%':'Salvar livro atual na nuvem'}</button>}
     {accountMessage&&<div style={{...small,padding:'4px 2px'}}>{accountMessage}</div>}
     <button type="button" style={button} onClick={()=>{setAccountOpen(false);void refreshCloudLibrary();setLibraryOpen(true);}}>Abrir minha biblioteca</button>
     <button type="button" style={{...button,color:'#8a4932'}} disabled={accountBusy} onClick={()=>void handleSignOut()}>{accountBusy?'Aguarde…':'Sair da conta'}</button>
    </div>:<div style={{padding:'16px 24px 28px'}}>
     <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:16,marginBottom:18}}>
      <div><div style={{fontFamily:'Georgia,serif',fontSize:34,fontWeight:800,lineHeight:1.02}}>Bem-vindo<br/>de volta!</div><div style={{...small,fontSize:14,marginTop:8}}>Entre na sua conta e continue sua jornada de leitura serena com foco.</div></div>
      <button type="button" onClick={()=>void handleSignUp()} disabled={accountBusy} style={{border:0,background:'transparent',color:'#E76F3B',fontWeight:800,padding:'6px 0'}}>Criar conta</button>
     </div>
     <div style={{display:'grid',gap:12}}>
      <label style={{display:'grid',gap:6,fontSize:13,fontWeight:800}}>E-mail
       <input type="email" autoComplete="email" placeholder="seu@email.com" value={accountEmail} onChange={e=>setAccountEmail(e.target.value)} style={{...button,width:'100%',boxSizing:'border-box',background:'#fffdf9',padding:'13px 14px'}}/>
      </label>
      <label style={{display:'grid',gap:6,fontSize:13,fontWeight:800}}>Senha
       <input type="password" autoComplete="current-password" placeholder="Sua senha" value={accountPassword} onChange={e=>setAccountPassword(e.target.value)} style={{...button,width:'100%',boxSizing:'border-box',background:'#fffdf9',padding:'13px 14px'}}/>
      </label>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,fontSize:12,color:'#7c786f'}}><span>Use a mesma conta em todos os aparelhos.</span><span style={{color:'#E76F3B',fontWeight:700}}>Sincronização segura</span></div>
      {accountMessage&&<div style={{...small,color:accountMessage.includes('Não')||accountMessage.includes('Digite')||accountMessage.includes('Use um')?'#9c4231':'#52645a',background:'#f6eee3',borderRadius:10,padding:'9px 10px'}}>{accountMessage}</div>}
      <button type="button" style={{...primary,width:'100%',padding:'13px 16px',fontSize:16}} disabled={accountBusy} onClick={()=>void handleSignIn()}>{accountBusy?'Aguarde…':'Entrar no Meu Foco'}</button>
      <button type="button" style={{...button,width:'100%',padding:'12px 16px'}} disabled={accountBusy} onClick={()=>void handleSignUp()}>Ainda não tem conta? Criar conta</button>
     </div>
     <div className="pv-books-decoration" style={{marginTop:22,display:'flex',alignItems:'flex-end',gap:8,justifyContent:'center'}}>
      <div style={{width:86,height:18,borderRadius:5,background:'#c47a48',transform:'rotate(-2deg)'}}/>
      <div style={{width:110,height:22,borderRadius:5,background:'#1B3B2B',transform:'rotate(1deg)'}}/>
      <div style={{width:96,height:20,borderRadius:5,background:'#e8c69b',transform:'rotate(-1deg)'}}/>
     </div>
    </div>}
    <div style={{borderTop:'1px solid #eadfce',padding:'14px 24px 18px',background:'#fbf5eb',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
     <div><div style={{fontWeight:800,fontSize:13}}>Áudio salvo neste aparelho</div><div style={small}>{audioCacheStats.entries?audioCacheStats.entries+' trechos · '+formatAudioCacheBytes(audioCacheStats.bytes):'Nenhum trecho salvo ainda'}</div></div>
     <button type="button" style={{...button,padding:'7px 10px',fontSize:12}} disabled={!audioCacheStats.entries} onClick={()=>void clearSavedAudioCache()}>Limpar áudio salvo</button>
    </div>
   </div>
  </div>}

  {libraryOpen&&cloudSession&&<div className="pv-library-screen" style={{position:'fixed',inset:0,zIndex:65,background:'#fbf7ef',overflow:'auto',padding:'max(28px,calc(12px + env(safe-area-inset-top,0px))) max(18px,calc(18px + env(safe-area-inset-right,0px))) calc(32px + env(safe-area-inset-bottom,0px)) max(18px,calc(18px + env(safe-area-inset-left,0px)))'}}>
   <div style={{maxWidth:1120,margin:'0 auto'}}>
    <div className="pv-library-header" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:14,marginBottom:22}}>
     <div style={{display:'flex',alignItems:'center',gap:12}}><PaperVoiceMark size={48}/><div><div style={{fontFamily:'Georgia,serif',fontSize:32,fontWeight:800,lineHeight:1}}>Meu Foco</div><div style={{...small,marginTop:4}}>Organize livros e PDFs sem sobrecarga, no ritmo da sua atenção.</div></div></div>
     <div style={{display:'flex',gap:8,alignItems:'center'}}>
      <button type="button" style={button} onClick={()=>choosePdfForLibrary()}>Adicionar PDF</button>
      <button type="button" style={button} onClick={()=>setLibraryOpen(false)}>Fechar</button>
     </div>
    </div>

    <div className="pv-library-tabs" style={{display:'flex',gap:8,alignItems:'center',marginBottom:24,flexWrap:'wrap'}}>
     <span style={{...primary,padding:'8px 14px'}}>Todos</span><span style={{...button,padding:'8px 14px'}}>Livros</span><span style={{...button,padding:'8px 14px'}}>PDFs</span><span style={{...button,padding:'8px 14px'}}>Favoritos</span>
     <span style={{...small,marginLeft:'auto'}}>{cloudSession.user.email} · {libraryBooks.length} {libraryBooks.length===1?'item':'itens'}</span>
    </div>

    {libraryBusy&&<div style={{...card,marginBottom:16}}>Atualizando sua biblioteca…</div>}
    {!libraryBusy&&libraryBooks.length===0&&<div style={{...card,padding:34,textAlign:'center'}}>
     <div style={{fontFamily:'Georgia,serif',fontSize:28,fontWeight:800}}>Sua biblioteca está pronta.</div>
     <div style={{...small,fontSize:14,marginTop:7}}>Adicione um PDF e o Meu Foco mantém sua leitura, marcadores e progresso sincronizados.</div>
     <button type="button" style={{...primary,marginTop:18}} onClick={()=>choosePdfForLibrary()}>Adicionar primeiro PDF</button>
    </div>}

    {libraryBooks.length>0&&<>
     <section style={{marginBottom:30}}>
      <div style={{display:'flex',alignItems:'end',justifyContent:'space-between',gap:12,marginBottom:12}}><div><div style={{fontFamily:'Georgia,serif',fontSize:28,fontWeight:800}}>Continuar lendo</div><div style={small}>Retome exatamente de onde parou.</div></div><span style={{...small,color:'#E76F3B',fontWeight:800}}>Ver tudo</span></div>
      <button type="button" disabled={libraryBusy} onClick={()=>libraryBooks[0].storage_path?void openLibraryBook(libraryBooks[0]):choosePdfForLibrary(libraryBooks[0])} style={{...card,width:'100%',display:'grid',gridTemplateColumns:'118px 1fr auto',alignItems:'center',gap:18,textAlign:'left',cursor:'pointer',background:'linear-gradient(135deg,#fff8ec,#f7ead8)',padding:16}}>
       <BookCover book={libraryBooks[0]} index={0} compact/>
       <div style={{minWidth:0}}>
        <div style={{fontFamily:'Georgia,serif',fontSize:25,fontWeight:800,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{libraryBooks[0].title||libraryBooks[0].file_name}</div>
        <div style={{...small,marginTop:5}}>Página {libraryBooks[0].page} de {libraryBooks[0].total_pages||'?'} · {libraryBooks[0].storage_path?'salvo na nuvem':'toque para enviar o PDF'}</div>
        <div style={{height:7,background:'#e6dccd',borderRadius:99,marginTop:14,overflow:'hidden'}}><div style={{height:'100%',width:Math.min(100,Math.round((libraryBooks[0].page/Math.max(1,libraryBooks[0].total_pages))*100))+'%',background:'#E76F3B'}}/></div>
       </div>
       <span style={{...primary,padding:'10px 15px',whiteSpace:'nowrap'}}>Continuar</span>
      </button>
     </section>

     <section>
      <div style={{display:'flex',alignItems:'end',justifyContent:'space-between',gap:12,marginBottom:14}}><div><div style={{fontFamily:'Georgia,serif',fontSize:28,fontWeight:800}}>Minha Biblioteca</div><div style={small}>Livros e PDFs sincronizados.</div></div><span style={{...small}}>Recentemente adicionados</span></div>
      <div className="pv-book-grid" style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(165px,1fr))',gap:18}}>
       {libraryBooks.map((book,i)=><button key={book.id} type="button" disabled={libraryBusy} onClick={()=>book.storage_path?void openLibraryBook(book):choosePdfForLibrary(book)} style={{border:0,background:'transparent',padding:0,textAlign:'left',color:'#1B3B2B',cursor:'pointer'}}>
        <BookCover book={book} index={i}/>
        <div style={{fontFamily:'Georgia,serif',fontWeight:800,fontSize:16,marginTop:9,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{book.title||book.file_name}</div>
        <div style={{...small,marginTop:4}}>Pág. {book.page}/{book.total_pages||'?'} · {book.storage_path?'Nuvem':'Enviar PDF'}</div>
        <div style={{height:4,background:'#e8dfd3',borderRadius:99,marginTop:7,overflow:'hidden'}}><div style={{height:'100%',width:Math.min(100,Math.round((book.page/Math.max(1,book.total_pages))*100))+'%',background:i%2?'#1B3B2B':'#E76F3B'}}/></div>
       </button>)}
      </div>
     </section>
    </>}
   </div>
  </div>}

  {selectedText&&<div style={{position:'fixed',left:'50%',bottom:compact?'calc(72px + env(safe-area-inset-bottom, 0px))':'150px',transform:'translateX(-50%)',zIndex:45,display:'flex',alignItems:'center',gap:6,background:'rgba(18,22,28,.94)',color:'white',borderRadius:14,padding:'6px 8px',boxShadow:'0 5px 22px rgba(0,0,0,.3)',whiteSpace:'nowrap'}}>
   <span style={{fontSize:12,padding:'0 4px'}}>Texto selecionado</span>
   <button type="button" onPointerDown={e=>e.preventDefault()} style={{...primary,padding:'7px 10px'}} onClick={readSelectionOnly}>Ler seleção</button>
   <button type="button" onPointerDown={e=>e.preventDefault()} style={{...button,padding:'7px 10px'}} onClick={readFromSelection}>Ler daqui</button>
   <button type="button" onPointerDown={e=>e.preventDefault()} style={{...button,padding:'7px 9px'}} onClick={clearSelection}>Fechar</button>
  </div>}

  {compact&&doc&&compactControls&&<>
   <div className="paper-voice-compact-top" style={{position:'fixed',top:'calc(8px + env(safe-area-inset-top, 0px))',left:'50%',transform:'translateX(-50%)',zIndex:30,background:'rgba(20,20,20,.78)',color:'white',borderRadius:16,padding:'5px 7px',fontSize:12,display:'flex',alignItems:'center',gap:6}}>
    <span style={{padding:'0 3px'}}>Página {page} de {pages}</span>
    <button type="button" onPointerDown={e=>e.preventDefault()} style={{...button,padding:'5px 8px',fontSize:12}} onClick={toggleBookmark}>{bookmarks.includes(page)?'Marcada':'Marcar'}</button>
    {bookmarks.length>0&&<select aria-label="Marcadores" value="" onChange={e=>openBookmark(e.target.value)} style={{...button,padding:'5px 7px',fontSize:12,width:'auto',margin:0}}>
     <option value="">Marcadores</option>
     {bookmarks.map(n=><option key={n} value={n}>Página {n}</option>)}
    </select>}
   </div>
   <form className="mf-compact-controls" onSubmit={e=>{e.preventDefault();jumpToPage();}} style={{position:'fixed',left:'50%',bottom:'calc(8px + env(safe-area-inset-bottom, 0px))',transform:'translateX(-50%)',zIndex:30,display:'flex',alignItems:'center',gap:5,background:'rgba(255,253,248,.94)',border:'1px solid #cfc7b9',borderRadius:16,padding:5,boxShadow:'0 4px 18px rgba(0,0,0,.18)'}}>
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
    <button type="button" style={{...button,padding:'7px 9px',borderColor:'#d46f51',color:'#a84d35',fontWeight:700}} onClick={stopAndClearAudio}>Parar</button>
    <button type="button" style={{...button,padding:'7px 9px'}} onClick={toggleHighlight}>{highlightEnabled?'Destaque':'Sem destaque'}</button>
    <button type="button" style={{...button,padding:'7px 9px'}} disabled={page>=pages} onClick={()=>void goPage(page+1)}>Próxima</button>
    <button type="button" style={{...button,padding:'7px 9px'}} onClick={()=>{setCompact(false);setPageSidebarOpen(true);}}>Navegar</button>
    <button type="button" className="mf-theme-toggle" style={{...button,padding:'7px 9px'}} onClick={toggleTheme}>{darkMode?'☀ Dia':'☾ Noite'}</button>
    <button type="button" style={{...button,padding:'7px 9px'}} onClick={()=>setCompactControls(false)}>Ocultar</button>
    <button type="button" style={{...button,padding:'7px 9px'}} onClick={()=>setCompact(false)}>Menu</button>
   </form>
  </>}
 </main>;
}
