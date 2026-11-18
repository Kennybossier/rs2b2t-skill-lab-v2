import {mkdir,readFile,writeFile,rename,copyFile,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHistory,mergeHistory} from '../src/leaderboardHistory';
import type {HistoryState} from '../src/leaderboardHistory';
export const stateDir=resolve('state'),historyFile=join(stateDir,'leaderboard-history.json');
export async function loadHistory(){
 await mkdir(stateDir,{recursive:true});
 for(const file of ['xp-analytics-cache.json','xp-alltime-records.json'])try{await access(join(stateDir,file));}catch{await copyFile(join('seed',file),join(stateDir,file));}
 const snapshots=JSON.parse(await readFile(join(stateDir,'xp-analytics-cache.json'),'utf8')).snapshots;
 const scan=JSON.parse(await readFile(join(stateDir,'xp-alltime-records.json'),'utf8'));
 let history:HistoryState;
 try{history=JSON.parse(await readFile(historyFile,'utf8'));if(history.version!==1)throw new Error('Unsupported history schema');}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
  try{history=JSON.parse(await readFile('seed/leaderboard-history.json','utf8'));}catch(seedError){if((seedError as NodeJS.ErrnoException).code!=='ENOENT')throw seedError;history=createHistory(snapshots,scan);}
 }
 mergeHistory(history,snapshots,scan);
 return history;
}
export async function saveHistory(history:HistoryState){
 await writeFile(historyFile+'.tmp',JSON.stringify(history));await rename(historyFile+'.tmp',historyFile);
}
