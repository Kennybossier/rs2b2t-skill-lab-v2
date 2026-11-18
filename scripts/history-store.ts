import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {historyFile,stateDir} from './history-state';
async function git(args:string[],input?:Uint8Array|string){
 const child=Bun.spawn(['git',...args],{stdin:input===undefined?'ignore':new Blob([input]),stdout:'pipe',stderr:'pipe',
  env:{...process.env,GIT_AUTHOR_NAME:'github-actions[bot]',GIT_AUTHOR_EMAIL:'41898282+github-actions[bot]@users.noreply.github.com',GIT_COMMITTER_NAME:'github-actions[bot]',GIT_COMMITTER_EMAIL:'41898282+github-actions[bot]@users.noreply.github.com'}});
 const [out,err,code]=await Promise.all([new Response(child.stdout).arrayBuffer(),new Response(child.stderr).text(),child.exited]);
 if(code!==0)throw new Error('History Git operation failed: '+err);return new Uint8Array(out);
}
const action=process.argv[2],decode=(b:Uint8Array)=>new TextDecoder().decode(b).trim();
const remote=decode(await git(['ls-remote','--heads','origin','history']));
if(remote)await git(['fetch','--depth=1','origin','refs/heads/history']);
const parent=remote?decode(await git(['rev-parse','FETCH_HEAD'])):null;
if(action==='restore'){
 if(parent){const zipped=await git(['show',parent+':archive.json.gz']);const history=Bun.gunzipSync(zipped);
  const parsed=JSON.parse(new TextDecoder().decode(history));if(parsed.version!==1)throw new Error('Unsupported archive version');
  await mkdir(stateDir,{recursive:true});await writeFile(historyFile,history);console.log('Restored durable history.');}
 else console.log('No history branch yet; using public seed.');
}else if(action==='save'){
 const raw=await readFile(historyFile);const zipped=Bun.gzipSync(raw);
 const blob=decode(await git(['hash-object','-w','--stdin'],zipped));
 const tree=decode(await git(['mktree'],`100644 blob ${blob}\tarchive.json.gz\n`));
 if(parent&&tree===decode(await git(['rev-parse',parent+'^{tree}']))){console.log('History unchanged.');process.exit(0);}
 const commit=decode(await git(['commit-tree',tree,...(parent?['-p',parent]:[])], 'Save resumable leaderboard history\n'));
 await git(['push','origin',commit+':refs/heads/history']);console.log('Saved durable history branch.');
}else throw new Error('Choose restore or save.');
