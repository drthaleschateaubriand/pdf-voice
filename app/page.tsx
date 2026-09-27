"use client";
import {lazy,Suspense,useEffect,useState} from 'react';

const DesktopReader=lazy(()=>import('./desktop-reader'));
const IpadReader=lazy(()=>import('./ipad-reader'));

function appleTouch(){
 if(typeof navigator==='undefined')return false;
 const ua=navigator.userAgent||'';
 return /iPad|iPhone|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
}

export default function Home(){
 const [target,setTarget]=useState<'ipad'|'desktop'|null>(null);
 useEffect(()=>{setTarget(appleTouch()?'ipad':'desktop');},[]);
 if(!target)return <main style={{minHeight:'100dvh',display:'grid',placeItems:'center',fontFamily:'system-ui,-apple-system,sans-serif',background:'#F7F3EB',color:'#1B3B2B'}}>Carregando Meu Foco…</main>;
 return <Suspense fallback={<main style={{minHeight:'100dvh',display:'grid',placeItems:'center',fontFamily:'system-ui,-apple-system,sans-serif',background:'#F7F3EB',color:'#1B3B2B'}}>Carregando Meu Foco…</main>}>{target==='ipad'?<IpadReader/>:<DesktopReader/>}</Suspense>;
}
