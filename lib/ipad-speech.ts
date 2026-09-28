// Build larger speech clips for smoother iPad/Safari playback.
// Up to six sentences are sent in one request, while long text is still capped
// so generation remains reliable and every character is preserved.
export const MAX_IPAD_SPEECH_CHARS=1500;
export const MAX_IPAD_SENTENCES_PER_CLIP=6;

export function splitIpadSpeech(text:string):string[]{
 const clean=text.replace(/\s+/g,' ').trim();
 if(!clean)return [];

 const sentences:string[]=[];
 const abbreviations=new Set([
  'dr','dra','sr','sra','prof','profa','etc','fig','tab','vs','cf','cap','aprox',
  'mín','máx','obs','ref','ed','vol','art','mg','ml','kg','mcg','mmol','mmhg',
  'min','seg','hr','hrs','dl','ui'
 ]);
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

 // First split only truly long individual sentences.
 const safeSentences:string[]=[];
 for(const sentence of sentences){
  let remainder=sentence;
  while(remainder.length>MAX_IPAD_SPEECH_CHARS){
   const boundary=remainder.lastIndexOf(' ',MAX_IPAD_SPEECH_CHARS);
   const cut=boundary>MAX_IPAD_SPEECH_CHARS/2?boundary:MAX_IPAD_SPEECH_CHARS;
   safeSentences.push(remainder.slice(0,cut).trim());
   remainder=remainder.slice(cut).trimStart();
  }
  if(remainder)safeSentences.push(remainder);
 }

 // Then group up to six sentences into a single clip. This avoids the audible
 // pause and highlight churn that happens when Safari swaps audio every sentence.
 const clips:string[]=[];
 let group:string[]=[];
 let chars=0;
 const flush=()=>{
  if(!group.length)return;
  clips.push(group.join(' '));
  group=[];chars=0;
 };
 for(const sentence of safeSentences){
  const nextChars=chars+(group.length?1:0)+sentence.length;
  if(group.length&&(group.length>=MAX_IPAD_SENTENCES_PER_CLIP||nextChars>MAX_IPAD_SPEECH_CHARS))flush();
  group.push(sentence);
  chars+=(group.length>1?1:0)+sentence.length;
 }
 flush();
 return clips;
}
