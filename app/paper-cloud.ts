const SUPABASE_URL='https://cmgwbowbvcwmnluzevoq.supabase.co';
const SUPABASE_KEY='sb_publishable_xNqu8APjg_nnM-h_fWYkmw_AY2sjNCO';
const SESSION_KEY='paper-voice-cloud-session';

export type CloudSession={
 access_token:string;
 refresh_token:string;
 expires_at?:number;
 expires_in?:number;
 token_type?:string;
 user:{id:string;email?:string|null};
};

export type CloudPreferences={
 voice?:string;
 speed?:number;
 highlight_enabled?:boolean;
 compact_mode?:boolean;
};

export type CloudBookState={
 bookId:string;
 progress:{page:number;sentence_index:number;updated_at?:string}|null;
 bookmarks:number[];
};

function headers(token?:string,extra?:HeadersInit){
 return {
  apikey:SUPABASE_KEY,
  'Content-Type':'application/json',
  ...(token?{Authorization:'Bearer '+token}:{}),
  ...(extra||{})
 };
}

function saveSession(session:CloudSession|null){
 if(typeof window==='undefined')return;
 if(session)localStorage.setItem(SESSION_KEY,JSON.stringify(session));
 else localStorage.removeItem(SESSION_KEY);
}

function readSession(){
 if(typeof window==='undefined')return null;
 try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null') as CloudSession|null;}catch{return null;}
}

async function authFetch(path:string,init:RequestInit={}){
 return fetch(SUPABASE_URL+path,{...init,headers:headers(undefined,init.headers)});
}

async function refresh(session:CloudSession){
 const res=await authFetch('/auth/v1/token?grant_type=refresh_token',{
  method:'POST',
  body:JSON.stringify({refresh_token:session.refresh_token})
 });
 if(!res.ok){saveSession(null);return null;}
 const next=await res.json() as CloudSession;
 if(next.expires_in&&!next.expires_at)next.expires_at=Math.floor(Date.now()/1000)+next.expires_in;
 saveSession(next);return next;
}

export async function getCloudSession(){
 let session=readSession();
 if(!session)return null;
 const now=Math.floor(Date.now()/1000);
 if(session.expires_at&&session.expires_at<now+90)session=await refresh(session);
 if(!session)return null;
 try{
  const res=await fetch(SUPABASE_URL+'/auth/v1/user',{headers:headers(session.access_token)});
  if(res.status===401){
   session=await refresh(session);
   if(!session)return null;
  }
 }catch{}
 return session;
}

export async function signInCloud(email:string,password:string){
 const res=await authFetch('/auth/v1/token?grant_type=password',{
  method:'POST',body:JSON.stringify({email,password})
 });
 const data=await res.json() as CloudSession&{msg?:string;error_description?:string};
 if(!res.ok)throw new Error(data.msg||data.error_description||'Não foi possível entrar.');
 if(data.expires_in&&!data.expires_at)data.expires_at=Math.floor(Date.now()/1000)+data.expires_in;
 saveSession(data);return data;
}

export async function signUpCloud(email:string,password:string){
 const res=await authFetch('/auth/v1/signup',{
  method:'POST',
  body:JSON.stringify({email,password,options:{emailRedirectTo:typeof window!=='undefined'?window.location.origin:undefined}})
 });
 const data=await res.json() as Partial<CloudSession>&{msg?:string;error_description?:string;user?:CloudSession['user']};
 if(!res.ok)throw new Error(data.msg||data.error_description||'Não foi possível criar a conta.');
 if(data.access_token&&data.refresh_token&&data.user){
  const session=data as CloudSession;
  if(session.expires_in&&!session.expires_at)session.expires_at=Math.floor(Date.now()/1000)+session.expires_in;
  saveSession(session);return {session,needsConfirmation:false};
 }
 return {session:null,needsConfirmation:true};
}

export async function signOutCloud(){
 const session=readSession();
 try{if(session)await fetch(SUPABASE_URL+'/auth/v1/logout',{method:'POST',headers:headers(session.access_token)});}catch{}
 saveSession(null);
}

async function db(path:string,init:RequestInit={}){
 let session=await getCloudSession();
 if(!session)throw new Error('Sessão não encontrada.');
 let res=await fetch(SUPABASE_URL+'/rest/v1/'+path,{...init,headers:headers(session.access_token,init.headers)});
 if(res.status===401){
  session=await getCloudSession();
  if(!session)throw new Error('Sessão expirada.');
  res=await fetch(SUPABASE_URL+'/rest/v1/'+path,{...init,headers:headers(session.access_token,init.headers)});
 }
 return {res,session};
}

export async function loadCloudPreferences(){
 const {res}=await db('reader_preferences?select=voice,speed,highlight_enabled,compact_mode&limit=1');
 if(!res.ok)throw new Error('Falha ao carregar preferências.');
 const rows=await res.json() as Array<{voice:string;speed:number;highlight_enabled:boolean;compact_mode:boolean}>;
 return rows[0]||null;
}

export async function saveCloudPreferences(prefs:CloudPreferences){
 const session=await getCloudSession();if(!session)return;
 const body={user_id:session.user.id,...prefs};
 const {res}=await db('reader_preferences?on_conflict=user_id',{
  method:'POST',
  headers:{Prefer:'resolution=merge-duplicates,return=minimal'},
  body:JSON.stringify(body)
 });
 if(!res.ok)throw new Error('Falha ao salvar preferências.');
}

export async function openCloudBook(input:{fingerprint:string;fileName:string;fileSize:number;totalPages:number}):Promise<CloudBookState>{
 const session=await getCloudSession();if(!session)throw new Error('Sessão não encontrada.');
 const bookBody={user_id:session.user.id,fingerprint:input.fingerprint,file_name:input.fileName,file_size:input.fileSize,title:input.fileName.replace(/\.pdf$/i,''),total_pages:input.totalPages};
 const upsert=await db('books?on_conflict=user_id,fingerprint&select=id',{
  method:'POST',
  headers:{Prefer:'resolution=merge-duplicates,return=representation'},
  body:JSON.stringify(bookBody)
 });
 if(!upsert.res.ok)throw new Error('Falha ao sincronizar o livro.');
 const books=await upsert.res.json() as Array<{id:string}>;
 const bookId=books[0]?.id;
 if(!bookId)throw new Error('Livro sem identificador.');
 const [progressResponse,bookmarkResponse]=await Promise.all([
  db('reading_progress?book_id=eq.'+encodeURIComponent(bookId)+'&select=page,sentence_index,updated_at&limit=1'),
  db('bookmarks?book_id=eq.'+encodeURIComponent(bookId)+'&select=page&order=page.asc')
 ]);
 const progressRows=progressResponse.res.ok?await progressResponse.res.json() as Array<{page:number;sentence_index:number;updated_at?:string}>:[];
 const bookmarkRows=bookmarkResponse.res.ok?await bookmarkResponse.res.json() as Array<{page:number}>:[];
 return {bookId,progress:progressRows[0]||null,bookmarks:bookmarkRows.map(x=>x.page)};
}

export async function saveCloudProgress(bookId:string,page:number,sentenceIndex:number){
 if(!bookId)return;
 const session=await getCloudSession();if(!session)return;
 const {res}=await db('reading_progress?on_conflict=user_id,book_id',{
  method:'POST',
  headers:{Prefer:'resolution=merge-duplicates,return=minimal'},
  body:JSON.stringify({user_id:session.user.id,book_id:bookId,page,sentence_index:sentenceIndex})
 });
 if(!res.ok)throw new Error('Falha ao salvar progresso.');
}

export async function addCloudBookmark(bookId:string,page:number){
 if(!bookId)return;
 const session=await getCloudSession();if(!session)return;
 const {res}=await db('bookmarks?on_conflict=user_id,book_id,page',{
  method:'POST',
  headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},
  body:JSON.stringify({user_id:session.user.id,book_id:bookId,page})
 });
 if(!res.ok)throw new Error('Falha ao salvar marcador.');
}

export async function removeCloudBookmark(bookId:string,page:number){
 if(!bookId)return;
 const {res}=await db('bookmarks?book_id=eq.'+encodeURIComponent(bookId)+'&page=eq.'+page,{method:'DELETE'});
 if(!res.ok)throw new Error('Falha ao remover marcador.');
}
