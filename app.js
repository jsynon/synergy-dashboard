(() => {
  'use strict';
  const RANKS = {1:'Initiate',2:'Wayfarer',3:'Stalwart',4:'Veteran',5:'Elder',6:'Officer',7:'Guild Leader'};
  const state = { roster: [], events: [], accountCount: 0, generatedAt: null, sortBy: 'name', sortDirection: 1, activityFilter: 'all' };
  const $ = (id) => document.getElementById(id);

  const parseDate=(str)=>{
    if(!str)return null;
    const match=String(str).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM))?$/i);
    if(!match){const d=new Date(str);return Number.isNaN(d.getTime())?null:d;}
    let hour=Number(match[4]||0);if(match[7])hour=hour%12+(match[7].toUpperCase()==='PM'?12:0);
    return new Date(Number(match[3]),Number(match[1])-1,Number(match[2]),hour,Number(match[5]||0),Number(match[6]||0));
  };
  const asDate=(value)=>value?parseDate(value):null;
  const formatDate=(date,withTime=false)=>date?new Intl.DateTimeFormat('en-US',withTime?{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}:{month:'short',day:'numeric',year:'numeric'}).format(date):'—';
  const escapeHtml=(s)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const activeCount=()=>state.roster.filter(m=>m.onlineNow===true||(m.location&&m.location.toLowerCase()!=='offline')).length;
  const displayStatus=(m)=>{
    if(!m.lastOnline)return '—';const days=Math.floor((new Date()-m.lastOnline)/86400000);
    if(days<1)return 'Today';if(days===1)return 'Yesterday';if(days<30)return `${days} days ago`;return formatDate(m.lastOnline);
  };
  function renderStats(){
    const ranks=new Set(state.roster.map(m=>m.rank).filter(Boolean));
    $('stat-characters').textContent=state.roster.length.toLocaleString();
    $('stat-accounts').textContent=`${state.accountCount.toLocaleString()} unique accounts`;
    $('stat-ranks').textContent=ranks.size.toString();$('stat-activity').textContent=state.events.length.toLocaleString();$('stat-online').textContent=activeCount().toLocaleString();
    const dates=state.events.map(e=>e.date).filter(Boolean).sort((a,b)=>a-b);
    const range=dates.length?`${formatDate(dates[0])} – ${formatDate(dates.at(-1))}`:'No activity dates';
    $('stat-range').textContent=range;$('activity-date-range').textContent=range;
    const dateLabel=state.generatedAt?formatDate(state.generatedAt):null;
    $('data-status').textContent=state.roster.length?`Published snapshot${dateLabel?` · generated ${dateLabel}`:''}`:'No published roster snapshot found';
  }
  function renderRanks(){
    const counts=new Map();for(const m of state.roster)counts.set(m.rank,(counts.get(m.rank)||0)+1);
    const rows=Object.keys(RANKS).map(Number).map(n=>[RANKS[n],counts.get(RANKS[n])||0,n]).filter(x=>x[1]>0);
    const max=Math.max(1,...rows.map(x=>x[1]));
    $('rank-chart').innerHTML=rows.length?`${rows.map(([name,count,n])=>`<div class="rank-row"><span class="rank-name">${escapeHtml(name)}</span><div class="rank-track"><div class="rank-fill rank-${n}" style="width:${Math.max(3,count/max*100)}%"></div></div><span class="rank-count">${count}</span></div>`).join('')}<div class="rank-foot">${state.roster.length.toLocaleString()} character records · ${state.accountCount.toLocaleString()} unique accounts</div>`:'<div class="empty-state">No published roster snapshot is available.</div>';
  }
  function populateFilters(){
    const ranks=[...new Set(state.roster.map(m=>m.rank))].sort((a,b)=>(Object.values(RANKS).indexOf(a)+1)-(Object.values(RANKS).indexOf(b)+1));
    const classes=[...new Set(state.roster.map(m=>m.class))].sort((a,b)=>a.localeCompare(b));
    const rankSelect=$('rank-filter'),classSelect=$('class-filter'),oldRank=rankSelect.value,oldClass=classSelect.value;
    rankSelect.innerHTML='<option value="">All ranks</option>'+ranks.map(v=>`<option>${escapeHtml(v)}</option>`).join('');
    classSelect.innerHTML='<option value="">All classes</option>'+classes.map(v=>`<option>${escapeHtml(v)}</option>`).join('');
    if(ranks.includes(oldRank))rankSelect.value=oldRank;if(classes.includes(oldClass))classSelect.value=oldClass;
  }
  function getVisibleMembers(){
    const query=$('search').value.trim().toLowerCase(),rank=$('rank-filter').value,cls=$('class-filter').value;
    return state.roster.filter(m=>(!query||`${m.name} ${m.class} ${m.rank}`.toLowerCase().includes(query))&&(!rank||m.rank===rank)&&(!cls||m.class===cls)).sort((a,b)=>{
      let av=a[state.sortBy],bv=b[state.sortBy];if(av instanceof Date)av=av.getTime();if(bv instanceof Date)bv=bv.getTime();if(av==null)av='';if(bv==null)bv='';
      return (typeof av==='number'&&typeof bv==='number'?(av-bv):String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:'base'}))*state.sortDirection;
    });
  }
  function renderRoster(){
    const rows=getVisibleMembers();$('shown-count').textContent=`${rows.length.toLocaleString()} ${rows.length===1?'member':'members'}`;$('table-summary').textContent=`Showing ${rows.length.toLocaleString()} of ${state.roster.length.toLocaleString()} character records`;
    $('roster-body').innerHTML=rows.length?rows.map(m=>`<tr><td class="member-name">${escapeHtml(m.name)}</td><td><span class="rank-tag"><i class="rank-dot rank-${m.rankOrder}"></i>${escapeHtml(m.rank)}</span></td><td class="class-name">${escapeHtml(m.class)}</td><td>${formatDate(m.joinDate)}</td><td title="${m.lastOnline?escapeHtml(formatDate(m.lastOnline,true)):''}">${displayStatus(m)}</td></tr>`).join(''):'<tr><td colspan="5" class="table-empty">No members match these filters.</td></tr>';
    document.querySelectorAll('.sort-button').forEach(b=>b.setAttribute('aria-sort',b.dataset.sort===state.sortBy?(state.sortDirection===1?'ascending':'descending'):'none'));
  }
  function renderActivityChart(){
    const filtered=state.events.filter(e=>state.activityFilter==='all'||e.kind===state.activityFilter),counts=new Map();
    for(const e of filtered){const key=`${e.date.getFullYear()}-${String(e.date.getMonth()+1).padStart(2,'0')}`;counts.set(key,(counts.get(key)||0)+1);}
    const months=[...counts.keys()].sort(),max=Math.max(1,...months.map(m=>counts.get(m)||0));
    $('activity-chart').innerHTML=months.length?months.map(key=>{const [y,mo]=key.split('-').map(Number),date=new Date(y,mo-1,1),n=counts.get(key),height=Math.max(3,n/max*132);return `<div class="month-column"><span class="month-count">${n}</span><div class="month-bar" style="height:${height}px" title="${escapeHtml(date.toLocaleDateString('en-US',{month:'long',year:'numeric'}))}: ${n} events"></div><span class="month-label">${date.toLocaleDateString('en-US',{month:'short',year:'2-digit'})}</span></div>`;}).join(''):'<div class="empty-state">No matching activity in this snapshot.</div>';
  }
  function renderRecent(){
    const label={join:'Joined',exit:'Departed',rank:'Rank changed',other:'Guild event'};
    $('recent-events').innerHTML=state.events.length?state.events.slice(0,7).map(e=>`<div class="event-row"><i class="event-dot ${e.kind}"></i><div><div class="event-copy">${escapeHtml(e.text)}</div><div class="event-type">${label[e.kind]||label.other}</div></div><time class="event-date" datetime="${e.date.toISOString()}">${formatDate(e.date,true)}</time></div>`).join(''):'<div class="empty-state">No published activity records are available.</div>';
  }
  function render(){renderStats();renderRanks();populateFilters();renderRoster();renderActivityChart();renderRecent();}
  function loadSnapshot(snapshot){
    if(!snapshot||!Array.isArray(snapshot.roster)||!Array.isArray(snapshot.events))throw new Error('Snapshot format is invalid.');
    state.roster=snapshot.roster.map(m=>({...m,joinDate:asDate(m.joinDate),lastOnline:asDate(m.lastOnline)}));
    state.events=snapshot.events.map(e=>({...e,date:asDate(e.date)})).filter(e=>e.date).sort((a,b)=>b.date-a.date);
    state.accountCount=Number(snapshot.accountCount)||0;state.generatedAt=asDate(snapshot.generatedAt);render();
  }
  async function autoLoad(){
    try{const response=await fetch('data/snapshot.json',{cache:'no-store'});if(!response.ok)throw new Error('Snapshot not found');loadSnapshot(await response.json());}
    catch(_){$('data-status').textContent='No published snapshot found';}
  }
  $('search').addEventListener('input',renderRoster);$('rank-filter').addEventListener('change',renderRoster);$('class-filter').addEventListener('change',renderRoster);
  $('activity-filter').addEventListener('change',e=>{state.activityFilter=e.target.value;renderActivityChart();});
  document.querySelectorAll('.sort-button').forEach(b=>b.addEventListener('click',()=>{if(state.sortBy===b.dataset.sort)state.sortDirection*=-1;else{state.sortBy=b.dataset.sort;state.sortDirection=1;}renderRoster();}));
  $('clear-filters').addEventListener('click',()=>{$('search').value='';$('rank-filter').value='';$('class-filter').value='';renderRoster();});
  autoLoad();
})();
