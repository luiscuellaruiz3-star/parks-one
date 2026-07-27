import { createClient } from '@supabase/supabase-js'; import fs from 'node:fs';
const file=process.argv[2], name=process.argv[3]; if(!file||!name)throw new Error('Uso: node scripts/seed_dataset.mjs payload.json top5|hydrica');
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const payload=JSON.parse(fs.readFileSync(file,'utf8'));const {error}=await sb.from('datasets').upsert({name,payload,source_filename:file,updated_at:new Date().toISOString()});if(error)throw error;console.log('Dataset actualizado:',name);
