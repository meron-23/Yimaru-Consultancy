import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

const srcPath = path.join(ROOT_DIR, 'Yimaru Consulting Website (1).html');
const destPath = path.join(ROOT_DIR, 'index.html');

let content = fs.readFileSync(srcPath, 'utf8');

const targetStr = `async function loadRemote(){\n if(!C.sb||!C.sb.url||!C.sb.key)return;`;

const replacementStr = `async function loadRemote(){
 if(!C.lead) C.lead = '/api/leads';
 if(!C.sb||!C.sb.url||!C.sb.key){
  try{
   const cfgRes=await fetch('/api/config');
   if(cfgRes.ok){
    const cfg=await cfgRes.json();
    if(cfg.supabaseUrl&&cfg.supabaseAnonKey){
     C.sb={url:cfg.supabaseUrl,key:cfg.supabaseAnonKey};
    }else{
     const pRes=await fetch('/api/public/content');
     if(pRes.ok){
      const data=await pRes.json();
      if(data.countries&&data.countries.length){
       D.length=0;data.countries.forEach(r=>{const c={...r.data,id:r.id};if(!c.min)c.min={ielts:6,budget:10000};if(!c.geo)c.geo=[0,0];if(!c.sch)c.sch=[];D.push(c)});
       POP.length=0;data.countries.filter(r=>r.featured).slice(0,4).forEach(r=>POP.push(r.id));D.forEach(c=>{if(POP.length<4&&!POP.includes(c.id))POP.push(c.id)});
      }
      if(data.scholarships&&data.scholarships.length){
       S.length=0;data.scholarships.forEach(r=>S.push({...r.data,id:r.id,_f:r.featured}));
      }
      D.forEach(c=>{if(c.f&&!FLAG[c.f])FLAG[c.f]=flagFallback(c.f)});
      let st=null;
      if(data.site_content){
       data.site_content.forEach(({key,value})=>{
        if(key==="faq"&&Array.isArray(value)&&value.length){FAQ.length=0;value.forEach(x=>FAQ.push(x))}
        else if(key==="stops"&&Array.isArray(value)&&value.length){STOPS.length=0;value.forEach(x=>STOPS.push(x))}
        else if(key==="settings")st=value;
        else I[key]=value;
       });
      }
      setLang(LANG);if(st)applySettings(st);
      return;
     }
    }
   }
  }catch(e){/* keep built-in content */}
 }
 if(!C.sb||!C.sb.url||!C.sb.key)return;`;

if (content.includes(targetStr)) {
  content = content.replace(targetStr, replacementStr);
  console.log('Successfully patched loadRemote() for index.html');
} else {
  console.warn('Could not find exact target string in HTML, using regex fallback');
  content = content.replace(/async function loadRemote\(\)\s*\{[\r\n\s]*if\(!C\.sb/, replacementStr);
}

fs.writeFileSync(destPath, content, 'utf8');
console.log('Created index.html from original starter website.');
