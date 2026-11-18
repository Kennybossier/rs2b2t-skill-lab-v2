const palette=['#c6e58b','#8bd9df','#e5b58b','#b6a1ef','#f294a6','#91b9f7','#ddd18a','#92d4b1','#d7a5d1','#b3c1cb'];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const format=(v,kind)=>kind==='closest'?v.toLocaleString('en-GB',{maximumFractionDigits:1})+' h':v+' pts';
const shortDate=s=>new Date(s+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',timeZone:'UTC'});
export function renderHistory(target,data,kind){
 const dates=data.dates,series=new Map();
 data.days.forEach(d=>d[kind].forEach(p=>{if(!series.has(p.slug))series.set(p.slug,{name:p.name,slug:p.slug});}));
 const players=[...series.values()],shown=new Set(players.map(p=>p.slug));
 const coverage=data.coverage;
 const progress=Math.min(100,coverage.percent||0).toFixed(1);
 const hasData=players.length>0;
 let selected=data.days.findLastIndex(d=>d[kind].length);if(selected<0)selected=dates.length-1;
 target.innerHTML=`<div class="history-heading"><strong>Last 30 days <span>· UTC day end</span></strong><span class="badge">${coverage.complete?'Backfill checked':'Backfill '+progress+'%'}</span></div>
 <p class="history-note">${kind==='closest'?'Remaining training hours using current EHP rates · lower is closer to max.':'All-time 5–4–3–2–1 points earned up to each date.'} Reconstructed for sampled players.</p>
 <div class="history-plot"></div>
 <div class="history-legend" aria-label="Toggle player lines"></div>
 <div class="history-date"><label for="${kind}-date">Inspect date</label><input id="${kind}-date" type="range" min="0" max="${dates.length-1}" value="${selected}" step="1"><output for="${kind}-date"></output></div>
 <p class="history-tooltip" role="status" aria-live="polite">Hover or focus a point for player, value and rank.</p><ol class="history-results"></ol>
 <p class="history-note history-coverage">${coverage.dailyRead.toLocaleString()}/${coverage.dailyTotal.toLocaleString()} skill histories read · ${coverage.hourlyRead.toLocaleString()}/${coverage.hourlyTotal.toLocaleString()} historical days checked · ${coverage.unavailable.toLocaleString()} days without retained hourly data. ${coverage.complete?'':'Results are partial while collection continues. '}Missing values are gaps, never zero.${coverage.error?' Latest collection paused: '+esc(coverage.error):''}</p>`;
 const plot=target.querySelector('.history-plot'),legend=target.querySelector('.history-legend'),tooltip=target.querySelector('.history-tooltip');
 players.forEach((p,i)=>{
  const button=document.createElement('button');button.type='button';button.textContent=p.name;button.setAttribute('aria-pressed','true');button.style.setProperty('--line',palette[i%palette.length]);
  button.addEventListener('click',()=>{if(shown.has(p.slug))shown.delete(p.slug);else shown.add(p.slug);button.setAttribute('aria-pressed',String(shown.has(p.slug)));draw();});
  legend.append(button);
 });
 function inspect(){
  const day=data.days[selected],rows=day[kind];
  target.querySelector('output').textContent=shortDate(day.date);
  target.querySelector('input').setAttribute('aria-valuetext',day.date);
  target.querySelector('.history-results').innerHTML=rows.length?rows.map(p=>`<li><span>${esc(p.name)}</span><strong>${esc(format(p.value,kind))}</strong></li>`).join(''):'<li class="history-empty">No reconstructable values for this date yet.</li>';
  if(kind==='closest')target.querySelector('output').textContent+=` · ${day.knownPlayers}/${day.totalPlayers} players covered`;
 }
 target.querySelector('input').addEventListener('input',event=>{selected=Number(event.target.value);inspect();});
 function draw(){
  if(!hasData){plot.innerHTML='<div class="history-empty">Building the first historical series…<br>Current leaderboard results remain available below.</div>';return;}
  const values=data.days.flatMap(d=>d[kind].filter(p=>shown.has(p.slug)).map(p=>p.value));
  if(!values.length){plot.innerHTML='<div class="history-empty">Select a player to show their history.</div>';return;}
  const min=kind==='closest'?Math.max(0,Math.floor(Math.min(...values)*.95)):0,max=Math.max(...values)*1.05||1,span=max-min||1;
  const width=Math.max(300,Math.round(plot.clientWidth||640)),right=width-18;
  const x=i=>48+i*(right-48)/Math.max(1,dates.length-1),y=v=>144-(v-min)/span*122;
  let svg=`<svg viewBox="0 0 ${width} 180" role="img" aria-label="${kind==='closest'?'Hours remaining':'Scoreboard points'} over the past 30 completed UTC days">`;
  for(let i=0;i<3;i++){const v=min+span*i/2,yp=y(v);svg+=`<line x1="48" x2="${right}" y1="${yp}" y2="${yp}" class="history-grid"/><text x="42" y="${yp+3}" text-anchor="end">${Math.round(v).toLocaleString('en-GB')}</text>`;}
  for(const i of [0,14,29])svg+=`<text x="${x(i)}" y="170" text-anchor="${i===0?'start':i===29?'end':'middle'}">${shortDate(dates[i])}</text>`;
  players.forEach((p,j)=>{
   if(!shown.has(p.slug))return;
   let path='',last=-2;const points=[];
   data.days.forEach((d,i)=>{const row=d[kind].find(r=>r.slug===p.slug);if(!row)return;
    path+=(last===i-1?'L':'M')+x(i).toFixed(1)+' '+y(row.value).toFixed(1)+' ';last=i;
    const label=`${p.name} · ${d.date} · ${format(row.value,kind)} · rank ${row.rank}`;
    points.push(`<circle cx="${x(i)}" cy="${y(row.value)}" r="3" fill="${palette[j%palette.length]}" tabindex="0" role="img" aria-label="${esc(label)}" data-label="${esc(label)}"><title>${esc(label)}</title></circle>`);
   });
   svg+=`<path d="${path}" fill="none" stroke="${palette[j%palette.length]}" stroke-width="1.8" ${j>=palette.length?'stroke-dasharray="5 3"':''}/>`+points.join('');
  });
  plot.innerHTML=svg+'</svg>';
  plot.querySelectorAll('circle').forEach(p=>{const show=()=>tooltip.textContent=p.dataset.label;p.addEventListener('focus',show);p.addEventListener('pointerenter',show);});
 }
 window.addEventListener('resize',draw);draw();inspect();
}
async function start(){
 try{
  const response=await fetch('./data/history.json',{cache:'no-store'});
  if(!response.ok)throw new Error('History snapshot is unavailable.');
  const data=await response.json();
  if(data.version!==1)throw new Error('Unsupported history format. Reload the page.');
  renderHistory(document.querySelector('#max-history'),data,'closest');
  renderHistory(document.querySelector('#points-history'),data,'points');
 }catch(error){for(const id of ['max-history','points-history']){const el=document.getElementById(id);if(el)el.textContent=error.message;}}
}
if(typeof document!=='undefined')start();
