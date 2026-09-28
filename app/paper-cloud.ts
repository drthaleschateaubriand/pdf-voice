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
 storagePath?:string|null;
 progress:{page:number;sentence_index:number;updated_at?:string}|null;
 bookmarks:number[];
};

export type CloudLibraryBook={
 id:string;
 fingerprint:string;
 file_name:string;
 file_size:number;
 title:string|null;
 total_pages:number;
 storage_path:string|null;
 updated_at:string;
 page:number;
 sentence_index:number;
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
 const metadata={file_name:input.fileName,file_size:input.fileSize,title:input.fileName.replace(/\.(pdf|epub)$/i,''),total_pages:input.totalPages};

 // Read first, then update. This deliberately avoids an upsert on an existing
 // book because a storage_path must never be cleared while syncing metadata.
 const existingResponse=await db('books?fingerprint=eq.'+encodeURIComponent(input.fingerprint)+'&select=id,storage_path&limit=1');
 if(!existingResponse.res.ok)throw new Error('Falha ao localizar o livro na nuvem.');
 let books=await existingResponse.res.json() as Array<{id:string;storage_path?:string|null}>;
 let bookId=books[0]?.id;
 let storagePath=books[0]?.storage_path||null;

 if(bookId){
  const update=await db('books?id=eq.'+encodeURIComponent(bookId),{
   method:'PATCH',
   headers:{Prefer:'return=representation'},
   body:JSON.stringify(metadata)
  });
  if(!update.res.ok)throw new Error('Falha ao atualizar os dados do livro.');
  const rows=await update.res.json() as Array<{id:string;storage_path?:string|null}>;
  storagePath=rows[0]?.storage_path??storagePath;
 }else{
  const insert=await db('books?select=id,storage_path',{
   method:'POST',
   headers:{Prefer:'return=representation'},
   body:JSON.stringify({user_id:session.user.id,fingerprint:input.fingerprint,...metadata})
  });
  if(!insert.res.ok)throw new Error('Falha ao sincronizar o livro.');
  books=await insert.res.json() as Array<{id:string;storage_path?:string|null}>;
  bookId=books[0]?.id;
  storagePath=books[0]?.storage_path||null;
 }

 if(!bookId)throw new Error('Livro sem identificador.');
 const [progressResponse,bookmarkResponse]=await Promise.all([
  db('reading_progress?book_id=eq.'+encodeURIComponent(bookId)+'&select=page,sentence_index,updated_at&limit=1'),
  db('bookmarks?book_id=eq.'+encodeURIComponent(bookId)+'&select=page&order=page.asc')
 ]);
 const progressRows=progressResponse.res.ok?await progressResponse.res.json() as Array<{page:number;sentence_index:number;updated_at?:string}>:[];
 const bookmarkRows=bookmarkResponse.res.ok?await bookmarkResponse.res.json() as Array<{page:number}>:[];
 return {bookId,storagePath,progress:progressRows[0]||null,bookmarks:bookmarkRows.map(x=>x.page)};
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


function encodeStoragePath(path:string){
 return path.split('/').map(encodeURIComponent).join('/');
}

function base64Metadata(value:string){
 const bytes=new TextEncoder().encode(value);
 let binary='';
 for(const b of bytes)binary+=String.fromCharCode(b);
 return btoa(binary);
}

export async function listCloudLibrary():Promise<CloudLibraryBook[]>{
 const booksResponse=await db('books?select=id,fingerprint,file_name,file_size,title,total_pages,storage_path,updated_at&order=updated_at.desc');
 if(!booksResponse.res.ok)throw new Error('Falha ao carregar biblioteca.');
 const books=await booksResponse.res.json() as Array<Omit<CloudLibraryBook,'page'|'sentence_index'>>;
 const progressResponse=await db('reading_progress?select=book_id,page,sentence_index,updated_at');
 const progress=progressResponse.res.ok?await progressResponse.res.json() as Array<{book_id:string;page:number;sentence_index:number}>:[];
 const byBook=new Map(progress.map(p=>[p.book_id,p]));
 return books.map(book=>{
  const p=byBook.get(book.id);
  return {...book,page:p?.page||1,sentence_index:p?.sentence_index||0};
 });
}

export async function uploadCloudDocument(file:File,bookId:string,onProgress?:(percent:number)=>void){
 const session=await getCloudSession();if(!session)throw new Error('Sessão não encontrada.');
 const lower=file.name.toLowerCase();
 const isPdf=lower.endsWith('.pdf')||file.type==='application/pdf';
 const isEpub=lower.endsWith('.epub')||file.type==='application/epub+zip';
 if(!isPdf&&!isEpub)throw new Error('Envie um arquivo PDF ou EPUB.');
 const extension=isEpub?'epub':'pdf';
 const contentType=isEpub?'application/epub+zip':'application/pdf';
 const objectPath=session.user.id+'/'+bookId+'/document.'+extension;
 const endpoint='https://cmgwbowbvcwmnluzevoq.storage.supabase.co/storage/v1/upload/resumable';
 const startUpload=async(type:string)=>{
  const metadata=[
   'bucketName '+base64Metadata('pdfs'),
   'objectName '+base64Metadata(objectPath),
   'contentType '+base64Metadata(type)
  ].join(',');
  return fetch(endpoint,{
   method:'POST',
   headers:{
    Authorization:'Bearer '+session.access_token,
    apikey:SUPABASE_KEY,
    'Tus-Resumable':'1.0.0',
    'Upload-Length':String(file.size),
    'Upload-Metadata':metadata,
    'x-upsert':'true'
   }
  });
 };
 let create=await startUpload(contentType);
 // The existing bucket predates EPUB support and may be restricted to PDF MIME.
 // Supabase stores the bytes unchanged, so for that legacy bucket only we retry
 // EPUB as the bucket-compatible MIME. Download restores application/epub+zip
 // from the .epub filename before parsing.
 if(!create.ok&&isEpub)create=await startUpload('application/pdf');
 if(!create.ok){
  let detail='';
  try{detail=await create.text();}catch{}
  throw new Error('Não foi possível iniciar o envio do '+extension.toUpperCase()+'.'+(detail?' '+detail:''));
 }
 const rawLocation=create.headers.get('location');
 if(!rawLocation)throw new Error('O servidor não retornou o endereço do envio.');
 const uploadUrl=new URL(rawLocation,endpoint).toString();
 const chunkSize=6*1024*1024;
 let offset=0;
 while(offset<file.size){
  const chunk=file.slice(offset,Math.min(file.size,offset+chunkSize));
  let attempt=0,response:Response|null=null;
  while(attempt<4){
   try{
    response=await fetch(uploadUrl,{
     method:'PATCH',
     headers:{
      Authorization:'Bearer '+session.access_token,
      apikey:SUPABASE_KEY,
      'Tus-Resumable':'1.0.0',
      'Upload-Offset':String(offset),
      'Content-Type':'application/offset+octet-stream'
     },
     body:chunk
    });
    if(response.ok)break;
   }catch{}
   attempt++;
   if(attempt<4)await new Promise(resolve=>setTimeout(resolve,[700,1800,4000][attempt-1]||4000));
  }
  if(!response||!response.ok)throw new Error('Falha durante o envio do '+extension.toUpperCase()+'.');
  const nextOffset=Number(response.headers.get('Upload-Offset'));
  offset=Number.isFinite(nextOffset)&&nextOffset>offset?nextOffset:Math.min(file.size,offset+chunk.size);
  onProgress?.(Math.min(100,Math.round(offset/file.size*100)));
 }
 const update=await db('books?id=eq.'+encodeURIComponent(bookId),{
  method:'PATCH',
  headers:{Prefer:'return=representation'},
  body:JSON.stringify({storage_path:objectPath,file_name:file.name,file_size:file.size,title:file.name.replace(/\.(pdf|epub)$/i,'')})
 });
 if(!update.res.ok)throw new Error('Documento enviado, mas não foi possível atualizar a biblioteca.');
 const updated=await update.res.json() as Array<{storage_path?:string|null}>;
 if(updated[0]?.storage_path!==objectPath)throw new Error('O arquivo foi enviado, mas o vínculo com a biblioteca não foi confirmado.');
 return objectPath;
}

export async function uploadCloudPdf(file:File,bookId:string,onProgress?:(percent:number)=>void){
 return uploadCloudDocument(file,bookId,onProgress);
}

export async function downloadCloudDocument(book:Pick<CloudLibraryBook,'storage_path'|'file_name'>){
 if(!book.storage_path)throw new Error('Este livro ainda não foi salvo na nuvem.');
 const session=await getCloudSession();if(!session)throw new Error('Sessão não encontrada.');
 const url=SUPABASE_URL+'/storage/v1/object/authenticated/pdfs/'+encodeStoragePath(book.storage_path);
 const res=await fetch(url,{headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+session.access_token}});
 if(!res.ok)throw new Error('Não foi possível baixar o documento da sua biblioteca.');
 const blob=await res.blob();
 const isEpub=book.file_name.toLowerCase().endsWith('.epub')||book.storage_path.toLowerCase().endsWith('.epub');
 const type=isEpub?'application/epub+zip':'application/pdf';
 return new File([blob],book.file_name,{type,lastModified:Date.now()});
}

export async function downloadCloudPdf(book:Pick<CloudLibraryBook,'storage_path'|'file_name'>){
 return downloadCloudDocument(book);
}


async function deleteStorageObject(path:string,token:string){
 const url=SUPABASE_URL+'/storage/v1/object/pdfs/'+encodeStoragePath(path);
 const res=await fetch(url,{
  method:'DELETE',
  headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+token}
 });
 if(!res.ok&&res.status!==404){
  let detail='';
  try{detail=await res.text();}catch{}
  throw new Error('Não foi possível excluir o arquivo salvo na nuvem.'+(detail?' '+detail:''));
 }
}

export async function deleteCloudBook(book:Pick<CloudLibraryBook,'id'|'storage_path'>){
 const session=await getCloudSession();if(!session)throw new Error('Sessão não encontrada.');

 // Delete the Storage object through the Storage API first. This avoids
 // orphaning a file after its library record has been removed.
 if(book.storage_path)await deleteStorageObject(book.storage_path,session.access_token);

 // Remove dependent rows explicitly so deletion works even if the database
 // foreign keys were created without ON DELETE CASCADE.
 const progress=await db('reading_progress?book_id=eq.'+encodeURIComponent(book.id),{method:'DELETE'});
 if(!progress.res.ok)throw new Error('Não foi possível excluir o progresso deste livro.');
 const marks=await db('bookmarks?book_id=eq.'+encodeURIComponent(book.id),{method:'DELETE'});
 if(!marks.res.ok)throw new Error('Não foi possível excluir os marcadores deste livro.');
 const record=await db('books?id=eq.'+encodeURIComponent(book.id),{method:'DELETE'});
 if(!record.res.ok)throw new Error('Não foi possível excluir o livro da biblioteca.');
}
