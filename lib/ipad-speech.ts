// Keep each request small enough for reliable generation and Safari playback.
// The pieces concatenate back to the original normalized text: no sentence is dropped.
export const MAX_IPAD_SPEECH_CHARS=1500;

export function splitIpadSpeech(text:string):string[]{
 const clean=text.replace(/\s+/g,' ').trim();
 if(!clean)return [];
 const sentences:string[]=[];
 const abbreviations=new Set(['dr','dra','sr','sra','prof','profa','fig','tab','vs','cf','cap','aprox','obs','ref','ed','vol','art']);
 let start=0;
 for(let i=0;i<clean.length;i++){
  const ch=clean[i];if(ch!=='.'&&ch!=='!'&&ch!=='?')continue;
  const next=clean[i+1];if(next&&next!==' ')continue;
  if(ch==='.'){
   const before=clean.slice(Math.max(0,i-16),i),m=before.match(/([0-9A-Za-zÀ-ÿ]+)$/),word=(m?.[1]||'').toLowerCase();
   if(next&&(word.length===1||abbreviations.has(word)))continue;
  }
  const sentence=clean.slice(start,i+1).trim();if(sentence)sentences.push(sentence);
  start=i+1;while(clean[start]===' ')start++;
 }
 const tail=clean.slice(start).trim();if(tail)sentences.push(tail);
 const pieces:string[]=[];
 for(const sentence of sentences){
  let remainder=sentence;
  while(remainder.length>MAX_IPAD_SPEECH_CHARS){
   const boundary=remainder.lastIndexOf(' ',MAX_IPAD_SPEECH_CHARS);
   const cut=boundary>MAX_IPAD_SPEECH_CHARS/2?boundary:MAX_IPAD_SPEECH_CHARS;
   pieces.push(remainder.slice(0,cut));
   remainder=remainder.slice(cut).trimStart();
  }
  if(remainder)pieces.push(remainder);
 }
 return pieces;
}
