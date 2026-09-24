const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const port=3210;
const base=`http://localhost:${port}`;
const server=spawn(process.execPath,['server.js'],{cwd:require('node:path').join(__dirname,'..'),env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
const request=async(path,options)=>{const response=await fetch(base+path,options);let body;try{body=await response.json()}catch{body=null}return{status:response.status,body}};
(async()=>{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Сервер не запустился')),3000);server.stdout.on('data',data=>{if(data.toString().includes('http://')){clearTimeout(timer);resolve()}});server.once('error',reject)});
  try{
    const all=await request('/api');
    assert.equal(all.status,200);
    assert.ok(all.body.formations.length>0&&all.body.agitations.length>0);
    const formation=all.body.formations[0];
    const updated=await request(`/api/formations/${formation.id}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({name:formation.name})});
    assert.equal(updated.status,200);
    const invalid=await request('/api/agitations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({date:'2026-09-25',formationId:formation.id,type:'wrong',left:-1})});
    assert.equal(invalid.status,400);
    const linkedDelete=await request(`/api/formations/${formation.id}`,{method:'DELETE'});
    assert.equal(linkedDelete.status,409);
    console.log('API smoke: OK');
  }finally{server.kill()}
})().catch(error=>{console.error(error.message);server.kill();process.exitCode=1});
