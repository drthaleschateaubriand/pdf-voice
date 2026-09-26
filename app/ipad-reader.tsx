"use client";
import {useEffect,useRef,useState,type CSSProperties} from 'react';

type Provider={id:string;name:string;model:string;configured:boolean;voices:{id:string;name:string}[]};
type Mode='idle'|'loading'|'playing'|'paused';
type PdfTextItem={str?:string;hasEOL?:boolean};
type PdfPageLike={getTextContent:()=>Promise<{items:PdfTextItem[]}>};
type PdfDocLike={numPages:number;getPage:(n:number)=>Promise<PdfPageLike>;destroy:()=>Promise<void>|void};
type PdfJsClassic={
 version:string;
 GlobalWorkerOptions:{workerSrc:string};
 getDocument:(options:{data:Uint8Array;cMapUrl?:string;cMapPacked?:boolean;standardFontDataUrl?:string})=>{promise:Promise<PdfDocLike>};
};

const PDFJS_VERSION='3.11.174';
const PDFJS_BASE='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/'+PDFJS_VERSION+'/';

const shell:CSSProperties={minHeight:'100dvh',background:'#f3efe6',color:'#17202a',fontFamily:'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',display:'flex',flexDirection:'column'};
const top:CSSProperties={position:'sticky',top:0,zIndex:10,background:'#fffdf8',borderBottom:'1px solid #d8d0c2',padding:'10px 12px',display:'flex',alignItems:'center',gap:10};
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
 const [pdfUrl,setPdfUrl]=useState('');
 const [page,setPage]=useState(1),[pages,setPages]=useState(0);
 const [sentences,setSentences]=useState<string[]>([]),[index,setIndex]=useState(0);
 const [mode,setMode]=useState<Mode>('idle'),[error,setError]=useState('');
 const [voices,setVoices]=useState<{id:string;name:string}[]>([]),[voice,setVoice]=useState('marin'),[speed,setSpeed]=useState(1);
 const [connected,setConnected]=useState(false),[stage,setStage]=useState('Pronto');
 const fileRef=useRef<HTMLInputElement>(null);
 const docRef=useRef<PdfDocLike|null>(null),pageRef=useRef(1),sentencesRef=useRef<string[]>([]),indexRef=useRef(0);
 const pdfUrlRef=useRef('');
 const audioRef=useRef<HTMLAudioElement|null>(null),playWanted=useRef(false),token=useRef(0);
 const cache=useRef(new Map<string,string>()),fileKey=useRef('');

 useEffect(()=>{pageRef.current=page;},[page]);
 useEffect(()=>{sentencesRef.current=sentences;},[sentences]);
 useEffect(()=>{indexRef.current=index;},[index]);
 useEffect(()=>{if(audioRef.current)audioRef.current.playbackRate=speed;},[speed]);

 useEffect(()=>{
  fetch('/api/speech').then(r=>r.json()).then((d:{providers:Provider[]})=>{
   const o=d.providers?.find(p=>p.id==='openai');
   if(!o)return;
   setConnected(Boolean(o.configured));setVoices(o.voices||[]);
   const preferred=o.voices?.find(v=>v.id==='marin')||o.voices?.[0];
   if(preferred)setVoice(preferred.id);
  }).catch(()=>setError('Não foi possível verificar a conexão com a voz OpenAI.'));
  return()=>{
   token.current++;
   audioRef.current?.pause();
   void docRef.current?.destroy();
   if(pdfUrlRef.current)URL.revokeObjectURL(pdfUrlRef.current);
   for(const url of cache.current.values())URL.revokeObjectURL(url);
  };
 },[]);

 function stop(reset=false){
  token.current++;playWanted.current=false;
  const a=audioRef.current;if(a){a.pause();a.onended=null;a.onerror=null;}
  setMode('idle');
  if(reset){setIndex(0);indexRef.current=0;}
 }

 async function extractPage(current:PdfDocLike,n:number,restoreIndex=0){
  setStage('Extraindo texto da página '+n+'…');setError('');
  const pdfPage=await current.getPage(n);
  const tc=await pdfPage.getTextContent();
  let text='';
  for(const it of tc.items){
   if(!it.str)continue;
   text+=it.str+(it.hasEOL?'\n':' ');
  }
  const list=splitSentences(text);
  const safeIndex=Math.max(0,Math.min(restoreIndex,Math.max(0,list.length-1)));
  pageRef.current=n;sentencesRef.current=list;indexRef.current=safeIndex;
  setPage(n);setSentences(list);setIndex(safeIndex);
  setStage(list.length?'Página pronta para leitura':'Página sem texto selecionável');
  if(fileKey.current){
   try{localStorage.setItem('paper-voice-ios:'+fileKey.current,JSON.stringify({page:n,index:safeIndex}));}catch{}
  }
  return list;
 }

 async function openFile(file:File){
  stop();setError('');setStage('Preparando PDF…');setSentences([]);setIndex(0);
  let stageName='início';
  const nextUrl=URL.createObjectURL(file);
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
   if(pdfUrlRef.current)URL.revokeObjectURL(pdfUrlRef.current);
   pdfUrlRef.current=nextUrl;setPdfUrl(nextUrl);
   docRef.current=next;setDoc(next);setName(file.name);setPages(next.numPages);
   fileKey.current=(file.name+':'+file.size).replace(/[^a-zA-Z0-9._:-]/g,'_');
   let start=1,savedIndex=0;
   try{
    const saved=JSON.parse(localStorage.getItem('paper-voice-ios:'+fileKey.current)||'{}');
    if(Number.isInteger(saved.page)&&saved.page>=1&&saved.page<=next.numPages)start=saved.page;
    if(Number.isInteger(saved.index)&&saved.index>=0)savedIndex=saved.index;
   }catch{}
   stageName='extrair texto';
   await extractPage(next,start,savedIndex);
  }catch(e){
   URL.revokeObjectURL(nextUrl);
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

 async function playAt(i:number,list=sentencesRef.current,currentToken=++token.current){
  if(!playWanted.current||currentToken!==token.current)return;
  if(i>=list.length){
   const d=docRef.current,n=pageRef.current;
   if(d&&n<d.numPages){
    try{
     const next=await extractPage(d,n+1);
     if(playWanted.current&&currentToken===token.current)void playAt(0,next,currentToken);
    }catch(e){
     setError(e instanceof Error?e.message:'Falha ao avançar página.');
     stop();
    }
   }else{
    playWanted.current=false;setMode('idle');setStage('Fim do documento');
   }
   return;
  }
  indexRef.current=i;setIndex(i);setMode('loading');setStage('Gerando voz…');
  try{
   const current=audioUrl(list[i]);
   if(i+1<list.length)void audioUrl(list[i+1]).catch(()=>{});
   const url=await current;
   if(!playWanted.current||currentToken!==token.current)return;
   let audio=audioRef.current;
   if(!audio){audio=new Audio();audio.preload='auto';audioRef.current=audio;}
   audio.pause();audio.src=url;audio.playbackRate=speed;audio.currentTime=0;
   audio.onended=()=>{if(playWanted.current&&currentToken===token.current)void playAt(i+1,list,currentToken);};
   audio.onerror=()=>{setError('O Safari não conseguiu reproduzir este trecho.');stop();};
   await audio.play();
   if(currentToken===token.current){setMode('playing');setStage('Lendo');}
   if(fileKey.current){
    try{localStorage.setItem('paper-voice-ios:'+fileKey.current,JSON.stringify({page:pageRef.current,index:i}));}catch{}
   }
  }catch(e){
   setError(e instanceof Error?e.message:'Falha na narração.');
   stop();
  }
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
  const d=docRef.current;if(!d||n<1||n>d.numPages)return;
  stop();
  try{await extractPage(d,n);}catch(e){setError(e instanceof Error?e.message:'Falha ao carregar página.');}
 }

 function moveSentence(delta:number){
  const list=sentencesRef.current;if(!list.length)return;
  const next=Math.max(0,Math.min(list.length-1,indexRef.current+delta));
  const was=mode==='playing';
  stop();setIndex(next);indexRef.current=next;
  if(was){playWanted.current=true;void playAt(next,list);}
 }

 const active=sentences[index]||'';
 const nativeSrc=pdfUrl?pdfUrl+'#page='+page+'&view=FitH':'';

 return <main style={shell}>
  <header style={top}>
   <div style={{minWidth:0,flex:1}}>
    <div style={{fontWeight:700,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{name}</div>
    <div style={small}>{pages?'Página '+page+' de '+pages:'Leitor PDF para iPad'} · {connected?'OpenAI conectada':'OpenAI não conectada'}</div>
   </div>
   <button style={button} onClick={()=>void testVoice()}>Testar voz</button>
   <button style={button} onClick={()=>fileRef.current?.click()}>Abrir PDF</button>
   <input ref={fileRef} hidden type="file" accept="application/pdf,.pdf" onChange={e=>{const f=e.target.files?.[0];if(f)void openFile(f);e.currentTarget.value='';}}/>
  </header>

  <section style={{padding:12,display:'grid',gap:10,flex:1}}>
   {error&&<div role="alert" style={{...card,borderColor:'#b84a4a',color:'#8c2727'}}>{error}</div>}
   <div style={{...card,padding:8,minHeight:'58dvh',overflow:'hidden'}}>
    {pdfUrl?
     <iframe
      title="PDF original"
      src={nativeSrc}
      style={{display:'block',width:'100%',height:'68dvh',border:0,background:'white',borderRadius:8}}
     />:
     <div style={{padding:'48px 18px',textAlign:'center'}}>
      <h2 style={{margin:'0 0 8px'}}>Paper Voice para iPad</h2>
      <p style={{margin:0,color:'#657080'}}>O Safari mostra o PDF original. O texto é extraído separadamente para a voz da OpenAI.</p>
     </div>}
   </div>
   {doc&&<div style={{...card,background:'#fff7dc'}}>
    <div style={{...small,marginBottom:5}}>TRECHO ATUAL {sentences.length?index+1:0}/{sentences.length}</div>
    <div style={{fontFamily:'Georgia,serif',fontSize:18,lineHeight:1.55}}>{active||'Esta página não possui texto selecionável. Se for uma página digitalizada, será necessário OCR.'}</div>
   </div>}
  </section>

  <footer style={{position:'sticky',bottom:0,zIndex:10,background:'#fffdf8',borderTop:'1px solid #d8d0c2',padding:'9px 10px calc(9px + env(safe-area-inset-bottom, 0px))'}}>
   <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:7,flexWrap:'wrap'}}>
    <button style={button} disabled={!doc||page<=1} onClick={()=>void goPage(page-1)}>Página anterior</button>
    <button style={button} disabled={!sentences.length||index<=0} onClick={()=>moveSentence(-1)}>Trecho anterior</button>
    <button style={primary} disabled={!sentences.length} onClick={toggle}>{mode==='playing'?'Pausar':mode==='paused'?'Continuar':'Ler'}</button>
    <button style={button} disabled={!sentences.length||index>=sentences.length-1} onClick={()=>moveSentence(1)}>Próximo trecho</button>
    <button style={button} disabled={!doc||page>=pages} onClick={()=>void goPage(page+1)}>Próxima página</button>
   </div>
   <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginTop:8}}>
    <select aria-label="Voz" value={voice} onChange={e=>{stop();setVoice(e.target.value);}} style={{...button,padding:'7px 9px',maxWidth:'45%'}}>
     {voices.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
    </select>
    <span style={{...small,textAlign:'center',flex:1}}>{stage}{isAppleTouch()?' · Safari/iPad':''}</span>
    <select aria-label="Velocidade" value={speed} onChange={e=>setSpeed(Number(e.target.value))} style={{...button,padding:'7px 9px'}}>
     {[0.75,1,1.25,1.5,1.75,2].map(v=><option key={v} value={v}>{v}×</option>)}
    </select>
   </div>
  </footer>
 </main>;
}
