import assert from 'node:assert/strict';
import {test} from 'node:test';
import {insuranceSemanticCatalog} from '../lib/catalog/semantic';
import {buildCatalogDrivenWorkspace, type WorkspacePlan} from '../lib/workspaces/dynamic';
const entity=insuranceSemanticCatalog.entities.find(e=>e.entity==='policies')!;
const plan:WorkspacePlan={intent:'policies',entity:'policies',source:entity.source,catalogVersion:insuranceSemanticCatalog.catalogVersion,title:'Premium growth',interpretation:'Monthly premium by coverage start date, January–March 2026.',fields:['start_date','total_premium'],filters:[],orderBy:[],metrics:[entity.metrics.find(m=>m.id==='written_premium')!],visualization:'line',presentation:{mode:'auto',blocks:['chart','table'],tableLayout:'grouped_summary'},days:15,minimumAmount:0,limit:12,analysis:{metricId:'written_premium',time:{field:'start_date',grain:'month',start:'2026-01-01',end:'2026-03-31'},comparison:'previous_bucket'}};
const records=[{bucket:'2026-01-01',group:null,value:25000,record_count:250},{bucket:'2026-02-01',group:null,value:60000,record_count:300},{bucket:'2026-03-01',group:null,value:900,record_count:3}];
function render(p=plan,rows=records){return buildCatalogDrivenWorkspace({plan:p,entity,records:rows,sourceMode:'client_gateway',generatedInMs:10});}
test('a growth answer shows real chronological values and computed period comparisons',()=>{
 const r=render();const chart=r.spec.blocks.find(b=>b.type==='chart')!;assert.equal(chart.type,'chart');if(chart.type!=='chart')return;
 assert.deepEqual(chart.items.map(i=>i.value),[25000,60000,900]);assert.match(chart.subtitle,/start|coverage/i);
 const table=r.spec.blocks.find(b=>b.type==='table')!;if(table.type!=='table')return;
 assert.equal(table.rows[0].change_percent,null);assert.equal(table.rows[1].change_percent,140);assert.equal(table.rows[2].change_percent,-98.5);
 assert.match(r.spec.description,/all matching|553/i);
});
test('zero previous value has no invented percentage; missing sum buckets are explicit zeroes',()=>{
 const r=render(plan,[{bucket:'2026-01-01',group:null,value:0,record_count:1},{bucket:'2026-03-01',group:null,value:100,record_count:2}]);
 const t=r.spec.blocks.find(b=>b.type==='table')!;if(t.type!=='table')return;
 assert.equal(t.rows.length,3);assert.equal(t.rows[1].value,0);assert.equal(t.rows[2].change_percent,null);
});
test('an empty period returns no invented trend or growth',()=>{
 const r=render(plan,[]);const c=r.spec.blocks.find(b=>b.type==='chart')!;if(c.type!=='chart')return;assert.equal(c.items.length,0);
});
test('table-only aggregate requests add no charts or metric cards',()=>{
 const r=render({...plan,visualization:'table',presentation:{mode:'table_only',blocks:['table'],tableLayout:'grouped_summary'}});
 assert.deepEqual(r.spec.blocks.map(b=>b.type),['table']);
});
test('growth comparisons follow the same category across periods, not the previous row',()=>{
 const grouped={...plan,groupBy:'branch',fields:[...plan.fields,'branch'],visualization:'bar' as const};
 const r=render(grouped,[{bucket:'2026-01-01',group:'A',value:100,record_count:1},{bucket:'2026-01-01',group:'B',value:200,record_count:2},{bucket:'2026-02-01',group:'A',value:150,record_count:1},{bucket:'2026-02-01',group:'B',value:100,record_count:2}]);
 const t=r.spec.blocks.find(b=>b.type==='table')!;if(t.type!=='table')return;
 assert.equal(t.rows.find(row=>row.bucket==='2026-02-01'&&row.group==='A')?.change_percent,50);
 assert.equal(t.rows.find(row=>row.bucket==='2026-02-01'&&row.group==='B')?.change_percent,-50);
});
test('missing average periods remain unavailable rather than creating zero averages',()=>{
 const average={...plan,analysis:{...plan.analysis!,metricId:'average_premium'},metrics:[entity.metrics.find(m=>m.id==='average_premium')!]};
 const r=render(average,[{bucket:'2026-01-01',group:null,value:100,record_count:2},{bucket:'2026-03-01',group:null,value:300,record_count:2}]);
 const c=r.spec.blocks.find(b=>b.type==='chart')!;if(c.type!=='chart')return;assert.deepEqual(c.items.map(item=>item.value),[100,null,300]);
 const t=r.spec.blocks.find(b=>b.type==='table')!;if(t.type!=='table')return;assert.equal(t.rows[2].change_percent,null);
});
test('percentage growth chart-only plots changes, not premium levels',()=>{
 const r=render({...plan,chartValue:'change_percent',presentation:{mode:'chart_only',blocks:['chart'],tableLayout:'grouped_summary'}});
 assert.deepEqual(r.spec.blocks.map(block=>block.type),['chart']);
 const c=r.spec.blocks[0];if(c.type!=='chart')return;
 assert.equal(c.valueFormat,'percentage');assert.deepEqual(c.items.map(item=>item.value),[null,140,-98.5]);assert.match(c.title,/growth/i);
});
test('category averages cannot masquerade as parts of an additive circular graph',()=>{
 const average={...plan,fields:['total_premium','branch'],groupBy:'branch',visualization:'donut' as const,analysis:{metricId:'average_premium',time:null,comparison:'none' as const}};
 assert.throws(()=>render(average,[{bucket:null as unknown as string,group:'A',value:100,record_count:2}]),/average|parts|whole/i);
});
