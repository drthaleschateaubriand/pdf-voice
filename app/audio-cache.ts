const DB_NAME='paper-voice-audio-cache';
const STORE='audio';
const DB_VERSION=1;
const MAX_BYTES=180*1024*1024;
const MAX_ENTRIES=1800;
const CACHE_NAMESPACE='openai-gpt-4o-mini-tts-ptbr-v1';

type AudioRecord={
 key:string;
 blob:Blob;
 size:number;
 lastAccess:number;
 createdAt:number;
};

export type AudioCacheStats={entries:number;bytes:number};

function openDb(){
 return new Promise<IDBDatabase>((resolve,reject)=>{
  if(typeof indexedDB==='undefined'){reject(new Error('IndexedDB unavailable'));return;}
  const request=indexedDB.open(DB_NAME,DB_VERSION);
  request.onupgradeneeded=()=>{
   const db=request.result;
   if(!db.objectStoreNames.contains(STORE)){
    const store=db.createObjectStore(STORE,{keyPath:'key'});
    store.createIndex('lastAccess','lastAccess');
   }
  };
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||new Error('Could not open audio cache'));
 });
}

function txDone(tx:IDBTransaction){
 return new Promise<void>((resolve,reject)=>{
  tx.oncomplete=()=>resolve();
  tx.onabort=()=>reject(tx.error||new Error('Audio cache transaction aborted'));
  tx.onerror=()=>reject(tx.error||new Error('Audio cache transaction failed'));
 });
}

export async function makeAudioCacheKey(voice:string,text:string){
 const raw=CACHE_NAMESPACE+'|'+voice+'|'+text;
 try{
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
 }catch{
  return raw;
 }
}

export async function getPersistentAudio(key:string){
 try{
  const db=await openDb();
  const tx=db.transaction(STORE,'readwrite');
  const store=tx.objectStore(STORE);
  const record=await new Promise<AudioRecord|undefined>((resolve,reject)=>{
   const req=store.get(key);
   req.onsuccess=()=>resolve(req.result as AudioRecord|undefined);
   req.onerror=()=>reject(req.error);
  });
  if(record){
   record.lastAccess=Date.now();
   store.put(record);
  }
  await txDone(tx);
  db.close();
  return record?.blob||null;
 }catch{
  return null;
 }
}

async function collectStatsAndRecords(db:IDBDatabase){
 const tx=db.transaction(STORE,'readonly');
 const store=tx.objectStore(STORE);
 const records=await new Promise<AudioRecord[]>((resolve,reject)=>{
  const req=store.getAll();
  req.onsuccess=()=>resolve((req.result||[]) as AudioRecord[]);
  req.onerror=()=>reject(req.error);
 });
 await txDone(tx);
 return records;
}

async function prune(db:IDBDatabase){
 const records=await collectStatsAndRecords(db);
 let bytes=records.reduce((sum,r)=>sum+(Number(r.size)||r.blob?.size||0),0);
 let entries=records.length;
 if(bytes<=MAX_BYTES&&entries<=MAX_ENTRIES)return {entries,bytes};
 const oldest=[...records].sort((a,b)=>(a.lastAccess||0)-(b.lastAccess||0));
 const tx=db.transaction(STORE,'readwrite');
 const store=tx.objectStore(STORE);
 for(const record of oldest){
  if(bytes<=MAX_BYTES*.86&&entries<=Math.floor(MAX_ENTRIES*.9))break;
  store.delete(record.key);
  bytes-=Number(record.size)||record.blob?.size||0;
  entries--;
 }
 await txDone(tx);
 return {entries,bytes};
}

export async function putPersistentAudio(key:string,blob:Blob):Promise<AudioCacheStats|null>{
 try{
  const db=await openDb();
  const now=Date.now();
  const tx=db.transaction(STORE,'readwrite');
  tx.objectStore(STORE).put({key,blob,size:blob.size,lastAccess:now,createdAt:now} satisfies AudioRecord);
  await txDone(tx);
  const stats=await prune(db);
  db.close();
  return stats;
 }catch{
  return null;
 }
}

export async function getPersistentAudioCacheStats():Promise<AudioCacheStats>{
 try{
  const db=await openDb();
  const records=await collectStatsAndRecords(db);
  db.close();
  return {entries:records.length,bytes:records.reduce((sum,r)=>sum+(Number(r.size)||r.blob?.size||0),0)};
 }catch{
  return {entries:0,bytes:0};
 }
}

export async function deletePersistentAudio(key:string){
 try{
  const db=await openDb();
  const tx=db.transaction(STORE,'readwrite');
  tx.objectStore(STORE).delete(key);
  await txDone(tx);
  db.close();
 }catch{}
}

export async function clearPersistentAudioCache(){
 try{
  const db=await openDb();
  const tx=db.transaction(STORE,'readwrite');
  tx.objectStore(STORE).clear();
  await txDone(tx);
  db.close();
 }catch{}
}

export function formatAudioCacheBytes(bytes:number){
 if(bytes<1024*1024)return (bytes/1024).toFixed(bytes<10240?1:0)+' KB';
 return (bytes/(1024*1024)).toFixed(bytes<10*1024*1024?1:0)+' MB';
}
