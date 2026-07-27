import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
const root=process.argv[2]; if(!root) throw new Error('Uso: node scripts/upload_repository.mjs <carpeta documents_repo>');
const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY; if(!url||!key) throw new Error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY');
const sb=createClient(url,key,{auth:{persistSession:false}}); const bucket='parks-documents';
function walk(d){return fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);}
const files=walk(root); let ok=0,fail=0;
for(const file of files){const rel=path.relative(root,file).split(path.sep).join('/');const body=fs.readFileSync(file);const {error}=await sb.storage.from(bucket).upload(rel,body,{upsert:true,contentType:'application/octet-stream'});if(error){console.error('ERROR',rel,error.message);fail++;}else{ok++;if(ok%50===0)console.log(ok,'/',files.length);}}
console.log({total:files.length,ok,fail,sha256:crypto.createHash('sha256').update(String(files.length)+':'+ok).digest('hex')});
