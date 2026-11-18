import {SKILLS,bestHourPoints,chartPoints,joinHistoryEdges} from './xpAnalytics';
import type {XpPoint} from './xpAnalytics';
import {trackerHours,MAX_XP} from './xpRates';

export const DAY=86400000;
export const dateKey=(t:number)=>new Date(t).toISOString().slice(0,10);
export type Hour={xp:number;from:number;to:number;samples:number};
type Edges=Parameters<typeof joinHistoryEdges>[0];
export type DailySkill={xp:Record<string,number>;readAt:number;unavailable:boolean};
export type HistoryPlayer={slug:string;name:string;skills:Record<string,DailySkill>};
export type HistoryPair={slug:string;name:string;skill:string;days:string[];done:Record<string,'ok'|'unavailable'>;records:Hour[];edges:Edges;indexed:boolean};
export type HistoryState={version:1;createdAt:number;updatedAt:number;players:Record<string,HistoryPlayer>;pairs:Record<string,HistoryPair>;requests:number;error:string|null};
export function monthDates(now=Date.now()){const end=Math.floor(now/DAY)*DAY;return Array.from({length:30},(_,i)=>dateKey(end-(30-i)*DAY));}
export function dailyValues(chart:{points:XpPoint[];tolerance:number}){
 const values:Record<string,number>={};
 for(const p of chart.points){
  const boundary=Math.round(p.t/DAY)*DAY;
  if(p.xp>=0&&Math.abs(p.t-boundary)<=chart.tolerance)values[dateKey(boundary)]=p.xp;
 }
 return values;
}
export function rememberHour(pair:HistoryPair,hour:Hour|null){
 if(hour&&hour.xp>0&&!pair.records.some(r=>r.xp===hour.xp&&r.from===hour.from&&r.to===hour.to))pair.records.push(hour);
}
export function recordChart(pair:HistoryPair,day:string,chart:{points:XpPoint[];tolerance:number}){
 rememberHour(pair,bestHourPoints(chart.points,chart.tolerance));
 rememberHour(pair,joinHistoryEdges(pair.edges,day,chart));
 pair.done[day]='ok';
}
export function createHistory(snapshots:any[],scan:any,now=Date.now()):HistoryState{
 const history:HistoryState={version:1,createdAt:now,updatedAt:now,players:{},pairs:{},requests:0,error:null};
 mergeHistory(history,snapshots,scan,now);
 return history;
}
export function mergeHistory(history:HistoryState,snapshots:any[],scan:any,now=Date.now()){
 // Process probable leaders first, while ultimately including the entire roster.
 const players=snapshots.flatMap(s=>s.players??[]).sort((a,b)=>b.skills.reduce((n:number,s:any)=>n+Math.min(MAX_XP,s.xp),0)-a.skills.reduce((n:number,s:any)=>n+Math.min(MAX_XP,s.xp),0));
 for(const p of players)if(!Object.hasOwn(history.players,p.slug))Object.defineProperty(history.players,p.slug,{value:{slug:p.slug,name:p.name,skills:{}},enumerable:true,writable:true,configurable:true});
 const end=Math.floor(now/DAY)*DAY;
 for(const p of scan.players??[]){
  const key=p.skill+':'+p.slug;
  let pair=history.pairs[key];
  if(!pair){
   pair=history.pairs[key]={slug:p.slug,name:p.name,skill:p.skill,days:[...new Set<string>(p.days??[])].sort(),done:{},records:[],edges:p.edges??{},indexed:p.days!==null};
   // A checked date with no retained chart edges was explicitly unavailable.
   for(const day of (p.days??[]).slice(0,p.next??0))if(!p.edges?.[day])pair.done[day]='unavailable';
  }
  rememberHour(pair,p.best);
  const latest=pair.days.at(-1);
  if(latest)for(let t=Date.parse(latest+'T00:00:00Z')+DAY;t<end;t+=DAY)pair.days.push(dateKey(t));
 }
}
export type Ranked={slug:string;name:string;value:number;rank:number};
export function pointRanks(pairs:HistoryPair[],cutoff:number):Ranked[]{
 const players=new Map<string,{slug:string;name:string;value:number}>();
 for(const skill of SKILLS){
  const leaders=pairs.filter(p=>p.skill===skill).map(p=>{
   const best=p.records.filter(r=>r.to<=cutoff&&r.xp>0).reduce((n,r)=>Math.max(n,r.xp),0);
   return {...p,best};
  }).filter(p=>p.best>0).sort((a,b)=>b.best-a.best||a.slug.localeCompare(b.slug)).slice(0,5);
  leaders.forEach((p,i)=>{if(!players.has(p.slug))players.set(p.slug,{slug:p.slug,name:p.name,value:0});players.get(p.slug)!.value+=5-i;});
 }
 return [...players.values()].sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name,'en')||a.slug.localeCompare(b.slug,'en')).slice(0,10).map((p,i)=>({...p,rank:i+1}));
}
export function maxRanks(players:HistoryPlayer[],boundary:string,hours=trackerHours):Ranked[]{
 return players.flatMap(p=>{
  const xp=SKILLS.map(skill=>p.skills[skill]?.xp[boundary]);
  if(xp.some(n=>n===undefined))return [];
  let value=0;
  for(let i=0;i<SKILLS.length;i++){const skill=SKILLS[i];if(skill==='hitpoints')continue;const h=hours(skill,xp[i]!,MAX_XP);if(h===null)return [];value+=h;}
  return [{slug:p.slug,name:p.name,value}];
 }).sort((a,b)=>a.value-b.value||a.name.localeCompare(b.name)).slice(0,10).map((p,i)=>({...p,rank:i+1}));
}
export function buildHistory(history:HistoryState,now=Date.now()){
 const dates=monthDates(now),players=Object.values(history.players),pairs=Object.values(history.pairs);
 const yesterday=dates.at(-1)!;
 const dailyTotal=players.length*SKILLS.length;
 const dailyRead=players.reduce((n,p)=>n+Object.values(p.skills).filter(s=>s.readAt>0).length,0);
 const hourlyTotal=pairs.reduce((n,p)=>n+p.days.filter(d=>d<=yesterday).length,0);
 const hourlyRead=pairs.reduce((n,p)=>n+p.days.filter(d=>d<=yesterday&&p.done[d]).length,0);
 const unavailable=pairs.reduce((n,p)=>n+Object.values(p.done).filter(s=>s==='unavailable').length,0);
 const indexed=pairs.filter(p=>p.indexed).length;
 const days=dates.map(date=>{
  const cutoff=Date.parse(date+'T00:00:00Z')+DAY,boundary=dateKey(cutoff);
  const closest=maxRanks(players,boundary);
  const knownPlayers=players.filter(p=>SKILLS.every(s=>p.skills[s]?.xp[boundary]!==undefined)).length;
  return {date,closest,points:pointRanks(pairs,cutoff),knownPlayers,totalPlayers:players.length};
 });
 return {version:1,generatedAt:now,sourceUpdatedAt:history.updatedAt,dates,days,
  coverage:{dailyRead,dailyTotal,hourlyRead,hourlyTotal,unavailable,indexed,pairs:pairs.length,requests:history.requests,
   percent:(dailyTotal+hourlyTotal)?Math.min(100,(dailyRead+hourlyRead)/(dailyTotal+hourlyTotal)*100):0,
   complete:dailyRead===dailyTotal&&hourlyRead===hourlyTotal&&indexed===pairs.length,
   error:history.error},
  note:'Reconstructed for sampled players. Missing retained history cannot be recovered. Points use known all-time records up to each UTC day end; hours use current EHP rates.'};
}
// Expose the source parser through one tested historical adapter.
export const historicalChart=chartPoints;
