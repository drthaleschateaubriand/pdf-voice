import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'Paper / voice',description:'Listen to PDFs with Cartesia or OpenAI speech and follow highlighted passages.'};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><head><script dangerouslySetInnerHTML={{__html:`(function(){try{var ua=navigator.userAgent||'';var iOS=/iPad|iPhone|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);if(iOS){try{Object.defineProperty(window,'showOpenFilePicker',{value:undefined,writable:true,configurable:true});}catch(e){try{window.showOpenFilePicker=undefined;}catch(_){}}}}catch(e){}})();`}} /></head><body>{children}</body></html>}
