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
    const invalid=await request('/api/agitations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({date:'2026-09-25',formationId:formation.id,type:'wrong',left:-1})});
    assert.equal(invalid.status,400);
    const linkedDelete=await request(`/api/formations/${formation.id}`,{method:'DELETE'});
    assert.equal(linkedDelete.status,409);
    const division=await request('/api/divisions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({formationId:formation.id,name:'Тестовое подразделение'})});
    assert.equal(division.status,201);
    const member=await request('/api/formation_members',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({formationId:formation.id,divisionId:division.body.id,rank:'Тест',position:'Тест',callsign:'Тест',lastPromotion:'2026-09-25',specialties:''})});
    assert.equal(member.status,201);
    assert.equal((await request(`/api/formation_members/${member.body.id}`,{method:'DELETE'})).status,200);
    assert.equal((await request(`/api/divisions/${division.body.id}`,{method:'DELETE'})).status,200);
    const material=await request('/api/materials',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Тестовый материал',description:'Проверка',url:'https://docs.google.com/document/d/test'})});
    assert.equal(material.status,201);
    const materialUpdate=await request(`/api/materials/${material.body.id}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Обновленный материал',description:'Проверка',url:'https://drive.google.com/file/d/test'})});
    assert.equal(materialUpdate.status,200);
    const materialDelete=await request(`/api/materials/${material.body.id}`,{method:'DELETE'});
    assert.equal(materialDelete.status,200);
    const duplicate=await request('/api/cadets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idn:all.body.cadets[0].idn,callsign:'Новый',date:'2026-09-25',reporterId:all.body.fighters[0].id,duplicate:false})});
    assert.equal(duplicate.status,409);
    console.log('API smoke: OK');
  }finally{server.kill()}
})().catch(error=>{console.error(error.message);server.kill();process.exitCode=1});
