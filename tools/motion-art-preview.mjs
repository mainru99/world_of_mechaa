/* Local art review only. No API, credentials or database. */
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,dirname,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.argv[2]||8124);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.webp':'image/webp','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};
http.createServer(async(req,res)=>{
  try{
    const name=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
    const allowed=/^\/(assets|js|data)\//.test(name)||
      ['/docs/art/attack-motion-preview.html','/docs/art/attack-motion-review.html','/docs/art/azure-dagger-sequence-preview.html'].includes(name);
    const file=resolve(root,'.'+name);
    if(req.method!=='GET'||!allowed||!file.startsWith(root+sep)||!mime[extname(file)]||!(await stat(file)).isFile()){
      res.writeHead(404);res.end('Not found');return;
    }
    res.writeHead(200,{'content-type':mime[extname(file)],'cache-control':'no-store'});
    res.end(await readFile(file));
  }catch{res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log('ROWAR art review http://127.0.0.1:'+port+'/docs/art/attack-motion-review.html'));

