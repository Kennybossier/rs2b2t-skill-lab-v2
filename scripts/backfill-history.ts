import {loadHistory,saveHistory} from './history-state';
import {SKILLS,source,chartPoints,historicalDays,parsePlayer} from '../src/xpAnalytics';
import {dailyValues,dateKey,DAY,recordChart,buildHistory} from '../src/leaderboardHistory';
const history=await loadHistory(),players=Object.values(history.players),pairs=Object.values(history.pairs);
const deadline=Date.now()+Number(process.env.HISTORY_MINUTES??'8')*60_000;
const today=dateKey(Date.now()),yesterday=dateKey(Date.parse(today+'T00:00:00Z')-DAY);
const errors:string[]=[];let cursor=0,iteration=0,requests=0;
history.error=null;
// Current leader contenders come first, then the rest of the frozen sampled roster.
while(Date.now()<deadline){
 const daily=players.flatMap(p=>SKILLS.filter(s=>!p.skills[s]||dateKey(p.skills[s].readAt)!==today).map(skill=>({p,skill})))
  .sort((a,b)=>(a.p.skills[a.skill]?.readAt??0)-(b.p.skills[b.skill]?.readAt??0))[0];
 let hourly: {pair:typeof pairs[number];day:string|null}|undefined;
 for(let i=0;i<pairs.length;i++){
  const pair=pairs[(cursor+i)%pairs.length];
  if(!pair.indexed){hourly={pair,day:null};cursor=(cursor+i+1)%pairs.length;break;}
  const day=pair.days.find(d=>d<=yesterday&&!pair.done[d]);
  if(day){hourly={pair,day};cursor=(cursor+i+1)%pairs.length;break;}
 }
 if(!daily&&!hourly)break;
 try{
  if(daily&&(!hourly||iteration%2===0)){
   const {p,skill}=daily;
   const html=await source(`/progress/${p.slug}?range=all&skill=${skill}`);
   const chart=chartPoints(html,'day');
   if(!chart)parsePlayer(html,p.slug);
   p.skills[skill]={xp:chart?dailyValues(chart):{},readAt:Date.now(),unavailable:!chart};
  }else if(hourly){
   const {pair,day}=hourly;
   if(day===null){
    const html=await source(`/progress/${pair.slug}?range=all&skill=${pair.skill}`);
    const chart=chartPoints(html,'day');
    if(!chart)parsePlayer(html,pair.slug);
    pair.days=chart?historicalDays(chart.points).filter(d=>d<=yesterday):[];pair.indexed=true;
   }else{
    const next=dateKey(Date.parse(day+'T00:00:00Z')+DAY);
    const html=await source(`/progress/${pair.slug}?from=${day}&to=${next}&skill=${pair.skill}`);
    const chart=chartPoints(html);
    if(chart)recordChart(pair,day,chart);else{parsePlayer(html,pair.slug);pair.done[day]='unavailable';}
   }
  }
  requests++;history.requests++;history.updatedAt=Date.now();
 }catch(error){errors.push(error instanceof Error?error.message:String(error));history.error=errors.at(-1)!;break;}
 iteration++;
 if(iteration%10===0){await saveHistory(history);console.log(JSON.stringify({requests,remainingMinutes:Math.max(0,(deadline-Date.now())/60000).toFixed(1)}));}
}
await saveHistory(history);
const result=buildHistory(history);console.log(JSON.stringify({requests,coverage:result.coverage,daysWithMaxResults:result.days.filter(d=>d.closest.length).length}));
// Checkpoints are saved even when upstream is unavailable; the existing site stays usable.
