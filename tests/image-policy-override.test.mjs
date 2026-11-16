import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { encodePngRgba } from '../scripts/lib/png-rgba.mjs';
import { IMAGE_MANIFEST_COLUMNS, serializeImageManifest } from '../scripts/lib/image-manifest.mjs';
import { IMAGE_OVERRIDE_POLICY as POLICY } from '../scripts/lib/image-policy-override.mjs';
import { validatePromptTextPreflight } from '../scripts/lib/image-prompt-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const validator = path.join(root, 'scripts/validate-image-translation.mjs');
const image = '30_translation/image_translation/';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

async function fixture({ override = false, typeset = false, count = typeset ? 2 : (override ? 1 : 3) } = {}) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gt-image-policy-synthetic-'));
  const project = path.join(temp, 'project');
  await fs.mkdir(project);
  const row = Object.fromEntries(IMAGE_MANIFEST_COLUMNS.map((k) => [k, 'N/A']));
  const source = Buffer.from([10,20,30,255,40,50,60,128,70,80,90,0,100,110,120,255]);
  const target = Buffer.from(source); target[4] = 200;
  const png = (rgba) => encodePngRgba(2, 2, rgba);
  const put = async (p, b) => { await fs.mkdir(path.dirname(path.join(project,p)),{recursive:true}); await fs.writeFile(path.join(project,p),b); return {path:p,sha256:sha(b)}; };
  const putJson = (p,v) => put(p,Buffer.from(JSON.stringify(v)));
  Object.assign(row, {
    stable_key:'synthetic/title', source_path:'10_extract/synthetic.png',
    reference_path:image+'reference/synthetic.png', candidate_path:image+'for_translation/synthetic.png',
    source_rgba_path:image+'probes/source.rgba', candidate_rgba_path:image+'probes/candidate.rgba',
    source_width:'2', source_height:'2', candidate_width:'2', candidate_height:'2',
    source_format:'png', candidate_format:'png', source_color_mode:'RGBA8', candidate_color_mode:'RGBA8',
    alpha_policy:'exact', edit_regions:'1,0,1,1', source_anchors:'1,0', candidate_anchors:'1,0',
    atlas_page:'none', source_atlas_rect:'none', candidate_atlas_rect:'none',
    origin:typeset?'agent-typeset':'agent-generated', generator:typeset?'typeset':'imagegen',
    tool:typeset?'SyntheticRenderer':'image_gen.imagegen', model:typeset?'N/A':'provider-selected',
    quality:typeset?'N/A':'provider-managed', generation_mode:typeset?'typeset':'edit',
    prompt_path:image+'prompts/synthetic.txt', receipt_path:image+'receipts/synthetic.json',
    style_contract:'합성 fixture의 고정된 흰색 글자와 외곽선', atmosphere_contract:'합성 fixture의 고정된 차분한 색조 유지',
    status:'verified',notes:'Synthetic fixtures only; no game inputs.',
  });
  for(const k of ['style_status','atmosphere_status','original_feel_status','source_text_removal_status','alpha_status','layout_status','korean_text_status','roundtrip_status']) row[k]='pass';
  for(const [p,b,k] of [[row.source_path,png(source),'source_sha256'],[row.reference_path,png(source),'reference_sha256'],[row.candidate_path,png(target),'candidate_sha256'],[row.source_rgba_path,source,'source_rgba_sha256'],[row.candidate_rgba_path,target,'candidate_rgba_sha256']]) row[k]=(await put(p,b)).sha256;
  const policyName=override?POLICY:'best-of-3-fail-closed';
  const prompt = [
    'use_case: text-localization','input_image_role: Image 1 = edit target','tool: image_gen.imagegen',
    'execution_surface: chatgpt-built-in','model: provider-selected','quality: provider-managed',
    'candidate_policy: '+policyName,'minimum_candidates: '+(override?1:3),
    ...(override?['maximum_attempts: 2']:[]),
    'reference_sha256: '+row.reference_sha256,'source_text: START','korean_text: 시작',
    'remove_source_text: complete','no_overlay: true','verbatim_korean: true',
    'change_only_declared_regions: true','preserve_unchanged_pixels: exact-outside-edit-regions',
    'preserve_layout: exact','preserve_alpha: exact','edit_regions: 1,0,1,1',
    ...['atmosphere','style','typography','color','outline_shadow','material_lighting','spacing_baseline'].map(k=>'preserve_'+k+': synthetic fixed visual contract'),
  ].join('\n');
  row.prompt_sha256=(await put(row.prompt_path,Buffer.from(prompt))).sha256;
  const receipt = {
    schema_version:typeset?6:3,stable_key:row.stable_key,origin:row.origin,generator:row.generator,
    tool:row.tool,model:row.model,quality:row.quality,
    execution_surface:typeset?'project-local-typeset':'chatgpt-built-in',api_endpoint:'N/A',
    input_fidelity:typeset?'N/A':'provider-managed',operation:row.generation_mode,
    candidate_policy:policyName,minimum_candidates:override?1:3,...(override?{maximum_attempts:2}:{}),
    selected_attempt:typeset?null:count,attempts:[],
  };
  for(const key of ['source_path','source_sha256','reference_path','reference_sha256','prompt_path','prompt_sha256','candidate_path','candidate_sha256','source_rgba_path','source_rgba_sha256','candidate_rgba_path','candidate_rgba_sha256','alpha_policy']) receipt[key]=row[key];
  const invoke = async (a) => {
    const record = {tool:a.tool,execution_surface:'chatgpt-built-in',operation:'edit',tool_call_id:a.tool_call_id,reference_sha256:a.reference_sha256,prompt_sha256:a.prompt_sha256,generation_status:a.generation_status,output_sha256:a.output_sha256,safety_refusal:false};
    record.provider_tool_call_id_exposed=a.provider_tool_call_id_exposed;
    if(a.provider_tool_call_id_exposed===false) Object.assign(record,{
      invocation_key:a.invocation_key,returned_artifact_locator:a.returned_artifact_locator,
      returned_artifact_sha256:a.returned_artifact_sha256,request_path:a.request_path,request_sha256:a.request_sha256,
    });
    if(a.generation_status==='failed') record.error='Synthetic non-safety transport failure';
    const e=await putJson(image+'receipts/calls/call-'+a.attempt+'.json',record);
    a.invocation_path=e.path;a.invocation_sha256=e.sha256;
  };
  for(let i=1;i<=count;i++){
    const selected=!typeset&&i===count;
    const output=selected?{path:row.candidate_path,sha256:row.candidate_sha256}:await put(image+'for_translation/attempts/fail-'+i+'.bin',Buffer.from('distinct synthetic generation '+i));
    const a={attempt:i,tool:'image_gen.imagegen',operation:'edit',reference_path:row.reference_path,reference_sha256:row.reference_sha256,
      prompt_path:row.prompt_path,prompt_sha256:row.prompt_sha256,output_path:output.path,output_sha256:output.sha256,generation_status:'completed',
      technical_status:selected?'pass':'reject',visual_status:selected?'pass':'reject',source_text_removal_status:selected?'pass':'reject',
      korean_text_status:'pass',original_feel_status:selected?'pass':'reject',selection_status:selected?'selected':'rejected',
      rejection_reasons:selected?[]:['synthetic text removal rejected']};
    if(override){Object.assign(a,{tool_call_id:'SYNTHETIC-CALL-'+i,provider_tool_call_id_exposed:true,execution_surface:'chatgpt-built-in',safety_refusal:false});await invoke(a);}
    receipt.attempts.push(a);
  }
  const policy = {
    schema_version:1,policy:POLICY,title_id:'SYNTHETIC-ONLY',project_root:project,
    max_imagegen_attempts:2,include_prior_failures:true,fallback:'direct-typesetting',
    scope:[{stable_key:row.stable_key,source_sha256:row.source_sha256}],
  };
  const instruction=await putJson(image+'policies/synthetic-user.json',{
    authority:'user',policy:POLICY,title_id:'SYNTHETIC-ONLY',project_root:project,max_imagegen_attempts:2,
    include_prior_failures:true,fallback:'direct-typesetting',verbatim:'SYNTHETIC TEST ONLY: at most two attempts then typeset',
    source_ref:'SYNTHETIC TEST ONLY, not real authorization',recorded_at:'2026-01-01T00:00:00Z',
  });
  policy.user_instruction=instruction;
  const freezeHistory=async(priors=[],phase='before-current-execution')=>{
    const history={
      schema_version:1,snapshot_phase:phase,title_id:'SYNTHETIC-ONLY',project_root:project,
      stable_key:policy.scope[0].stable_key,source_sha256:policy.scope[0].source_sha256,
      source_ref:'SYNTHETIC '+phase+' registry snapshot',recorded_at:'2026-01-01T00:00:00Z',
      explicit_zero_prior:priors.length===0,
      invocations:priors.map(a=>({tool_call_id:a.tool_call_id,provider_tool_call_id_exposed:a.provider_tool_call_id_exposed,invocation_key:a.invocation_key,returned_artifact_locator:a.returned_artifact_locator,invocation_path:a.invocation_path,invocation_sha256:a.invocation_sha256})),
    };
    policy.scope[0].prior_history=await putJson(image+'policies/prior-history.json',history);
  };
  await freezeHistory();
  const writePolicy=async()=>{
    if(override){
      const p=await putJson(image+'policies/synthetic.json',policy);
      receipt.policy_override=p;
      receipt.prior_history=policy.scope[0].prior_history;
      await put('PROJECT.md',Buffer.from('title_id: SYNTHETIC-ONLY\nimage_generation_override: '+p.path+'\nimage_generation_override_sha256: '+p.sha256+'\n'));
    }else await put('PROJECT.md',Buffer.from('title_id: SYNTHETIC-ONLY\n'));
  };
  if(typeset){
    const mask=Buffer.from([0,0,0,255,255,255,255,255,0,0,0,255,0,0,0,255]);
    const zero=Buffer.from(mask);zero[4]=zero[5]=zero[6]=0;
    const identity={stable_key:row.stable_key,source_sha256:row.source_sha256,candidate_sha256:row.candidate_sha256};
    const reloaded=await put(image+'probes/reloaded.png',png(target));
    const rgba=await put(image+'probes/reloaded.rgba',target);
    receipt.typesetting={
      technique:'direct-typesetting',source_text:'START',korean_text:'시작',
      font:await put(image+'provenance/synthetic-font.bin',Buffer.from('synthetic-font-fixture-not-for-rendering')),
      renderer:{name:'SyntheticRenderer',version:'fixture-1',settings:{font_size:12}},
      glyph_mask:await put(image+'provenance/glyph.png',png(mask)),
      effect_mask:await put(image+'provenance/effect.png',png(zero)),
      background_evidence:await putJson(image+'provenance/background.json',{...identity,method:'Synthetic background restoration fixture'}),
      visual_qa:await putJson(image+'provenance/visual.json',{...identity,actual_view:true,reviewer:'SYNTHETIC reviewer',source_text:'START',korean_text:'시작',visual_status:'pass',source_text_removal_status:'pass',korean_text_status:'pass',original_feel_status:'pass'}),
      roundtrip:await putJson(image+'provenance/roundtrip.json',{...identity,status:'pass',method:'Synthetic serialized reload fixture',reloaded_path:reloaded.path,reloaded_sha256:reloaded.sha256,reloaded_rgba_path:rgba.path,reloaded_rgba_sha256:rgba.sha256}),
    };
    row.prompt_path=row.prompt_sha256=receipt.prompt_path=receipt.prompt_sha256='N/A';
  }
  const sync=async()=>{
    row.receipt_sha256=(await putJson(row.receipt_path,receipt)).sha256;
    await put(image+'IMAGE_GENERATION_MANIFEST.tsv',Buffer.from(serializeImageManifest([row])));
  };
  await writePolicy();await sync();
  const run=()=>{
    const args=[validator,'--project-root',project,'--manifest',path.join(project,image+'IMAGE_GENERATION_MANIFEST.tsv')];
    try{return{code:0,output:execFileSync(process.execPath,args,{encoding:'utf8',timeout:20000})};}
    catch(e){return{code:e.status,output:String(e.stdout??'')+String(e.stderr??'')};}
  };
  return {temp,project,row,receipt,policy,source,target,put,putJson,invoke,writePolicy,freezeHistory,sync,run};
}

async function check(t,name,opts,edit,pattern){
  await t.test(name,async()=>{
    const f=await fixture(opts);
    try{if(edit)await edit(f);await f.sync();const result=f.run();
      if(pattern){assert.notEqual(result.code,0,result.output);assert.match(result.output,pattern);}
      else{assert.equal(result.code,0,result.output);assert.match(result.output,/Issues: 0/);}
    }finally{await fs.rm(f.temp,{recursive:true,force:true});}
  });
}


async function observableCalls(f) {
  for(const a of f.receipt.attempts) {
    delete a.tool_call_id;
    a.provider_tool_call_id_exposed=false;
    a.returned_artifact_locator='C:/synthetic-returned/exec-observed-'+a.attempt+'.png';
    a.invocation_key='returned-artifact:exec-observed-'+a.attempt;
    a.returned_artifact_sha256=a.output_sha256;
    const request=await f.putJson(image+'receipts/requests/request-'+a.attempt+'.json',{
      source_sha256:f.row.source_sha256,prompt_sha256:a.prompt_sha256,synthetic_only:true,
    });
    a.request_path=request.path;a.request_sha256=request.sha256;
    await f.invoke(a);
  }
}

async function machineJsonText(f, source, korean) {
  if(Array.isArray(source)){
    f.row.edit_regions='0,0,1,1;1,0,1,1;0,1,1,1;1,1,1,1';
    f.row.source_anchors=f.row.candidate_anchors='0,0;1,0;0,1;1,1';
  }
  const promptPath=f.receipt.attempts[0].prompt_path;
  let raw=await fs.readFile(path.join(f.project,promptPath),'utf8');
  raw=raw.replace(/^source_text:.*$/m,'source_text_json: '+JSON.stringify(source))
    .replace(/^korean_text:.*$/m,'korean_text_json: '+JSON.stringify(korean))
    .replace(/^edit_regions:.*$/m,'edit_regions: '+f.row.edit_regions);
  raw+='\n# Replace each indexed state only in the corresponding edit region; preserve all other states.';
  const pin=await f.put(promptPath,Buffer.from(raw));
  if(f.row.prompt_path!=='N/A') f.row.prompt_sha256=f.receipt.prompt_sha256=pin.sha256;
  for(const a of f.receipt.attempts){a.prompt_sha256=pin.sha256;await f.invoke(a);}
  if(f.receipt.typesetting){
    Object.assign(f.receipt.typesetting,{source_text:source,korean_text:korean});
    const visual=JSON.parse(await fs.readFile(path.join(f.project,f.receipt.typesetting.visual_qa.path),'utf8'));
    Object.assign(visual,{source_text:source,korean_text:korean});
    f.receipt.typesetting.visual_qa=await f.putJson(f.receipt.typesetting.visual_qa.path,visual);
  }
}

async function preservedNaturalPrompt(f, trailingLf = false, separateSourceLines = false) {
  await observableCalls(f);
  if(separateSourceLines){
    f.receipt.typesetting.source_text='甲\n乙';
    const visual=JSON.parse(await fs.readFile(path.join(f.project,f.receipt.typesetting.visual_qa.path),'utf8'));
    visual.source_text=f.receipt.typesetting.source_text;
    f.receipt.typesetting.visual_qa=await f.putJson(f.receipt.typesetting.visual_qa.path,visual);
  }
  const sourceText=f.receipt.typesetting.source_text, koreanText=f.receipt.typesetting.korean_text;
  const sourceClause=separateSourceLines?'甲 on the first line and 乙 on the second line':sourceText;
  const natural='Replace every visible Japanese label "'+sourceClause+'" with the exact Korean label "'+koreanText+'". Canvas 2 x 2. Edit rectangle [1,0,1,1]. Preserve outside pixels and alpha.';
  const raw=natural+(trailingLf?'\n':'');
  const at=(text)=>({byte_offset:Buffer.byteLength(raw.slice(0,raw.indexOf(text)),'utf8'),byte_length:Buffer.byteLength(text,'utf8')});
  const records=[];
  for(const a of f.receipt.attempts){
    a.prompt_sha256=(await f.put(a.prompt_path,Buffer.from(raw))).sha256;
    a.request_sha256=(await f.putJson(a.request_path,{arguments:{prompt:natural,referenced_image_paths:['SYNTHETIC reference only'],transparent_background:false}})).sha256;
    await f.invoke(a);
    records.push({
      provider_tool_call_id_exposed:false,invocation_key:a.invocation_key,returned_artifact_locator:a.returned_artifact_locator,
      prompt_path:a.prompt_path,prompt_sha256:a.prompt_sha256,request_path:a.request_path,request_sha256:a.request_sha256,
      request_prompt_pointer:'/arguments/prompt',request_prompt_span:{byte_offset:0,byte_length:Buffer.byteLength(natural,'utf8')},
      literal_spans:{source_text:separateSourceLines?{
        kind:'ordered-source-lines',ordered_spans:[at('甲'),at('乙')],joiner:'\n',line_instruction_span:at(sourceClause),
      }:at(sourceText),korean_text:at(koreanText)},canvas_span:at('2 x 2'),
      region_spans:[{index:0,representation:'xywh',...at('[1,0,1,1]')}],
    });
  }
  const plan=await f.put(image+'IMAGE_PLAN.tsv',Buffer.from('stable_key\tsource_sha256\n'+f.row.stable_key+'\t'+f.row.source_sha256+'\n'));
  const sidecar={
    schema_version:1,kind:'preserved-failed-prompt-contract',actual_read:true,reviewer:'SYNTHETIC reviewer',semantic_consistency:'pass',
    stable_key:f.row.stable_key,source_path:f.row.source_path,source_sha256:f.row.source_sha256,
    reference_path:f.row.reference_path,reference_sha256:f.row.reference_sha256,plan,
    source_text:sourceText,korean_text:koreanText,edit_regions:f.row.edit_regions,canvas:{width:2,height:2},attempts:records,
  };
  f.receipt.failed_prompt_contract=await f.putJson(image+'receipts/failed-prompt-contract.json',sidecar);
  return sidecar;
}

test('image policy override: synthetic positive and negative authorization/provenance/pixel cases',async(t)=>{
  await check(t,'default three attempts unchanged',{},null);
  await check(t,'default fewer attempts rejected',{count:2},null,/3 or 4 independent/);
  await check(t,'explicit override accepts first success once',{override:true},null);
  await check(t,'explicit override accepts second success',{override:true,count:2},null);
  await check(t,'two rejected built-in calls allow honest typeset',{override:true,typeset:true},null);
  await check(t,'typeset generation errors retain failed invocation evidence',{override:true,typeset:true},async f=>{
    for(const a of f.receipt.attempts){a.generation_status='failed';a.failure_kind='generation-error';a.output_path=a.output_sha256='N/A';await f.invoke(a);}
  });
  await check(t,'no PROJECT policy refuses typeset',{override:true,typeset:true},async f=>{await f.put('PROJECT.md',Buffer.from('title_id: SYNTHETIC-ONLY\n'));},/requires exact project override|scope\/pin/);
  await check(t,'missing user directive refuses override',{override:true},async f=>{f.policy.user_instruction.path=image+'policies/missing.json';await f.writePolicy();},/user instruction/);
  await check(t,'other project rejected',{override:true},async f=>{f.policy.project_root=path.join(f.temp,'other-project');await f.writePolicy();},/title\/project identity/);
  await check(t,'other title rejected',{override:true},async f=>{f.policy.title_id='OTHER-SYNTHETIC';await f.writePolicy();},/title\/project identity/);
  await check(t,'other exact stable key rejected',{override:true},async f=>{f.policy.scope[0].stable_key='synthetic/other';await f.writePolicy();},/scope\/pin/);
  await check(t,'other source SHA rejected',{override:true},async f=>{f.policy.scope[0].source_sha256='0'.repeat(64);await f.writePolicy();},/scope\/pin/);
  await check(t,'policy file pin mismatch rejected',{override:true},async f=>{await f.put('PROJECT.md',Buffer.from('title_id: SYNTHETIC-ONLY\nimage_generation_override: '+f.receipt.policy_override.path+'\nimage_generation_override_sha256: '+'0'.repeat(64)+'\n'));},/policy SHA/);
  await check(t,'one failed call is not typeset permission',{override:true,typeset:true},async f=>{f.receipt.attempts.pop();},/2 to 2 independent/);
  await check(t,'third imagegen attempt exceeds override',{override:true,count:3},null,/1 to 2 independent/);
  await check(t,'same built-in invocation counted twice rejected',{override:true,typeset:true},async f=>{f.receipt.attempts[1].tool_call_id=f.receipt.attempts[0].tool_call_id;await f.invoke(f.receipt.attempts[1]);},/invocation identities must be distinct/);
  await check(t,'safety refusal cannot unlock typeset',{override:true,typeset:true},async f=>{f.receipt.attempts[0].safety_refusal=true;},/no safety refusal/);
  await check(t,'font provenance required',{override:true,typeset:true},async f=>{f.receipt.typesetting.font.path=image+'provenance/no-font';},/cannot read font/);
  await check(t,'native reload evidence required',{override:true,typeset:true},async f=>{f.receipt.typesetting.roundtrip.sha256='0'.repeat(64);},/roundtrip SHA/);
  await check(t,'typeset cannot impersonate user supplied',{override:true,typeset:true},async f=>{f.row.origin=f.receipt.origin='user-supplied';f.row.generator=f.receipt.generator='user-supplied';},/must not impersonate/);
  await check(t,'protected pixels still fail with authorized override',{override:true},async f=>{
    const rgba=Buffer.from(f.target);rgba[0]=99;
    f.row.candidate_sha256=(await f.put(f.row.candidate_path,encodePngRgba(2,2,rgba))).sha256;
    f.row.candidate_rgba_sha256=(await f.put(f.row.candidate_rgba_path,rgba)).sha256;
    f.receipt.candidate_sha256=f.row.candidate_sha256;f.receipt.candidate_rgba_sha256=f.row.candidate_rgba_sha256;
    f.receipt.attempts[0].output_sha256=f.row.candidate_sha256;await f.invoke(f.receipt.attempts[0]);
  },/RGBA changed outside edit_regions/);
  await check(t,'unscoped default row keeps best-of-three even with a policy file',{},async f=>{
    f.policy.scope[0].stable_key='synthetic/other';
    await f.freezeHistory();
    const p=await f.putJson(image+'policies/synthetic.json',f.policy);
    await f.put('PROJECT.md',Buffer.from('title_id: SYNTHETIC-ONLY\nimage_generation_override: '+p.path+'\nimage_generation_override_sha256: '+p.sha256+'\n'));
  });
  await check(t,'typeset protected RGBA gate remains active',{override:true,typeset:true},async f=>{
    const rgba=Buffer.from(f.target);rgba[0]=99;
    f.row.candidate_rgba_sha256=(await f.put(f.row.candidate_rgba_path,rgba)).sha256;
    f.receipt.candidate_rgba_sha256=f.row.candidate_rgba_sha256;
  },/RGBA changed outside edit_regions/);
  await check(t,'typeset alpha gate remains active',{override:true,typeset:true},async f=>{
    const rgba=Buffer.from(f.target);rgba[7]=0;
    f.row.candidate_rgba_sha256=(await f.put(f.row.candidate_rgba_path,rgba)).sha256;
    f.receipt.candidate_rgba_sha256=f.row.candidate_rgba_sha256;
  },/exact alpha changed/);
  await check(t,'typeset anchor gate remains active',{override:true,typeset:true},async f=>{f.row.candidate_anchors='0,0';},/anchors must match/);
  await check(t,'typeset canvas gate remains active',{override:true,typeset:true},async f=>{f.row.candidate_width='3';},/canvas width changed/);
  await check(t,'typeset cannot impersonate built-in imagegen',{override:true,typeset:true},async f=>{f.row.origin=f.receipt.origin='agent-generated';},/must not impersonate/);
  await check(t,'typeset text must match both failed prompts',{override:true,typeset:true},async f=>{f.receipt.typesetting.korean_text='다른 문구';},/prompt korean_text/);
  await check(t,'mask may not include protected pixels',{override:true,typeset:true},async f=>{
    const mask=Buffer.from([255,255,255,255,255,255,255,255,0,0,0,255,0,0,0,255]);
    f.receipt.typesetting.glyph_mask=await f.put(image+'provenance/glyph.png',encodePngRgba(2,2,mask));
  },/mask exceeds edit regions/);

  await check(t,'prior A plus current B,C is a cumulative third call',{override:true,count:3},async f=>{
    const a=f.receipt.attempts[0];await f.freezeHistory([a]);await f.writePolicy();
    f.receipt.attempts=f.receipt.attempts.slice(1);
    f.receipt.attempts.forEach((call,i)=>{call.attempt=i+1;});f.receipt.selected_attempt=2;
  },/cumulative unique calls exceed limit 2/);
  await check(t,'pinned prior A and current B are allowed with full A,B receipt',{override:true,count:2},async f=>{
    await f.freezeHistory([f.receipt.attempts[0]]);await f.writePolicy();
  });
  await check(t,'prior A may not be omitted even below cumulative cap',{override:true,count:2},async f=>{
    await f.freezeHistory([f.receipt.attempts[0]]);await f.writePolicy();
    f.receipt.attempts=[f.receipt.attempts[1]];f.receipt.attempts[0].attempt=1;f.receipt.selected_attempt=1;
  },/pinned prior call omitted/);
  await check(t,'changed history snapshot fails its pre-execution pin',{override:true},async f=>{
    await f.put(f.policy.scope[0].prior_history.path,Buffer.from('{"schema_version":1,"tampered":true}'));
  },/prior history SHA/);

  await check(t,'observable returned-artifact IDs permit two-fail typeset and pinned prior history',{override:true,typeset:true},async f=>{
    await observableCalls(f);await f.freezeHistory([f.receipt.attempts[0]]);await f.writePolicy();
  });
  await check(t,'duplicate observable artifact identity is not an independent call',{override:true,typeset:true},async f=>{
    await observableCalls(f);const [a,b]=f.receipt.attempts;
    b.invocation_key=a.invocation_key;b.returned_artifact_locator=a.returned_artifact_locator;await f.invoke(b);
  },/invocation identities must be distinct/);
  await check(t,'unexposed provider ID must not be invented',{override:true,typeset:true},async f=>{
    await observableCalls(f);f.receipt.attempts[0].tool_call_id='FAKE-PROVIDER-ID';await f.invoke(f.receipt.attempts[0]);
  },/typed invocation identity/);
  await check(t,'observable artifact requires pinned preserved request',{override:true,typeset:true},async f=>{
    await observableCalls(f);f.receipt.attempts[0].request_sha256='0'.repeat(64);await f.invoke(f.receipt.attempts[0]);
  },/preserved imagegen request SHA/);

  await check(t,'historical adoption preserves two actual artifact calls without retroactive policy',{override:true,typeset:true},async f=>{
    await observableCalls(f);await f.freezeHistory(f.receipt.attempts,'after-generation-before-adoption');await f.writePolicy();
  });
  await check(t,'historical adoption may not fabricate a zero-prior snapshot',{override:true,typeset:true},async f=>{
    await f.freezeHistory([],'after-generation-before-adoption');await f.writePolicy();
  },/historical adoption requires exactly two actual prior calls/);
  await check(t,'historical adoption does not authorize a generation candidate',{override:true,count:2},async f=>{
    await f.freezeHistory(f.receipt.attempts,'after-generation-before-adoption');await f.writePolicy();
  },/historical adoption is typeset-only/);
  await check(t,'preserved natural prompt sidecar works with a genuine pre-call zero snapshot',{override:true,typeset:true},async f=>{
    await preservedNaturalPrompt(f);
  });
  await check(t,'preserved natural prompt sidecar keeps historical phase and explicit final LF',{override:true,typeset:true},async f=>{
    await preservedNaturalPrompt(f,true);await f.freezeHistory(f.receipt.attempts,'after-generation-before-adoption');await f.writePolicy();
  });
  await check(t,'preserved natural prompt sidecar pin tampering is rejected',{override:true,typeset:true},async f=>{
    await preservedNaturalPrompt(f);f.receipt.failed_prompt_contract.sha256='0'.repeat(64);
  },/failed prompt contract SHA/);
  await check(t,'preserved natural prompt sidecar literal mismatch is rejected',{override:true,typeset:true},async f=>{
    const c=await preservedNaturalPrompt(f);c.attempts[0].literal_spans.source_text.byte_offset++;
    f.receipt.failed_prompt_contract=await f.putJson(f.receipt.failed_prompt_contract.path,c);
  },/literal mismatch: source_text/);
  await check(t,'ordered source lines preserve a genuine before-current-execution phase',{override:true,typeset:true},async f=>{
    await preservedNaturalPrompt(f,false,true);
  });
  await check(t,'ordered source lines reject reversed raw spans without changing before phase',{override:true,typeset:true},async f=>{
    const c=await preservedNaturalPrompt(f,false,true);
    c.attempts[0].literal_spans.source_text.ordered_spans.reverse();
    f.receipt.failed_prompt_contract=await f.putJson(f.receipt.failed_prompt_contract.path,c);
  },/ordered source line instruction\/order or reconstructed source mismatch/);
  await check(t,'ordered source lines reject a fabricated instruction span',{override:true,typeset:true},async f=>{
    const c=await preservedNaturalPrompt(f,false,true);
    c.attempts[0].literal_spans.source_text.line_instruction_span.byte_offset++;
    f.receipt.failed_prompt_contract=await f.putJson(f.receipt.failed_prompt_contract.path,c);
  },/ordered source line instruction\/order or reconstructed source mismatch/);
  await check(t,'future JSON string header preserves LF through typeset and visual QA',{override:true,typeset:true},async f=>{
    await machineJsonText(f,'甲\n乙','가\n나');
  });
  await check(t,'future JSON arrays preserve mixed region states through typeset and visual QA',{override:true,typeset:true},async f=>{
    await machineJsonText(f,['甲','甲','甲','乙'],['가','가','가','나']);
  });
  await check(t,'future JSON string header also keeps imagegen first-success contract',{override:true},async f=>{
    await machineJsonText(f,'甲\n乙','가\n나');
  });
  await check(t,'one failed call cannot use preserved natural prompt adoption',{override:true,typeset:true},async f=>{
    await preservedNaturalPrompt(f);f.receipt.attempts.pop();
  },/failed prompt sidecar requires exactly two rejected/);

});

test('future prompt JSON text preflight: metadata-only exact values',async(t)=>{
  const scalar={source_text:'甲\n乙',korean_text:'가\n나',edit_regions:'1,0,1,1',reference_sha256:'a'.repeat(64),tool:'image_gen.imagegen',execution_surface:'chatgpt-built-in'};
  const mixed={...scalar,source_text:['甲','甲','甲','乙'],korean_text:['가','가','가','나'],edit_regions:'0,0,1,1;1,0,1,1;0,1,1,1;1,1,1,1'};
  const prompt=(e)=>Object.entries(e).map(([k,v])=>k==='source_text'||k==='korean_text'?k+'_json: '+JSON.stringify(v):k+': '+v).join('\n');
  const reject=(actual,expected,pattern)=>{
    const issues=[];validatePromptTextPreflight(actual,{__line:1,edit_regions:expected.edit_regions},expected,issues);
    assert.match(issues.join('\n'),pattern);
  };
  await t.test('malformed JSON fails',()=>reject(prompt(scalar).replace('source_text_json: "甲\\n乙"','source_text_json: ["甲",'),scalar,/invalid JSON source_text_json/));
  await t.test('plain and JSON text may not coexist',()=>reject(prompt(scalar)+'\nsource_text: 甲',scalar,/conflicts source_text and source_text_json/));
  await t.test('array length must match exact edit regions',()=>reject(prompt({...mixed,source_text:['甲']}),mixed,/ordered string arrays matching edit_regions/));
  await t.test('array elements must all be strings',()=>reject(prompt({...mixed,korean_text:['가','가',3,'나']}),mixed,/ordered string arrays matching edit_regions/));
  await t.test('escaped literal slash-n is not an actual LF',()=>reject(prompt({...scalar,source_text:'甲\\n乙'}),scalar,/preflight mismatch source_text/));
  await t.test('reversed mixed states fail exact ordered comparison',()=>reject(prompt({...mixed,source_text:[...mixed.source_text].reverse()}),mixed,/preflight mismatch source_text/));
});
