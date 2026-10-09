import express from 'express';
import helmet from 'helmet';
import pg from 'pg';
import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
const app=express(),db=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSL==='true'?{rejectUnauthorized:true}:undefined});
if(!process.env.DATABASE_URL)throw Error('DATABASE_URL necessária');
app.disable('x-powered-by');app.use(helmet());app.use(express.json({limit:'80kb'}));
app.use('/api',rateLimit({windowMs:900000,limit:300,standardHeaders:'draft-7',legacyHeaders:false}));
const H=x=>crypto.createHash('sha256').update(x).digest('hex');
const pwd=(p,s)=>new Promise((ok,bad)=>crypto.scrypt(p,s,64,(e,b)=>e?bad(e):ok(b.toString('hex'))));
const run=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const error=(message,status=400)=>Object.assign(new Error(message),{status});
const text=(v,n=250)=>String(v??'').trim().slice(0,n);
const okdate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'');
const id=v=>Number.isSafeInteger(Number(v))&&Number(v)>0;
async function init(){
const schema=[
"CREATE TABLE IF NOT EXISTS users(id BIGSERIAL PRIMARY KEY,email TEXT UNIQUE NOT NULL,pass TEXT NOT NULL,salt TEXT NOT NULL)",
"CREATE TABLE IF NOT EXISTS spaces(id BIGSERIAL PRIMARY KEY,name TEXT UNIQUE NOT NULL,kind TEXT NOT NULL)",
"CREATE TABLE IF NOT EXISTS access(user_id BIGINT REFERENCES users(id),space_id BIGINT REFERENCES spaces(id),PRIMARY KEY(user_id,space_id))",
"CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id BIGINT REFERENCES users(id),expires TIMESTAMPTZ NOT NULL)",
"CREATE TABLE IF NOT EXISTS accounts(id BIGSERIAL PRIMARY KEY,space_id BIGINT REFERENCES spaces(id),name TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'bank',opening NUMERIC(14,2) NOT NULL DEFAULT 0)",
"CREATE TABLE IF NOT EXISTS cards(id BIGSERIAL PRIMARY KEY,space_id BIGINT REFERENCES spaces(id),name TEXT NOT NULL,credit_limit NUMERIC(14,2) NOT NULL DEFAULT 0,closing_day INT NOT NULL DEFAULT 1,due_day INT NOT NULL DEFAULT 10)",
"CREATE TABLE IF NOT EXISTS categories(id BIGSERIAL PRIMARY KEY,space_id BIGINT REFERENCES spaces(id),name TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'expense')",
"CREATE TABLE IF NOT EXISTS contacts(id BIGSERIAL PRIMARY KEY,space_id BIGINT REFERENCES spaces(id),name TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'other',notes TEXT NOT NULL DEFAULT '')",
"CREATE TABLE IF NOT EXISTS entries(id BIGSERIAL PRIMARY KEY,space_id BIGINT REFERENCES spaces(id),description TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('income','expense','transfer')),amount NUMERIC(14,2) NOT NULL CHECK(amount>0),due_date DATE NOT NULL,paid_date DATE,account_id BIGINT REFERENCES accounts(id),to_account_id BIGINT REFERENCES accounts(id),card_id BIGINT REFERENCES cards(id),category_id BIGINT REFERENCES categories(id),contact_id BIGINT REFERENCES contacts(id),cost_center TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',installment_number INT,installment_count INT,created_by BIGINT REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())",
"CREATE INDEX IF NOT EXISTS entries_space_due ON entries(space_id,due_date)",
"CREATE TABLE IF NOT EXISTS audit(id BIGSERIAL PRIMARY KEY,space_id BIGINT,user_id BIGINT,action TEXT NOT NULL,entity TEXT NOT NULL,entity_id BIGINT,at TIMESTAMPTZ DEFAULT NOW())"
];for(const sql of schema)await db.query(sql);
for(const [name,kind] of [['Casa','home'],['Nossas Delícias','business']])await db.query('INSERT INTO spaces(name,kind) VALUES($1,$2) ON CONFLICT(name) DO NOTHING',[name,kind]);
for(const [space,kind,names] of [['Casa','expense',['Alimentação','Moradia','Água','Energia','Internet','Transporte','Saúde','Educação','Lazer','Assinaturas','Impostos','Outros']],['Casa','income',['Salário','Renda extra','Reembolso']],['Nossas Delícias','expense',['Ingredientes','Embalagens','Fornecedores','Entregas','Funcionários','Aluguel','Energia','Água','Marketing','Impostos','Equipamentos','Manutenção','Taxas bancárias']],['Nossas Delícias','income',['Vendas','Encomendas','Eventos','Outros recebimentos']]]){await db.query('INSERT INTO categories(space_id,name,kind) SELECT s.id,$2,$3 FROM spaces s WHERE s.name=$1 AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.space_id=s.id AND c.name=$2 AND c.kind=$3)',[space,kind,names[0]]);for(const name of names.slice(1))await db.query('INSERT INTO categories(space_id,name,kind) SELECT s.id,$2,$3 FROM spaces s WHERE s.name=$1 AND NOT EXISTS (SELECT 1 FROM categories c WHERE c.space_id=s.id AND c.name=$2 AND c.kind=$3)',[space,name,kind]);}
if(!(await db.query('SELECT id FROM users LIMIT 1')).rowCount){
 const email=text(process.env.ADMIN_EMAIL,255).toLowerCase(),password=process.env.ADMIN_PASSWORD||'';
 if(!email.includes('@')||password.length<16)throw Error('Configure ADMIN_EMAIL e ADMIN_PASSWORD com 16+ caracteres');
 const salt=crypto.randomBytes(20).toString('hex'),pass=await pwd(password,salt);
 const u=(await db.query('INSERT INTO users(email,pass,salt) VALUES($1,$2,$3) RETURNING id',[email,pass,salt])).rows[0];
 await db.query('INSERT INTO access(user_id,space_id) SELECT $1,id FROM spaces',[u.id]);
}}
app.post('/api/login',rateLimit({windowMs:900000,limit:10,standardHeaders:'draft-7',legacyHeaders:false}),run(async(req,res)=>{
const u=(await db.query('SELECT * FROM users WHERE email=$1',[text(req.body.email,255).toLowerCase()])).rows[0];
const password=String(req.body.password||'').slice(0,500),attempt=await pwd(password,u?.salt||crypto.randomBytes(20).toString('hex'));
if(!u||!crypto.timingSafeEqual(Buffer.from(attempt,'hex'),Buffer.from(u.pass,'hex')))throw error('Credenciais inválidas',401);
const token=crypto.randomBytes(32).toString('hex');
await db.query("INSERT INTO sessions(token,user_id,expires) VALUES($1,$2,NOW()+INTERVAL '7 days')",[H(token),u.id]);
res.cookie('fin_sid',token,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',maxAge:604800000,path:'/'}).json({ok:true});
}));
app.use('/api',run(async(req,res,next)=>{
const token=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('fin_sid='))?.slice(8)||'';
if(!/^[a-f0-9]{64}$/.test(token))throw error('Faça login',401);
const u=(await db.query('SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1 AND s.expires>NOW()',[H(token)])).rows[0];
if(!u)throw error('Sessão expirada',401);
if(!['GET','HEAD','OPTIONS'].includes(req.method)){
const origin=req.headers.origin,host=req.headers['x-forwarded-host']||req.headers.host;
if(origin&&new URL(origin).host!==host)throw error('Origem não permitida',403);
}
req.user=u;next();
}));
app.get('/api/me',run(async(req,res)=>res.json({user:req.user,spaces:(await db.query('SELECT s.* FROM spaces s JOIN access a ON a.space_id=s.id WHERE a.user_id=$1',[req.user.id])).rows})));
app.post('/api/logout',run(async(req,res)=>{const t=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('fin_sid='))?.slice(8)||'';await db.query('DELETE FROM sessions WHERE token=$1',[H(t)]);res.clearCookie('fin_sid',{path:'/'}).json({ok:true})}));
app.use('/api/s/:sid',run(async(req,res,next)=>{
if(!id(req.params.sid))throw error('Ambiente inválido');
if(!(await db.query('SELECT 1 FROM access WHERE user_id=$1 AND space_id=$2',[req.user.id,req.params.sid])).rowCount)throw error('Sem acesso',403);
req.sid=Number(req.params.sid);next();
}));
const audit=(req,action,entity,entityId)=>db.query('INSERT INTO audit(space_id,user_id,action,entity,entity_id) VALUES($1,$2,$3,$4,$5)',[req.sid,req.user.id,action,entity,entityId]);
const dict={accounts:['name','kind','opening'],cards:['name','credit_limit','closing_day','due_day'],categories:['name','kind'],contacts:['name','kind','notes']};
for(const [table,fields] of Object.entries(dict)){
app.get('/api/s/:sid/'+table,run(async(req,res)=>res.json((await db.query('SELECT * FROM '+table+' WHERE space_id=$1 ORDER BY id DESC',[req.sid])).rows)));
app.post('/api/s/:sid/'+table,run(async(req,res)=>{
const vals=fields.map(f=>req.body[f]??(f==='opening'||f==='credit_limit'?0:f==='closing_day'?1:f==='due_day'?10:f==='notes'?'':f==='kind'?'other':''));
if(!text(vals[0]))throw error('Nome obrigatório');
if(['accounts','cards'].includes(table)&&vals.slice(table==='cards'?1:2).some(v=>!Number.isFinite(Number(v))))throw error('Valor inválido');
if(table==='cards'&&(![vals[2],vals[3]].every(v=>Number.isInteger(Number(v))&&v>=1&&v<=31)))throw error('Dia inválido');
const slots=vals.map((_,i)=>'$'+(i+2)).join(',');
const r=(await db.query('INSERT INTO '+table+'(space_id,'+fields.join(',')+') VALUES($1,'+slots+') RETURNING *',[req.sid,...vals])).rows[0];await audit(req,'create',table,r.id);res.status(201).json(r);
}));
app.delete('/api/s/:sid/'+table+'/:id',run(async(req,res)=>{
if(!id(req.params.id))throw error('ID inválido');
const r=await db.query('DELETE FROM '+table+' WHERE id=$1 AND space_id=$2 RETURNING id',[req.params.id,req.sid]);
if(!r.rowCount)throw error('Não encontrado',404);await audit(req,'delete',table,Number(req.params.id));res.json({ok:true});
}));
}
const columns=['description','kind','amount','due_date','paid_date','account_id','to_account_id','card_id','category_id','contact_id','cost_center','notes','installment_number','installment_count'];
async function validate(req){
const b={...req.body};b.description=text(b.description,300);b.cost_center=text(b.cost_center,100);b.notes=text(b.notes,1500);
if(!b.description||!['income','expense','transfer'].includes(b.kind)||!Number.isFinite(Number(b.amount))||Number(b.amount)<=0||Number(b.amount)>999999999999||!okdate(b.due_date)||b.paid_date&&!okdate(b.paid_date))throw error('Verifique descrição, tipo, valor e datas');
for(const [field,table] of [['account_id','accounts'],['to_account_id','accounts'],['card_id','cards'],['category_id','categories'],['contact_id','contacts']]){
if(!b[field]){b[field]=null;continue}if(!id(b[field])||!(await db.query('SELECT 1 FROM '+table+' WHERE id=$1 AND space_id=$2',[b[field],req.sid])).rowCount)throw error('Referência inválida: '+field);
}
if(b.kind==='transfer'&&(!b.account_id||!b.to_account_id||b.account_id===b.to_account_id||b.card_id))throw error('Transferência exige duas contas diferentes');
if(b.kind!=='transfer')b.to_account_id=null;
if(b.account_id&&b.card_id)throw error('Selecione conta OU cartão');
for(const f of ['installment_number','installment_count']){b[f]=b[f]?Number(b[f]):null;if(b[f]!==null&&(!Number.isInteger(b[f])||b[f]<1||b[f]>360))throw error('Parcela inválida')}
return b;
}
app.get('/api/s/:sid/entries',run(async(req,res)=>{
const args=[req.sid],where=['space_id=$1'];
for(const [k,op] of [['from','>='],['to','<=']])if(okdate(req.query[k])){args.push(req.query[k]);where.push('due_date'+op+'$'+args.length)}
res.json((await db.query('SELECT * FROM entries WHERE '+where.join(' AND ')+' ORDER BY due_date DESC,id DESC LIMIT 2000',args)).rows);
}));
app.post('/api/s/:sid/entries',run(async(req,res)=>{
const b=await validate(req),values=columns.map(c=>b[c]??null),slots=values.map((_,i)=>'$'+(i+2)).join(',');
const row=(await db.query('INSERT INTO entries(space_id,'+columns.join(',')+',created_by) VALUES($1,'+slots+',$'+(values.length+2)+') RETURNING *',[req.sid,...values,req.user.id])).rows[0];
await audit(req,'create','entries',row.id);res.status(201).json(row);
}));
app.put('/api/s/:sid/entries/:id',run(async(req,res)=>{
if(!id(req.params.id))throw error('ID inválido');const b=await validate(req),values=columns.map(c=>b[c]??null),set=columns.map((c,i)=>c+'=$'+(i+3)).join(',');
const row=(await db.query('UPDATE entries SET '+set+' WHERE id=$1 AND space_id=$2 RETURNING *',[req.params.id,req.sid,...values])).rows[0];if(!row)throw error('Não encontrado',404);
await audit(req,'update','entries',row.id);res.json(row);
}));
app.delete('/api/s/:sid/entries/:id',run(async(req,res)=>{
if(!id(req.params.id))throw error('ID inválido');const r=await db.query('DELETE FROM entries WHERE id=$1 AND space_id=$2 RETURNING id',[req.params.id,req.sid]);if(!r.rowCount)throw error('Não encontrado',404);await audit(req,'delete','entries',Number(req.params.id));res.json({ok:true});
}));
app.get('/api/s/:sid/summary',run(async(req,res)=>{
const from=okdate(req.query.from)?req.query.from:new Date().toISOString().slice(0,7)+'-01',to=okdate(req.query.to)?req.query.to:new Date().toISOString().slice(0,10),args=[req.sid,from,to];
const totals=(await db.query('SELECT kind,COALESCE(SUM(amount),0) total FROM entries WHERE space_id=$1 AND due_date BETWEEN $2 AND $3 GROUP BY kind',args)).rows;
const byCategory=(await db.query("SELECT COALESCE(c.name,'Sem categoria') label,e.kind,SUM(e.amount) total FROM entries e LEFT JOIN categories c ON c.id=e.category_id AND c.space_id=e.space_id WHERE e.space_id=$1 AND e.due_date BETWEEN $2 AND $3 AND e.kind<>'transfer' GROUP BY 1,2 ORDER BY total DESC LIMIT 12",args)).rows;
const accounts=(await db.query("SELECT a.id,a.name,a.kind,a.opening+COALESCE((SELECT SUM(CASE WHEN e.kind='income' THEN e.amount ELSE -e.amount END) FROM entries e WHERE e.account_id=a.id AND e.space_id=a.space_id AND e.paid_date IS NOT NULL),0)+COALESCE((SELECT SUM(e.amount) FROM entries e WHERE e.to_account_id=a.id AND e.kind='transfer' AND e.paid_date IS NOT NULL AND e.space_id=a.space_id),0) balance FROM accounts a WHERE a.space_id=$1 ORDER BY a.name",[req.sid])).rows;
const cards=(await db.query("SELECT c.id,c.name,c.credit_limit,COALESCE(SUM(CASE WHEN e.kind='expense' THEN e.amount ELSE 0 END),0) purchases FROM cards c LEFT JOIN entries e ON e.card_id=c.id AND e.space_id=c.space_id AND e.due_date BETWEEN $2 AND $3 WHERE c.space_id=$1 GROUP BY c.id ORDER BY c.name",args)).rows;
const overdue=(await db.query("SELECT COUNT(*)::int count,COALESCE(SUM(amount),0) amount FROM entries WHERE space_id=$1 AND paid_date IS NULL AND due_date<CURRENT_DATE AND kind<>'transfer'",[req.sid])).rows[0];
res.json({totals,byCategory,accounts,cards,overdue,from,to});
}));
app.get('/api/s/:sid/audit',run(async(req,res)=>res.json((await db.query('SELECT action,entity,entity_id,at FROM audit WHERE space_id=$1 ORDER BY id DESC LIMIT 100',[req.sid])).rows)));
app.get('/api/s/:sid/export.csv',run(async(req,res)=>{
const rows=(await db.query('SELECT id,description,kind,amount,due_date,paid_date,cost_center,notes FROM entries WHERE space_id=$1 ORDER BY due_date DESC',[req.sid])).rows;
const fields=['id','description','kind','amount','due_date','paid_date','cost_center','notes'];
const esc=v=>{let s=String(v instanceof Date?v.toISOString().slice(0,10):v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'};
res.set({'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="prestacao-contas.csv"'}).send('\ufeff'+[fields.join(';'),...rows.map(r=>fields.map(f=>esc(r[f])).join(';'))].join('\r\n'));
}));
app.get('/health',run(async(req,res)=>{await db.query('SELECT 1');res.json({status:'ok'})}));
app.use(express.static('public'));
app.use((e,req,res,next)=>{console.error('Erro:',e.code||e.message);res.status(e.status||(['23503','23505','23514','22P02'].includes(e.code)?400:500)).json({error:e.status?e.message:e.code==='23503'?'Este registro está em uso':e.code==='23505'?'Registro duplicado':'Não foi possível concluir'})});
init().then(()=>app.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('Sistema financeiro iniciado'))).catch(e=>{console.error(e);process.exit(1)});
