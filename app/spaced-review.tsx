"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import {getCloudSession,loadCloudStudyState,saveCloudStudyState} from "./paper-cloud";

type Rating="again"|"hard"|"good"|"easy"|"manual";
type ReviewState={
 nextReview:string|null;
 lastReview:string|null;
 intervalDays:number;
 reps:number;
 lapses:number;
 lastRating:Rating|null;
 history:Array<{at:string;rating:Rating;nextReview:string;intervalDays?:number}>;
};
type StudyQuestion={
 id:string;
 order:number;
 question:string;
 answer:string;
 tags:string[];
 source:string|null;
 groupTitle:string;
 sectionTitle:string;
 review:ReviewState;
};
type StudySection={title:string;questions:StudyQuestion[]};
type StudyGroup={title:string;sections:StudySection[]};
type StudyBank={schemaVersion:number;id:string;title:string;importedAt:string;groups:StudyGroup[]};
type SchedulerSettings={
 againMinutes:number;
 hardDays:number;
 goodDays:number;
 easyDays:number;
 growthFactor:number;
 maxDays:number;
};

const BANK_KEY="meu-foco-spaced-review-v1";
const SETTINGS_KEY="meu-foco-spaced-review-settings-v1";
const CLOUD_STAMP_KEY="meu-foco-spaced-review-cloud-stamp-v1";
const DEFAULT_SETTINGS:SchedulerSettings={againMinutes:10,hardDays:1,goodDays:3,easyDays:7,growthFactor:2.2,maxDays:365};

const makeId=(prefix="q")=>{
 const random=typeof crypto!=="undefined"&&"randomUUID" in crypto?crypto.randomUUID():Math.random().toString(36).slice(2);
 return prefix+"-"+random;
};
const shuffle=<T,>(items:T[])=>{
 const copy=[...items];
 for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}
 return copy;
};
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]||ch));
const formatDate=(value:string|null)=>{
 if(!value)return "Nova";
 try{return new Date(value).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"});}catch{return value;}
};
const isDue=(q:StudyQuestion)=>!q.review.nextReview||new Date(q.review.nextReview).getTime()<=Date.now();
type Performance="unseen"|"again"|"hard"|"good"|"easy";
const performanceOf=(q:StudyQuestion):Performance=>{
 if(!q.review.reps)return "unseen";
 const last=[...q.review.history].reverse().find(item=>item.rating!=="manual")?.rating;
 if(last==="again"||last==="hard"||last==="good"||last==="easy")return last;
 if(q.review.lastRating==="again"||q.review.lastRating==="hard"||q.review.lastRating==="good"||q.review.lastRating==="easy")return q.review.lastRating;
 return "unseen";
};

function emptyReview():ReviewState{
 return {nextReview:null,lastReview:null,intervalDays:0,reps:0,lapses:0,lastRating:null,history:[]};
}

function normalizeQuestion(raw:any,groupTitle:string,sectionTitle:string,order:number):StudyQuestion{
 const question=String(raw?.question??raw?.pergunta??"");
 const answer=String(raw?.answer??raw?.resposta??"");
 if(!question.trim()||!answer.trim())throw new Error("Há uma pergunta ou resposta vazia na posição "+order+".");
 const review=raw?.review||{};
 return {
  id:String(raw?.id||makeId()),
  order:Number.isFinite(Number(raw?.order))?Number(raw.order):order,
  question,
  answer,
  tags:Array.isArray(raw?.tags)?raw.tags.map(String):[],
  source:raw?.source==null?null:String(raw.source),
  groupTitle,
  sectionTitle,
  review:{
   nextReview:review.nextReview||null,
   lastReview:review.lastReview||null,
   intervalDays:Number(review.intervalDays||0),
   reps:Number(review.reps||0),
   lapses:Number(review.lapses||0),
   lastRating:review.lastRating||null,
   history:Array.isArray(review.history)?review.history:[]
  }
 };
}

function normalizeBank(raw:any):StudyBank{
 if(!raw||typeof raw!=="object")throw new Error("JSON inválido.");
 let order=1;
 let groups:StudyGroup[]=[];
 if(Array.isArray(raw.groups)){
  groups=raw.groups.map((group:any,gi:number)=>{
   const groupTitle=String(group?.title||"Tema "+(gi+1));
   const sectionsInput=Array.isArray(group?.sections)?group.sections:[{title:"",questions:Array.isArray(group?.questions)?group.questions:[]}];
   return {
    title:groupTitle,
    sections:sectionsInput.map((section:any)=>{
     const sectionTitle=String(section?.title||"");
     return {
      title:sectionTitle,
      questions:(Array.isArray(section?.questions)?section.questions:[]).map((q:any)=>normalizeQuestion(q,groupTitle,sectionTitle,order++))
     };
    })
   };
  });
 }else if(Array.isArray(raw.questions)){
  const title=String(raw.title||"Banco importado");
  groups=[{title,sections:[{title:"",questions:raw.questions.map((q:any)=>normalizeQuestion(q,title,"",order++))}]}];
 }else{
  throw new Error("O JSON precisa conter 'groups' ou 'questions'.");
 }
 const total=groups.reduce((sum,g)=>sum+g.sections.reduce((n,s)=>n+s.questions.length,0),0);
 if(!total)throw new Error("Nenhuma pergunta foi encontrada.");
 return {schemaVersion:1,id:String(raw.id||makeId("bank")),title:String(raw.title||"Banco de questões"),importedAt:raw.importedAt||new Date().toISOString(),groups};
}

function addDuration(date:Date,value:number,unit:"minutes"|"hours"|"days"|"weeks"){
 const next=new Date(date);
 if(unit==="minutes")next.setMinutes(next.getMinutes()+value);
 if(unit==="hours")next.setHours(next.getHours()+value);
 if(unit==="days")next.setDate(next.getDate()+value);
 if(unit==="weeks")next.setDate(next.getDate()+value*7);
 return next;
}

function computeSchedule(q:StudyQuestion,rating:Exclude<Rating,"manual">,settings:SchedulerSettings){
 const prev=Number(q.review.intervalDays||0);
 let due:Date,intervalDays=0;
 if(rating==="again"){
  due=addDuration(new Date(),settings.againMinutes,"minutes");
  intervalDays=settings.againMinutes/1440;
 }else if(rating==="hard"){
  intervalDays=Math.min(settings.maxDays,Math.max(settings.hardDays,prev?prev*1.2:settings.hardDays));
  due=addDuration(new Date(),intervalDays,"days");
 }else if(rating==="good"){
  intervalDays=Math.min(settings.maxDays,Math.max(settings.goodDays,prev?prev*settings.growthFactor:settings.goodDays));
  due=addDuration(new Date(),intervalDays,"days");
 }else{
  intervalDays=Math.min(settings.maxDays,Math.max(settings.easyDays,prev?prev*settings.growthFactor*1.6:settings.easyDays));
  due=addDuration(new Date(),intervalDays,"days");
 }
 return {due,intervalDays};
}

function sampleBank():StudyBank{
 return normalizeBank({
  title:"Exemplo — Tratamento da obesidade",
  groups:[
   {title:"Tratamento da obesidade on-label",sections:[
    {title:"Tirzepatida",questions:[
     {id:"sample-001",order:1,question:"Qual é o mecanismo farmacológico principal da tirzepatida?",answer:"A tirzepatida é um agonista duplo dos receptores de GIP e GLP-1."},
     {id:"sample-002",order:2,question:"Qual é a frequência de administração da tirzepatida?",answer:"A tirzepatida é administrada por via subcutânea uma vez por semana."}
    ]},
    {title:"Semaglutida",questions:[
     {id:"sample-003",order:3,question:"Qual receptor é ativado pela semaglutida?",answer:"A semaglutida é um agonista do receptor de GLP-1."}
    ]}
   ]},
   {title:"Princípios do tratamento da obesidade",sections:[
    {title:"Seguimento",questions:[
     {id:"sample-004",order:4,question:"Por que a obesidade deve ser tratada como doença crônica?",answer:"Porque apresenta mecanismos biológicos persistentes de regulação do peso e elevado risco de recidiva após interrupção do tratamento."}
    ]}
   ]}
  ]
 });
}

export default function SpacedReview({onClose}:{onClose:()=>void}){
 const fileRef=useRef<HTMLInputElement>(null);
 const [tab,setTab]=useState<"bank"|"reader"|"review"|"settings">("bank");
 const [bank,setBank]=useState<StudyBank|null>(null);
 const [settings,setSettings]=useState<SchedulerSettings>(DEFAULT_SETTINGS);
 const [search,setSearch]=useState("");
 const [groupFilter,setGroupFilter]=useState("");
 const [readerOrder,setReaderOrder]=useState<string[]|null>(null);
 const [reviewScope,setReviewScope]=useState<"due"|"all"|"group">("due");
 const [reviewGroup,setReviewGroup]=useState("");
 const [queue,setQueue]=useState<StudyQuestion[]>([]);
 const [queueIndex,setQueueIndex]=useState(0);
 const [answerShown,setAnswerShown]=useState(false);
 const [manualValue,setManualValue]=useState(7);
 const [manualUnit,setManualUnit]=useState<"minutes"|"hours"|"days"|"weeks">("days");
 const [message,setMessage]=useState("");
 const [cloudStatus,setCloudStatus]=useState("Verificando nuvem…");
 const [cloudReady,setCloudReady]=useState(false);

 useEffect(()=>{
  let cancelled=false;
  void (async()=>{
   let localBank:StudyBank|null=null;
   let localSettings:SchedulerSettings={...DEFAULT_SETTINGS};
   let localStamp="";
   try{
    const saved=localStorage.getItem(BANK_KEY);
    if(saved)localBank=JSON.parse(saved) as StudyBank;
    const prefs=localStorage.getItem(SETTINGS_KEY);
    if(prefs)localSettings={...DEFAULT_SETTINGS,...JSON.parse(prefs)};
    localStamp=localStorage.getItem(CLOUD_STAMP_KEY)||"";
   }catch{}
   if(cancelled)return;
   if(localBank)setBank(localBank);
   setSettings(localSettings);

   try{
    const session=await getCloudSession();
    if(cancelled)return;
    if(!session){
     setCloudStatus("Somente neste aparelho");
     setCloudReady(true);
     return;
    }
    const cloud=await loadCloudStudyState<StudyBank>();
    if(cancelled)return;
    const localTime=Date.parse(localStamp)||0;
    const cloudTime=cloud?.updatedAt?Date.parse(cloud.updatedAt)||0:0;
    if(cloud?.bank&&(!localBank||cloudTime>localTime)){
     const cloudBank=normalizeBank(cloud.bank);
     const cloudSettings={...DEFAULT_SETTINGS,...(cloud.settings||{})} as SchedulerSettings;
     setBank(cloudBank);
     setSettings(cloudSettings);
     try{
      localStorage.setItem(BANK_KEY,JSON.stringify(cloudBank));
      localStorage.setItem(SETTINGS_KEY,JSON.stringify(cloudSettings));
      localStorage.setItem(CLOUD_STAMP_KEY,cloud.updatedAt);
     }catch{}
    }else if(localBank){
     const updatedAt=localStamp||new Date().toISOString();
     await saveCloudStudyState({version:1,updatedAt,bank:localBank,settings:localSettings});
    }
    if(!cancelled)setCloudStatus("Nuvem sincronizada");
   }catch{
    if(!cancelled)setCloudStatus("Nuvem indisponível · salvo neste aparelho");
   }finally{
    if(!cancelled)setCloudReady(true);
   }
  })();
  return()=>{cancelled=true;};
 },[]);

 useEffect(()=>{
  if(!cloudReady)return;
  try{
   if(bank)localStorage.setItem(BANK_KEY,JSON.stringify(bank));
   else localStorage.removeItem(BANK_KEY);
   localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));
  }catch{}
  const timer=window.setTimeout(()=>{
   void (async()=>{
    try{
     const session=await getCloudSession();
     if(!session){setCloudStatus("Somente neste aparelho");return;}
     const updatedAt=new Date().toISOString();
     await saveCloudStudyState({version:1,updatedAt,bank,settings});
     try{localStorage.setItem(CLOUD_STAMP_KEY,updatedAt);}catch{}
     setCloudStatus("Nuvem sincronizada");
    }catch{
     setCloudStatus("Nuvem indisponível · salvo neste aparelho");
    }
   })();
  },700);
  return()=>window.clearTimeout(timer);
 },[bank,settings,cloudReady]);

 const allQuestions=useMemo(()=>bank?bank.groups.flatMap(g=>g.sections.flatMap(s=>s.questions)):[],[bank]);
 const totalDue=allQuestions.filter(isDue).length;
 const totalReviews=allQuestions.reduce((sum,q)=>sum+q.review.reps,0);
 const performanceCounts=useMemo(()=>allQuestions.reduce((acc,q)=>{
  acc[performanceOf(q)]++;
  return acc;
 },{unseen:0,again:0,hard:0,good:0,easy:0} as Record<Performance,number>),[allQuestions]);

 const filteredGroups=useMemo(()=>{
  if(!bank)return [];
  const term=search.trim().toLowerCase();
  return bank.groups.map((group,gi)=>{
   if(groupFilter!==""&&Number(groupFilter)!==gi)return null;
   const sections=group.sections.map(section=>({
    ...section,
    questions:section.questions.filter(q=>{
     const hay=(group.title+" "+section.title+" "+q.question+" "+q.answer+" "+q.tags.join(" ")).toLowerCase();
     return !term||hay.includes(term);
    })
   })).filter(section=>section.questions.length);
   return sections.length?{...group,sections,index:gi}:null;
  }).filter(Boolean) as Array<StudyGroup&{index:number}>;
 },[bank,search,groupFilter]);

 const readerQuestions=useMemo(()=>{
  if(!bank)return [];
  if(!readerOrder)return allQuestions;
  const map=new Map(allQuestions.map(q=>[q.id,q]));
  return readerOrder.map(id=>map.get(id)).filter(Boolean) as StudyQuestion[];
 },[bank,allQuestions,readerOrder]);

 const current=queue[queueIndex]||null;

 function showMessage(text:string){setMessage(text);window.setTimeout(()=>setMessage(""),2600);}

 async function importJson(file:File){
  const raw=JSON.parse(await file.text());
  const normalized=normalizeBank(raw);
  setBank(normalized);setReaderOrder(null);setQueue([]);setQueueIndex(0);setTab("bank");
  showMessage(normalized.groups.reduce((sum,g)=>sum+g.sections.reduce((n,s)=>n+s.questions.length,0),0)+" perguntas importadas sem alteração do conteúdo.");
 }

 function startCustomReview(candidates:StudyQuestion[]){
  if(!candidates.length){showMessage("Nenhuma pergunta neste grupo.");return;}
  setQueue(shuffle(candidates));setQueueIndex(0);setAnswerShown(false);setTab("review");
 }

 function startReview(scopeOverride?:{scope:"all"|"group";group?:string}){
  if(!bank){showMessage("Importe um banco de questões primeiro.");return;}
  const scope=scopeOverride?.scope||reviewScope;
  let candidates:StudyQuestion[]=[];
  if(scope==="all")candidates=allQuestions;
  else if(scope==="group"){
   const value=scopeOverride?.group??reviewGroup;
   const gi=Number(value);
   const group=bank.groups[gi];
   candidates=group?group.sections.flatMap(s=>s.questions):[];
  }else candidates=allQuestions.filter(isDue);
  if(!candidates.length){showMessage("Nenhuma pergunta disponível nesse filtro.");return;}
  startCustomReview(candidates);
 }

 function updateQuestion(questionId:string,updater:(q:StudyQuestion)=>StudyQuestion){
  setBank(currentBank=>{
   if(!currentBank)return currentBank;
   return {...currentBank,groups:currentBank.groups.map(group=>({...group,sections:group.sections.map(section=>({...section,questions:section.questions.map(q=>q.id===questionId?updater(q):q)}))}))};
  });
 }

 function rate(rating:Exclude<Rating,"manual">){
  if(!current)return;
  const schedule=computeSchedule(current,rating,settings);
  const at=new Date().toISOString();
  updateQuestion(current.id,q=>({...q,review:{
   ...q.review,
   lastReview:at,
   nextReview:schedule.due.toISOString(),
   intervalDays:schedule.intervalDays,
   reps:q.review.reps+1,
   lapses:q.review.lapses+(rating==="again"?1:0),
   lastRating:rating,
   history:[...q.review.history,{at,rating,nextReview:schedule.due.toISOString(),intervalDays:schedule.intervalDays}]
  }}));
  window.setTimeout(()=>{setQueueIndex(i=>i+1);setAnswerShown(false);},220);
 }

 function scheduleManual(){
  if(!current||!manualValue||manualValue<1)return;
  const due=addDuration(new Date(),manualValue,manualUnit);
  const at=new Date().toISOString();
  updateQuestion(current.id,q=>({...q,review:{...q.review,nextReview:due.toISOString(),history:[...q.review.history,{at,rating:"manual",nextReview:due.toISOString()}]}}));
  showMessage("Próxima revisão: "+formatDate(due.toISOString()));
 }

 function saveSettingsNow(){
  try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));showMessage("Configurações salvas.");}catch{}
 }

 function clearProgress(){
  if(!bank||!window.confirm("Limpar apenas o histórico de revisão? As perguntas e respostas serão preservadas."))return;
  setBank({...bank,groups:bank.groups.map(group=>({...group,sections:group.sections.map(section=>({...section,questions:section.questions.map(q=>({...q,review:emptyReview()}))}))}))});
  showMessage("Progresso apagado. Conteúdo preservado.");
 }

 function exportBackup(){
  if(!bank){showMessage("Nenhum banco carregado.");return;}
  const blob=new Blob([JSON.stringify(bank,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download=(bank.title||"meu-foco").replace(/[^a-zA-Z0-9_-]+/g,"_")+".json";a.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
 }

 function printReader(){
  if(!bank)return;
  const ordered=readerQuestions;
  const html=ordered.map(q=>'<article class="q"><div class="n">QUESTÃO '+String(q.order).padStart(3,"0")+'</div><div class="qq">'+escapeHtml(q.question)+'</div><div class="aa">'+escapeHtml(q.answer).replace(/\n/g,"<br>")+'</div></article>').join("");
  const w=window.open("","_blank");
  if(!w){showMessage("O navegador bloqueou a janela de impressão.");return;}
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>'+escapeHtml(bank.title)+'</title><style>@page{size:A4;margin:14mm}body{font-family:Arial,sans-serif;color:#1b1b1c;margin:0}h1{font:700 28px Georgia,serif;color:#1B3B2B}.meta{color:#6c665e;margin-bottom:24px}.q{break-inside:avoid;border-bottom:1px solid #ddd;padding:12px 0}.n{font-size:10px;color:#887f76;font-weight:700}.qq{font-weight:700;line-height:1.5;margin-top:4px}.aa{line-height:1.6;margin-top:7px;color:#4f4a44}</style></head><body><h1>'+escapeHtml(bank.title)+'</h1><div class="meta">'+ordered.length+' perguntas e respostas</div>'+html+'<script>window.onload=()=>window.print()<\/script></body></html>');
  w.document.close();
 }

 return <div className="mf-spaced-root">
  <style>{`
   .mf-spaced-root{position:fixed;inset:0;z-index:120;background:#F7F3EB;color:#1B1B1C;font-family:"Plus Jakarta Sans",Inter,system-ui,-apple-system,sans-serif;overflow:auto}
   .mf-spaced-top{position:sticky;top:0;z-index:3;background:rgba(247,243,235,.95);backdrop-filter:blur(16px);border-bottom:1px solid #E5DED2;padding:max(14px,env(safe-area-inset-top)) clamp(14px,3vw,34px) 14px;display:flex;align-items:center;justify-content:space-between;gap:18px}
   .mf-spaced-brand{display:flex;align-items:center;gap:12px;min-width:220px}.mf-spaced-mark{width:42px;height:42px;border-radius:13px;background:#1B3B2B;color:#F7F3EB;display:grid;place-items:center;font:800 17px Georgia,serif}.mf-spaced-brand strong{display:block;font:800 22px Georgia,serif;color:#1B3B2B}.mf-spaced-brand small{display:block;color:#E76F3B;font-size:11px;font-weight:800;letter-spacing:.1em;margin-top:2px}
   .mf-spaced-tabs{display:flex;gap:7px;flex-wrap:wrap;justify-content:center}.mf-spaced-btn{border:1px solid #E5DED2;background:#fff;border-radius:999px;padding:10px 14px;color:#1B3B2B;font-weight:750;cursor:pointer}.mf-spaced-btn.active,.mf-spaced-btn.primary{background:#1B3B2B;color:white;border-color:#1B3B2B}.mf-spaced-btn.danger{color:#9b3c35}.mf-spaced-close{white-space:nowrap}
   .mf-spaced-main{max-width:1180px;margin:0 auto;padding:28px clamp(14px,3vw,34px) 80px}.mf-spaced-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:22px}.mf-spaced-hero h2{font:700 38px Georgia,serif;color:#1B3B2B;margin:0 0 6px}.mf-spaced-hero p{margin:0;color:#6C665E;line-height:1.55}.mf-spaced-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
   .mf-spaced-input{border:1px solid #E5DED2;background:#fff;border-radius:12px;padding:11px 12px;color:#1B1B1C;min-width:0}.mf-spaced-toolbar{display:grid;grid-template-columns:minmax(220px,1fr) 260px auto;gap:10px;margin-bottom:18px}
   .mf-spaced-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0 18px}.mf-spaced-stat{background:white;border:1px solid #E5DED2;border-radius:18px;padding:16px}.mf-spaced-stat span{font-size:12px;color:#6C665E}.mf-spaced-stat strong{display:block;font:700 28px Georgia,serif;color:#1B3B2B;margin-top:4px}
   .mf-domain{background:#fff;border:1px solid #E5DED2;border-radius:22px;padding:18px;margin:0 0 24px;box-shadow:0 8px 26px rgba(60,48,30,.05)}.mf-domain-head{display:flex;justify-content:space-between;gap:12px;align-items:end;margin-bottom:13px}.mf-domain-head h3{margin:0;font:700 22px Georgia,serif;color:#1B3B2B}.mf-domain-head p{margin:3px 0 0;color:#6C665E;font-size:13px}.mf-domain-cards{display:grid;grid-template-columns:repeat(5,1fr);gap:9px}.mf-domain-card{border:1px solid transparent;border-radius:16px;padding:12px;text-align:left;cursor:pointer}.mf-domain-card span{display:block;font-size:11px;font-weight:800}.mf-domain-card strong{display:block;font:800 25px Georgia,serif;margin-top:3px}.mf-domain-card.unseen{background:#efefed;color:#666}.mf-domain-card.again{background:#f7e3e1;color:#8c2f2f}.mf-domain-card.hard{background:#f4ead8;color:#825b1d}.mf-domain-card.good{background:#e1efe7;color:#1f623e}.mf-domain-card.easy{background:#d2e7df;color:#164d36}.mf-domain-grid{display:flex;flex-wrap:wrap;gap:5px;margin-top:14px}.mf-domain-dot{width:17px;height:17px;border:0;border-radius:5px;cursor:pointer;padding:0}.mf-domain-dot.unseen{background:#c8c8c4}.mf-domain-dot.again{background:#d96b64}.mf-domain-dot.hard{background:#d8ad57}.mf-domain-dot.good{background:#65a87f}.mf-domain-dot.easy{background:#2f7652}.mf-cloud-pill{font-size:11px;font-weight:800;border:1px solid #D7D0C6;border-radius:999px;padding:7px 10px;background:#fff;color:#5f5a53;white-space:nowrap}
   .mf-spaced-empty{padding:50px 20px;text-align:center;border:1px dashed #cec5ba;border-radius:22px;background:rgba(255,255,255,.5);color:#6C665E}.mf-spaced-empty h3{color:#1B3B2B}
   .mf-spaced-tree{display:grid;gap:14px}.mf-spaced-group{background:white;border:1px solid #E5DED2;border-radius:22px;overflow:hidden;box-shadow:0 8px 26px rgba(60,48,30,.06)}.mf-spaced-group-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 20px}.mf-spaced-group-head h3{margin:0;font:700 22px Georgia,serif;color:#1B3B2B}.mf-spaced-group-head small{color:#6C665E}.mf-spaced-section{border-top:1px solid #E5DED2;padding:14px 20px}.mf-spaced-section h4{margin:0 0 10px;color:#E76F3B}.mf-spaced-row{display:grid;grid-template-columns:48px 1fr auto;gap:10px;padding:11px 0;border-top:1px solid #f0ebe4}.mf-spaced-row:first-of-type{border-top:0}.mf-spaced-row .n{font-size:12px;color:#948b82}.mf-spaced-row b{display:block;line-height:1.45}.mf-spaced-row p{margin:5px 0 0;color:#6C665E;line-height:1.5}.mf-spaced-pill{border:1px solid #E5DED2;border-radius:999px;padding:6px 9px;font-size:11px;color:#6C665E;height:max-content}
   .mf-spaced-paper{background:#fff;border:1px solid #E5DED2;box-shadow:0 10px 30px rgba(60,48,30,.08);max-width:900px;min-height:1100px;margin:0 auto;padding:42px 54px}.mf-spaced-paper h1{font:700 30px Georgia,serif;color:#1B3B2B;margin:0}.mf-spaced-paper .meta{color:#6C665E;margin:6px 0 28px}.mf-spaced-paper .q{padding:13px 0;border-bottom:1px solid #ece6dc;break-inside:avoid}.mf-spaced-paper .n{font-size:10px;color:#8f877e;font-weight:800;letter-spacing:.06em}.mf-spaced-paper .qq{font-weight:750;line-height:1.55;margin-top:4px}.mf-spaced-paper .aa{margin-top:7px;line-height:1.65;color:#4f4a44;white-space:pre-wrap}
   .mf-spaced-review{max-width:820px;margin:0 auto}.mf-spaced-review-top{display:flex;justify-content:space-between;color:#6C665E;font-size:13px;margin-bottom:8px}.mf-spaced-card{background:white;border:1px solid #E5DED2;border-radius:26px;padding:clamp(20px,4vw,40px);box-shadow:0 10px 30px rgba(60,48,30,.08)}.mf-spaced-label{font-size:11px;letter-spacing:.14em;color:#E76F3B;font-weight:800;margin-bottom:9px}.mf-spaced-card h3{font:700 clamp(24px,4vw,34px)/1.3 Georgia,serif;color:#1B3B2B;margin:0 0 26px}.mf-spaced-answer{border-top:1px solid #E5DED2;padding-top:22px;margin-top:18px;font-size:18px;line-height:1.7;white-space:pre-wrap}.mf-spaced-wide{width:100%;justify-content:center}.mf-spaced-ratings{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:20px}.mf-spaced-rate{border:0;border-radius:14px;padding:14px 10px;font-weight:800;cursor:pointer}.mf-spaced-rate.again{background:#f7e3e1;color:#8c2f2f}.mf-spaced-rate.hard{background:#f4ead8;color:#825b1d}.mf-spaced-rate.good{background:#e1efe7;color:#1f623e}.mf-spaced-rate.easy{background:#dcebea;color:#205d5b}.mf-spaced-manual{margin-top:22px;border-top:1px solid #E5DED2;padding-top:16px}.mf-spaced-manual summary{cursor:pointer;font-weight:800;color:#1B3B2B}.mf-spaced-manual-row{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;margin-top:12px}
   .mf-spaced-settings{background:#fff;border:1px solid #E5DED2;border-radius:22px;padding:22px;box-shadow:0 8px 26px rgba(60,48,30,.06)}.mf-spaced-form{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}.mf-spaced-form label{font-size:13px;font-weight:750;color:#1B3B2B}.mf-spaced-form input{width:100%;margin-top:7px}.mf-spaced-note{color:#6C665E;line-height:1.6;font-size:13px;margin-top:18px}.mf-spaced-msg{position:fixed;right:20px;bottom:20px;z-index:4;background:#1B3B2B;color:white;border-radius:12px;padding:12px 16px;box-shadow:0 10px 30px #0002}
   @media(max-width:850px){.mf-spaced-top{align-items:flex-start;flex-wrap:wrap}.mf-spaced-tabs{order:3;width:100%;justify-content:flex-start}.mf-spaced-hero{align-items:flex-start;flex-direction:column}.mf-spaced-actions{justify-content:flex-start}.mf-spaced-toolbar{grid-template-columns:1fr}.mf-spaced-stats{grid-template-columns:repeat(2,1fr)}.mf-domain-cards{grid-template-columns:repeat(2,1fr)}.mf-spaced-ratings{grid-template-columns:repeat(2,1fr)}.mf-spaced-form{grid-template-columns:1fr}.mf-spaced-paper{padding:26px 20px}.mf-spaced-row{grid-template-columns:38px 1fr}.mf-spaced-pill{grid-column:2}}
  `}</style>

  <header className="mf-spaced-top">
   <div className="mf-spaced-brand"><div className="mf-spaced-mark">MF</div><div><strong>Revisão Espaçada</strong><small>MEU FOCO · APOLLO 13.1</small></div></div>
   <nav className="mf-spaced-tabs">
    <button className={"mf-spaced-btn "+(tab==="bank"?"active":"")} onClick={()=>setTab("bank")}>Banco</button>
    <button className={"mf-spaced-btn "+(tab==="reader"?"active":"")} onClick={()=>setTab("reader")}>Leitura</button>
    <button className={"mf-spaced-btn "+(tab==="review"?"active":"")} onClick={()=>setTab("review")}>Revisão</button>
    <button className={"mf-spaced-btn "+(tab==="settings"?"active":"")} onClick={()=>setTab("settings")}>Configurações</button>
   </nav>
   <span className="mf-cloud-pill">{cloudStatus}</span>
   <button className="mf-spaced-btn mf-spaced-close" onClick={onClose}>Voltar ao leitor</button>
  </header>

  <main className="mf-spaced-main">
   {tab==="bank"&&<>
    <div className="mf-spaced-hero"><div><h2>Banco de questões</h2><p>Importação literal em JSON, com títulos, subtítulos e progresso separado do conteúdo.</p></div><div className="mf-spaced-actions">
     <button className="mf-spaced-btn primary" onClick={()=>fileRef.current?.click()}>Importar JSON</button>
     <button className="mf-spaced-btn" onClick={()=>{setBank(sampleBank());setReaderOrder(null);}}>Carregar exemplo</button>
     <button className="mf-spaced-btn" onClick={exportBackup}>Exportar backup</button>
     <input ref={fileRef} hidden type="file" accept=".json,application/json" onChange={e=>{const file=e.target.files?.[0];e.currentTarget.value="";if(file)void importJson(file).catch(err=>showMessage(err instanceof Error?err.message:"Falha ao importar JSON."));}}/>
    </div></div>
    <div className="mf-spaced-toolbar">
     <input className="mf-spaced-input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar pergunta, resposta, tema ou subtítulo"/>
     <select className="mf-spaced-input" value={groupFilter} onChange={e=>setGroupFilter(e.target.value)}><option value="">Todos os temas</option>{bank?.groups.map((g,i)=><option key={i} value={i}>{g.title}</option>)}</select>
     <button className="mf-spaced-btn" onClick={()=>startReview({scope:"all"})}>Embaralhar todas</button>
    </div>
    <div className="mf-spaced-stats">
     <div className="mf-spaced-stat"><span>Total</span><strong>{allQuestions.length}</strong></div>
     <div className="mf-spaced-stat"><span>Para revisar hoje</span><strong>{totalDue}</strong></div>
     <div className="mf-spaced-stat"><span>Temas</span><strong>{bank?.groups.length||0}</strong></div>
     <div className="mf-spaced-stat"><span>Revisões realizadas</span><strong>{totalReviews}</strong></div>
    </div>
    {bank&&<section className="mf-domain">
     <div className="mf-domain-head"><div><h3>Mapa de domínio</h3><p>Clique em uma cor para revisar somente aquele grupo.</p></div><button className="mf-spaced-btn" onClick={()=>startCustomReview(allQuestions.filter(q=>performanceOf(q)==="again"||performanceOf(q)==="hard"))}>Revisar erros + difíceis</button></div>
     <div className="mf-domain-cards">
      <button className="mf-domain-card unseen" onClick={()=>startCustomReview(allQuestions.filter(q=>performanceOf(q)==="unseen"))}><span>NÃO REVISADAS</span><strong>{performanceCounts.unseen}</strong></button>
      <button className="mf-domain-card again" onClick={()=>startCustomReview(allQuestions.filter(q=>performanceOf(q)==="again"))}><span>ERRADAS</span><strong>{performanceCounts.again}</strong></button>
      <button className="mf-domain-card hard" onClick={()=>startCustomReview(allQuestions.filter(q=>performanceOf(q)==="hard"))}><span>DIFÍCEIS / DÚVIDA</span><strong>{performanceCounts.hard}</strong></button>
      <button className="mf-domain-card good" onClick={()=>startCustomReview(allQuestions.filter(q=>performanceOf(q)==="good"))}><span>LEMBRADAS</span><strong>{performanceCounts.good}</strong></button>
      <button className="mf-domain-card easy" onClick={()=>startCustomReview(allQuestions.filter(q=>performanceOf(q)==="easy"))}><span>DOMINADAS</span><strong>{performanceCounts.easy}</strong></button>
     </div>
     <div className="mf-domain-grid" aria-label="Mapa das questões">{allQuestions.map(q=><button key={q.id} className={"mf-domain-dot "+performanceOf(q)} title={"Questão "+q.order+" · "+q.question} onClick={()=>startCustomReview([q])}/>)}</div>
    </section>}
    {!bank&&<div className="mf-spaced-empty"><h3>Nenhum banco importado</h3><p>Importe o JSON criado no ChatGPT ou carregue o exemplo.</p></div>}
    {bank&&<div className="mf-spaced-tree">{filteredGroups.map(group=><article className="mf-spaced-group" key={group.index}>
     <div className="mf-spaced-group-head"><div><h3>{group.title}</h3><small>{group.sections.reduce((n,s)=>n+s.questions.length,0)} perguntas</small></div><button className="mf-spaced-btn" onClick={()=>startReview({scope:"group",group:String(group.index)})}>Revisar embaralhado</button></div>
     {group.sections.map((section,si)=><section className="mf-spaced-section" key={si}>{section.title&&<h4>{section.title}</h4>}{section.questions.map(q=><div className="mf-spaced-row" key={q.id}><div className="n">{String(q.order).padStart(3,"0")}</div><div><b>{q.question}</b><p>{q.answer}</p></div><span className="mf-spaced-pill">{q.review.nextReview?"Próxima: "+formatDate(q.review.nextReview):"Nova"}</span></div>)}</section>)}
    </article>)}</div>}
   </>}

   {tab==="reader"&&<>
    <div className="mf-spaced-hero"><div><h2>Leitura contínua</h2><p>Todas as perguntas e respostas em sequência, como uma apostila.</p></div><div className="mf-spaced-actions">
     <button className="mf-spaced-btn" onClick={()=>setReaderOrder(shuffle(allQuestions).map(q=>q.id))}>Embaralhar leitura</button>
     <button className="mf-spaced-btn" onClick={()=>setReaderOrder(null)}>Ordem original</button>
     <button className="mf-spaced-btn primary" onClick={printReader}>Imprimir / Salvar PDF</button>
    </div></div>
    <article className="mf-spaced-paper">{bank?<><h1>{bank.title}</h1><div className="meta">{readerQuestions.length} perguntas e respostas</div>{readerQuestions.map(q=><section className="q" key={q.id}><div className="n">QUESTÃO {String(q.order).padStart(3,"0")} · {q.groupTitle}{q.sectionTitle?" · "+q.sectionTitle:""}</div><div className="qq">{q.question}</div><div className="aa">{q.answer}</div></section>)}</>:<div className="mf-spaced-empty">Importe um banco primeiro.</div>}</article>
   </>}

   {tab==="review"&&<>
    <div className="mf-spaced-hero"><div><h2>Revisão</h2><p>Recuperação ativa com resposta inicialmente oculta e intervalo configurável.</p></div><div className="mf-spaced-actions">
     <select className="mf-spaced-input" value={reviewScope} onChange={e=>setReviewScope(e.target.value as any)}><option value="due">Somente vencidas</option><option value="all">Todas as perguntas</option><option value="group">Tema selecionado</option></select>
     <select className="mf-spaced-input" value={reviewGroup} onChange={e=>setReviewGroup(e.target.value)}><option value="">Escolha um tema</option>{bank?.groups.map((g,i)=><option key={i} value={i}>{g.title}</option>)}</select>
     <button className="mf-spaced-btn primary" onClick={()=>startReview()}>Começar revisão</button>
    </div></div>
    {!current&&<div className="mf-spaced-empty"><h3>{queue.length?"Revisão concluída":"Nenhuma sessão iniciada"}</h3><p>{queue.length?"Você terminou esta sessão.":"Escolha o escopo e clique em Começar revisão."}</p></div>}
    {current&&<div className="mf-spaced-review"><div className="mf-spaced-review-top"><span>{queueIndex+1} / {queue.length}</span><span>{current.groupTitle}{current.sectionTitle?" · "+current.sectionTitle:""}</span></div><article className="mf-spaced-card">
     <div className="mf-spaced-label">PERGUNTA</div><h3>{current.question}</h3>
     {answerShown?<><div className="mf-spaced-answer"><div className="mf-spaced-label">RESPOSTA</div>{current.answer}</div><div className="mf-spaced-ratings">
      <button className="mf-spaced-rate again" onClick={()=>rate("again")}>Não lembrei</button><button className="mf-spaced-rate hard" onClick={()=>rate("hard")}>Difícil</button><button className="mf-spaced-rate good" onClick={()=>rate("good")}>Lembrei</button><button className="mf-spaced-rate easy" onClick={()=>rate("easy")}>Muito fácil</button>
     </div></>:<button className="mf-spaced-btn primary mf-spaced-wide" onClick={()=>setAnswerShown(true)}>Mostrar resposta</button>}
     <details className="mf-spaced-manual"><summary>Ajustar esta pergunta manualmente</summary><div className="mf-spaced-manual-row"><input className="mf-spaced-input" type="number" min={1} value={manualValue} onChange={e=>setManualValue(Number(e.target.value))}/><select className="mf-spaced-input" value={manualUnit} onChange={e=>setManualUnit(e.target.value as any)}><option value="minutes">minutos</option><option value="hours">horas</option><option value="days">dias</option><option value="weeks">semanas</option></select><button className="mf-spaced-btn" onClick={scheduleManual}>Agendar</button></div></details>
    </article></div>}
   </>}

   {tab==="settings"&&<>
    <div className="mf-spaced-hero"><div><h2>Configurações da repetição</h2><p>O sistema agenda automaticamente, mas você controla os limites e pode sobrescrever uma pergunta individual.</p></div></div>
    <div className="mf-spaced-settings">
     <div className="mf-spaced-form">
      <label>“Não lembrei” volta em minutos<input className="mf-spaced-input" type="number" min={1} value={settings.againMinutes} onChange={e=>setSettings({...settings,againMinutes:Number(e.target.value)})}/></label>
      <label>Intervalo mínimo “Difícil” em dias<input className="mf-spaced-input" type="number" min={1} value={settings.hardDays} onChange={e=>setSettings({...settings,hardDays:Number(e.target.value)})}/></label>
      <label>Intervalo mínimo “Lembrei” em dias<input className="mf-spaced-input" type="number" min={1} value={settings.goodDays} onChange={e=>setSettings({...settings,goodDays:Number(e.target.value)})}/></label>
      <label>Intervalo mínimo “Muito fácil” em dias<input className="mf-spaced-input" type="number" min={1} value={settings.easyDays} onChange={e=>setSettings({...settings,easyDays:Number(e.target.value)})}/></label>
      <label>Multiplicador de crescimento<input className="mf-spaced-input" type="number" min={1.1} step={0.1} value={settings.growthFactor} onChange={e=>setSettings({...settings,growthFactor:Number(e.target.value)})}/></label>
      <label>Intervalo máximo em dias<input className="mf-spaced-input" type="number" min={30} value={settings.maxDays} onChange={e=>setSettings({...settings,maxDays:Number(e.target.value)})}/></label>
     </div>
     <div className="mf-spaced-actions" style={{marginTop:22,justifyContent:"flex-start"}}><button className="mf-spaced-btn primary" onClick={saveSettingsNow}>Salvar configurações</button><button className="mf-spaced-btn" onClick={()=>{setSettings(DEFAULT_SETTINGS);localStorage.setItem(SETTINGS_KEY,JSON.stringify(DEFAULT_SETTINGS));}}>Restaurar padrão</button><button className="mf-spaced-btn danger" onClick={clearProgress}>Limpar somente progresso</button></div>
     <p className="mf-spaced-note">O conteúdo das perguntas e respostas permanece separado do histórico de revisão. Quando você está conectado à sua conta, banco, progresso e configurações são sincronizados automaticamente na nuvem; o navegador mantém também uma cópia local.</p>
    </div>
   </>}
  </main>
  {message&&<div className="mf-spaced-msg">{message}</div>}
 </div>;
}
