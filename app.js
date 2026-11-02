(() => {
  'use strict';
  const state = { roster: [], events: [], accountCount: 0, accountJoinDates: {}, generatedAt: null, sortBy: 'name', sortDirection: 1, rankFilter: '', classFilter: '' };
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
  const displayStatus=(m)=>{
    if(!m.lastOnline)return m.onlineNow?'Today':'—';const days=Math.floor((new Date()-m.lastOnline)/86400000);
    if(days<1)return 'Today';if(days===1)return 'Yesterday';if(days<30)return `${days} days ago`;return formatDate(m.lastOnline);
  };
  function renderSnapshotStatus(){
    const dateLabel=state.generatedAt?formatDate(state.generatedAt):null;
    $('roster-generated-date').textContent=dateLabel?`Roster snapshot generated on ${dateLabel}.`:'Roster snapshot date unavailable.';
    $('data-status').textContent=state.roster.length?`Published snapshot${dateLabel?` · generated ${dateLabel}`:''}`:'No published roster snapshot found';
  }
  function addCalendarMonths(date, months){
    const year=date.getFullYear(), month=date.getMonth()+months, day=date.getDate();
    const first=new Date(year,month,1);
    const lastDay=new Date(first.getFullYear(),first.getMonth()+1,0).getDate();
    return new Date(first.getFullYear(),first.getMonth(),Math.min(day,lastDay),date.getHours(),date.getMinutes(),date.getSeconds());
  }
  function renderPromotions(){
    const rankNames={1:'Initiate',2:'Wayfarer',3:'Stalwart',4:'Veteran',5:'Elder'};
    const monthsByRank={1:1,2:3,3:6,4:12};
    const accounts=new Map();
    for(const member of state.roster){
      const key=(member.account||'').trim().toLocaleLowerCase();
      if(!key)continue;
      if(!accounts.has(key)){
        const savedDate=state.accountJoinDates[key];
        accounts.set(key,{key,account:member.account,rankOrder:0,characterCount:0,joinDate:asDate(savedDate)||member.originalJoinDate||member.joinDate});
      }
      const account=accounts.get(key);
      account.rankOrder=Math.max(account.rankOrder,Number(member.rankOrder)||0);
      account.characterCount++;
      const savedDate=state.accountJoinDates[key];
      const joinDate=asDate(savedDate)||member.originalJoinDate||member.joinDate;
      if(joinDate&&(!account.joinDate||joinDate<account.joinDate))account.joinDate=joinDate;
    }
    const now=new Date();
    const startOfToday=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    const endOfWindow=new Date(startOfToday);
    endOfWindow.setDate(endOfWindow.getDate()+30);
    endOfWindow.setHours(23,59,59,999);
    const upcoming=[...accounts.values()].filter(account=>monthsByRank[account.rankOrder]&&account.joinDate).map(account=>{
      const eligibleDate=addCalendarMonths(account.joinDate,monthsByRank[account.rankOrder]);
      return {...account,eligibleDate};
    }).filter(account=>account.eligibleDate<=endOfWindow)
      .sort((a,b)=>a.eligibleDate-b.eligibleDate||a.account.localeCompare(b.account));
    const count=upcoming.length;
    $('promotion-list').innerHTML=count?upcoming.map(account=>{
      const nextRank=account.rankOrder+1;
      const stateLabel=account.eligibleDate<=now?'Eligible now':`Eligible ${formatDate(account.eligibleDate)}`;
      return `<div class="promotion-row">
        <div class="promotion-account"><a href="#roster" class="promotion-account-link" data-account-query="${escapeHtml(account.account)}">${escapeHtml(account.account)}</a><span>${account.characterCount} ${account.characterCount===1?'character':'characters'}</span></div>
        <div class="promotion-path">${rankNames[account.rankOrder]} <span aria-hidden="true">→</span> ${rankNames[nextRank]}</div>
        <time class="promotion-date" datetime="${account.eligibleDate.toISOString()}">${stateLabel}</time>
      </div>`;
    }).join(''):'<div class="empty-state">No accounts are approaching a promotion milestone in the next 30 days.</div>';
  }
  function renderInactivityAlerts(){
    const limits={1:7,2:14,3:30,4:60,5:90};
    const rankNames={1:'Initiate',2:'Wayfarer',3:'Stalwart',4:'Veteran',5:'Elder'};
    const protectedAccounts=new Set(['@arkhybrid#75770']);
    const accounts=new Map();
    for(const member of state.roster){
      const key=(member.account||'').trim().toLocaleLowerCase();
      if(!key)continue;
      if(!accounts.has(key))accounts.set(key,{key,account:member.account,rankOrder:0,lastActive:null,characterCount:0,onLeave:false});
      const account=accounts.get(key);
      account.rankOrder=Math.max(account.rankOrder,Number(member.rankOrder)||0);
      account.characterCount++;
      account.onLeave=account.onLeave||member.leaveOfAbsence===true;
      // A blank last-online value means the character was online at snapshot time.
      const lastActive=member.lastOnline||state.generatedAt;
      if(lastActive&&(!account.lastActive||lastActive>account.lastActive))account.lastActive=lastActive;
    }
    const now=new Date();
    const alerts=[...accounts.values()].filter(account=>{
      if(!limits[account.rankOrder]||protectedAccounts.has(account.key)||account.onLeave||!account.lastActive)return false;
      account.daysInactive=Math.max(0,Math.floor((now-account.lastActive)/86400000));
      account.limitDays=limits[account.rankOrder];
      return account.daysInactive>=account.limitDays;
    }).sort((a,b)=>b.daysInactive-a.daysInactive||a.account.localeCompare(b.account));
    $('inactivity-count').textContent=`${alerts.length} ${alerts.length===1?'alert':'alerts'}`;
    $('inactivity-list').innerHTML=alerts.length?alerts.map(account=>`<div class="inactivity-row">
      <div class="inactivity-details">
        <div><a href="#roster" class="inactivity-account-link" data-account-query="${escapeHtml(account.account)}">${escapeHtml(account.account)}</a><span class="inactivity-rank"> · ${rankNames[account.rankOrder]}</span></div>
        <div class="inactivity-meta">${account.daysInactive}-day limit · Last active ${formatDate(account.lastActive)}</div>
      </div>
      <strong class="inactivity-age">${account.daysInactive} ${account.daysInactive===1?'day':'days'}</strong>
    </div>`).join(''):'<div class="empty-state inactivity-empty">No accounts currently meet their inactivity threshold.</div>';
  }
  function renderDirectoryFilters(){
    const rankCounts=new Map(),classCounts=new Map(),rankOrders=new Map();
    for(const member of state.roster){
      rankCounts.set(member.rank,(rankCounts.get(member.rank)||0)+1);rankOrders.set(member.rank,member.rankOrder||0);
      classCounts.set(member.class,(classCounts.get(member.class)||0)+1);
    }
    const ranks=[...rankCounts.keys()].sort((a,b)=>(rankOrders.get(a)||0)-(rankOrders.get(b)||0)||a.localeCompare(b));
    const classes=[...classCounts.keys()].sort((a,b)=>classCounts.get(b)-classCounts.get(a)||a.localeCompare(b));
    $('rank-facets').innerHTML=[`<option value="">All (${state.roster.length})</option>`,...ranks.map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)} (${rankCounts.get(name)})</option>`)].join('');
    $('class-facets').innerHTML=[`<option value="">All (${state.roster.length})</option>`,...classes.map(name=>`<option value="${escapeHtml(name)}">${escapeHtml(name)} (${classCounts.get(name)})</option>`)].join('');
    $('rank-facets').value=state.rankFilter;
    $('class-facets').value=state.classFilter;
  }
  function getVisibleMembers(){
    const query=$('search').value.trim().toLowerCase();
    return state.roster.filter(m=>(!query||`${m.name} ${m.account||''} ${m.class} ${m.rank}`.toLowerCase().includes(query))&&(!state.rankFilter||m.rank===state.rankFilter)&&(!state.classFilter||m.class===state.classFilter)).sort((a,b)=>{
      let av=a[state.sortBy],bv=b[state.sortBy];if(av instanceof Date)av=av.getTime();if(bv instanceof Date)bv=bv.getTime();if(av==null)av='';if(bv==null)bv='';
      return (typeof av==='number'&&typeof bv==='number'?(av-bv):String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:'base'}))*state.sortDirection;
    });
  }
  function renderRoster(){
    const rows=getVisibleMembers();
    const matchingAccounts=new Set(rows.map(m=>(m.account||'').trim().toLocaleLowerCase()).filter(Boolean)).size;
    const characterLabel=rows.length===1?'character':'characters';
    const accountLabel=matchingAccounts===1?'account':'accounts';
    $('search-results-count').textContent=`${rows.length.toLocaleString()} ${characterLabel} · ${matchingAccounts.toLocaleString()} ${accountLabel} found`;
    $('directory-count').textContent=$('search-results-count').textContent;
    $('table-summary').textContent=`Showing ${rows.length.toLocaleString()} of ${state.roster.length.toLocaleString()} character records`;
    $('mobile-sort').value=state.sortBy;
    $('mobile-sort-direction').textContent=state.sortDirection===1?'Ascending ↑':'Descending ↓';
    $('mobile-sort-direction').setAttribute('aria-label',state.sortDirection===1?'Sort descending':'Sort ascending');
    $('roster-body').innerHTML=rows.length?rows.map(m=>`<tr><td class="member-name">${escapeHtml(m.name)}</td><td class="account-name">${escapeHtml(m.account||"")}</td><td><span class="rank-tag"><i class="rank-dot rank-${m.rankOrder}"></i>${escapeHtml(m.rank)}</span></td><td class="class-name">${escapeHtml(m.class)}</td><td>${formatDate(m.joinDate)}</td><td title="${m.lastOnline?escapeHtml(formatDate(m.lastOnline,true)):''}">${displayStatus(m)}</td></tr>`).join(''):'<tr><td colspan="6" class="table-empty">No members match these filters.</td></tr>';
    $('mobile-roster-list').innerHTML=rows.length?rows.map(m=>`<article class="mobile-member-card">
      <header class="mobile-member-card-head">
        <div class="mobile-member-identity"><h3 class="mobile-member-name">${escapeHtml(m.name)}</h3><span class="mobile-member-class">${escapeHtml(m.class)}</span></div>
        <span class="rank-tag mobile-member-rank"><i class="rank-dot rank-${m.rankOrder}"></i>${escapeHtml(m.rank)}</span>
      </header>
      <div class="mobile-member-account"><span class="mobile-member-label">Account</span><span class="mobile-member-value">${escapeHtml(m.account||'—')}</span></div>
      <div class="mobile-member-dates">
        <div><span class="mobile-member-label">Joined</span><span class="mobile-member-value">${formatDate(m.joinDate)}</span></div>
        <div><span class="mobile-member-label">Last online</span><span class="mobile-member-value mobile-member-status" title="${m.lastOnline?escapeHtml(formatDate(m.lastOnline,true)):''}">${displayStatus(m)}</span></div>
      </div>
    </article>`).join(''):'<div class="empty-state">No members match these filters.</div>';
    document.querySelectorAll('.sort-button').forEach(b=>b.setAttribute('aria-sort',b.dataset.sort===state.sortBy?(state.sortDirection===1?'ascending':'descending'):'none'));
  }
  function activityMemberText(text){
    const members=[...state.roster].filter(member=>member.name).sort((a,b)=>b.name.length-a.name.length);
    const memberByName=new Map(members.map(member=>[member.name.toLocaleLowerCase(),member]));
    const searchableHandles=new Map();
    const names=members.map(member=>member.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
    if(!names.length)return {html:escapeHtml(text),searchText:text};
    const matcher=new RegExp('(^|[^A-Za-z0-9_])(' + names.join('|') + ')(?![A-Za-z0-9_])','gi');
    let cursor=0, html='', searchText=text, match;
    while((match=matcher.exec(text))){
      const nameStart=match.index+match[1].length;
      const nameEnd=nameStart+match[2].length;
      if(nameStart<cursor)continue;
      html+=escapeHtml(text.slice(cursor,nameStart));
      const member=memberByName.get(match[2].toLocaleLowerCase());
      const rawHandle=(text.slice(nameEnd).match(/^@[A-Za-z0-9._-]+(?:#[A-Za-z0-9]+)?/)||[])[0]||'';
      let account=rawHandle||((member&&member.account)||'');
      if(account&&!account.startsWith('@'))account='@'+account;
      const suffix=rawHandle?rawHandle:account;
      const label=match[2]+suffix;
      const query=member?(member.account||member.name):match[2];
      html+=`<a class="activity-member-link" href="#roster" data-member-query="${escapeHtml(query)}">${escapeHtml(label)}</a>`;
      if(member&&account)searchableHandles.set(member.name.toLocaleLowerCase(),account);
      cursor=nameEnd+(rawHandle?rawHandle.length:0);
      matcher.lastIndex=cursor;
    }
    html+=escapeHtml(text.slice(cursor));
    if(searchableHandles.size){
      searchText+=' '+[...searchableHandles.values()].join(' ');
    }
    return {html,searchText};
  }
  function renderRecent(){
    const label={join:'Joined',exit:'Departed',rank:'Rank changed',other:'Guild event'};
    const query=$('activity-search').value.trim().toLocaleLowerCase();
    const prepared=state.events.map(event=>({event,view:activityMemberText(event.text)}));
    const rows=prepared.filter(item=>!query||item.view.searchText.toLocaleLowerCase().includes(query)||item.event.kind.toLocaleLowerCase().includes(query));
    const count=rows.length, total=state.events.length;
    $('activity-results-count').textContent=query?`${count.toLocaleString()} of ${total.toLocaleString()} events match`:`${total.toLocaleString()} events`;
    $('recent-events').innerHTML=count?rows.map(({event,view})=>`<div class="event-row"><i class="event-dot ${event.kind}"></i><div><div class="event-copy">${view.html}</div><div class="event-type">${label[event.kind]||label.other}</div></div><time class="event-date" datetime="${event.date.toISOString()}">${formatDate(event.date,true)}</time></div>`).join(''):(query?'<div class="empty-state">No activity events match this search.</div>':'<div class="empty-state">No published activity records are available.</div>');
  }
  function render(){renderSnapshotStatus();renderDirectoryFilters();renderRoster();renderRecent();renderPromotions();renderInactivityAlerts();}
  function loadSnapshot(snapshot){
    if(!snapshot||!Array.isArray(snapshot.roster)||!Array.isArray(snapshot.events))throw new Error('Snapshot format is invalid.');
    state.accountJoinDates=Object.fromEntries(Object.entries(snapshot.accountJoinDates||{}).map(([account,date])=>[account.trim().toLocaleLowerCase(),date]));
    state.roster=snapshot.roster.map(m=>({...m,joinDate:asDate(m.joinDate),originalJoinDate:asDate(m.originalJoinDate)||asDate(m.joinDate),lastOnline:asDate(m.lastOnline)}));
    state.events=snapshot.events.map(e=>({...e,date:asDate(e.date)})).filter(e=>e.date).sort((a,b)=>b.date-a.date);
    state.accountCount=Number(snapshot.accountCount)||0;state.generatedAt=asDate(snapshot.generatedAt);render();
  }
  async function autoLoad(){
    try{const response=await fetch('data/snapshot.json',{cache:'no-store'});if(!response.ok)throw new Error('Snapshot not found');loadSnapshot(await response.json());}
    catch(_){$('data-status').textContent='No published snapshot found';}
  }
  $('search').addEventListener('input',renderRoster);
  $('activity-search').addEventListener('input',renderRecent);
  $('promotion-list').addEventListener('click',event=>{
    const link=event.target.closest('.promotion-account-link');
    if(!link)return;
    event.preventDefault();
    $('search').value=link.dataset.accountQuery||'';
    state.rankFilter='';state.classFilter='';renderDirectoryFilters();renderRoster();
    $('roster').scrollIntoView({behavior:'smooth',block:'start'});
  });
  const promotionRulesDialog=$('promotion-rules-dialog');
  $('show-promotion-rules').addEventListener('click',()=>promotionRulesDialog.showModal());
  $('close-promotion-rules').addEventListener('click',()=>promotionRulesDialog.close());
  promotionRulesDialog.addEventListener('click',event=>{
    if(event.target===promotionRulesDialog)promotionRulesDialog.close();
  });
  const inactivityRulesDialog=$('inactivity-rules-dialog');
  $('show-inactivity-rules').addEventListener('click',()=>inactivityRulesDialog.showModal());
  $('close-inactivity-rules').addEventListener('click',()=>inactivityRulesDialog.close());
  inactivityRulesDialog.addEventListener('click',event=>{
    if(event.target===inactivityRulesDialog)inactivityRulesDialog.close();
  });
  $('inactivity-list').addEventListener('click',event=>{
    const link=event.target.closest('.inactivity-account-link');
    if(!link)return;
    event.preventDefault();
    $('search').value=link.dataset.accountQuery||'';
    state.rankFilter='';state.classFilter='';renderDirectoryFilters();renderRoster();
    $('roster').scrollIntoView({behavior:'smooth',block:'start'});
  });
  $('recent-events').addEventListener('click',event=>{
    const link=event.target.closest('.activity-member-link');
    if(!link)return;
    event.preventDefault();
    $('search').value=link.dataset.memberQuery||'';
    state.rankFilter='';state.classFilter='';renderDirectoryFilters();renderRoster();
    $('roster').scrollIntoView({behavior:'smooth',block:'start'});
  });
  document.querySelectorAll('.sort-button').forEach(b=>b.addEventListener('click',()=>{if(state.sortBy===b.dataset.sort)state.sortDirection*=-1;else{state.sortBy=b.dataset.sort;state.sortDirection=1;}renderRoster();}));
  $('mobile-sort').addEventListener('change',event=>{state.sortBy=event.target.value;state.sortDirection=1;renderRoster();});
  $('mobile-sort-direction').addEventListener('click',()=>{state.sortDirection*=-1;renderRoster();});
  $('rank-facets').addEventListener('change',event=>{state.rankFilter=event.target.value;renderRoster();});
  $('class-facets').addEventListener('change',event=>{state.classFilter=event.target.value;renderRoster();});
  $('clear-filters').addEventListener('click',()=>{$('search').value='';state.rankFilter='';state.classFilter='';renderDirectoryFilters();renderRoster();});
  autoLoad();
})();
