import {mkdir,copyFile,readFile,writeFile,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const state=resolve('state');await mkdir(state,{recursive:true});
for(const file of ['xp-analytics-cache.json','xp-alltime-records.json']){
 try{await access(join(state,file));}catch{await copyFile(join('seed',file),join(state,file));}
}
process.env.DASHBOARD_DATA_DIR=state;
// Extend completed histories through today without throwing away their records.
const historyFile=join(state,'xp-alltime-records.json');
const history=JSON.parse(await readFile(historyFile,'utf8'));
const today=new Date().toISOString().slice(0,10);
let extended=false;
for(const player of history.players){
 if(!player.days?.length)continue;
 const last=[...player.days].sort().at(-1);
 for(let time=Date.parse(last+'T00:00:00Z')+86400000;time<=Date.parse(today+'T00:00:00Z');time+=86400000){
  player.days.push(new Date(time).toISOString().slice(0,10));extended=true;
 }
 // Today's chart can gain XP between scheduled runs; check it again each run.
 if(player.next>=player.days.length&&player.days.includes(today)){player.days=player.days.filter((day:string)=>day!==today).concat(today);player.next=player.days.length-1;extended=true;}
}
if(extended){history.complete=false;history.running=false;await writeFile(historyFile,JSON.stringify(history));}
const {handleXpRoute,parseBoard,character}=await import('../src/xpAnalytics');
const route=async(path:string,method='GET')=>{
 const response=await handleXpRoute(new Request('http://localhost/api/xp/'+path,{method}));
 if(!response.ok)throw new Error(`Data update failed: ${response.status}`);
 return response.json() as Promise<any>;
};
const file=join(state,'xp-analytics-cache.json'),warnings:string[]=[];
// Keep every successful range update even if a later source request fails.
let saved=JSON.parse(await readFile(file,'utf8'));
for(const range of ['7','1','30']){
 console.log(`Refreshing ${range}-day player snapshot`);
 const previous=saved.snapshots.find((s:any)=>s.range===range);
 let result=await route(`refresh?range=${range}`,'POST');
 const deadline=Date.now()+20*60_000;
 while(result.running||result.recordsRunning){
  if(Date.now()>deadline)throw new Error('Source collection exceeded its time budget; retained snapshots are unchanged.');
  await Bun.sleep(2500);result=await route(`overview?range=${range}`);
 }
 const current=JSON.parse(await readFile(file,'utf8')).snapshots.find((s:any)=>s.range===range);
 if(result.error||!current||current.boards.length!==19){
  warnings.push(`The ${range}-day update failed; its previous snapshot was retained.`);
  if(previous)saved.snapshots=saved.snapshots.filter((s:any)=>s.range!==range).concat(previous);
  await writeFile(file,JSON.stringify(saved));continue;
 }
 const players=new Map(current.players.map((p:any)=>[p.slug,p]));
 // Discover the complete public overall roster, rather than just skill contenders.
 const seen=new Set<string>();
 for(let page=1;page<=100;page++){
  try{
   await Bun.sleep(150);
   const response=await fetch(`https://rs2b2t.com/progress?range=${range}&skill=overall&sort=level&dir=desc&page=${page}`,{signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw new Error(`HTTP ${response.status}`);
   const rows=parseBoard(await response.text(),'overall');
   const fresh=rows.filter(p=>!seen.has(p.slug));
   if(!fresh.length)break;
   for(const row of fresh){seen.add(row.slug);if(!players.has(row.slug)){
    try{players.set(row.slug,await character(row.slug,range));}catch{warnings.push(`Some ${range}-day characters could not be refreshed.`);}
   }}
  }catch{warnings.push(`The ${range}-day roster is partial; available characters are shown.`);break;}
 }
 current.players=[...players.values()];current.updatedAt=Date.now();current.phase='Published snapshot';
 saved.snapshots=saved.snapshots.filter((s:any)=>s.range!==range).concat(current);
 await writeFile(file,JSON.stringify(saved));console.log(`${range}-day snapshot: ${players.size} characters`);
}
// Historical scanning resumes saved work; complete seed scans are retained.
let scan=await route('alltime');
if(!scan.complete){
 await route('alltime?action=start','POST');
 const deadline=Date.now()+Number(process.env.SCAN_MINUTES??'8')*60_000;
 do{await Bun.sleep(5000);scan=await route('alltime');}while(scan.running&&Date.now()<deadline);
 await route('alltime?action=pause','POST');
 while((await route('alltime')).running)await Bun.sleep(500);
}
await writeFile(join(state,'refresh-status.json'),JSON.stringify({updatedAt:Date.now(),warning:[...new Set(warnings)].join(' ')}));
console.log('Public data update complete.');
