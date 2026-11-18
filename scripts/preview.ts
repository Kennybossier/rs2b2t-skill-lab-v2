import {resolve,sep} from 'node:path';
const root=resolve('dist'),port=Number(process.env.PORT??'7334');
const server=Bun.serve({hostname:'127.0.0.1',port,async fetch(req){
 const url=new URL(req.url),decoded=decodeURIComponent(url.pathname),relative=decoded.replace(/^\/rs2b2t-skill-lab-v2\/?/,'/');
 const file=resolve(root,'.'+(relative.endsWith('/')?relative+'index.html':relative));
 if(!file.startsWith(root+sep))return new Response('Not found',{status:404});
 const asset=Bun.file(file);return await asset.exists()?new Response(asset):new Response('Not found',{status:404});
}});
console.log(`Standalone preview: http://127.0.0.1:${server.port}/rs2b2t-skill-lab-v2/`);
