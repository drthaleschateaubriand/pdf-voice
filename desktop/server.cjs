const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {parseEnv}=require('node:util');
// Two speech engines, chosen per request by the reader: Cartesia Sonic 3.6 (key SONIC) and OpenAI gpt-4o-mini-tts (key OPENAI).
// The tables mirror app/api/speech/route.ts; this file ships standalone inside the macOS app.
const providers={
 openai:{name:'OpenAI',model:'gpt-4o-mini-tts',variable:'OPENAI',voices:['marin','cedar','coral','alloy','ash','ballad','echo','fable','nova','onyx','sage','shimmer','verse'].map(v=>[v,v[0].toUpperCase()+v.slice(1)])},
 cartesia:{name:'Cartesia',model:'sonic-3.6',variable:'SONIC',voices:[['694f9389-aac1-45b6-b726-9d9369183238','Sarah'],['b24f41fd-00a3-4cd8-992a-a0c9f13f3ef1','Clive'],['aa2cafe9-97ba-4052-ac3c-875000f95212','Zander'],['5568a7df-e5ab-4442-9fae-2e9ba1b15ad8','Quentin'],['8c254787-4eb4-4577-bd3d-fb3c273baea2','Rowan'],['47c38ca4-5f35-497b-b1a3-415245fb35e1','Daniel'],['ef191366-f52f-447a-a398-ed8c0f2943a1','Archie'],['a33f7a4c-100f-41cf-a1fd-5822e8fc253f','Lauren'],['7348f896-8516-4382-9c8f-ad2aee1ffedc','Naledi'],['273f9ef7-9fc2-4def-88bb-ab108c6249ca','Julia'],['db6b0ed5-d5d3-463d-ae85-518a07d3c2b4','Skylar'],['62ae83ad-4f6a-430b-af41-a9bede9286ca','Gemma'],['9626c31c-bec5-4cca-baa8-f8ba9e84c8bc','Jacqueline'],['d1d9c946-7cfc-4378-85a4-07d09827cb7e','Jolene']]},
};
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.pdf':'application/pdf','.bcmap':'application/octet-stream','.ttf':'font/ttf','.pfb':'application/octet-stream'};
function configuredKey(provider){try{const value=parseEnv(fs.readFileSync(path.join(os.homedir(),'.env'),'utf8'))[providers[provider].variable];return typeof value==='string'?value.trim():'';}catch{return '';}}
// Cartesia caps concurrent generations per account (2 on the free plan) and counts one until its audio has been fully
// streamed; the reader requests up to three passages at once, so requests queue here and hold a slot until the response is sent.
let active=0;const waiting=[];
async function acquire(limit){
 if(active>=limit)await new Promise(resolve=>waiting.push(resolve));
 active++;let released=false;return ()=>{if(released)return;released=true;active--;const next=waiting.shift();if(next)next();};
}
// A concurrency 429 can still occur if the same key is in use elsewhere; retry briefly before reporting it.
async function retrying(request,signal){
 for(let attempt=0;;attempt++){
  const response=await request();
  if(response.status!==429||attempt>=8)return response;
  await response.body?.cancel();
  await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,400*(attempt+1));signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});});
 }
}
async function startServer(root,preferredPort=0){
 let origin;
 const server=http.createServer(async(req,res)=>{
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try{
   if(req.headers.host!==new URL(origin).host)return json(403,{error:'Invalid host.'});
   if(req.headers.origin&&req.headers.origin!==origin)return json(403,{error:'Invalid origin.'});
   const pathname=new URL(req.url,origin).pathname;
   if(pathname==='/api/speech'){
    if(req.method==='GET')return json(200,{providers:Object.keys(providers).map(id=>({id,name:providers[id].name,model:providers[id].model,configured:Boolean(configuredKey(id)),voices:providers[id].voices.map(([value,name])=>({id:value,name}))}))});
    if(req.method!=='POST')return json(405,{error:'Method not allowed.'});
    let body='',size=0;for await(const chunk of req){size+=chunk.length;if(size>16000)return json(413,{error:'Passage too large.'});body+=chunk;}
    let payload;try{payload=JSON.parse(body);}catch{return json(400,{error:'Invalid request.'});}
    const {provider='openai',text,voice,key}=payload||{};
    if(typeof provider!=='string'||!Object.hasOwn(providers,provider))return json(400,{error:'Unknown speech engine.'});
    const engine=providers[provider],name=engine.name;
    const apiKey=configuredKey(provider)||(typeof key==='string'?key.trim():'');
    if(!apiKey)return json(401,{error:`Add your ${name} API key to begin listening.`});
    if(typeof text!=='string'||!text.trim()||text.length>4096||typeof voice!=='string'||!engine.voices.some(([id])=>id===voice))return json(400,{error:'Invalid text or voice.'});
    const abort=new AbortController();res.on('close',()=>abort.abort());
    const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(90000)]);
    const release=provider==='cartesia'?await acquire(2):()=>{};
    let response;
    try{response=provider==='cartesia'
     ?await retrying(()=>fetch('https://api.cartesia.ai/tts/bytes',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Cartesia-Version':'2026-08-14','Content-Type':'application/json'},body:JSON.stringify({model_id:engine.model,transcript:text,voice:{mode:'id',id:voice},language:'en',output_format:{container:'mp3',sample_rate:44100,bit_rate:128000}}),signal}),signal)
     :await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:engine.model,voice,input:text,response_format:'mp3',instructions:'Leia integralmente o texto fornecido, exatamente uma vez, do início ao fim. Não pule, não resuma, não reorganize, não parafraseie e não omita nenhuma palavra ou frase. Use português do Brasil, dicção clara, ritmo calmo e natural, respeite a pontuação e pronuncie siglas com clareza. Não acrescente comentários.'}),signal});}
    catch(error){release();throw error;}
    if(!response.ok){release();const status=response.status;return json(status,{error:status===401?`${name} rejected the API key.`:status===402?`${name} credits are used up. Check the plan, then try again.`:status===429?`${name} quota, concurrency or rate limit reached. Check the plan, then try again.`:`${name} speech request failed (${status}).`});}
    const audio=Buffer.from(await response.arrayBuffer());release();if(audio.length<1024)return json(502,{error:'Speech generation returned incomplete audio. Please try again.'});res.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':audio.length,'Cache-Control':'no-store'});res.end(audio);return;
   }
   if(req.method!=='GET'&&req.method!=='HEAD')return json(405,{error:'Method not allowed.'});
   const file=path.resolve(root,'.'+decodeURIComponent(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep))return json(403,{error:'Invalid path.'});
   const stat=await fs.promises.stat(file).catch(()=>null);if(!stat?.isFile())return json(404,{error:'File not found.'});
   res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':stat.size,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none'"});
   if(req.method==='HEAD')return res.end();fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
  }catch{if(!res.headersSent)json(500,{error:'The request failed. Please try again.'});else res.destroy();}
 });
 await new Promise((resolve,reject)=>{server.once('error',error=>{if(error.code==='EADDRINUSE'&&preferredPort){server.once('error',reject);server.listen(0,'127.0.0.1',resolve);}else reject(error);});server.listen(preferredPort,'127.0.0.1',resolve);});origin=`http://127.0.0.1:${server.address().port}`;return {server,origin};
}
module.exports={startServer};
