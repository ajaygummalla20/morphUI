import {writeFileSync} from 'node:fs';
const name=process.env.MORPH_DEPLOY_WORKER_NAME;
const id=process.env.MORPH_DEPLOY_DATABASE_ID;
if(!name||!/^[a-z0-9-]+$/.test(name)||!id||!/^[a-f0-9-]{36}$/.test(id)||!process.env.CLOUDFLARE_ACCOUNT_ID||!process.env.CLOUDFLARE_API_TOKEN) throw new Error('Configure the pilot environment worker name, D1 ID and Cloudflare credentials first.');
writeFileSync('.deploy.generated.json',JSON.stringify({name,main:'dist/server/index.js',compatibility_date:'2026-10-06',compatibility_flags:['nodejs_compat'],keep_vars:true,assets:{directory:'dist/client',binding:'ASSETS'},images:{binding:'IMAGES'},d1_databases:[{binding:'DB',database_name:'morphui',database_id:id,migrations_dir:'drizzle'}]},null,2));
