import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

// Report the full audit. An exception is limited to the unpatched build-time
// braces advisory, never production dependencies or unrelated advisories.
const knownDevAdvisory='GHSA-vfj7-8cjw-p6xm';
const exceptionExpires='2026-11-06';
let failed=false;
for(const prefix of ['', 'gateway']) {
  const args=['audit','--json',...(prefix?['--prefix',prefix]:[])];
  const run=spawnSync('npm',args,{encoding:'utf8',maxBuffer:8*1024*1024});
  let report;try{report=JSON.parse(run.stdout);}catch{throw new Error('The dependency audit could not complete.');}
  if(report.error) throw new Error('The dependency audit registry is unavailable.');
  const lock=JSON.parse(readFileSync(prefix?`${prefix}/package-lock.json`:'package-lock.json','utf8'));
  const all=report.vulnerabilities??{};
  function excepted(name,seen=new Set()) {
    if(seen.has(name))return false;seen.add(name);
    const item=all[name];if(!item||!item.nodes?.every(path=>lock.packages[path]?.dev===true)||new Date().toISOString().slice(0,10)>exceptionExpires)return false;
    return item.via.length>0&&item.via.every(v=>typeof v==='string'?excepted(v,new Set(seen)):v.url?.endsWith(knownDevAdvisory));
  }
  console.log(JSON.stringify({package:prefix||'web',counts:report.metadata?.vulnerabilities}));
  for(const [name,item]of Object.entries(all)) {
    if(!['high','critical'].includes(item.severity))continue;
    if(excepted(name))console.warn(`${name}: tracked build-only exception ${knownDevAdvisory}; expires ${exceptionExpires}`);
    else{failed=true;console.error(`${name}: unresolved ${item.severity} dependency advisory`);}
  }
}
if(failed)process.exitCode=1;
