import {test,expect} from 'bun:test';
import {monthDates,dailyValues,maxRanks,pointRanks,createHistory,mergeHistory,recordChart,rememberHour,buildHistory} from '../src/leaderboardHistory';
import type {HistoryPair,HistoryPlayer} from '../src/leaderboardHistory';
import {SKILLS} from '../src/xpAnalytics';
import {MAX_XP} from '../src/xpRates';
const hour=(xp:number,to:string)=>({xp,from:Date.parse(to)-3600000,to:Date.parse(to),samples:5});
const pair=(slug:string,skill='attack',records=[hour(100,'2026-10-01T12:00:00Z')]):HistoryPair=>({slug,name:slug.toUpperCase(),skill,records,days:[],done:{},edges:{},indexed:true});
const player=(slug:string,xp:number,boundary='2026-11-18'):HistoryPlayer=>({slug,name:slug.toUpperCase(),skills:Object.fromEntries(SKILLS.map(s=>[s,{xp:{[boundary]:xp},readAt:1,unavailable:false}]))});
test('30 completed days use UTC boundaries, including around daylight-saving changes',()=>{
 const d=monthDates(Date.parse('2026-11-18T20:00:00Z'));expect(d).toHaveLength(30);expect(d[0]).toBe('2026-10-19');expect(d.at(-1)).toBe('2026-11-17');
 expect(monthDates(Date.parse('2026-10-26T00:30:00Z')).at(-1)).toBe('2026-10-25');
});
test('daily XP accepts only observed midnight values within source rounding tolerance',()=>{
 const t=Date.parse('2026-11-17T00:00:00Z');
 expect(dailyValues({points:[{t:t-60000,xp:100},{t:t+86400000+60000,xp:200},{t:t+43200000,xp:150}],tolerance:120000})).toEqual({'2026-11-17':100,'2026-11-18':200});
});
test('daily max ranks require all skills, use current rates and exclude extra Hitpoints time',()=>{
 const a=player('a',MAX_XP-100),b=player('b',MAX_XP-200),missing=player('missing',MAX_XP);delete missing.skills.prayer;
 const rate100=(_s:string,from:number,to:number)=>Math.max(0,to-from)/100;
 const rank=maxRanks([b,missing,a],'2026-11-18',rate100);
 expect(rank.map(r=>r.slug)).toEqual(['a','b']);expect(rank[0].value).toBe(18);
 const rate200=(_s:string,from:number,to:number)=>Math.max(0,to-from)/200;
 expect(maxRanks([a],'2026-11-18',rate200)[0].value).toBe(9);
 expect(maxRanks([a],'2026-11-17')).toEqual([]);
});
test('points include pre-month records, exclude future records and aggregate across skills',()=>{
 const a=pair('a','attack',[hour(100,'2026-10-01T12:00:00Z'),hour(1000,'2026-11-19T12:00:00Z')]);
 const b=pair('b','attack',[hour(200,'2026-11-01T12:00:00Z')]);
 const c=pair('c','attack',[hour(50,'2026-11-01T12:00:00Z')]);
 const ranks=pointRanks([a,b,c,pair('a','mining')],Date.parse('2026-11-18T00:00:00Z'));
 expect(ranks.map(r=>[r.slug,r.value])).toEqual([['a',9],['b',5],['c',3]]);
 expect(pointRanks([a,b],Date.parse('2026-11-20T00:00:00Z'))[0].slug).toBe('a');
 expect(pointRanks([pair('z'),pair('b','mining')],Date.now()).map(p=>p.slug)).toEqual(['b','z']);
});
test('cross-midnight records count on their finish day, in either collection order',()=>{
 const make=(t:string,xp:number)=>({t:Date.parse(t),xp});
 const first={points:[make('2026-11-16T23:30:00Z',0),make('2026-11-16T23:45:00Z',100)],tolerance:1000};
 const second={points:[make('2026-11-17T00:00:00Z',200),make('2026-11-17T00:15:00Z',300),make('2026-11-17T00:30:00Z',400)],tolerance:1000};
 for(const reversed of [false,true]){
  const p=pair('a','attack',[]);
  if(reversed){recordChart(p,'2026-11-17',second);recordChart(p,'2026-11-16',first);}
  else{recordChart(p,'2026-11-16',first);recordChart(p,'2026-11-17',second);}
  expect(pointRanks([p],Date.parse('2026-11-17T00:00:00Z'))).toEqual([]);
  expect(pointRanks([p],Date.parse('2026-11-18T00:00:00Z'))[0].value).toBe(5);
  expect(p.records[0].xp).toBe(400);
 }
});
test('resume preserves daily records, completed tasks and seed anchors without duplicates',()=>{
 const scan={players:[{slug:'a',name:'A',skill:'attack',days:['2026-11-16'],next:1,best:hour(100,'2026-11-16T12:00:00Z'),edges:{}}]};
 const time=Date.parse('2026-11-18T12:00:00Z'),state=createHistory([],scan,time);
 const p=state.pairs['attack:a'];expect(p.done['2026-11-16']).toBe('unavailable');
 rememberHour(p,p.records[0]);mergeHistory(state,[],scan,time);expect(p.records).toHaveLength(1);
 expect(p.days.filter(d=>d==='2026-11-17')).toHaveLength(1);
 const restored=JSON.parse(JSON.stringify(state));mergeHistory(restored,[],scan,time);
 expect(restored.pairs['attack:a'].done).toEqual(p.done);
 const result=buildHistory(restored,time);expect(result.days.every(d=>d.closest.length===0)).toBe(true);
 expect(result.coverage.complete).toBe(false);
});
test('daily entrants leave gaps and ranks retain only each day’s top ten',()=>{
 const group=Array.from({length:11},(_,i)=>player(String(i),MAX_XP-i));
 expect(maxRanks(group,'2026-11-18')).toHaveLength(10);
 const removed=group[0];delete removed.skills.prayer.xp['2026-11-18'];
 expect(maxRanks(group,'2026-11-18').some(p=>p.slug==='10')).toBe(true);
});
test('valid names matching object properties remain ordinary player entries',()=>{
 const h=createHistory([{players:[{...player('constructor',0),skills:SKILLS.map(skill=>({skill,xp:0}))},{...player('__proto__',0),skills:SKILLS.map(skill=>({skill,xp:0}))}]}],{players:[]});
 expect(Object.hasOwn(h.players,'constructor')).toBe(true);expect(Object.hasOwn(h.players,'__proto__')).toBe(true);
 expect(Object.getPrototypeOf(h.players)).toBe(Object.prototype);
});
