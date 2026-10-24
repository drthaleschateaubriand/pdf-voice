// Firebase backend for Meu Foco — Apollo 14. No Supabase URLs or secrets.
// Firebase Authentication, Firestore and Storage REST APIs; all protected by
// per-user security rules in firebase/firestore.rules and firebase/storage.rules.
const API_KEY=process.env.NEXT_PUBLIC_FIREBASE_API_KEY||'';
const PROJECT=process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID||'';
const BUCKET=process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET||'';
const SESSION_KEY='meu-foco-firebase-session-v1';
const AUTH='https://identitytoolkit.googleapis.com/v1/';
const TOKEN='https://securetoken.googleapis.com/v1/token?key=';
const FIRESTORE='https://firestore.googleapis.com/v1/projects/';
const STORAGE='https://firebasestorage.googleapis.com/v0/b/';

export type CloudSession={
 access_token:string; refresh_token:string; expires_at:number;
 user:{id:string;email?:string|null};
};
export type CloudPreferences={voice?:string;speed?:number;highlight_enabled?:boolean;compact_mode?:boolean};
export type CloudBookState={bookId:string;storagePath?:string|null;progress:{page:number;sentence_index:number;updated_at?:string}|null;bookmarks:number[]};
export type CloudLibraryBook={
 id:string;fingerprint:string;file_name:string;file_size:number;title:string|null;
 total_pages:number;storage_path:string|null;updated_at:string;page:number;sentence_index:number;
};
export type CloudStudyState<T=unknown>={version:number;updatedAt:string;bank:T|null;settings?:{
 againMinutes?:number;hardDays?:number;goodDays?:number;easyDays?:number;growthFactor?:number;maxDays?:number;
}};
type JsonObject=Record<string,unknown>;
function config(){
 if(!API_KEY||!PROJECT||!BUCKET)throw new Error('Firebase ainda não configurado. Informe as variáveis NEXT_PUBLIC_FIREBASE_* no App Hosting.');
}
function checkResponse(res:Response,context:string):Promise<Response>{
 if(res.ok)return Promise.resolve(res);
 return res.clone().json().catch(()=>({})).then((obj:{error?:{message?:string}})=>{
  throw new Error(context+': '+(obj.error?.message||'HTTP '+res.status));
 });
}
async function request(url:string,init:RequestInit,description:string){
 const res=await fetch(url,init);
 return checkResponse(res,description);
}
function sessionRead():CloudSession|null{
 if(typeof window==='undefined')return null;
 try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null') as CloudSession|null;}catch{return null;}
}
function sessionSave(s:CloudSession|null){
 if(typeof window==='undefined')return;
 if(s)localStorage.setItem(SESSION_KEY,JSON.stringify(s));
 else localStorage.removeItem(SESSION_KEY);
}
function normalizeAuth(raw:{idToken?:string;refreshToken?:string;expiresIn?:string;localId?:string;email?:string},previous?:CloudSession):CloudSession{
 return {
  access_token:raw.idToken||previous?.access_token||'',
  refresh_token:raw.refreshToken||previous?.refresh_token||'',
  expires_at:Math.floor(Date.now()/1000)+Number(raw.expiresIn||3600),
  user:{id:raw.localId||previous?.user.id||'',email:raw.email||previous?.user.email||null}
 };
}
async function authAction(method:string,body:JsonObject){
 config();
 const res=await request(AUTH+method+'?key='+encodeURIComponent(API_KEY),{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(body)
 },'Falha na autenticação Firebase');
 return res.json() as Promise<{idToken:string;refreshToken:string;expiresIn:string;localId:string;email:string}>;
}
async function refresh(s:CloudSession):Promise<CloudSession>{
 const res=await request(TOKEN+encodeURIComponent(API_KEY),{
  method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({grant_type:'refresh_token',refresh_token:s.refresh_token})
 },'Não foi possível atualizar sua sessão');
 const x=await res.json() as {id_token:string;refresh_token:string;expires_in:string;user_id:string};
 const next:CloudSession={access_token:x.id_token,refresh_token:x.refresh_token,
  expires_at:Math.floor(Date.now()/1000)+Number(x.expires_in),
  user:{id:x.user_id,email:s.user.email}};
 sessionSave(next);return next;
}
export async function getCloudSession():Promise<CloudSession|null>{
 const s=sessionRead();
 if(!s)return null;
 if(s.expires_at>Math.floor(Date.now()/1000)+90)return s;
 try{return await refresh(s);}catch{sessionSave(null);return null;}
}
export async function signInCloud(email:string,password:string){
 const x=await authAction('accounts:signInWithPassword',{email,password,returnSecureToken:true});
 const s=normalizeAuth(x);sessionSave(s);return s;
}
export async function signUpCloud(email:string,password:string){
 const x=await authAction('accounts:signUp',{email,password,returnSecureToken:true});
 const s=normalizeAuth(x);sessionSave(s);return {session:s,needsConfirmation:false};
}
export async function signOutCloud(){sessionSave(null);}
function encoded(value:string){return encodeURIComponent(value);}
function firestorePath(uid:string,path:string){
 return FIRESTORE+encoded(PROJECT)+'/databases/(default)/documents/users/'+encoded(uid)+'/'+path;
}
async function authenticated(){
 config();
 const s=await getCloudSession();
 if(!s)throw new Error('Entre em sua conta Firebase para sincronizar a biblioteca.');
 return s;
}
function authHeaders(s:CloudSession,extra:Record<string,string>={}){
 return {Authorization:'Bearer '+s.access_token,...extra};
}
function toField(value:unknown):unknown{
 if(value===null||value===undefined)return {nullValue:null};
 if(typeof value==='boolean')return {booleanValue:value};
 if(typeof value==='number')return Number.isInteger(value)?{integerValue:String(value)}:{doubleValue:value};
 if(typeof value==='string')return {stringValue:value};
 if(Array.isArray(value))return {arrayValue:{values:value.map(toField)}};
 if(typeof value==='object')return {mapValue:{fields:toFields(value as JsonObject)}};
 return {nullValue:null};
}
function toFields(o:JsonObject){return Object.fromEntries(Object.entries(o).map(([k,v])=>[k,toField(v)]));}
function fromField(value:unknown):unknown{
 const f=value as JsonObject;
 if('stringValue'in f)return f.stringValue;
 if('integerValue'in f)return Number(f.integerValue);
 if('doubleValue'in f)return Number(f.doubleValue);
 if('booleanValue'in f)return f.booleanValue;
 if('nullValue'in f)return null;
 if('timestampValue'in f)return f.timestampValue;
 if('arrayValue'in f)return ((f.arrayValue as {values?:unknown[]})?.values||[]).map(fromField);
 if('mapValue'in f)return fromFields((f.mapValue as {fields?:JsonObject})?.fields||{});
 return null;
}
function fromFields(fields:JsonObject):JsonObject{
 return Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,fromField(v)]));
}
async function getDoc(uid:string,path:string):Promise<JsonObject|null>{
 const s=await authenticated();
 const res=await fetch(firestorePath(uid,path),{headers:authHeaders(s)});
 if(res.status===404)return null;
 await checkResponse(res,'Falha ao consultar biblioteca');
 const doc=await res.json() as {fields?:JsonObject};
 return fromFields(doc.fields||{});
}
async function saveDoc(uid:string,path:string,value:JsonObject){
 const s=await authenticated();
 await request(firestorePath(uid,path),{method:'PATCH',
  headers:authHeaders(s,{'Content-Type':'application/json'}),
  body:JSON.stringify({fields:toFields(value)})},'Falha ao salvar dados');
}
async function deleteDoc(uid:string,path:string){
 const s=await authenticated();
 const res=await fetch(firestorePath(uid,path),{method:'DELETE',headers:authHeaders(s)});
 if(res.status!==404)await checkResponse(res,'Falha ao remover dados');
}
async function listDocs(uid:string,path:string):Promise<Array<{id:string;data:JsonObject}>>{
 const s=await authenticated();
 const out:Array<{id:string;data:JsonObject}>=[];
 let next='';
 do{
  const params=new URLSearchParams({pageSize:'100'});
  if(next)params.set('pageToken',next);
  const res=await fetch(firestorePath(uid,path)+'?'+params,{headers:authHeaders(s)});
  if(res.status===404)return out;
  await checkResponse(res,'Falha ao listar dados');
  const payload=await res.json() as {documents?:Array<{name:string;fields?:JsonObject}>;nextPageToken?:string};
  for(const d of payload.documents||[])out.push({id:d.name.split('/').pop()||'',data:fromFields(d.fields||{})});
  next=payload.nextPageToken||'';
 }while(next);
 return out;
}
function now(){return new Date().toISOString();}
async function bookKey(fingerprint:string){
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fingerprint));
 return 'b_'+Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
export async function loadCloudPreferences(){
 const s=await authenticated();
 return getDoc(s.user.id,'preferences/main') as Promise<CloudPreferences|null>;
}
export async function saveCloudPreferences(prefs:CloudPreferences){
 const s=await authenticated();
 const prior=await loadCloudPreferences()||{};
 await saveDoc(s.user.id,'preferences/main',{...prior,...prefs});
}
export async function openCloudBook(input:{fingerprint:string;fileName:string;fileSize:number;totalPages:number}):Promise<CloudBookState>{
 const s=await authenticated();const id=await bookKey(input.fingerprint);
 const path='books/'+id,prior=await getDoc(s.user.id,path)||{};
 await saveDoc(s.user.id,path,{
  fingerprint:input.fingerprint,file_name:input.fileName,file_size:input.fileSize,
  title:input.fileName.replace(/\.(pdf|epub)$/i,''),total_pages:input.totalPages,
  storage_path:prior.storage_path||null,updated_at:now()
 });
 const [progress,marks]=await Promise.all([
  getDoc(s.user.id,path+'/progress/current'),listDocs(s.user.id,path+'/bookmarks')
 ]);
 return {bookId:id,storagePath:typeof prior.storage_path==='string'?prior.storage_path:null,
  progress:progress?{page:Number(progress.page||1),sentence_index:Number(progress.sentence_index||0),updated_at:String(progress.updated_at||'')}:null,
  bookmarks:marks.map(m=>Number(m.data.page)).filter(Number.isFinite).sort((a,b)=>a-b)};
}
export async function saveCloudProgress(bookId:string,page:number,sentenceIndex:number){
 if(!bookId)return;
 const s=await authenticated();
 await saveDoc(s.user.id,'books/'+encoded(bookId)+'/progress/current',{page,sentence_index:sentenceIndex,updated_at:now()});
}
export async function addCloudBookmark(bookId:string,page:number){
 const s=await authenticated();
 await saveDoc(s.user.id,'books/'+encoded(bookId)+'/bookmarks/p'+page,{page});
}
export async function removeCloudBookmark(bookId:string,page:number){
 const s=await authenticated();
 await deleteDoc(s.user.id,'books/'+encoded(bookId)+'/bookmarks/p'+page);
}
export async function listCloudLibrary():Promise<CloudLibraryBook[]>{
 const s=await authenticated(),books=await listDocs(s.user.id,'books');
 return Promise.all(books.map(async b=>{
  const progress=await getDoc(s.user.id,'books/'+encoded(b.id)+'/progress/current');
  return {...b.data,id:b.id,page:Number(progress?.page||1),sentence_index:Number(progress?.sentence_index||0)} as CloudLibraryBook;
 }));
}
function objectUrl(path:string){
 return STORAGE+encoded(BUCKET)+'/o/'+encoded(path);
}
async function storageFetch(path:string,init:RequestInit,description:string){
 const s=await authenticated();
 return request(path,{...init,headers:{Authorization:'Firebase '+s.access_token,...(init.headers as Record<string,string>||{})}},description);
}
export async function uploadCloudDocument(file:File,bookId:string,onProgress?:(percent:number)=>void){
 if(!file.name.toLowerCase().match(/\.(pdf|epub)$/))throw new Error('Selecione um PDF ou EPUB.');
 const s=await authenticated(),extension=file.name.toLowerCase().endsWith('.epub')?'epub':'pdf';
 const path='users/'+s.user.id+'/books/'+bookId+'/document.'+extension;
 const url=STORAGE+encoded(BUCKET)+'/o?name='+encoded(path);
 // Standard Firebase Storage upload endpoint; never include credentials in the URL.
 await storageFetch(url,{method:'POST',headers:{'Content-Type':file.type||(extension==='pdf'?'application/pdf':'application/epub+zip')},body:file},
  'Não foi possível enviar o documento ao Firebase Storage');
 onProgress?.(100);
 const previous=await getDoc(s.user.id,'books/'+encoded(bookId));
 await saveDoc(s.user.id,'books/'+encoded(bookId),{
  ...previous,storage_path:path,file_name:file.name,file_size:file.size,
  title:file.name.replace(/\.(pdf|epub)$/i,''),updated_at:now()
 });
 return path;
}
export const uploadCloudPdf=uploadCloudDocument;
export async function downloadCloudDocument(book:Pick<CloudLibraryBook,'storage_path'|'file_name'>){
 if(!book.storage_path)throw new Error('Livro não enviado à nuvem.');
 const res=await storageFetch(objectUrl(book.storage_path)+'?alt=media',{},'Não foi possível baixar o livro');
 const type=book.file_name.toLowerCase().endsWith('.epub')?'application/epub+zip':'application/pdf';
 return new File([await res.blob()],book.file_name,{type});
}
export const downloadCloudPdf=downloadCloudDocument;
export async function deleteCloudBook(book:Pick<CloudLibraryBook,'id'|'storage_path'>){
 const s=await authenticated(),p='books/'+encoded(book.id);
 let storageDeleted=true;
 if(book.storage_path){
  try{await storageFetch(objectUrl(book.storage_path),{method:'DELETE'},'Falha ao apagar arquivo');}
  catch{storageDeleted=false;}
 }
 const marks=await listDocs(s.user.id,p+'/bookmarks');
 await Promise.all(marks.map(mark=>deleteDoc(s.user.id,p+'/bookmarks/'+encoded(mark.id))));
 await deleteDoc(s.user.id,p+'/progress/current');
 await deleteDoc(s.user.id,p);
 return {storageDeleted};
}
function spacedPath(uid:string){return 'users/'+uid+'/study/spaced-review-state.json';}
export async function loadCloudStudyState<T=unknown>():Promise<CloudStudyState<T>|null>{
 const s=await authenticated(),url=objectUrl(spacedPath(s.user.id))+'?alt=media';
 const res=await fetch(url,{headers:{Authorization:'Firebase '+s.access_token}});
 if(res.status===404)return null;
 await checkResponse(res,'Falha ao carregar revisão espaçada');
 return res.json() as Promise<CloudStudyState<T>>;
}
export async function saveCloudStudyState<T=unknown>(state:CloudStudyState<T>){
 const s=await authenticated(),url=STORAGE+encoded(BUCKET)+'/o?name='+encoded(spacedPath(s.user.id));
 await storageFetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)},'Falha ao salvar revisão espaçada');
 return true;
}
