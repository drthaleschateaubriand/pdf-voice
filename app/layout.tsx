import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:'Paper / voice',description:'Listen to PDFs with Cartesia or OpenAI speech and follow highlighted passages.'};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>}
