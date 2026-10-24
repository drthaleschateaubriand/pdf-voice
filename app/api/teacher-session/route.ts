import { env } from 'cloudflare:workers';

// Apollo 14: only short-lived Realtime credentials reach the browser.
// The permanent OPENAI key stays in the Cloudflare Worker.
export async function POST(request:Request){
 const origin=request.headers.get('origin');
 if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'Origem não autorizada.'},{status:403});
 const key=(env as Record<string,unknown>).OPENAI;
 if(typeof key!=='string'||!key.trim())return Response.json({error:'Configure a chave OPENAI no servidor para usar o professor.'},{status:503});
 try{
  const response=await fetch('https://api.openai.com/v1/realtime/client_secrets',{
   method:'POST',
   headers:{Authorization:'Bearer '+key.trim(),'Content-Type':'application/json'},
   body:JSON.stringify({session:{type:'realtime',model:'gpt-realtime-2.1',audio:{output:{voice:'marin'},input:{turn_detection:{type:'semantic_vad',create_response:true,interrupt_response:true}}}}}),
   signal:AbortSignal.any([request.signal,AbortSignal.timeout(15000)])
  });
  if(!response.ok)return Response.json({error:response.status===401?'Chave OpenAI inválida.':response.status===429?'Limite da API Realtime atingido.':'Não foi possível iniciar uma sessão do professor.',status:response.status},{status:response.status===429?429:502});
  const data=await response.json() as {value?:string;client_secret?:{value?:string}};
  const value=data.value||data.client_secret?.value;
  if(!value)return Response.json({error:'A OpenAI não retornou uma credencial temporária.'},{status:502});
  return Response.json({value},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Falha de conexão com a API Realtime.'},{status:502});}
}
