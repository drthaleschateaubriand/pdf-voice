import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
 title:'Paper Voice',
 description:'Leitor de PDF com narração por voz da OpenAI.',
 manifest:'/manifest.webmanifest',
 appleWebApp:{
  capable:true,
  title:'Paper Voice',
  statusBarStyle:'black-translucent'
 },
 viewport:'width=device-width, initial-scale=1, viewport-fit=cover'
};

export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){
 return <html lang="pt-BR"><body>{children}</body></html>;
}
