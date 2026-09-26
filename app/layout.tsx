import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
 title:'Paper Voice',
 description:'Leitor de PDF com voz natural, destaques, marcadores e biblioteca sincronizada.',
 manifest:'/manifest.webmanifest',
 icons:{icon:'/paper-voice-icon.svg',apple:'/paper-voice-icon.svg'},
 appleWebApp:{
  capable:true,
  title:'Paper Voice',
  statusBarStyle:'default'
 }
};

export const viewport: Viewport = {
 width:'device-width',
 initialScale:1,
 viewportFit:'cover',
 themeColor:'#173d31'
};

export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){
 return <html lang="pt-BR"><body>{children}</body></html>;
}
