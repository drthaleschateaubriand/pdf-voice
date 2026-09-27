"use client";
import {lazy,Suspense} from 'react';

const MeuFocoReader=lazy(()=>import('./ipad-reader'));

const loading=<main style={{minHeight:'100dvh',display:'grid',placeItems:'center',fontFamily:'system-ui,-apple-system,sans-serif',background:'#F7F3EB',color:'#1B3B2B'}}>Carregando Meu Foco…</main>;

export default function Home(){
 return <Suspense fallback={loading}><MeuFocoReader/></Suspense>;
}
