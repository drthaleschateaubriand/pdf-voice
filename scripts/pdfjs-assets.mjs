import fs from 'node:fs';
import path from 'node:path';
import {projectRoot} from './sites-env.mjs';
// The reader loads PDF.js's worker, CMaps and standard fonts from public/;
// they come from the installed pdfjs-dist so they always match its version.
const source=path.join(projectRoot,'node_modules','pdfjs-dist'),target=path.join(projectRoot,'public');
fs.mkdirSync(target,{recursive:true});
fs.copyFileSync(path.join(source,'build','pdf.worker.min.mjs'),path.join(target,'pdf.worker.min.mjs'));
fs.copyFileSync(path.join(source,'legacy','build','pdf.worker.min.mjs'),path.join(target,'pdf.worker.legacy.min.mjs'));
for(const name of ['cmaps','standard_fonts']){fs.rmSync(path.join(target,name),{recursive:true,force:true});fs.cpSync(path.join(source,name),path.join(target,name),{recursive:true});}
console.log('PDF.js assets copied to public/.');
