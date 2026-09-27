import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
 title:'Meu Foco',
 description:'Leitura guiada por voz para livros e PDFs, com foco, ritmo calmo, destaques, marcadores e biblioteca sincronizada.',
 manifest:'/manifest.webmanifest',
 icons:{icon:'/paper-voice-icon.svg',apple:'/paper-voice-icon.svg'},
 appleWebApp:{
  capable:true,
  title:'Meu Foco',
  statusBarStyle:'default'
 }
};

export const viewport: Viewport = {
 width:'device-width',
 initialScale:1,
 viewportFit:'cover',
 themeColor:'#1B3B2B'
};

export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){
 return <html lang="pt-BR"><body>{children}</body></html>;
}
