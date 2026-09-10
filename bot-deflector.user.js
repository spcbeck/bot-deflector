// ==UserScript==
// @name         BotDeflector for Reddit
// @namespace    https://github.com/spcbeck/bot-deflector
// @version      1.0.0
// @description  Detects and stealthily deflects automated bots, viral repost farms, and hijacked comments across Reddit.
// @author       spcbeck
// @match        https://*.reddit.com/*
// @match        https://reddit.com/*
// @icon         https://raw.githubusercontent.com/spcbeck/bot-deflector/main/public/icons/icon-128.png
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function(){"use strict";const S={deflectThreshold:70,flagThreshold:40,mode:"STEALTH_COLLAPSE",enableSubmissionCheck:!0,enableCadenceCheck:!0,autoBlockReddit:!0,whitelist:[]};class N{queue=[];isProcessing=!1;delayMs=600;pausedUntil=0;async enqueue(e){return new Promise((t,n)=>{this.queue.push({execute:e,resolve:t,reject:n}),this.processQueue()})}async processQueue(){if(!this.isProcessing){for(this.isProcessing=!0;this.queue.length>0;){const e=Date.now();if(e<this.pausedUntil){const n=this.pausedUntil-e;await new Promise(o=>setTimeout(o,n))}const t=this.queue.shift();if(!t)break;try{const n=await t.execute();t.resolve(n)}catch(n){n instanceof Error&&n.message.includes("429")&&(console.warn("[BotDeflector] Rate limited (429). Pausing queue for 12s..."),this.pausedUntil=Date.now()+12e3),t.reject(n)}await new Promise(n=>setTimeout(n,this.delayMs))}this.isProcessing=!1}}}const w=new N;let E=null,A=0;async function P(){const r=Date.now();return E&&r<A?E:w.enqueue(async()=>{try{const e=await fetch("https://www.reddit.com/api/me.json",{headers:{Accept:"application/json"}});if(!e.ok)return console.warn("[BotDeflector Blocker] Could not fetch user session from /api/me.json"),null;const n=(await e.json())?.data?.modhash;return typeof n=="string"&&n.length>0?(E=n,A=Date.now()+30*60*1e3,n):null}catch(e){return console.error("[BotDeflector Blocker] Error fetching modhash:",e),null}})}async function _(r){const e=r.replace(/^u\//,"").trim();if(!e||e==="[deleted]")return{success:!1,username:e,error:"Invalid username"};const t=await P();return w.enqueue(async()=>{try{const n=new URLSearchParams;n.append("name",e),n.append("api_type","json"),t&&n.append("uh",t);const o={"Content-Type":"application/x-www-form-urlencoded","X-Requested-With":"XMLHttpRequest"};t&&(o["X-Modhash"]=t);const s=await fetch("https://www.reddit.com/api/block_user",{method:"POST",headers:o,body:n.toString()});if(s.status===429)throw new Error("Rate limit 429 encountered during block_user");const c=(await s.json())?.json?.errors;if(Array.isArray(c)&&c.length>0){const i=c[0][0];return i==="TOO_MANY_BLOCKED"?(console.warn("[BotDeflector Blocker] Reddit 1,000 block quota exceeded!"),{success:!1,username:e,quotaExceeded:!0,error:"Reddit 1,000 block quota exceeded"}):i==="USER_DOESNT_EXIST"?{success:!1,username:e,error:"User does not exist or was deleted"}:{success:!1,username:e,error:i}}return console.log(`[BotDeflector Blocker] Successfully blocked u/${e} on Reddit account`),{success:!0,username:e}}catch(n){return console.error(`[BotDeflector Blocker] Failed to block u/${e}:`,n),{success:!1,username:e,error:n instanceof Error?n.message:String(n)}}})}async function $(r){const e=r.replace(/^u\//,"").trim();return!e||e==="[deleted]"?null:w.enqueue(async()=>{const t=`https://www.reddit.com/user/${encodeURIComponent(e)}/about.json`,n=await fetch(t,{headers:{Accept:"application/json"}});if(n.status===429)throw new Error(`Reddit API rate limit 429 for ${e}`);if(n.status===404)return{username:e,createdUtc:0,linkKarma:0,commentKarma:0,totalKarma:0,bio:"",isSuspended:!0};if(!n.ok)return null;const s=(await n.json())?.data;return s?{username:s.name||e,createdUtc:s.created_utc||0,linkKarma:s.link_karma||0,commentKarma:s.comment_karma||0,totalKarma:s.total_karma||(s.link_karma||0)+(s.comment_karma||0),bio:s.subreddit?.public_description||"",isSuspended:!!s.is_suspended,over18:!!s.subreddit?.over_18}:null})}async function q(r){const e=r.replace(/^u\//,"").trim();return!e||e==="[deleted]"?[]:w.enqueue(async()=>{const t=`https://www.reddit.com/user/${encodeURIComponent(e)}/comments.json?limit=25`,n=await fetch(t,{headers:{Accept:"application/json"}});if(n.status===429)throw new Error(`Reddit API rate limit 429 for comments of ${e}`);if(!n.ok)return[];const s=(await n.json())?.data?.children;return Array.isArray(s)?s.map(a=>({id:a.data.id||"",linkId:a.data.link_id||"",subreddit:a.data.subreddit||"",createdUtc:a.data.created_utc||0,body:a.data.body||"",score:a.data.score||0})):[]})}async function j(r,e){const t=r.replace(/^r\//,"").trim(),n=e.trim();return!t||!n?null:w.enqueue(async()=>{const o=`"${n.replace(/"/g,"")}"`,s=`https://www.reddit.com/r/${encodeURIComponent(t)}/search.json?q=${encodeURIComponent(o)}&restrict_sr=1&sort=top&limit=5`,a=await fetch(s,{headers:{Accept:"application/json"}});if(a.status===429)throw new Error(`Reddit API rate limit 429 for search in r/${t}`);if(!a.ok)return null;const i=(await a.json())?.data?.children;if(!Array.isArray(i)||i.length===0)return null;const f=Math.floor(Date.now()/1e3),u=180*86400;for(const m of i){const d=m.data;if(!d)continue;if(f-d.created_utc>u&&d.score>500){const h=(d.title||"").toLowerCase().replace(/[^\w\s]/g,"").trim(),p=n.toLowerCase().replace(/[^\w\s]/g,"").trim();if(h===p||h.includes(p)||p.includes(h))return{id:d.id,title:d.title,subreddit:d.subreddit,author:d.author,createdUtc:d.created_utc,score:d.score,url:d.url,permalink:d.permalink}}}return null})}async function O(r){const e=r.replace(/^t3_/,"").trim();return e?w.enqueue(async()=>{const t=`https://www.reddit.com/comments/${encodeURIComponent(e)}.json?limit=25&depth=1`,n=await fetch(t,{headers:{Accept:"application/json"}});if(!n.ok)return[];const o=await n.json();if(!Array.isArray(o)||o.length<2)return[];const s=o[1]?.data?.children;return Array.isArray(s)?s.map(a=>a.data?.body).filter(a=>typeof a=="string"&&a.trim().length>10):[]}):[]}const G=/^[A-Z][a-z]+[-_][A-Z][a-z]+[-_]?\d{2,5}$/i,z=/&(?:amp|quot|apos|lt|gt|#39|#x27|nbsp);|&amp;amp;/i,K=/(?:t\.me\/|telegram(?:\.me|\.dog|\s*[:@])|onlyfans(?:\.com|\.me|\s*[:@])|fansly|linktr\.ee|beacons\.ai|allmylinks|cash\.app|\$cashtag|cutt\.ly|bit\.ly)/i;function x(r){return r&&z.test(r)?{ruleId:"unescaped_html_entities",category:"artifacts",name:"Unescaped Scraper HTML Entities",points:50,description:"Found raw HTML entities (&amp;, &#39;, etc.) typical of unparsed scraper scripts"}:null}function W(r){if(!r)return null;const e=r.replace(/^u\//,"");return G.test(e)?{ruleId:"auto_generated_username",category:"identity",name:"Default Generated Username Pattern",points:15,description:"Username matches Reddit auto-generated Word-Word-1234 format"}:null}function V(r){return r&&K.test(r)?{ruleId:"bio_funnel_link",category:"profile",name:"External Funnel / Telegram Link in Bio",points:45,description:"Bio advertises Telegram, OnlyFans, cash handles, or link aggregators"}:null}function X(r,e=Math.floor(Date.now()/1e3)){if(!r)return null;const t=e-r,n=t/86400;return n<2?{ruleId:"fresh_account_48h",category:"profile",name:"Brand New Account (< 48 Hours)",points:40,description:`Account created only ${Math.max(1,Math.round(t/3600))} hours ago`}:n<14?{ruleId:"young_account_14d",category:"profile",name:"Young Account (< 14 Days)",points:20,description:`Account created ${Math.round(n)} days ago`}:null}function Y(r,e,t,n=Math.floor(Date.now()/1e3)){if(!r||t.length===0)return null;const o=(n-r)/86400;if(o>180&&e<100){const s=Math.min(...t.map(c=>c.createdUtc)),a=(n-s)/3600;if(a<=72)return{ruleId:"aged_sleeper_gap",category:"dormancy",name:"Aged Sleeper Gap (Awakened Farm Account)",points:45,description:`Account is ${Math.round(o)} days old with low karma, but all activity began in the last ${Math.round(a)}h`}}return null}function Q(r,e){return r>5e3&&e<25?{ruleId:"extreme_karma_asymmetry",category:"karma",name:"Extreme Post/Comment Karma Asymmetry",points:30,description:`High post karma (${r}) with near-zero comment karma (${e})`}:r>1e4&&r/Math.max(1,e)>150?{ruleId:"extreme_karma_asymmetry",category:"karma",name:"Extreme Post/Comment Karma Asymmetry",points:30,description:`Disproportionate link-to-comment ratio (${Math.round(r/Math.max(1,e))}:1)`}:null}function Z(r,e){if(r>1e3&&e.length>0&&e.length<10){const t=e.reduce((n,o)=>n+(o.score||0),0);if(t<r*.05)return{ruleId:"ghost_karma_scrubbed",category:"karma",name:"Ghost Karma / Scrubbed History",points:35,description:`Profile has ${r} comment karma but visible history accounts for only ${t} points`}}return null}function J(r){if(r.length<5)return null;const e=[...r].sort((s,a)=>a.createdUtc-s.createdUtc),t=[];for(let s=0;s<e.length-1;s++){const a=e[s].createdUtc-e[s+1].createdUtc;a>0&&t.push(a)}if(t.length<4)return null;t.sort((s,a)=>s-a);const n=t[Math.floor(t.length/2)],o=new Set(e.slice(0,10).map(s=>s.subreddit.toLowerCase()));return n<=90&&o.size>=4?{ruleId:"inhuman_velocity_cadence",category:"cadence",name:"Inhuman Multi-Subreddit Comment Cadence",points:55,description:`Rapid-fire comments (median ${Math.round(n)}s apart) across ${o.size} distinct subreddits`}:null}function ee(r){if(r.length<10)return null;const e=[...r].sort((n,o)=>o.createdUtc-n.createdUtc),t=(e[0].createdUtc-e[e.length-1].createdUtc)/3600;if(t>=20){let n=0;for(let o=0;o<e.length-1;o++){const s=(e[o].createdUtc-e[o+1].createdUtc)/3600;s>n&&(n=s)}if(n<2.5)return{ruleId:"circadian_rhythm_failure",category:"cadence",name:"24/7 Sleepless Circadian Anomaly",points:40,description:`Continuous posting spanning ${Math.round(t)}h with no natural sleep break longer than ${n.toFixed(1)}h`}}return null}function te(r){if(r.length<10)return null;const e=new Map;for(const n of r)n.linkId&&e.set(n.linkId,(e.get(n.linkId)||0)+1);return Array.from(e.values()).filter(n=>n>1).length>=3?{ruleId:"conversationalist_safe_harbor",category:"safe_harbor",name:"Conversational Dialogue Safe Harbor",points:-30,description:"Engages in multi-comment conversational chains across discussion threads"}:r.length>=15&&e.size===r.length?{ruleId:"drive_by_dialogue_deficit",category:"dialogue",name:"Drive-By Dialogue Deficit",points:30,description:"Single isolated comments across 15+ threads with zero conversational replies"}:null}function ne(r){return r<0?{ruleId:"negative_karma",category:"profile",name:"Negative Total Karma",points:35,description:`Account has negative overall reputation (${r})`}:r<10?{ruleId:"low_karma_baseline",category:"profile",name:"Near-Zero Karma Baseline",points:25,description:`Account has under 10 total karma (${r})`}:null}function re(r,e,t=Math.floor(Date.now()/1e3)){const n=(t-r)/86400;return n>365&&e>2e3?{ruleId:"established_user_safe_harbor",category:"safe_harbor",name:"Established Organic User Safe Harbor",points:-50,description:`Account is over 1 year old (${Math.round(n)}d) with strong karma (${e})`}:null}const se=new Set(["automoderator","remindmebot","savevideo","haikusbot","sneakpeekbot","auddbot","repostsleuthbot","gifreversingbot","converter-bot","vredditdownloader","bot-sleuth-bot","qualityvote","moderators"]);function oe(r,e=[]){if(!r)return!1;const t=r.toLowerCase().replace(/^u\//,"");return se.has(t)?!0:e.some(n=>n.toLowerCase().replace(/^u\//,"")===t)}function ae(r,e=[],t=!1,n=!1){if(t||n)return 1;const o=e.some(s=>s.category==="safe_harbor");if(r){const s=(Date.now()/1e3-r.createdUtc)/86400;if(s>=3*365&&r.totalKarma>=2e3||s>=365&&r.totalKarma>=1e4||o&&s>=365&&r.totalKarma>=2e3)return 1;if(s>=180&&r.totalKarma>=100||s>=60&&r.totalKarma>=500)return 2}return 3}function T(r,e,t,n,o,s={}){const a=s.deflectThreshold??70,c=s.flagThreshold??40,i=[];if(oe(r,s.userWhitelist))return{username:r,score:0,classification:"CLEAN",breakdown:[{ruleId:"whitelisted_user",category:"safe_harbor",name:"Whitelisted / Verified Utility Account",points:-100,description:"Account is explicitly on the safe whitelist"}],evaluatedAt:Date.now(),profile:e,confidenceTier:1};if(s.isMod||e?.isMod)return{username:r,score:0,classification:"CLEAN",breakdown:[{ruleId:"moderator_safe_harbor",category:"safe_harbor",name:"Subreddit Moderator Safe Harbor",points:-100,description:"Account is a designated moderator of this community"}],evaluatedAt:Date.now(),profile:e,confidenceTier:1};s.isExactTitleRepost&&i.push({ruleId:"exact_historical_repost",category:"submission",name:"Exact Historical Title Repost",points:60,description:"Submission title is an exact duplicate of a high-scoring historical post from > 180d ago"}),s.isAccompliceHijacker&&i.push({ruleId:"accomplice_comment_theft",category:"syndicate",name:"Accomplice Comment Hijacking",points:65,description:"Comment matches a top comment from the original archival submission"});const f=o?x(o):null,u=null,m=e?.bio?x(e.bio):null;(f||u||m)&&i.push(f||u||m);const d=W(r);if(d&&i.push(d),e){if(e.bio){const b=V(e.bio);b&&i.push(b)}if(e.createdUtc){const b=X(e.createdUtc);b&&i.push(b)}const g=ne(e.totalKarma);g&&i.push(g);const y=Q(e.linkKarma,e.commentKarma);y&&i.push(y);const C=re(e.createdUtc,e.totalKarma);C&&i.push(C)}if(t&&t.length>0&&e){const g=Y(e.createdUtc,e.totalKarma,t);g&&i.push(g);const y=Z(e.commentKarma,t);y&&i.push(y);const C=J(t);C&&i.push(C);const b=ee(t);b&&i.push(b);const H=te(t);H&&i.push(H)}const l=i.reduce((g,y)=>g+y.points,0),h=Math.max(0,Math.min(100,l));let p="CLEAN";h>=a?p="DEFLECT":h>=c&&(p="FLAG");const he=p==="CLEAN"?ae(e,i,!1,!!(s.isMod||e?.isMod)):void 0;return{username:r,score:h,classification:p,breakdown:i,evaluatedAt:Date.now(),profile:e,confidenceTier:he}}class D{async getSettings(){const e=await chrome.runtime.sendMessage({type:"GET_SETTINGS"});return e?.success&&e.data?e.data:S}async checkSubmission(e){const t=await chrome.runtime.sendMessage({type:"CHECK_SUBMISSION",...e});return t?.success&&t.data?t.data:{isRepost:!1}}async checkUsers(e){const t=await chrome.runtime.sendMessage({type:"CHECK_USERS",usernames:e});return t?.success&&t.data?t.data:{}}async addWhitelist(e){await chrome.runtime.sendMessage({type:"ADD_WHITELIST",username:e})}async blockUser(e){return(await chrome.runtime.sendMessage({type:"BLOCK_USER",username:e}))?.data||{success:!1}}}const v="bd_settings",U="bd_cache_",ie=7*24*60*60*1e3;function k(r,e){try{if(typeof GM_getValue=="function")return GM_getValue(r,e);const t=localStorage.getItem(r);return t?JSON.parse(t):e}catch{return e}}function R(r,e){try{if(typeof GM_setValue=="function"){GM_setValue(r,e);return}localStorage.setItem(r,JSON.stringify(e))}catch{}}class ce{settings=k(v,S);async getSettings(){return this.settings=k(v,S),this.settings}async addWhitelist(e){const t=e.toLowerCase().replace(/^u\//,"");this.settings.whitelist.includes(t)||(this.settings.whitelist.push(t),R(v,this.settings))}async blockUser(e){return await _(e)}async checkSubmission(e){if(!this.settings.enableSubmissionCheck)return{isRepost:!1};const t=await j(e.subreddit,e.title);let n=[];t&&(n=await O(t.id));const o=T(e.author,void 0,void 0,void 0,e.title,{isExactTitleRepost:!!t,deflectThreshold:this.settings.deflectThreshold,flagThreshold:this.settings.flagThreshold,userWhitelist:this.settings.whitelist});return{isRepost:!!t,originalPost:t||void 0,historicalComments:n,opScored:o}}async checkUsers(e){const t={},n=[];for(const o of e){const s=o.replace(/^u\//,"").trim();if(!s||s==="[deleted]")continue;const a=this.getCachedUser(s);a?t[s]=a:n.push(s)}for(const o of n)try{const s=await $(o);let a=[];if(s){const i=(Date.now()/1e3-s.createdUtc)/86400;(i>=60&&i<=1e3&&s.totalKarma<150||s.linkKarma>5e3&&s.commentKarma<30||s.totalKarma<0)&&this.settings.enableCadenceCheck&&(a=await q(o))}const c=T(o,s||void 0,a,void 0,void 0,{deflectThreshold:this.settings.deflectThreshold,flagThreshold:this.settings.flagThreshold,userWhitelist:this.settings.whitelist});c.classification==="DEFLECT"&&this.settings.autoBlockReddit&&!c.isBlockedOnReddit&&(await _(o)).success&&(c.isBlockedOnReddit=!0),this.setCachedUser(c),t[o]=c}catch(s){console.warn(`[BotDeflector Userscript] Could not evaluate ${o}:`,s)}return t}getCachedUser(e){const t=U+e.toLowerCase(),n=k(t,null);return!n||Date.now()-n.evaluatedAt>ie?null:n}setCachedUser(e){const t=U+e.username.toLowerCase();R(t,e)}}function M(r,e,t,n){const o=document.createElement("div");o.className="bd-deflection-bar";const s=document.createElement("div");s.className="bd-deflection-meta";const a=document.createElement("span");if(a.className=r.classification==="DEFLECT"?"bd-badge-red":"bd-badge-yellow",a.textContent=`${r.classification} (${r.score}PTS)`,s.appendChild(a),r.isBlockedOnReddit){const l=document.createElement("span");l.className="bd-badge-red",l.style.backgroundColor="#B71C1C",l.textContent="BLOCKED ON REDDIT",s.appendChild(l)}const c=document.createElement("span");c.className="bd-user-label",c.textContent=`u/${r.username}`,s.appendChild(c);const i=document.createElement("span");i.className="bd-reason-text";const f=r.breakdown.filter(l=>l.points>0).slice(0,2).map(l=>l.name).join(" • ");f&&(i.textContent=`[ ${f} ]`,s.appendChild(i));const u=document.createElement("div");if(u.style.display="flex",u.style.gap="6px",!r.isBlockedOnReddit&&n){const l=document.createElement("button");l.className="bd-action-btn",l.style.color="#FF8A80",l.textContent="Block on Reddit",l.title="Permanently block this user on your Reddit account",l.addEventListener("click",h=>{h.stopPropagation(),l.textContent="Blocking...",l.disabled=!0,n(),l.textContent="Blocked",l.style.color="#AAAAAA"}),u.appendChild(l)}const m=document.createElement("button");m.className="bd-action-btn",m.textContent="Reveal",m.addEventListener("click",l=>{l.stopPropagation(),e(),o.remove()});const d=document.createElement("button");return d.className="bd-action-btn",d.textContent="Whitelist",d.title="Never deflect this account",d.addEventListener("click",l=>{l.stopPropagation(),t(),e(),o.remove()}),u.appendChild(m),u.appendChild(d),o.appendChild(s),o.appendChild(u),o}function I(r,e){const t=document.createElement("div");t.className="bd-submission-banner";const n=document.createElement("div");n.className="bd-banner-header";const o=document.createElement("span");o.className="bd-badge-red",o.textContent=`DEFLECTED REPOST FARM (${e.score} PTS)`;const s=document.createElement("span");s.className="bd-user-label",s.textContent=`OP u/${r.author} suspected bot`,n.appendChild(o),n.appendChild(s);const a=document.createElement("div");a.className="bd-banner-body";const c=new Date(r.createdUtc*1e3).toLocaleDateString();return a.innerHTML=`
    <strong>Exact Historical Title Repost Detected:</strong> Original post from <strong>${c}</strong> with <strong>${r.score.toLocaleString()} upvotes</strong>.
    <br/>
    <a class="bd-banner-link" href="https://reddit.com${r.permalink||""}" target="_blank" rel="noopener noreferrer">
      &rarr; View Original Submission
    </a>
  `,t.appendChild(n),t.appendChild(a),t}class le{name="Old Reddit (Classic)";detect(){return document.body.classList.contains("reddit-classic")||document.querySelector("#siteTable, .nestedlisting, .commentarea")!==null}extractSubmission(){const e=document.querySelector(".thing.link");if(!e)return null;const t=e.querySelector("a.title"),n=e.querySelector("a.author"),o=t?.textContent?.trim()||"",s=n?.textContent?.trim()||"",a=e.getAttribute("data-subreddit")||"";return!o||!s?null:{title:o,author:s,subreddit:a,element:e}}findComments(){const e=[];return document.querySelectorAll(".thing.comment").forEach(n=>{const o=n;if(o.dataset.bdProcessed==="true")return;const s=o.getAttribute("data-author")||"";if(!s||s==="[deleted]")return;const a=o.getAttribute("data-fullname")||o.id||"",i=o.querySelector("div.usertext-body")?.textContent?.trim()||"";e.push({id:a,author:s,bodyText:i,element:o,isTopLevel:!o.parentElement?.closest(".thing.comment")})}),e}collapseComment(e,t,n,o,s){const a=e.element;a.dataset.bdProcessed="true",a.dataset.bdDeflected="true";const c=a.querySelector(".entry");c&&c.classList.add("bd-hidden-content");const i=M(t,()=>{c&&c.classList.remove("bd-hidden-content"),a.dataset.bdDeflected="false",n()},o||(()=>{}),s);a.prepend(i)}injectSubmissionWarning(e,t,n){if(e.element.querySelector(".bd-submission-banner"))return;const o=I(t,n);e.element.prepend(o)}observe(e){const t=new MutationObserver(o=>{let s=!1;for(const a of o){for(const c of a.addedNodes)if(c instanceof HTMLElement&&(c.classList.contains("comment")||c.querySelector(".comment"))){s=!0;break}if(s)break}s&&e()}),n=document.querySelector(".commentarea")||document.body;return t.observe(n,{childList:!0,subtree:!0}),t}}class de{name="Shreddit (Modern Reddit)";detect(){return!!document.querySelector("shreddit-app, shreddit-comment, shreddit-post")}extractSubmission(){const e=document.querySelector("shreddit-post");if(!e)return null;const t=e.getAttribute("post-title")||e.querySelector("h1")?.textContent?.trim()||"",n=e.getAttribute("author")||"",o=e.getAttribute("subreddit-prefixed-name")||"";return!t||!n?null:{title:t,author:n,subreddit:o.replace(/^r\//,""),element:e}}findComments(){const e=[];return document.querySelectorAll("shreddit-comment").forEach(n=>{const o=n;if(o.dataset.bdProcessed==="true")return;const s=o.getAttribute("author")||"";if(!s||s==="[deleted]")return;const a=o.getAttribute("thingid")||o.id||"",i=(o.querySelector('div[slot="comment"]')||o).textContent?.trim()||"";e.push({id:a,author:s,bodyText:i,element:o,isTopLevel:o.parentElement?.tagName.toLowerCase()!=="shreddit-comment"})}),e}collapseComment(e,t,n,o,s){const a=e.element;a.dataset.bdProcessed="true",a.dataset.bdDeflected="true",a.setAttribute("collapsed","");const c=M(t,()=>{a.removeAttribute("collapsed"),a.dataset.bdDeflected="false",n()},o||(()=>{}),s);a.prepend(c)}injectSubmissionWarning(e,t,n){if(e.element.querySelector(".bd-submission-banner"))return;const o=I(t,n);e.element.prepend(o)}observe(e){const t=new MutationObserver(n=>{let o=!1;for(const s of n){for(const a of s.addedNodes)if(a instanceof HTMLElement&&(a.tagName.toLowerCase()==="shreddit-comment"||a.querySelector("shreddit-comment"))){o=!0;break}if(o)break}o&&e()});return t.observe(document.body,{childList:!0,subtree:!0}),t}}class ue{visibleElements=new Set;observer;constructor(){this.observer=new IntersectionObserver(e=>{for(const t of e){const n=t.target,o=n.id||n.getAttribute("thingid")||n.getAttribute("data-fullname")||"";o&&(t.isIntersecting?this.visibleElements.add(o):this.visibleElements.delete(o))}},{root:null,rootMargin:"200px",threshold:.05})}observeComment(e){this.observer.observe(e.element)}sortPrioritized(e){return[...e].sort((t,n)=>{const o=this.visibleElements.has(t.id),s=this.visibleElements.has(n.id);return o&&!s?-1:!o&&s?1:0})}disconnect(){this.observer.disconnect()}}class L{client;adapter=null;viewport=new ue;historicalTopComments=[];processedCommentIds=new Set;activeSettings=null;isScanning=!1;constructor(e=new D){this.client=e}async init(){const e=new de,t=new le;e.detect()?this.adapter=e:t.detect()?this.adapter=t:this.adapter=e,console.log(`[BotDeflector] Active Adapter: ${this.adapter.name}`),await this.refreshSettings(),await this.evaluateSubmission(),await this.scanComments(),this.adapter.observe(()=>{this.debouncedScan()})}debounceTimer=null;debouncedScan(){this.debounceTimer&&window.clearTimeout(this.debounceTimer),this.debounceTimer=window.setTimeout(()=>{this.scanComments()},400)}async refreshSettings(){try{this.activeSettings=await this.client.getSettings()}catch{}}async evaluateSubmission(){if(!this.adapter)return;const e=this.adapter.extractSubmission();if(e)try{const t=await this.client.checkSubmission({title:e.title,subreddit:e.subreddit,author:e.author});t?.isRepost&&t?.originalPost&&(this.historicalTopComments=t.historicalComments||[],this.adapter.injectSubmissionWarning(e,t.originalPost,t.opScored||{username:e.author,score:85,classification:"DEFLECT",breakdown:[],evaluatedAt:Date.now()}))}catch(t){console.warn("[BotDeflector] Submission check error:",t)}}async scanComments(){if(!(!this.adapter||this.isScanning)){this.isScanning=!0;try{const e=this.adapter.findComments(),t=[];for(const c of e)this.processedCommentIds.has(c.id)||(this.processedCommentIds.add(c.id),this.viewport.observeComment(c),t.push(c));if(t.length===0){this.isScanning=!1;return}const n=this.viewport.sortPrioritized(t),o=[];for(const c of n)if(this.isAccompliceStolenComment(c.bodyText)){const i={username:c.author,score:95,classification:"DEFLECT",breakdown:[{ruleId:"accomplice_comment_theft",category:"syndicate",name:"Accomplice Comment Hijacking",points:65,description:"Word-for-word copy of top comment from original historical thread"}],evaluatedAt:Date.now()};this.adapter.collapseComment(c,i,()=>{},()=>this.client.addWhitelist(i.username),()=>this.client.blockUser(i.username))}else o.push(c);const s=Array.from(new Set(o.map(c=>c.author)));if(s.length===0){this.isScanning=!1;return}const a=await this.client.checkUsers(s);for(const c of o){const i=a[c.author.toLowerCase().replace(/^u\//,"")];i&&(i.classification==="DEFLECT"?this.adapter.collapseComment(c,i,()=>{},()=>this.client.addWhitelist(i.username),()=>this.client.blockUser(i.username)):i.classification==="FLAG"&&this.activeSettings?.mode==="AUDIT_TAG"&&(c.element.style.borderLeft="3px solid #FBC02D"))}}finally{this.isScanning=!1}}}isAccompliceStolenComment(e){if(!e||this.historicalTopComments.length===0)return!1;const t=e.toLowerCase().replace(/[^\w\s]/g,"").trim();if(t.length<20)return!1;for(const n of this.historicalTopComments){const o=n.toLowerCase().replace(/[^\w\s]/g,"").trim();if(t===o||o.includes(t)||t.includes(o))return!0}return!1}}if(typeof chrome<"u"&&typeof chrome.runtime?.sendMessage=="function"){const r=new L(new D);document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>r.init()):r.init()}const B=`/* Bauhaus Design System for BotDeflector Reddit Elements */

:root {
  --bd-bg: #111111;
  --bd-fg: #FFFFFF;
  --bd-border: #333333;
  --bd-red: #E53935;
  --bd-yellow: #FBC02D;
  --bd-blue: #1976D2;
  --bd-gray: #777777;
  --bd-font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --bd-font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

/* Deflection bar replacing/collapsing comment */
.bd-deflection-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: var(--bd-bg);
  border: 1px solid var(--bd-border);
  border-left: 4px solid var(--bd-red);
  padding: 6px 12px;
  margin: 6px 0;
  font-family: var(--bd-font-sans);
  color: var(--bd-fg);
  font-size: 12px;
  box-sizing: border-box;
}

.bd-deflection-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.bd-badge-red {
  background-color: var(--bd-red);
  color: #FFFFFF;
  font-family: var(--bd-font-mono);
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.bd-badge-yellow {
  background-color: var(--bd-yellow);
  color: #000000;
  font-family: var(--bd-font-mono);
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  text-transform: uppercase;
}

.bd-user-label {
  font-weight: 600;
  color: #FFFFFF;
}

.bd-reason-text {
  color: #AAAAAA;
  font-size: 11px;
}

.bd-action-btn {
  background: transparent;
  border: 1px solid #555555;
  color: #DDDDDD;
  font-family: var(--bd-font-mono);
  font-size: 10px;
  font-weight: 600;
  padding: 3px 8px;
  cursor: pointer;
  text-transform: uppercase;
  transition: background-color 0.15s, border-color 0.15s;
}

.bd-action-btn:hover {
  background-color: #333333;
  border-color: #FFFFFF;
  color: #FFFFFF;
}

/* Submission Archival Repost Banner */
.bd-submission-banner {
  background-color: var(--bd-bg);
  border: 2px solid var(--bd-red);
  padding: 12px 16px;
  margin: 12px 0;
  font-family: var(--bd-font-sans);
  color: var(--bd-fg);
  box-sizing: border-box;
}

.bd-banner-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.bd-banner-body {
  font-size: 13px;
  color: #CCCCCC;
  line-height: 1.4;
}

.bd-banner-link {
  color: var(--bd-blue);
  text-decoration: underline;
  font-weight: 600;
}

/* Stealth collapse hide class */
.bd-hidden-content {
  display: none !important;
}
`;if(typeof GM_addStyle=="function")GM_addStyle(B);else{const r=document.createElement("style");r.id="bot-deflector-styles",r.textContent=B,(document.head||document.documentElement).appendChild(r)}const me=new ce,F=new L(me);document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>{F.init().catch(r=>console.error("[BotDeflector Userscript Error]",r))}):F.init().catch(r=>console.error("[BotDeflector Userscript Error]",r))})();
