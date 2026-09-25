const http=require('http'),fs=require('fs'),path=require('path');
const {DatabaseSync}=require('node:sqlite');
const SOURCE=path.join(__dirname,'data','db.json'),DB=path.join(__dirname,'data','kmb.sqlite'),PUB=path.join(__dirname,'public'),PORT=process.env.PORT||3000;
const sqlite=new DatabaseSync(DB);
sqlite.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS formations(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE,fullName TEXT NOT NULL DEFAULT '',commander TEXT NOT NULL DEFAULT '',description TEXT NOT NULL DEFAULT '',agitationText TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS fighters(id INTEGER PRIMARY KEY,tag TEXT NOT NULL DEFAULT '',callsign TEXT NOT NULL,formationId INTEGER NOT NULL REFERENCES formations(id));
CREATE TABLE IF NOT EXISTS cadets(id INTEGER PRIMARY KEY,idn TEXT NOT NULL,callsign TEXT NOT NULL,date TEXT NOT NULL,reporterId INTEGER NOT NULL REFERENCES fighters(id),duplicate INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS agitations(id INTEGER PRIMARY KEY,eventId INTEGER NOT NULL,type TEXT NOT NULL CHECK(type IN ('open','closed')),date TEXT NOT NULL,formationId INTEGER NOT NULL REFERENCES formations(id),left INTEGER NOT NULL CHECK(left>=0),UNIQUE(eventId,formationId));
CREATE TABLE IF NOT EXISTS formation_members(id INTEGER PRIMARY KEY,formationId INTEGER NOT NULL REFERENCES formations(id),rank TEXT NOT NULL,callsign TEXT NOT NULL,lastPromotion TEXT NOT NULL,specialties TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS materials(id INTEGER PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',url TEXT NOT NULL,createdAt TEXT NOT NULL);`);
sqlite.exec('CREATE TABLE IF NOT EXISTS divisions(id INTEGER PRIMARY KEY,formationId INTEGER NOT NULL REFERENCES formations(id),name TEXT NOT NULL,UNIQUE(formationId,name));');
sqlite.exec('CREATE TABLE IF NOT EXISTS documentation_categories(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE,description TEXT NOT NULL DEFAULT \'\');');
const ensureColumn=(table,column,definition)=>{const columns=sqlite.prepare(`PRAGMA table_info(${table})`).all();if(!columns.some(x=>x.name===column))sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)};
ensureColumn('formations','commander',"TEXT NOT NULL DEFAULT ''");
ensureColumn('formations','fullName',"TEXT NOT NULL DEFAULT ''");
ensureColumn('formations','description',"TEXT NOT NULL DEFAULT ''");
ensureColumn('formations','agitationText',"TEXT NOT NULL DEFAULT ''");
ensureColumn('formation_members','position',"TEXT NOT NULL DEFAULT ''");
ensureColumn('formation_members','divisionId','INTEGER REFERENCES divisions(id)');
ensureColumn('materials','categoryId','INTEGER REFERENCES documentation_categories(id)');
const count=table=>sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
const migrate=()=>{
  if(count('formations')||!fs.existsSync(SOURCE))return;
  const source=JSON.parse(fs.readFileSync(SOURCE,'utf8')),groups={},used=new Set(source.agitations.map(a=>Number(a.eventId)).filter(Number.isInteger));
  const nextEvent=()=>{let id=Math.max(0,...used)+1;while(used.has(id))id++;used.add(id);return id};
  sqlite.exec('BEGIN');
  try{
    const addFormation=sqlite.prepare('INSERT INTO formations(id,name) VALUES(?,?)');
    const addFighter=sqlite.prepare('INSERT INTO fighters(id,tag,callsign,formationId) VALUES(?,?,?,?)');
    const addCadet=sqlite.prepare('INSERT INTO cadets(id,idn,callsign,date,reporterId,duplicate) VALUES(?,?,?,?,?,?)');
    const addAgitation=sqlite.prepare('INSERT INTO agitations(id,eventId,type,date,formationId,left) VALUES(?,?,?,?,?,?)');
    source.formations.forEach(x=>addFormation.run(x.id,x.name));
    source.fighters.forEach(x=>addFighter.run(x.id,x.tag||'',x.callsign,x.formationId));
    source.cadets.forEach(x=>addCadet.run(x.id,x.idn,x.callsign,x.date,x.reporterId,x.duplicate?1:0));
    source.agitations.forEach(x=>{const key=x.date+'|'+x.type;const eventId=Number.isInteger(x.eventId)?x.eventId:(groups[key]??(groups[key]=nextEvent()));addAgitation.run(x.id,eventId,x.type,x.date,x.formationId,x.left)});
    sqlite.exec('COMMIT');
  }catch(error){sqlite.exec('ROLLBACK');throw error}
};
migrate();
const tables={formations:'SELECT id,name,fullName,commander,description,agitationText FROM formations ORDER BY id',fighters:'SELECT id,tag,callsign,formationId FROM fighters ORDER BY id',cadets:'SELECT id,idn,callsign,date,reporterId,duplicate FROM cadets ORDER BY id',agitations:'SELECT id,eventId,type,date,formationId,left FROM agitations ORDER BY date DESC,id DESC',formation_members:'SELECT id,formationId,divisionId,rank,position,callsign,lastPromotion,specialties FROM formation_members ORDER BY id',materials:'SELECT id,title,description,url,categoryId,createdAt FROM materials ORDER BY createdAt DESC,id DESC',divisions:'SELECT id,formationId,name FROM divisions ORDER BY formationId,name',documentation_categories:'SELECT id,name,description FROM documentation_categories ORDER BY name'};
const collections=Object.keys(tables);
const readAll=collection=>sqlite.prepare(tables[collection]).all().map(x=>collection==='cadets'?{...x,duplicate:Boolean(x.duplicate)}:x);
const exists=(table,id)=>Boolean(sqlite.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(id));
const validation=(collection,o)=>{
  const required={formations:['name','commander'],fighters:['callsign','formationId'],cadets:['idn','callsign','date','reporterId'],agitations:['date','formationId','type','left'],formation_members:['formationId','rank','position','callsign','lastPromotion'],materials:['title','url'],divisions:['formationId','name'],documentation_categories:['name']}[collection];
  if(required.some(k=>o[k]===undefined||o[k]===''))return 'Заполните все поля';
  if(collection==='formations'&&typeof o.name!=='string')return 'Название должно быть текстом';
  if(collection==='fighters'&&(!Number.isInteger(o.formationId)||!exists('formations',o.formationId)))return 'Укажите существующее формирование';
  if(collection==='cadets'&&(!Number.isInteger(o.reporterId)||!exists('fighters',o.reporterId)))return 'Укажите существующего рапортующего';
  if(collection==='agitations'&&(!['open','closed'].includes(o.type)||!Number.isInteger(o.formationId)||!exists('formations',o.formationId)))return 'Некорректный тип или формирование';
  if(collection==='agitations'&&(!Number.isFinite(o.left)||o.left<0))return 'Количество ушедших должно быть неотрицательным числом';
  if(collection==='formation_members'&&(!Number.isInteger(o.formationId)||!exists('formations',o.formationId)))return 'Укажите существующее формирование';
  if(collection==='formation_members'&&o.divisionId!==undefined&&o.divisionId!==''&&(!Number.isInteger(o.divisionId)||!sqlite.prepare('SELECT 1 FROM divisions WHERE id=? AND formationId=?').get(o.divisionId,o.formationId)))return 'Укажите подразделение этого формирования';
  if(collection==='divisions'&&(!Number.isInteger(o.formationId)||!exists('formations',o.formationId)))return 'Укажите существующее формирование';
  if(collection==='materials'&&!/^https:\/\/(docs\.google\.com|drive\.google\.com)\//.test(o.url))return 'Укажите ссылку Google Docs или Google Drive';
  if(collection==='materials'&&o.categoryId!==undefined&&o.categoryId!==''&&(!Number.isInteger(o.categoryId)||!exists('documentation_categories',o.categoryId)))return 'Укажите существующую категорию';
  return '';
};
const nextId=table=>sqlite.prepare(`SELECT COALESCE(MAX(id),0)+1 AS id FROM ${table}`).get().id;
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json;charset=utf-8'});res.end(JSON.stringify(value))};
const body=req=>new Promise((resolve,reject)=>{let value='';req.on('data',chunk=>value+=chunk);req.on('end',()=>{try{resolve(JSON.parse(value))}catch(error){reject(error)}});req.on('error',reject)});
const mime={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css'};
http.createServer(async(req,res)=>{
  const p=new URL(req.url,'http://x').pathname.split('/').filter(Boolean);
  try{
    if(p[0]==='api'){
      const collection=p[1];if(req.method==='GET'&&!collection)return json(res,200,Object.fromEntries(collections.map(x=>[x,readAll(x)])));
      if(!collections.includes(collection))return json(res,404,{error:'Нет такой коллекции'});
      if(req.method==='POST'){
        const o=await body(req),error=validation(collection,o);if(error)return json(res,400,{error});
        if(collection==='cadets'){
          const duplicate=sqlite.prepare('SELECT 1 FROM cadets WHERE lower(trim(idn))=lower(trim(?)) OR lower(trim(callsign))=lower(trim(?)) LIMIT 1').get(o.idn,o.callsign);
          if(duplicate&&!o.duplicate)return json(res,409,{error:'Кадет с таким IDN или позывным уже есть',duplicate:true});
        }
        const id=nextId(collection);
        if(collection==='formations')sqlite.prepare('INSERT INTO formations(id,name,fullName,commander,description,agitationText) VALUES(?,?,?,?,?,?)').run(id,o.name,o.fullName||o.name,o.commander||'',o.description||'',o.agitationText||'');
        if(collection==='fighters')sqlite.prepare('INSERT INTO fighters(id,tag,callsign,formationId) VALUES(?,?,?,?)').run(id,o.tag||'',o.callsign,o.formationId);
        if(collection==='cadets')sqlite.prepare('INSERT INTO cadets(id,idn,callsign,date,reporterId,duplicate) VALUES(?,?,?,?,?,?)').run(id,o.idn,o.callsign,o.date,o.reporterId,o.duplicate?1:0);
        if(collection==='agitations'){
          const event=sqlite.prepare('SELECT eventId FROM agitations WHERE date=? AND type=? LIMIT 1').get(o.date,o.type);
          const eventId=o.eventId||event?.eventId||nextId('agitations');
          if(sqlite.prepare('SELECT 1 FROM agitations WHERE eventId=? AND formationId=?').get(eventId,o.formationId))return json(res,409,{error:'Это формирование уже добавлено в агитацию'});
          sqlite.prepare('INSERT INTO agitations(id,eventId,type,date,formationId,left) VALUES(?,?,?,?,?,?)').run(id,eventId,o.type,o.date,o.formationId,o.left);
        }
        if(collection==='formation_members')sqlite.prepare('INSERT INTO formation_members(id,formationId,divisionId,rank,position,callsign,lastPromotion,specialties) VALUES(?,?,?,?,?,?,?,?)').run(id,o.formationId,o.divisionId||null,o.rank,o.position||'',o.callsign,o.lastPromotion,o.specialties||'');
        if(collection==='materials')sqlite.prepare('INSERT INTO materials(id,title,description,url,categoryId,createdAt) VALUES(?,?,?,?,?,?)').run(id,o.title,o.description||'',o.url,o.categoryId||null,new Date().toISOString());
        if(collection==='divisions')sqlite.prepare('INSERT INTO divisions(id,formationId,name) VALUES(?,?,?)').run(id,o.formationId,o.name);
        if(collection==='documentation_categories')sqlite.prepare('INSERT INTO documentation_categories(id,name,description) VALUES(?,?,?)').run(id,o.name,o.description||'');
        return json(res,201,{...o,id});
      }
      if(req.method==='PUT'){
        const id=Number(p[2]);if(!exists(collection,id))return json(res,404,{error:'Не найдено'});
        const o=await body(req),error=validation(collection,o);if(error)return json(res,400,{error});
        if(collection==='cadets'){
          const duplicate=sqlite.prepare('SELECT 1 FROM cadets WHERE id<>? AND (lower(trim(idn))=lower(trim(?)) OR lower(trim(callsign))=lower(trim(?))) LIMIT 1').get(id,o.idn,o.callsign);
          if(duplicate&&!o.duplicate)return json(res,409,{error:'Кадет с таким IDN или позывным уже есть',duplicate:true});
        }
        if(collection==='formations')sqlite.prepare('UPDATE formations SET name=?,fullName=?,commander=?,description=?,agitationText=? WHERE id=?').run(o.name,o.fullName||o.name,o.commander||'',o.description||'',o.agitationText||'',id);
        if(collection==='fighters')sqlite.prepare('UPDATE fighters SET tag=?,callsign=?,formationId=? WHERE id=?').run(o.tag||'',o.callsign,o.formationId,id);
        if(collection==='cadets')sqlite.prepare('UPDATE cadets SET idn=?,callsign=?,date=?,reporterId=?,duplicate=? WHERE id=?').run(o.idn,o.callsign,o.date,o.reporterId,o.duplicate?1:0,id);
        if(collection==='agitations'){
          const current=sqlite.prepare('SELECT eventId FROM agitations WHERE id=?').get(id),eventId=o.eventId||current.eventId;
          if(sqlite.prepare('SELECT 1 FROM agitations WHERE eventId=? AND formationId=? AND id<>?').get(eventId,o.formationId,id))return json(res,409,{error:'Это формирование уже добавлено в агитацию'});
          sqlite.prepare('UPDATE agitations SET eventId=?,type=?,date=?,formationId=?,left=? WHERE id=?').run(eventId,o.type,o.date,o.formationId,o.left,id);
        }
        if(collection==='formation_members')sqlite.prepare('UPDATE formation_members SET formationId=?,divisionId=?,rank=?,position=?,callsign=?,lastPromotion=?,specialties=? WHERE id=?').run(o.formationId,o.divisionId||null,o.rank,o.position||'',o.callsign,o.lastPromotion,o.specialties||'',id);
        if(collection==='materials')sqlite.prepare('UPDATE materials SET title=?,description=?,url=?,categoryId=? WHERE id=?').run(o.title,o.description||'',o.url,o.categoryId||null,id);
        if(collection==='divisions')sqlite.prepare('UPDATE divisions SET formationId=?,name=? WHERE id=?').run(o.formationId,o.name,id);
        if(collection==='documentation_categories')sqlite.prepare('UPDATE documentation_categories SET name=?,description=? WHERE id=?').run(o.name,o.description||'',id);
        return json(res,200,{...o,id});
      }
      if(req.method==='DELETE'){
        const id=Number(p[2]);if(!exists(collection,id))return json(res,404,{error:'Не найдено'});
        if(collection==='formations'&&(sqlite.prepare('SELECT 1 FROM fighters WHERE formationId=?').get(id)||sqlite.prepare('SELECT 1 FROM agitations WHERE formationId=?').get(id)||sqlite.prepare('SELECT 1 FROM divisions WHERE formationId=?').get(id)))return json(res,409,{error:'Нельзя удалить: у формирования есть связанные записи'});
        if(collection==='fighters'&&sqlite.prepare('SELECT 1 FROM cadets WHERE reporterId=?').get(id))return json(res,409,{error:'Нельзя удалить: боец указан рапортующим у кадетов'});
        if(collection==='divisions'&&sqlite.prepare('SELECT 1 FROM formation_members WHERE divisionId=?').get(id))return json(res,409,{error:'Нельзя удалить: в подразделении есть участники'});
        if(collection==='documentation_categories'&&sqlite.prepare('SELECT 1 FROM materials WHERE categoryId=?').get(id))return json(res,409,{error:'Нельзя удалить: в категории есть документы'});
        sqlite.prepare(`DELETE FROM ${collection} WHERE id=?`).run(id);return json(res,200,{ok:true});
      }
      return json(res,405,{error:'Метод не поддерживается'});
    }
    const file=path.resolve(PUB,p.length?path.normalize(p.join('/')):'index.html');
    if(!file.startsWith(PUB+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end('Not found')}
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});return fs.createReadStream(file).pipe(res);
  }catch(error){console.error(error);return json(res,400,{error:'Некорректные данные'})}
}).listen(PORT,()=>console.log('http://localhost:'+PORT));
