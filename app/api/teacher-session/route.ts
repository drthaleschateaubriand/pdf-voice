import { env } from 'cloudflare:workers';
import {SUPABASE_KEY,SUPABASE_URL} from '../../paper-cloud';

// Apollo 14: only short-lived Realtime credentials reach the browser.
// The permanent OPENAI key stays in the Cloudflare Worker.
export async function POST(request:Request){
 const origin=request.headers.get('origin');
 if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'Origem não autorizada.'},{status:403});
 const bearer=request.headers.get('authorization')||'';
 const jwt=bearer.startsWith('Bearer ')?bearer.slice(7).trim():'';
 if(!jwt||jwt.length>4096)return Response.json({error:'Entre na sua conta Meu Foco antes de conversar com o professor.'},{status:401});
 let identity:{id?:string};
 try{
  const verify=await fetch(SUPABASE_URL+'/auth/v1/user',{
   headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+jwt},
   signal:AbortSignal.any([request.signal,AbortSignal.timeout(10000)])
  });
  if(!verify.ok)return Response.json({error:'Sua sessão expirou. Entre novamente no Meu Foco.'},{status:401});
  identity=await verify.json() as {id?:string};
  if(!identity?.id)return Response.json({error:'Não foi possível validar a sessão do leitor.'},{status:401});
 }catch{return Response.json({error:'Não foi possível validar sua conta. Tente novamente.'},{status:503});}
 const key=(env as Record<string,unknown>).OPENAI;
 if(typeof key!=='string'||!key.trim())return Response.json({error:'Configure a chave OPENAI no servidor para usar o professor.'},{status:503});
 try{
  const response=await fetch('https://api.openai.com/v1/realtime/client_secrets',{
   method:'POST',
   headers:{Authorization:'Bearer '+key.trim(),'Content-Type':'application/json','OpenAI-Safety-Identifier':Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity.id!)))).map(b=>b.toString(16).padStart(2,'0')).join('')},
   body:JSON.stringify({expires_after:{anchor:'created_at',seconds:60},session:{type:'realtime',model:'gpt-realtime-2.1',audio:{output:{voice:'marin'},input:{turn_detection:{type:'semantic_vad',create_response:true,interrupt_response:true}}}}}),
   signal:AbortSignal.any([request.signal,AbortSignal.timeout(15000)])
  });
  if(!response.ok)return Response.json({error:response.status===401?'Chave OpenAI inválida.':response.status===429?'Limite da API Realtime atingido.':'Não foi possível iniciar uma sessão do professor.',status:response.status},{status:response.status===429?429:502});
  const data=await response.json() as {value?:string;client_secret?:{value?:string}};
  const value=data.value||data.client_secret?.value;
  if(!value)return Response.json({error:'A OpenAI não retornou uma credencial temporária.'},{status:502});
  return Response.json({value},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Falha de conexão com a API Realtime.'},{status:502});}
}
