import {mkdir,copyFile,readdir,access,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const state=resolve('state');await mkdir(state,{recursive:true});
for(const file of ['xp-analytics-cache.json','xp-alltime-records.json']){
 try{await access(join(state,file));}catch{await copyFile(join('seed',file),join(state,file));}
}
process.env.DASHBOARD_DATA_DIR=state;
const {handleXpRoute}=await import('../src/xpAnalytics');
const {loadHistory,saveHistory}=await import('./history-state');
const {buildHistory}=await import('../src/leaderboardHistory');
const {trackerEstimate,RATE_SOURCE}=await import('../src/xpRates');
await mkdir('dist/data',{recursive:true});
for(const file of await readdir('public'))await copyFile(join('public',file),join('dist',file));
const raw=JSON.parse(await readFile(join(state,'xp-analytics-cache.json'),'utf8'));
const roster=new Map<string,{name:string;slug:string}>();
const ranges:string[]=[];
const output=async(file:string,value:unknown)=>writeFile(join('dist/data',file),JSON.stringify(value));
for(const snapshot of raw.snapshots){
 if(snapshot.error||snapshot.boards.length!==19||!snapshot.players.length)continue;
 const range=snapshot.range;ranges.push(range);
 const response=await handleXpRoute(new Request(`http://localhost/api/xp/overview?range=${range}`));
 if(!response.ok)throw new Error(`Overview failed for range ${range}`);
 const overview=await response.json() as any;
 overview.phase='Published snapshot';overview.running=false;overview.recordsRunning=false;
 await output(`overview-${range}.json`,overview);
 const players=Object.fromEntries(snapshot.players.map((player:any)=>{
  roster.set(player.slug,{name:player.name,slug:player.slug});
  const estimate=trackerEstimate(player.skills);
  return [player.slug,{...player,timeToMax:estimate,referenceRates:Object.fromEntries(estimate.skills.map((s:any)=>[s.skill,s.referenceRate])),referenceSource:RATE_SOURCE,referenceProvisional:false}];
 }));
 await output(`characters-${range}.json`,players);
}
if(!ranges.length)throw new Error('No valid snapshots; refusing to publish an empty site.');
const alltime=await(await handleXpRoute(new Request('http://localhost/api/xp/alltime'))).json() as any;
alltime.running=false;alltime.error=null;alltime.phase=alltime.complete?'Complete · retained history checked':'Saved historical scan checkpoint';
await output('alltime.json',alltime);
const scan=JSON.parse(await readFile(join(state,'xp-alltime-records.json'),'utf8'));
await output('hours.json',Object.fromEntries(scan.players.map((p:any)=>[`${p.slug}:${p.skill}`,p.best])));
let warning='';try{warning=JSON.parse(await readFile(join(state,'refresh-status.json'),'utf8')).warning??'';}catch{}
const manifest={version:1,builtAt:Date.now(),ranges:ranges.sort((a,b)=>Number(a)-Number(b)),characters:[...roster.values()].sort((a,b)=>a.name.localeCompare(b.name)),warning,
 source:'https://rs2b2t.com/progress',rateSource:RATE_SOURCE,scanDays:alltime.scannedDays};
const history=await loadHistory();await saveHistory(history);
await output('history.json',buildHistory(history));
await output('manifest.json',manifest);await writeFile('dist/.nojekyll','');
console.log(JSON.stringify({ranges:manifest.ranges,characters:roster.size,scanDays:alltime.scannedDays,output:resolve('dist')}));
