import express from 'express';
import {mkdirSync,readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {openStore} from './store.mjs';
import {createApi} from './api.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export function createApplication(options){
  const db=openStore(options.dataDir),directory=join(resolve(options.dataDir),'media');
  mkdirSync(directory,{recursive:true,mode:0o700});
  return createApi({...options,db,media:{
    save:(id,bytes)=>sharp(bytes,{limitInputPixels:40000000}).rotate().webp({quality:88}).toFile(join(directory,id+'.webp')),
    read:id=>{const path=join(directory,id+'.webp');return existsSync(path)?readFileSync(path):null;}
  },installStatic(app){
    app.use('/vendor/pdfjs',express.static(join(root,'node_modules/pdfjs-dist'),{index:false}));
    app.get('/vendor/html2canvas.js',(req,res)=>res.sendFile(join(root,'node_modules/html2canvas/dist/html2canvas.min.js')));
    app.get('/vendor/jspdf.js',(req,res)=>res.sendFile(join(root,'node_modules/jspdf/dist/jspdf.umd.min.js')));
    // Same clean URL that Workers assets serve for admin/login.html.
    app.get('/admin/login',(req,res)=>res.sendFile(join(root,'public/admin/login.html')));
    app.use(express.static(join(root,'public'),{etag:true,maxAge:0}));
  }});
}
