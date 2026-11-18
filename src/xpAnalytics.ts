// Public progress data only. No game/account credentials are used.
import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {RATE_SOURCE,trackerRate,trackerSkill,trackerEstimate,trackerMethods} from './xpRates';
export const SKILLS = ['attack','defence','strength','hitpoints','ranged','prayer','magic','cooking','woodcutting','fletching','fishing','firemaking','crafting','smithing','mining','herblore','agility','thieving','runecraft'] as const;
export const skillName = (s: string) => s === 'runecraft' ? 'Runecrafting' : s[0].toUpperCase() + s.slice(1);
export const MAX_SKILL_XP=13_034_431;
export type Stat = { skill: string; level: number; xp: number; gains: number | null; rate: number | null; hours: number | null };
export type Player = { name: string; slug: string; skills: Stat[]; hoursOnline?: number | null };
type Row = Stat & { name: string; slug: string };
type RecordHour = { xp: number; from: number; to: number; samples: number };
export type XpPoint = {t:number;xp:number};
type SkillBoard = { skill: string; baseline: number | null; referenceKind: 'skill'|'online'|null; sample: number; population: number; hours: number; leaders: Row[]; candidates: Row[]; record: (RecordHour & { name: string; slug: string }) | null; scanned: number; recordErrors: number };
const decode = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|#39|nbsp|mdash|ndash);/g, x => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'",'&nbsp;':' ','&mdash;':'—','&ndash;':'–'}[x] ?? x)).trim();
const number = (s: string): number | null => { const v = decode(s).replace(/[,+\s]/g,''); return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null; };
const attr = (s: string, key: string) => new RegExp(`(?:^|\\s)${key}=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(s)?.slice(1).find(v => v !== undefined) ?? '';
const table = (html: string, cls: string) => {
    const opening=[...html.matchAll(/<table\b([^>]*)>/gi)].find(m=>attr(m[1],'class').split(/\s+/).includes(cls));
    if(!opening)return undefined;
    const start=opening.index!+opening[0].length,end=html.indexOf('</table>',start);
    return end<0?undefined:html.slice(start,end);
};
const cells = (row: string) => [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
export function parseBoard(html: string, skill: string): Row[] {
    const body = table(html,'pg-table');
    if (body === undefined) throw new Error('The server progress table is unavailable or has changed.');
    return [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap(m => {
        const c = cells(m[1]); if (!c.length) return [];
        const slug = /href="\/progress\/([^"?]+)"/.exec(c[1])?.[1];
        if (!slug || c.length !== (skill === 'overall' ? 8 : 7)) throw new Error('Unexpected progress row.');
        const offset = skill === 'overall' ? 1 : 0;
        const xp = number(c[3+offset]), gains = number(c[4+offset]), level = number(c[2+offset]);
        if (xp === null || level === null) throw new Error('Invalid progress numbers.');
        return [{name:decode(c[1]),slug,skill,level,xp,gains,rate:number(c[5+offset]),hours:number(c[6+offset])}];
    });
}
export function parsePlayer(html: string, slug: string): Player {
    const body = table(html,'pg-skills');
    if (!body) throw new Error('Character not found, or no public progress is available.');
    const skills = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap(m => {
        const c = cells(m[1]); if (c.length !== 7) return [];
        const skill = SKILLS.find(s => skillName(s).toLowerCase() === decode(c[0]).toLowerCase());
        if (!skill) return [];
        const xp = number(c[3]), gains = number(c[4]), level = number(c[1]);
        if (xp === null || level === null) throw new Error('Invalid character skill data.');
        return [{skill,level,xp,gains,rate:number(c[5]),hours:number(c[6])}];
    });
    if (skills.length !== SKILLS.length) throw new Error('Incomplete character skill data.');
    const online = /<span\b[^>]*>\s*Hours online\s*<\/span>\s*<b\b[^>]*>([\s\S]*?)<\/b>/i.exec(html)?.[1];
    return {name:decode(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? slug),slug,skills,
        hoursOnline:online === undefined ? null : number(online)};
}
export function referenceRate(rows: Stat[]) {
    // One-hour minimum excludes tiny rounded denominators. Weighted mean, not mean of rates.
    const valid = rows.filter(r => r.gains !== null && r.gains > 0 && r.hours !== null && r.hours >= 1 && r.rate !== null && r.rate > 0);
    const hours = valid.reduce((n,r) => n + r.hours!,0);
    return {baseline:hours > 0 ? valid.reduce((n,r) => n+r.gains!,0)/hours : null,sample:valid.length,hours};
}
export function ehp(xp: number | null, baseline: number | null) { return xp!==null && baseline && baseline > 0 ? Math.max(0,xp)/baseline : null; }
export function sampleReference(skillRows:Stat[],onlineRows:Stat[]) {
    const skill=referenceRate(skillRows);
    if(skill.baseline!==null)return {...skill,referenceKind:'skill' as const};
    const online=referenceRate(onlineRows);
    return {...online,referenceKind:online.baseline!==null?'online' as const:null};
}
export function chartPoints(html:string,bucket='hour'): {points:XpPoint[];tolerance:number}|null {
    const figure = [...html.matchAll(/<figure\b([^>]*)>([\s\S]*?)<\/figure>/gi)].find(m => attr(m[1],'data-bucket') === bucket);
    if (!figure) return null;
    const line = /<polyline\b([^>]*)>/i.exec(figure[2]); if (!line) return null;
    const start = Number(attr(figure[1],'data-tmin')), span = Number(attr(figure[1],'data-tspan'));
    const left = Number(attr(figure[1],'data-ml')), width = Number(attr(figure[1],'data-w')) - left - 12;
    const values = attr(line[1],'data-v').split(',').map(Number);
    const xs = attr(line[1],'points').trim().split(/\s+/).map(p => Number(p.split(',')[0]));
    if (!(width > 0 && span > 0) || xs.length !== values.length || !values.every(Number.isFinite)) return null;
    const points = xs.map((x,i) => ({t:start+(x-left)/width*span, xp:values[i]}));
    // X coordinates are rounded to 0.1 SVG pixels. Allow only that timestamp uncertainty.
    const tolerance = span/width*0.11 + 1000;
    if(!points.every(p=>Number.isFinite(p.t)))return null;
    return {points,tolerance};
}
export function bestHourPoints(points:XpPoint[],tolerance:number):RecordHour|null {
    let best: RecordHour | null = null;
    for (let i=0;i<points.length;i++) {
        for (let j=i+1;j<points.length;j++) {
            const duration=points[j].t-points[i].t;
            if (duration > 3600000+tolerance) break;
            if (points[j].xp < points[j-1].xp || points[j].t-points[j-1].t > 1800000+tolerance) break;
            if (Math.abs(duration-3600000) <= tolerance) {
                const xp=points[j].xp-points[i].xp;
                if (xp >= 0 && (!best || xp > best.xp)) best={xp,from:Math.round(points[i].t),to:Math.round(points[j].t),samples:j-i+1};
            }
        }
    }
    return best;
}
export function bestHour(html:string):RecordHour|null {
    const chart=chartPoints(html);return chart?bestHourPoints(chart.points,chart.tolerance):null;
}
const DAY=86400000;
const dateKey=(time:number)=>new Date(time).toISOString().slice(0,10);
export function historicalDays(points:XpPoint[]):string[] {
    // Include neighbouring days for rolling windows that cross midnight.
    const dates=new Set<string>(),today=Math.floor(Date.now()/DAY)*DAY;
    const firstDay=points.length?Math.floor(points[0].t/DAY)*DAY:today;
    const add=(time:number)=>{const day=Math.floor(time/DAY)*DAY;if(day>=firstDay&&day<=today)dates.add(dateKey(day));};
    if(points.length)add(points[0].t);
    for(let i=1;i<points.length;i++){
        if(points[i].xp===points[i-1].xp)continue;
        const first=Math.floor(points[i-1].t/DAY)*DAY-DAY,last=Math.floor(points[i].t/DAY)*DAY+DAY;
        for(let day=first;day<=last;day+=DAY)add(day);
    }
    add(today);return [...dates].sort();
}

const cache = new Map<string,{time:number;html:string}>();
const pending = new Map<string,Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();
export async function source(path: string): Promise<string> {
    const saved=cache.get(path); if(saved && Date.now()-saved.time < 15*60000)return saved.html;
    if(pending.has(path))return pending.get(path)!;
    // Serialize requests and leave a gap, so a local dashboard cannot hammer the public site.
    const task=queue.catch(()=>{}).then(async()=>{
        await Bun.sleep(120);
        let response:Response|undefined;
        for(let attempt=0;attempt<4;attempt++){
            try {
                response=await fetch(`https://rs2b2t.com${path}`,{signal:AbortSignal.timeout(20000),headers:{Accept:'text/html'}});
                if(![429,502,503,504].includes(response.status)||attempt===3)break;
                await response.body?.cancel();
            }catch(error){if(attempt===3)throw error;}
            await Bun.sleep(1000*2**attempt);
        }
        if(!response)throw new Error('Public progress could not be reached. Resume to retry.');
        if(!response.ok)throw new Error(`Public progress returned HTTP ${response.status}. Try again later.`);
        const html=await response.text();
        if(html.length > 3000000)throw new Error('Unexpected progress response size.');
        cache.set(path,{time:Date.now(),html});
        if(cache.size>2500)cache.delete(cache.keys().next().value!);
        return html;
    });
    queue=task;pending.set(path,task);
    try{return await task;}finally{pending.delete(path);}
}
const ranges=new Set(['1','7','30']);
const cleanName=(name:string)=>name.trim().toLowerCase().replace(/ /g,'_');
const characterCache=new Map<string,{time:number;player:Player}>();
export async function character(name:string,range:string) {
    const slug=cleanName(name);
    if(!/^[a-z0-9_]{1,12}$/.test(slug))throw new Error('Use a character name of 1–12 letters, numbers or spaces.');
    const key=`${range}:${slug}`,saved=characterCache.get(key);
    if(saved&&saved.player.hoursOnline!==undefined&&Date.now()-saved.time<15*60000)return saved.player;
    const player=parsePlayer(await source(`/progress/${slug}?range=${range}`),slug);
    characterCache.set(key,{time:Date.now(),player});
    if(characterCache.size>2500)characterCache.delete(characterCache.keys().next().value!);
    return player;
}
type Snapshot = {range:string;startedAt:number;updatedAt:number;running:boolean;phase:string;error:string|null;boards:SkillBoard[];players:Player[];verified:boolean;unseenUpperBound:number|null;failedPlayers:number;recordsRunning:boolean};
const snapshots=new Map<string,Snapshot>();
const cacheDir=process.env.DASHBOARD_DATA_DIR??join(import.meta.dir,'../work');
const cacheFile=join(cacheDir,'xp-analytics-cache.json');
try {
    const saved=JSON.parse(readFileSync(cacheFile,'utf8'));
    if(saved.version===1||saved.version===2)for(const s of saved.snapshots as Snapshot[]){
        for(const player of s.players??[])characterCache.set(`${s.range}:${player.slug}`,{time:s.updatedAt,player});
        if(saved.version===2&&ranges.has(s.range)&&s.boards.length===19&&!s.error){s.running=false;s.recordsRunning=false;s.phase='Saved snapshot';snapshots.set(s.range,s);}
    }
}catch{/* First run or invalid cache: collect fresh public data. */}
function persist(){
    try{mkdirSync(cacheDir,{recursive:true});writeFileSync(cacheFile+'.tmp',JSON.stringify({version:2,snapshots:[...snapshots.values()].filter(s=>!s.running)}));renameSync(cacheFile+'.tmp',cacheFile);}
    catch(error){console.warn('XP snapshot could not be saved:',error instanceof Error?error.message:String(error));}
}
export function rankPlayers(players:Player[]) {
    const ranked = players.map(p=>{
        const estimate=trackerEstimate(p.skills);
        const hoursOnline = p.hoursOnline != null && Number.isFinite(p.hoursOnline) && p.hoursOnline > 0 ? p.hoursOnline : null;
        const efficiency = hoursOnline !== null && estimate.missingSkills.length === 0 ? 100 * estimate.totalEhp / hoursOnline : null;
        return {name:p.name,slug:p.slug,total:estimate.totalEhp,gained:estimate.gainedEhp,hoursToMax:estimate.hours,skillsMaxed:estimate.skillsMaxed,remainingXp:estimate.remainingXp,hoursOnline,efficiency};
    }).filter(p=>p.hoursToMax!==null).sort((a,b)=>a.hoursToMax!-b.hoursToMax!||a.name.localeCompare(b.name));
    const efficiencyLeaders = ranked.filter(p=>p.efficiency!==null)
        .sort((a,b)=>b.efficiency!-a.efficiency!||b.total-a.total||a.name.localeCompare(b.name)).slice(0,10);
    return {leaders:ranked.slice(0,10),efficiencyLeaders};
}
async function collect(s:Snapshot) {
    try {
        for(const skill of SKILLS) {
            s.phase=`Reading ${skillName(skill)} rates and leaders`;
            const active=parseBoard(await source(`/progress?range=${s.range}&skill=${skill}&sort=gains&dir=desc`),skill);
            const leaders=parseBoard(await source(`/progress?range=${s.range}&skill=${skill}&sort=xp&dir=desc`),skill);
            s.boards.push({skill,baseline:null,referenceKind:null,sample:0,hours:0,population:active.length,leaders,candidates:active,record:null,scanned:0,recordErrors:0});
            s.updatedAt=Date.now();
        }
        const candidates=new Set(s.boards.flatMap(b=>[...b.leaders,...b.candidates].map(p=>p.slug)));
        let completed=0;
        for(const slug of candidates) {
            s.phase=`Calculating time to max · ${++completed} / ${candidates.size} characters`;
            try{s.players.push(await character(slug,s.range));}catch{s.failedPlayers++;}
            for(const b of s.boards){
                if(b.baseline!==null)continue;
                const stats=b.candidates.map(row=>s.players.find(p=>p.slug===row.slug)?.skills.find(v=>v.skill===b.skill));
                if(stats.every((v):v is Stat=>v!==undefined)){
                    const ref=referenceRate(stats);Object.assign(b,ref);if(ref.baseline!==null)b.referenceKind='skill';
                }
            }
            s.updatedAt=Date.now();
        }
        for(const b of s.boards) {
            // Leaderboard hours are account-online hours. Character pages expose skill hours.
            // Never use the leaderboard denominator to estimate training efficiency.
            const sourceRows=b.candidates;
            const skillRows=sourceRows.flatMap(row=>{
                const stat=s.players.find(p=>p.slug===row.slug)?.skills.find(v=>v.skill===b.skill);
                return stat?[{...row,...stat}]:[];
            });
            const ref=sampleReference(skillRows,sourceRows);
            Object.assign(b,ref);b.candidates=ref.referenceKind==='skill'?skillRows:sourceRows;
            b.candidates=b.candidates.filter(v=>v.rate!==null&&v.hours!==null&&v.hours>=1&&v.gains!==null&&v.gains>0).sort((a,b)=>b.rate!-a.rate!);
        }
        // Every unseen player is at or below each skill's last fetched XP rank.
        // This bound can prove the total top 10 without crawling every server account.
        s.unseenUpperBound=null;s.verified=false;
        s.phase='Ready';
    }catch(error){s.error=error instanceof Error?error.message:String(error);s.phase='Collection incomplete';}
    finally{s.running=false;s.updatedAt=Date.now();persist();}
    if(!s.error)void scanRecords(s,3);
}
async function scanRecords(s:Snapshot,limit=3) {
    if(s.recordsRunning)return;
    s.recordsRunning=true;
    try{
        for(const b of s.boards) {
            b.record=null;b.scanned=0;b.recordErrors=0;
            for(const p of b.candidates.slice(0,limit)) {
                try{
                    const record=bestHour(await source(`/progress/${p.slug}?range=1&skill=${b.skill}`));
                    if(record && (!b.record || record.xp>b.record.xp))b.record={...record,name:p.name,slug:p.slug};
                    b.scanned++;
                }catch{b.recordErrors++;}
            }
        }
    }finally{s.recordsRunning=false;s.updatedAt=Date.now();persist();}
}

type HistoryEdges={first:XpPoint[];last:XpPoint[];tolerance:number};
type AllTimeCandidate={skill:string;name:string;slug:string;days:string[]|null;next:number;best:RecordHour|null;edges:Record<string,HistoryEdges>};
type OverallContender={name:string;slug:string;level:number};
type AllTimeScan={version:1;running:boolean;complete:boolean;startedAt:number;updatedAt:number;phase:string;error:string|null;discoveredSkills:number;scannedDays:number;unavailableDays:number;players:AllTimeCandidate[];overallPlayers?:OverallContender[]};
export function selectOverallTop40(pages:OverallContender[][]):OverallContender[]{
    const unique=new Map<string,OverallContender>();
    for(const row of pages.flat())if(!unique.has(row.slug))unique.set(row.slug,{name:row.name,slug:row.slug,level:row.level});
    const selected=[...unique.values()].slice(0,40);
    if(selected.length!==40)throw new Error('The overall total-level ranking did not return 40 distinct players.');
    return selected;
}
export function addOverallContenders(players:AllTimeCandidate[],overall:OverallContender[]):number {
    const existing=new Set(players.map(p=>`${p.skill}:${p.slug}`));let added=0;
    for(const skill of SKILLS)for(const p of overall){
        const key=`${skill}:${p.slug}`;if(existing.has(key))continue;
        players.push({skill,name:p.name,slug:p.slug,days:null,next:0,best:null,edges:{}});
        existing.add(key);added++;
    }
    return added;
}
const allTimeFile=join(cacheDir,'xp-alltime-records.json');
let allTime:AllTimeScan|null=null,allTimeWorker:Promise<void>|null=null,pauseAllTime=false;
try {
    const saved=JSON.parse(readFileSync(allTimeFile,'utf8')) as AllTimeScan;
    if(saved.version===1&&Array.isArray(saved.players)){
        allTime={...saved,unavailableDays:saved.unavailableDays??0,running:false,phase:saved.complete?'Complete':'Paused · resume saved scan'};
    }
}catch{/* No historical scan has been saved yet. */}
function saveAllTime(){
    if(!allTime)return;
    try{mkdirSync(cacheDir,{recursive:true});writeFileSync(allTimeFile+'.tmp',JSON.stringify(allTime));renameSync(allTimeFile+'.tmp',allTimeFile);}
    catch(error){console.warn('All-time XP scan could not be saved:',error instanceof Error?error.message:String(error));}
}
export function topFiveHours(players:Pick<AllTimeCandidate,'name'|'slug'|'skill'|'best'>[],skill:string){
    return players.filter(p=>p.skill===skill&&p.best!==null&&p.best.xp>0)
        .sort((a,b)=>b.best!.xp-a.best!.xp||a.slug.localeCompare(b.slug)).slice(0,5)
        .map(p=>({name:p.name,slug:p.slug,...p.best!}));
}
export function topFiveMedian(rates:number[]):number|null {
    const five=rates.filter(r=>Number.isFinite(r)&&r>0).sort((a,b)=>b-a).slice(0,5);
    return five.length===5?five[2]:null;
}
function efficiencyRateMap():Record<string,number|null>{
    return Object.fromEntries(SKILLS.map(skill=>[skill,trackerRate(skill,MAX_SKILL_XP)]));
}
export function estimateTimeToMax(skills:Stat[],rates:Record<string,number|null>){
    const rows=skills.map(s=>{
        const remainingXp=Math.max(0,MAX_SKILL_XP-s.xp);
        const value=rates[s.skill],rate=value!==null&&Number.isFinite(value)&&value>0?value:null;
        return {...s,remainingXp,referenceRate:rate,hoursTo99:remainingXp===0?0:rate===null?null:remainingXp/rate};
    });
    const missingSkills=rows.filter(s=>s.hoursTo99===null).map(s=>s.skill);
    const knownHours=rows.reduce((n,s)=>n+(s.hoursTo99??0),0);
    return {targetXp:MAX_SKILL_XP,hours:missingSkills.length?null:knownHours,knownHours,missingSkills,skillsMaxed:rows.filter(s=>s.remainingXp===0).length,remainingXp:rows.reduce((n,s)=>n+s.remainingXp,0),skills:rows};
}
export function joinHistoryEdges(edges:Record<string,HistoryEdges>,day:string,chart:{points:XpPoint[];tolerance:number}):RecordHour|null {
    let best=bestHourPoints(chart.points,chart.tolerance);
    edges[day]={first:chart.points.slice(0,5),last:chart.points.slice(-5),tolerance:chart.tolerance};
    const time=Date.parse(day+'T00:00:00Z');
    for(const neighbour of [dateKey(time-DAY),dateKey(time+DAY)]){
        const other=edges[neighbour];if(!other)continue;
        const points=[...other.first,...other.last,...chart.points.slice(0,5),...chart.points.slice(-5)]
            .sort((a,b)=>a.t-b.t).filter((p,i,a)=>i===0||Math.abs(p.t-a[i-1].t)>1000);
        const across=bestHourPoints(points,Math.max(other.tolerance,chart.tolerance));
        if(across&&(!best||across.xp>best.xp))best=across;
    }
    return best;
}
export function scanProgress(job:Pick<AllTimeScan,'players'|'discoveredSkills'|'complete'>){
    const historiesIndexed=job.players.filter(p=>p.days!==null).length,historiesTotal=job.players.length;
    const totalDays=job.players.reduce((n,p)=>n+(p.days?.length??0),0);
    const checkedDays=job.players.reduce((n,p)=>n+Math.min(p.next,p.days?.length??0),0);
    let stage='days',label='Scanning historical days',current=checkedDays,total=totalDays;
    if(job.complete){stage='complete';label='Scan complete';}
    else if(job.discoveredSkills<SKILLS.length){stage='discovery';label='Finding skill contenders';current=job.discoveredSkills;total=SKILLS.length;}
    else if(historiesIndexed<historiesTotal){stage='indexing';label='Indexing player histories';current=historiesIndexed;total=historiesTotal;}
    const percent=job.complete?100:total?Math.max(0,Math.min(99.9,current/total*100)):0;
    return {stage,label,current,total,percent,checkedDays,totalDays,historiesIndexed,historiesTotal};
}
function allTimeStatus(){
    if(!allTime)return {running:false,complete:false,phase:'Not scanned yet',boards:[],scannedDays:0,playerCount:0,discoveredSkills:0,error:null};
    return {running:allTime.running,complete:allTime.complete,phase:allTime.phase,error:allTime.error,startedAt:allTime.startedAt,updatedAt:allTime.updatedAt,scannedDays:allTime.scannedDays,unavailableDays:allTime.unavailableDays,playerCount:allTime.players.length,discoveredSkills:allTime.discoveredSkills,overallPlayers:allTime.overallPlayers??[],progress:scanProgress(allTime),
        boards:SKILLS.map(skill=>{
            const players=allTime!.players.filter(p=>p.skill===skill);
            const leaders=topFiveHours(players,skill);
            return {skill,leaders,referenceRate:trackerRate(skill,MAX_SKILL_XP),observedMedian:topFiveMedian(leaders.map(p=>p.xp)),referenceSample:leaders.length,players:players.length,overallPlayers:(allTime!.overallPlayers??[]).filter(p=>players.some(c=>c.slug===p.slug)).length,scannedDays:players.reduce((n,p)=>n+p.next,0),totalDays:players.reduce((n,p)=>n+(p.days?.length??0),0),historiesRead:players.filter(p=>p.days!==null).length};
        })};
}
async function runAllTimeScan(){
    const job=allTime!;job.running=true;job.error=null;pauseAllTime=false;
    try {
        if(job.overallPlayers?.length!==40){
            job.phase='Adding the top 40 overall total-level players to every skill';
            const first=parseBoard(await source('/progress?range=all&skill=overall&sort=level&dir=desc&page=1'),'overall');
            const second=parseBoard(await source('/progress?range=all&skill=overall&sort=level&dir=desc&page=2'),'overall');
            job.overallPlayers=selectOverallTop40([first,second]);
            addOverallContenders(job.players,job.overallPlayers);
            job.complete=false;job.updatedAt=Date.now();saveAllTime();
        }
        for(let i=job.discoveredSkills;i<SKILLS.length&&!pauseAllTime;i++){
            const skill=SKILLS[i];job.phase=`Finding all-time ${skillName(skill)} contenders`;
            const rates=parseBoard(await source(`/progress?range=all&skill=${skill}&sort=rate&dir=desc`),skill);
            const xp=parseBoard(await source(`/progress?range=all&skill=${skill}&sort=xp&dir=desc`),skill);
            const candidates=new Map([...rates.slice(0,10),...xp.slice(0,10)].map(p=>[p.slug,p]));
            const existing=new Set(job.players.filter(p=>p.skill===skill).map(p=>p.slug));
            for(const p of candidates.values())if(!existing.has(p.slug))job.players.push({skill,name:p.name,slug:p.slug,days:null,next:0,best:null,edges:{}});
            job.discoveredSkills=i+1;job.updatedAt=Date.now();saveAllTime();
        }
        // Round-robin passes give every skill results before fully exhausting one player.
        while(!pauseAllTime&&job.discoveredSkills===SKILLS.length){
            let remaining=false;
            for(const p of job.players){
                if(pauseAllTime)break;
                if(p.days===null){
                    job.phase=`Reading all-time ${skillName(p.skill)} history · ${p.name}`;
                    const history=await source(`/progress/${p.slug}?range=all&skill=${p.skill}`);
                    const chart=chartPoints(history,'day')??chartPoints(history);
                    if(!chart)parsePlayer(history,p.slug); // Reject maintenance/error pages.
                    p.days=chart?historicalDays(chart.points).reverse():[dateKey(Date.now())];
                }
                if(p.next>=p.days.length)continue;
                remaining=true;
                const day=p.days[p.next];
                job.phase=`${skillName(p.skill)} · ${p.name} · ${day}`;
                const html=await source(`/progress/${p.slug}?from=${day}&to=${dateKey(Date.parse(day+'T00:00:00Z')+DAY)}&skill=${p.skill}`);
                const chart=chartPoints(html);
                if(!chart){parsePlayer(html,p.slug);job.unavailableDays++;}
                const best=chart?joinHistoryEdges(p.edges,day,chart):null;
                if(best&&(!p.best||best.xp>p.best.xp))p.best=best;
                p.next++;job.scannedDays++;job.updatedAt=Date.now();
                if(job.scannedDays%10===0)saveAllTime();
            }
            if(!remaining&&!pauseAllTime){job.complete=true;job.phase='Complete · retained active-day history checked';break;}
        }
    }catch(error){job.error=`${job.phase}: ${error instanceof Error?error.message:String(error)}`;job.phase='Paused after an error · resume to retry';}
    finally{job.running=false;job.updatedAt=Date.now();if(pauseAllTime)job.phase='Paused · resume saved scan';saveAllTime();allTimeWorker=null;}
}
function handleAllTime(req:Request,url:URL):Response{
    if(req.method==='POST'){
        const action=url.searchParams.get('action')??'start';
        if(!['start','pause','restart'].includes(action))return Response.json({error:'Invalid scan action'},{status:400});
        if(action==='pause'){
            pauseAllTime=true;if(allTime?.running)allTime.phase='Pausing after the current request…';
        }else if(!allTimeWorker){
            if(!allTime||action==='restart')allTime={version:1,running:false,complete:false,startedAt:Date.now(),updatedAt:Date.now(),phase:'Starting all-time scan',error:null,discoveredSkills:0,scannedDays:0,unavailableDays:0,players:[]};
            if(!allTime.complete||allTime.overallPlayers?.length!==40)allTimeWorker=runAllTimeScan();
        }
    }else if(req.method!=='GET')return Response.json({error:'Method not allowed'},{status:405});
    return Response.json(allTimeStatus(),{headers:{'cache-control':'no-store'}});
}
export async function handleXpRoute(req:Request):Promise<Response> {
    const url=new URL(req.url),range=url.searchParams.get('range')??'7';
    const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
    if(url.pathname==='/api/xp/alltime')return handleAllTime(req,url);
    if(!ranges.has(range))return reply({error:'Choose 1, 7 or 30 days.'},400);
    if(req.method!=='GET'&&req.method!=='POST')return reply({error:'Method not allowed'},405);
    try {
        if(url.pathname==='/api/xp/character'&&req.method==='GET'){
            const name=url.searchParams.get('name')??'';
            if(!/^[a-z0-9_]{1,12}$/.test(cleanName(name)))return reply({error:'Use a character name of 1–12 letters, numbers or spaces.'},400);
            const player=await character(name,range);
            const estimate=trackerEstimate(player.skills);
            return reply({...player,timeToMax:estimate,referenceRates:Object.fromEntries(estimate.skills.map(s=>[s.skill,s.referenceRate])),referenceSource:RATE_SOURCE,referenceProvisional:false});
        }
        if(url.pathname==='/api/xp/hour'&&req.method==='GET') {
            const name=cleanName(url.searchParams.get('name')??''),skill=url.searchParams.get('skill')??'';
            if(!/^[a-z0-9_]{1,12}$/.test(name)||!SKILLS.includes(skill as typeof SKILLS[number]))return reply({error:'Invalid character or skill.'},400);
            return reply({record:bestHour(await source(`/progress/${name}?range=1&skill=${skill}`)),fetchedAt:Date.now()});
        }
        if(!['/api/xp/overview','/api/xp/refresh','/api/xp/records'].includes(url.pathname))return reply({error:'Not found'},404);
        let s=snapshots.get(range);
        if(url.pathname==='/api/xp/refresh'&&req.method!=='POST')return reply({error:'Use POST'},405);
        if(!s||(url.pathname==='/api/xp/refresh'&&!s.running&&!s.recordsRunning)) {
            s={range,startedAt:Date.now(),updatedAt:Date.now(),running:true,phase:'Reading public progress',error:null,boards:[],players:[],verified:false,unseenUpperBound:null,failedPlayers:0,recordsRunning:false};
            snapshots.set(range,s);void collect(s);
        }
        if(url.pathname==='/api/xp/records') {
            if(req.method!=='POST')return reply({error:'Use POST'},405);
            if(s.running)return reply({error:'Wait for the reference rates to finish loading.'},409);
            void scanRecords(s,10);
        }
        const rates=efficiencyRateMap();
        return reply({...s,players:undefined,boards:s.boards.map(b=>({...b,baseline:rates[b.skill],methods:trackerMethods(b.skill),leaders:b.leaders.map(p=>({...p,...trackerSkill(b.skill,p.xp,p.gains)})),referenceKind:'2004tracker'})),...rankPlayers(s.players),playerCount:s.players.length,verified:false,unseenUpperBound:null,referenceSource:RATE_SOURCE,referenceProvisional:false});
    }catch(error){return reply({error:error instanceof Error?error.message:String(error)},502);}
}
