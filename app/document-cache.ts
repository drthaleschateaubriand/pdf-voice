const DB_NAME='paper-voice-document-cache';
const STORE='documents';
const DB_VERSION=1;
const ACTIVE_KEY='active-document';

type StoredDocument={
 key:string;
 name:string;
 type:string;
 lastModified:number;
 blob:Blob;
 savedAt:number;
};

function openDb(){
 return new Promise<IDBDatabase>((resolve,reject)=>{
  if(typeof indexedDB==='undefined'){reject(new Error('IndexedDB unavailable'));return;}
  const request=indexedDB.open(DB_NAME,DB_VERSION);
  request.onupgradeneeded=()=>{
   const db=request.result;
   if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'key'});
  };
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||new Error('Could not open document cache'));
 });
}

function txDone(tx:IDBTransaction){
 return new Promise<void>((resolve,reject)=>{
  tx.oncomplete=()=>resolve();
  tx.onabort=()=>reject(tx.error||new Error('Document cache transaction aborted'));
  tx.onerror=()=>reject(tx.error||new Error('Document cache transaction failed'));
 });
}

export async function saveLastOpenedDocument(file:File){
 const db=await openDb();
 try{
  const tx=db.transaction(STORE,'readwrite');
  const record:StoredDocument={
   key:ACTIVE_KEY,
   name:file.name,
   type:file.type,
   lastModified:file.lastModified,
   blob:file.slice(0,file.size,file.type||undefined),
   savedAt:Date.now()
  };
  tx.objectStore(STORE).put(record);
  await txDone(tx);
 }finally{
  db.close();
 }
}

export async function loadLastOpenedDocument(){
 try{
  const db=await openDb();
  try{
   const tx=db.transaction(STORE,'readonly');
   const store=tx.objectStore(STORE);
   const record=await new Promise<StoredDocument|undefined>((resolve,reject)=>{
    const req=store.get(ACTIVE_KEY);
    req.onsuccess=()=>resolve(req.result as StoredDocument|undefined);
    req.onerror=()=>reject(req.error);
   });
   await txDone(tx);
   if(!record?.blob||!record.name)return null;
   return new File([record.blob],record.name,{
    type:record.type||record.blob.type,
    lastModified:record.lastModified||Date.now()
   });
  }finally{
   db.close();
  }
 }catch{
  return null;
 }
}

export async function clearLastOpenedDocument(){
 try{
  const db=await openDb();
  try{
   const tx=db.transaction(STORE,'readwrite');
   tx.objectStore(STORE).delete(ACTIVE_KEY);
   await txDone(tx);
  }finally{
   db.close();
  }
 }catch{}
}
