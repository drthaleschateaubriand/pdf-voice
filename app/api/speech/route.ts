import { env } from 'cloudflare:workers';
// Two speech engines, chosen per request by the reader: Cartesia Sonic 3.6 (key SONIC) and OpenAI gpt-4o-mini-tts (key OPENAI).
// The tables are mirrored in desktop/server.cjs, which ships standalone inside the macOS app.
const providers={
 openai:{name:'OpenAI',model:'gpt-4o-mini-tts',variable:'OPENAI',voices:['marin','cedar','coral','alloy','ash','ballad','echo','fable','nova','onyx','sage','shimmer','verse'].map(v=>[v,v[0].toUpperCase()+v.slice(1)])},
 cartesia:{name:'Cartesia',model:'sonic-3.6',variable:'SONIC',voices:[['694f9389-aac1-45b6-b726-9d9369183238','Sarah'],['b24f41fd-00a3-4cd8-992a-a0c9f13f3ef1','Clive'],['aa2cafe9-97ba-4052-ac3c-875000f95212','Zander'],['5568a7df-e5ab-4442-9fae-2e9ba1b15ad8','Quentin'],['8c254787-4eb4-4577-bd3d-fb3c273baea2','Rowan'],['47c38ca4-5f35-497b-b1a3-415245fb35e1','Daniel'],['ef191366-f52f-447a-a398-ed8c0f2943a1','Archie'],['a33f7a4c-100f-41cf-a1fd-5822e8fc253f','Lauren'],['7348f896-8516-4382-9c8f-ad2aee1ffedc','Naledi'],['273f9ef7-9fc2-4def-88bb-ab108c6249ca','Julia'],['db6b0ed5-d5d3-463d-ae85-518a07d3c2b4','Skylar'],['62ae83ad-4f6a-430b-af41-a9bede9286ca','Gemma'],['9626c31c-bec5-4cca-baa8-f8ba9e84c8bc','Jacqueline'],['d1d9c946-7cfc-4378-85a4-07d09827cb7e','Jolene']]},
} as const;
type Provider=keyof typeof providers;
function configuredKey(provider:Provider){const value=(env as Record<string,unknown>)[providers[provider].variable];return typeof value==='string'&&value.trim()?value.trim():'';}
// Cartesia caps concurrent generations per account (2 on the free plan) and the reader requests up to three passages at once.
// Workers cannot share a queue across requests, so a concurrency 429 is retried briefly instead.
async function retrying(request:()=>Promise<Response>,signal:AbortSignal):Promise<Response>{
 for(let attempt=0;;attempt++){
  const response=await request();
  if(response.status!==429||attempt>=8)return response;
  await response.body?.cancel();
  await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,400*(attempt+1));signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});});
 }
}
export async function GET(){return Response.json({providers:(Object.keys(providers) as Provider[]).map(id=>({id,name:providers[id].name,model:providers[id].model,configured:Boolean(configuredKey(id)),voices:providers[id].voices.map(([value,name])=>({id:value,name}))}))});}
export async function POST(request:Request){
 const origin=request.headers.get('origin');
 if(origin && origin!==new URL(request.url).origin)return Response.json({error:'Request origin not allowed.'},{status:403});
 try{
  if(Number(request.headers.get('content-length'))>16000)return Response.json({error:'Passage too large.'},{status:413});
  const {provider='openai',text,voice,key}=await request.json() as {provider?:unknown;text:unknown;voice?:unknown;key?:unknown};
  if(typeof provider!=='string'||!(provider in providers))return Response.json({error:'Unknown speech engine.'},{status:400});
  const engine=providers[provider as Provider],name=engine.name;
  const apiKey=configuredKey(provider as Provider)||(typeof key==='string'?key.trim():'');
  if(!apiKey)return Response.json({error:`Add your ${name} API key to begin listening.`},{status:401});
  if(typeof text!=='string'||!text.trim()||text.length>4096||typeof voice!=='string'||!engine.voices.some(([id])=>id===voice))return Response.json({error:'Provide a passage of 1–4096 characters and a supported voice.'},{status:400});
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(90000)]);
  const response=provider==='cartesia'
   ?await retrying(()=>fetch('https://api.cartesia.ai/tts/bytes',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Cartesia-Version':'2026-08-14','Content-Type':'application/json'},body:JSON.stringify({model_id:engine.model,transcript:text,voice:{mode:'id',id:voice},language:'en',output_format:{container:'mp3',sample_rate:44100,bit_rate:128000}}),signal}),signal)
   :await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:engine.model,voice,input:text,response_format:'mp3',instructions:'Leia integralmente o texto fornecido, exatamente uma vez, do início ao fim. Não pule, não resuma, não reorganize, não parafraseie e não omita nenhuma palavra ou frase. Use português do Brasil, dicção clara, ritmo calmo e natural, respeite a pontuação e pronuncie siglas com clareza. Não acrescente comentários.'}),signal});
  if(!response.ok){const status=response.status;return Response.json({error:status===401?`${name} rejected the API key.`:status===402?`${name} credits are used up. Check the plan, then try again.`:status===429?`${name} quota, concurrency or rate limit reached. Check the plan, then try again.`:`${name} speech request failed (${status}). Try again.`},{status});}
  // Buffer the upstream body completely before returning 200. This prevents a
  // prematurely closed upstream stream from being accepted and cached as a valid MP3.
  const audio=await response.arrayBuffer();
  if(audio.byteLength<1024)return Response.json({error:'Speech generation returned incomplete audio. Please try again.'},{status:502});
  return new Response(audio,{headers:{'Content-Type':'audio/mpeg','Content-Length':String(audio.byteLength),'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Speech generation failed or timed out. Please try again.'},{status:502});}
}
