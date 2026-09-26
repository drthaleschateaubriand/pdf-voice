import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
 title:'Paper Voice',
 description:'Leitor de PDF com narração por voz da OpenAI.',
 manifest:'/manifest.webmanifest',
 appleWebApp:{
  capable:true,
  title:'Paper Voice',
  statusBarStyle:'black-translucent'
 }
};

export const viewport: Viewport = {
 width:'device-width',
 initialScale:1,
 viewportFit:'cover',
 themeColor:'#111111'
};

export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){
 return <html lang="pt-BR"><body>{children}</body></html>;
}
