// One reproducible entry point for new QA specifications and existing regression protections.
// Existing suites are complementary; RosterQA.gs contains newly authored scenarios.
const fs=require('fs'),path=require('path'),cp=require('child_process');
process.chdir(path.resolve(__dirname,'..'));
const suites=['qacheck','qawhatif','qaplatform','cfgcheck','tablecheck','publishcheck','welcomecheck','perfcheck','panelopencheck','selectioncheck','resetcheck','hardeningcheck','settingscheck','groupcheck','errorcheck','recoverycheck','privacycheck','startupcheck'];
const started=Date.now(),results=[];
for(const name of suites){
 const before=Date.now(),r=cp.spawnSync(process.execPath,['tools/'+name+'.js'],{encoding:'utf8',timeout:60000});
 const passed=r.status===0&&!r.error;
 results.push({suite:name,status:passed?'PASS':'FAIL',ms:Date.now()-before,detail:(r.stdout||'')+(r.stderr||'')+(r.error?String(r.error):'')});
 console.log(name+': '+(passed?'PASS':'FAIL'));if(!passed)console.error(results[results.length-1].detail);
}
const html=cp.spawnSync(process.execPath,['tools/htmlchk.js','ControlPanel.html','SettingsPanel.html'],{encoding:'utf8',timeout:60000});
results.push({suite:'html',status:html.status===0?'PASS':'FAIL',detail:(html.stdout||'')+(html.stderr||'')});
try{for(const file of fs.readdirSync('.').filter(f=>f.endsWith('.gs')))new Function(fs.readFileSync(file,'utf8'));results.push({suite:'syntax',status:'PASS'});}catch(e){results.push({suite:'syntax',status:'FAIL',detail:String(e)});}
fs.mkdirSync('tools/.qa',{recursive:true});
fs.writeFileSync('tools/.qa/latest.json',JSON.stringify({when:new Date().toISOString(),ms:Date.now()-started,results},null,2));
const failed=results.filter(r=>r.status!=='PASS');console.log(results.length+' suites/checks; '+failed.length+' failed. Report: tools/.qa/latest.json');
if(failed.length)process.exitCode=1;
