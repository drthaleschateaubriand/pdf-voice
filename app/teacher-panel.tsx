"use client";
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {getCloudSession} from './paper-cloud';
import {DEFAULT_TEACHERS,METHODS,PERSONALITIES,buildTeacherInstructions,loadSelectedTeacherId,loadTeacherProfiles,storeTeacherProfiles,type TeacherContext,type TeacherProfile} from './teacher-profiles';

type ChatLine={id:number;role:'user'|'assistant';text:string};
type ServerEvent={type?:string;delta?:string;transcript?:string;response_id?:string;error?:{message?:string};response?:{id?:string}};
const btn:CSSProperties={border:'1px solid #d9cfc0',background:'white',color:'#1B3B2B',borderRadius:12,padding:'10px 12px',fontSize:14,letterSpacing:0,cursor:'pointer'};
const accent:CSSProperties={...btn,background:'#1B3B2B',color:'white',borderColor:'#1B3B2B',fontWeight:700};
const label:CSSProperties={display:'grid',gap:5,fontSize:13,fontWeight:700,color:'#263f34'};
const inputStyle:CSSProperties={border:'1px solid #d9cfc0',borderRadius:10,padding:'10px 12px',fontSize:14,width:'100%',boxSizing:'border-box',background:'white',color:'#263f34'};
const group:CSSProperties={border:'1px solid #e2dacd',borderRadius:14,padding:12,display:'grid',gap:12,background:'#fffdf9'};
let messageSequence=0;

export default function TeacherPanel({context,onClose,onResume,onLogin,isLoggedIn}:{context:TeacherContext;onClose:()=>void;onResume:()=>void;onLogin:()=>void;isLoggedIn:boolean}){
 const [profiles,setProfiles]=useState<TeacherProfile[]>(loadTeacherProfiles);
 const [chosen,setChosen]=useState(loadSelectedTeacherId);
 const [messages,setMessages]=useState<ChatLine[]>([]);
 const [question,setQuestion]=useState('');
 const [status,setStatus]=useState('Pronto para conversar');
 const [error,setError]=useState('');
 const [connected,setConnected]=useState(false);
 const [busy,setBusy]=useState(false);
 const [micEnabled,setMicEnabled]=useState(false);
 const [soundEnabled,setSoundEnabled]=useState(true);
 const [playbackBlocked,setPlaybackBlocked]=useState(false);
 const [settingsOpen,setSettingsOpen]=useState(false);
 const peerRef=useRef<RTCPeerConnection|null>(null);
 const channelRef=useRef<RTCDataChannel|null>(null);
 const microphoneRef=useRef<MediaStream|null>(null);
 const outputRef=useRef<HTMLAudioElement|null>(null);
 const responseRef=useRef('');
 const profile=profiles.find(p=>p.id===chosen)||profiles[0]||DEFAULT_TEACHERS[0];
 const instructions=buildTeacherInstructions(profile,context);

 useEffect(()=>{storeTeacherProfiles(profiles,chosen);},[profiles,chosen]);
 useEffect(()=>{
  const dc=channelRef.current;
  if(dc?.readyState==='open')dc.send(JSON.stringify({type:'session.update',session:{type:'realtime',instructions}}));
 },[instructions]);

 useEffect(()=>()=>{
  channelRef.current?.close();peerRef.current?.close();
  microphoneRef.current?.getTracks().forEach(t=>t.stop());
  if(outputRef.current){outputRef.current.pause();outputRef.current.srcObject=null;}
 },[]);

 function disconnect(){
  channelRef.current?.close();channelRef.current=null;
  peerRef.current?.close();peerRef.current=null;
  microphoneRef.current?.getTracks().forEach(t=>t.stop());microphoneRef.current=null;
  if(outputRef.current){outputRef.current.pause();outputRef.current.srcObject=null;outputRef.current=null;}
  responseRef.current='';
  setConnected(false);setMicEnabled(false);
 }
 function updateProfile<K extends keyof TeacherProfile>(key:K,value:TeacherProfile[K]){
  setProfiles(old=>old.map(p=>p.id===profile.id?{...p,[key]:value}:p));
 }
 function createProfile(){
  if(profiles.length>=30){setError('Limite de 30 perfis neste aparelho.');return;}
  const id='personalizado-'+Date.now().toString(36);
  const next={...profile,id,name:'Meu professor personalizado'};
  setProfiles(old=>[...old,next]);setChosen(id);setSettingsOpen(true);
 }
 function deleteProfile(){
  if(profiles.length===1)return;
  const next=profiles.filter(p=>p.id!==chosen);
  setProfiles(next);setChosen(next[0].id);
 }
 function handleServerEvent(event:ServerEvent){
  if(event.type==='error'){setError(event.error?.message||'A API Realtime retornou um erro.');setStatus('Erro de conexão');return;}
  if(event.type==='input_audio_buffer.speech_started'){setStatus('Ouvindo sua pergunta...');return;}
  if(event.type==='input_audio_buffer.speech_stopped'){setStatus('Preparando a resposta...');return;}
  if(event.type==='conversation.item.input_audio_transcription.completed'&&event.transcript?.trim()){
   setMessages(old=>[...old.slice(-60),{id:++messageSequence,role:'user',text:event.transcript!.trim()}]);return;
  }
  if(event.type==='response.created'){setStatus('Professor respondendo...');return;}
  if(event.type==='response.output_audio_transcript.delta'&&typeof event.delta==='string'){
   const id=event.response_id||'speech';
   setMessages(old=>{
    if(responseRef.current===id&&old.length&&old[old.length-1].role==='assistant'){
     return old.map((line,i)=>i===old.length-1?{...line,text:line.text+event.delta}:line);
    }
    responseRef.current=id;
    return [...old.slice(-60),{id:++messageSequence,role:'assistant',text:event.delta||''}];
   });return;
  }
  if(event.type==='response.output_audio_transcript.done'&&typeof event.transcript==='string'){
   const id=event.response_id||'speech';
   setMessages(old=>{
    if(responseRef.current===id&&old.length&&old[old.length-1].role==='assistant')
     return old.map((line,i)=>i===old.length-1?{...line,text:event.transcript!}:line);
    responseRef.current=id;
    return [...old.slice(-60),{id:++messageSequence,role:'assistant',text:event.transcript!}];
   });return;
  }
  if(event.type==='response.done')setStatus('Pode perguntar novamente');
 }
 async function connect(withMicrophone:boolean):Promise<RTCDataChannel>{
  const existing=channelRef.current;
  if(existing?.readyState==='open'&&(!withMicrophone||Boolean(microphoneRef.current)))return existing;
  // A text-only session can be upgraded to microphone by reconnecting.
  // Save the visible transcript so the new session retains recent discussion context.
  disconnect();setError('');setBusy(true);setStatus('Conectando ao professor...');
  try{
   if(!window.RTCPeerConnection)throw new Error('Este navegador não suporta conversas Realtime por WebRTC.');
   let stream:MediaStream|null=null;
   if(withMicrophone){
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microfone não disponível neste navegador.');
    stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
    microphoneRef.current=stream;
   }
   const session=await getCloudSession();
   if(!session?.access_token)throw new Error('Entre na sua conta Meu Foco para conversar com o professor.');
   const tokenResponse=await fetch('/api/teacher-session',{
    method:'POST',cache:'no-store',headers:{Authorization:'Bearer '+session.access_token}
   });
   const tokenData=await tokenResponse.json() as {value?:string;error?:string};
   if(!tokenResponse.ok||!tokenData.value)throw new Error(tokenData.error||'Não foi possível autenticar a API Realtime.');
   const pc=new RTCPeerConnection();peerRef.current=pc;
   const audio=new Audio();audio.autoplay=true;audio.setAttribute('playsinline','true');audio.muted=!soundEnabled;outputRef.current=audio;
   pc.ontrack=event=>{
    audio.srcObject=event.streams[0]||new MediaStream([event.track]);
    void audio.play().then(()=>setPlaybackBlocked(false)).catch(()=>{setPlaybackBlocked(true);setStatus('Toque em Reproduzir áudio para ouvir o professor.');});
   };
   if(stream){stream.getAudioTracks().forEach(track=>pc.addTrack(track,stream));}
   else pc.addTransceiver('audio',{direction:'recvonly'});
   const dc=pc.createDataChannel('oai-events');channelRef.current=dc;
   dc.onmessage=event=>{try{handleServerEvent(JSON.parse(String(event.data)) as ServerEvent);}catch{}};
   dc.onclose=()=>{if(channelRef.current===dc){setConnected(false);setStatus('Conversa desconectada');}};
   const offer=await pc.createOffer();await pc.setLocalDescription(offer);
   const answer=await fetch('https://api.openai.com/v1/realtime/calls',{
    method:'POST',headers:{Authorization:'Bearer '+tokenData.value,'Content-Type':'application/sdp'},body:offer.sdp
   });
   if(!answer.ok)throw new Error('Falha no WebRTC da OpenAI ('+answer.status+').');
   await pc.setRemoteDescription({type:'answer',sdp:await answer.text()});
   await new Promise<void>((resolve,reject)=>{
    if(dc.readyState==='open'){resolve();return;}
    const timeout=window.setTimeout(()=>reject(new Error('Tempo limite para abrir o canal de conversa.')),15000);
    dc.addEventListener('open',()=>{clearTimeout(timeout);resolve();},{once:true});
    dc.addEventListener('error',()=>{clearTimeout(timeout);reject(new Error('Erro ao abrir canal Realtime.'));},{once:true});
   });
   const summary=messages.slice(-10).map(m=>(m.role==='user'?'Aluno: ':'Professor: ')+m.text.slice(0,400)).join('\n');
   dc.send(JSON.stringify({type:'session.update',session:{
    type:'realtime',instructions:instructions+(summary?'\nHistórico recente da conversa anterior:\n'+summary:''),
    output_modalities:['audio'],
    audio:{input:{turn_detection:{type:'semantic_vad',create_response:true,interrupt_response:true},transcription:{model:'gpt-live-transcribe',languages:['pt']}}}
   }}));
   setConnected(true);setMicEnabled(Boolean(stream));setStatus(stream?'Professor conectado. Pode falar.':'Professor conectado. Digite sua pergunta.');
   return dc;
  }catch(err){
   disconnect();const message=err instanceof Error?err.message:'Falha ao conectar.';
   setError(message);setStatus('Não foi possível conectar');throw err;
  }finally{setBusy(false);}
 }
 async function submitQuestion(){
  const text=question.trim();if(!text||busy)return;
  setQuestion('');setMessages(old=>[...old.slice(-60),{id:++messageSequence,role:'user',text}]);
  try{
   const dc=await connect(false);
   dc.send(JSON.stringify({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text}]}}));
   dc.send(JSON.stringify({type:'response.create',response:{output_modalities:['audio']}}));
   setStatus('Professor respondendo...');
  }catch{setQuestion(text);}
 }
 async function enableVoice(){
  if(microphoneRef.current){
   const next=!micEnabled;
   microphoneRef.current.getAudioTracks().forEach(track=>{track.enabled=next;});
   setMicEnabled(next);setStatus(next?'Microfone ativo. Pode falar.':'Microfone desligado.');
   return;
  }
  try{await connect(true);}catch{}
 }
 function restoreAudio(){
  const audio=outputRef.current;
  if(!audio)return;
  audio.muted=false;setSoundEnabled(true);
  void audio.play().then(()=>{setPlaybackBlocked(false);setStatus('Áudio do professor liberado');}).catch(()=>setError('O Safari bloqueou o áudio. Toque novamente para liberar.'));
 }
 function toggleSound(){
  const next=!soundEnabled;setSoundEnabled(next);
  if(outputRef.current){outputRef.current.muted=!next;if(next)void outputRef.current.play().catch(()=>{});}
 }
 function finish(resume:boolean){
  disconnect();if(resume)onResume();else onClose();
 }
 const isLocalProfile=profile.id.startsWith('personalizado-');
 const checkbox=(name:keyof Pick<TeacherProfile,'before'|'after'|'reveal'|'examples'>,caption:string)=>
  <label key={name} style={{display:'flex',alignItems:'center',gap:10,fontSize:14,fontWeight:500,color:'#263f34'}}>
   <input type="checkbox" checked={profile[name]} onChange={e=>updateProfile(name,e.target.checked)} style={{width:18,height:18,accentColor:'#1B3B2B'}}/>{caption}
  </label>;
 return <div role="dialog" aria-modal="true" aria-label="Professor IA" style={{position:'fixed',inset:0,zIndex:100,display:'flex',justifyContent:'flex-end',background:'rgba(13,25,19,.48)'}}>
  <section style={{width:'min(560px,100vw)',height:'100%',overflowY:'auto',boxSizing:'border-box',padding:'calc(16px + env(safe-area-inset-top,0px)) 18px calc(24px + env(safe-area-inset-bottom,0px))',background:'#F7F3EB',boxShadow:'-12px 0 45px #13281d48',color:'#1B1B1C'}}>
   <header style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:10,marginBottom:15}}>
    <div><div style={{fontFamily:'Georgia,serif',fontSize:27,fontWeight:800,color:'#1B3B2B'}}>Professor IA</div><div style={{fontSize:12,color:'#766d61'}}>Apollo 14 · Conversa por voz com o livro aberto</div></div>
    <button type="button" onClick={()=>finish(false)} style={btn}>Fechar</button>
   </header>
   <div style={{...group,marginBottom:12,background:'#e7eee7',borderColor:'#ccd9ce'}}>
    <div style={{fontSize:12,fontWeight:800,color:'#2c4d35'}}>CONTEXTO DA LEITURA</div>
    <div style={{fontWeight:700,fontSize:14}}>{context.title} · {context.location}</div>
    <div style={{fontSize:13,lineHeight:1.5,color:'#4a5549'}}>{context.selection||context.passage||'Texto não disponível na página.'}</div>
   </div>
   <details open={settingsOpen} onToggle={e=>setSettingsOpen(e.currentTarget.open)} style={{...group,marginBottom:12}}>
    <summary style={{fontWeight:800,fontSize:16,cursor:'pointer',color:'#1B3B2B'}}>Personalidade e método de ensino</summary>
    <div style={{display:'flex',gap:7,alignItems:'center',flexWrap:'wrap'}}>
     <select aria-label="Perfil do professor" value={profile.id} onChange={e=>setChosen(e.target.value)} style={{...inputStyle,flex:'1 1 180px',width:'auto'}}>
      {profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
     </select>
     <button type="button" style={btn} onClick={createProfile}>Criar cópia</button>
     <button type="button" style={btn} disabled={!isLocalProfile} onClick={deleteProfile}>Excluir</button>
    </div>
    <label style={label}>Nome do professor
     <input style={inputStyle} maxLength={70} value={profile.name} onChange={e=>updateProfile('name',e.target.value)}/>
    </label>
    <label style={label}>Personalidade
     <select style={inputStyle} value={profile.personality} onChange={e=>updateProfile('personality',e.target.value as TeacherProfile['personality'])}>
      {Object.entries(PERSONALITIES).map(([id,name])=><option key={id} value={id}>{name}</option>)}
     </select>
    </label>
    <label style={label}>Método de ensino
     <select style={inputStyle} value={profile.method} onChange={e=>updateProfile('method',e.target.value as TeacherProfile['method'])}>
      {Object.entries(METHODS).map(([id,name])=><option key={id} value={id}>{name}</option>)}
     </select>
    </label>
    {checkbox('before','Fazer pergunta de sondagem antes de explicar')}
    {checkbox('reveal','Dizer a resposta e explicar o raciocínio')}
    {checkbox('examples','Dar exemplos práticos')}
    {checkbox('after','Fazer perguntas de reforço depois da explicação')}
    <label style={label}>Instruções livres
     <textarea style={{...inputStyle,resize:'vertical',minHeight:100,lineHeight:1.4}} maxLength={2000} value={profile.custom} onChange={e=>updateProfile('custom',e.target.value)} placeholder="Descreva como o professor deve conversar, perguntar e explicar."/>
    </label>
    <div style={{fontSize:12,color:'#766d61'}}>Alterações salvas automaticamente neste aparelho e enviadas ao professor durante a conversa.</div>
   </details>
   <div style={{...group,marginBottom:12}}>
    {!isLoggedIn&&<div style={{borderRadius:12,padding:12,background:'#ffedcd',color:'#744c15',fontSize:13}}>Para usar a conversa por voz, entre na sua conta do Meu Foco. As configurações do professor podem ser editadas antes de entrar.<button type="button" style={{...accent,display:'block',marginTop:9}} onClick={onLogin}>Entrar na minha conta</button></div>}
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap'}}>
     <strong style={{fontSize:14}}>Conversa</strong>
     <span role="status" style={{fontSize:12,color:'#496858'}}>{status}</span>
    </div>
    <div style={{display:'flex',gap:7,flexWrap:'wrap'}}>
     <button type="button" disabled={busy||!isLoggedIn} style={micEnabled?accent:btn} onClick={()=>void enableVoice()}>{busy?'Conectando...':micEnabled?'Silenciar microfone':'Levantar a mão · Falar'}</button>
     <button type="button" style={btn} onClick={toggleSound}>{soundEnabled?'Silenciar áudio':'Ativar áudio'}</button>
     {playbackBlocked&&<button type="button" style={accent} onClick={restoreAudio}>Reproduzir áudio</button>}
     {connected&&<button type="button" style={btn} onClick={()=>{disconnect();setStatus('Conversa encerrada');}}>Desconectar</button>}
    </div>
    <div aria-live="polite" style={{minHeight:116,maxHeight:'30dvh',overflowY:'auto',background:'#fbf9f4',border:'1px solid #e8e0d3',borderRadius:12,padding:10,display:'grid',alignContent:'start',gap:9}}>
     {messages.length===0&&<p style={{fontSize:13,lineHeight:1.5,margin:0,color:'#7a736a'}}>Você pode perguntar falando ou digitando. O professor responderá em voz natural com base no trecho e nas suas preferências.</p>}
     {messages.map(m=><div key={m.id} style={{justifySelf:m.role==='user'?'end':'start',maxWidth:'94%',borderRadius:12,padding:'9px 11px',background:m.role==='user'?'#e6efe9':'#efe9dd',fontSize:14,lineHeight:1.5,whiteSpace:'pre-wrap'}}><strong>{m.role==='user'?'Aluno':'Professor'}</strong><div>{m.text}</div></div>)}
    </div>
    <form onSubmit={e=>{e.preventDefault();void submitQuestion();}} style={{display:'flex',gap:7}}>
     <input value={question} onChange={e=>setQuestion(e.target.value)} aria-label="Pergunte ao professor" placeholder="Escreva sua pergunta..." style={{...inputStyle,flex:1,minWidth:0}} maxLength={1800}/>
     <button type="submit" disabled={!question.trim()||busy||!isLoggedIn} style={accent}>Enviar</button>
    </form>
    {error&&<p role="alert" style={{fontSize:13,color:'#a23d32',margin:0}}>{error}</p>}
    <div style={{fontSize:11,color:'#766d61'}}>A voz utiliza a API Realtime da OpenAI. Requer internet, permissão do microfone para perguntas faladas e chave da API configurada no servidor. O texto da página e suas perguntas são enviados à OpenAI durante a conversa.</div>
   </div>
   <button type="button" style={{...accent,width:'100%',padding:14,fontSize:16}} onClick={()=>finish(true)}>Retomar leitura do ponto pausado</button>
  </section>
 </div>;
}
