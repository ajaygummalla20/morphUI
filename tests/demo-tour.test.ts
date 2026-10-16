import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {demoSteps,advanceDemoStep,demoStepMatches} from '../lib/workspaces/demo';
import {DemoGuide} from '../app/components/demo-guide';
import type {DynamicWorkspaceResponse} from '../lib/workspaces/dynamic';
const result=(index:number):DynamicWorkspaceResponse=>({intent:'policies',sourceMode:'secure_demo',presentation:{mode:index===0?'table_only':'chart_only',blocks:[index===0?'table':'chart'],tableLayout:'grouped_summary'},interpretation:'Premium by manager',spec:{title:'Premium by manager',description:'Authorized totals',source:'Demo',generatedIn:'2s',blocks:[index===0?{type:'table',title:'Premium',columns:[],rows:[],totalRows:0,emptyMessage:'No data'}:{type:'chart',variant:'donut',title:'Premium',subtitle:'All records',valueFormat:'currency',items:[]}]},queryPlan:{source:'policies_read_replica',catalogVersion:'test',operation:'select',entity:'policies',fields:['total_premium','relationship_manager'],filters:index===2?[{field:'total_premium',operator:'greater_than',value:30000}]:[],groupBy:'relationship_manager',orderBy:[],rowLimit:200,analysis:{metricId:'written_premium',time:null,comparison:'none'}},planner:{mode:'ai',model:'test',validated:true,reason:'ai_plan'},safety:{readOnly:true,rawSqlAccepted:false,fieldsAccessed:2,permittedFields:11,sensitiveData:'masked',maximumRows:200,returnedRows:0}});
test('the tour has one ordered story and advances only on the requested result',()=>{
 assert.equal(demoSteps.length,3);
 for(let step=0;step<3;step++)assert.equal(advanceDemoStep(step,result(step)),step+1);
 const wrong=result(1);wrong.spec.blocks=[{type:'chart',variant:'bar',title:'Wrong',subtitle:'',valueFormat:'currency',items:[]}];
 assert.equal(advanceDemoStep(1,wrong),1);assert.equal(advanceDemoStep(0,undefined),0);
 const fallback=result(0);fallback.planner!.mode='deterministic_fallback';assert.equal(demoStepMatches(0,fallback),false);
});
test('filters, measures, source and grouping must match the demo before completing a step',()=>{
 const extra=result(1);extra.queryPlan.filters=[{field:'status',operator:'equals',value:'active'}];assert.equal(demoStepMatches(1,extra),false);
 const changed=result(2);changed.queryPlan.analysis!.metricId='policy_count';assert.equal(demoStepMatches(2,changed),false);
 const group=result(0);group.queryPlan.groupBy='branch';assert.equal(demoStepMatches(0,group),false);
});
test('first-time demo explains the purpose and gives one direct build action',()=>{
 const html=renderToStaticMarkup(createElement(DemoGuide,{step:0,busy:false,onRun:()=>{},onRestart:()=>{},onFinish:()=>{},onCancel:()=>{},error:null,needsClarification:false,response:null}));
 assert.match(html,/Build my example workspace/);assert.match(html,/Step 1 of 3/);assert.doesNotMatch(html,/Operations|Claims analyst|prohibited|Use this request/);
});
test('completed tour explains the outcome and lets users keep exploring',()=>{
 const html=renderToStaticMarkup(createElement(DemoGuide,{step:3,busy:false,onRun:()=>{},onRestart:()=>{},onFinish:()=>{},onCancel:()=>{},error:null,needsClarification:false,response:result(2)}));
 assert.match(html,/Continue with my own questions/);assert.match(html,/Sample data/);assert.doesNotMatch(html,/Send this in chat/);
});
