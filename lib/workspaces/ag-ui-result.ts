import {z} from 'zod';
import {workspaceContextSchema} from './context';
const cell=z.union([z.string(),z.number(),z.null()]);
const block=z.discriminatedUnion('type',[
 z.object({type:z.literal('table'),title:z.string(),columns:z.array(z.object({key:z.string(),label:z.string(),format:z.enum(['text','id','currency','date','person','badge','percentage']).optional()})).max(100),rows:z.array(z.record(z.string(),cell)).max(200),totalRows:z.number(),emptyMessage:z.string()}),
 z.object({type:z.literal('chart'),variant:z.enum(['bar','line','donut']),title:z.string(),subtitle:z.string(),valueFormat:z.enum(['currency','number','percentage']),items:z.array(z.object({label:z.string(),value:z.number().nullable(),drilldownValue:z.string().optional()})).max(200)}),
 z.object({type:z.literal('metrics'),items:z.array(z.object({label:z.string(),value:z.string(),delta:z.string(),tone:z.enum(['lime','orange','blue'])})).max(20)}),
 z.object({type:z.literal('filters'),items:z.array(z.object({label:z.string(),value:z.string()})).max(100)}),
 z.object({type:z.literal('trend'),title:z.string(),subtitle:z.string(),values:z.array(z.number()),total:z.string(),labels:z.tuple([z.string(),z.string(),z.string()]),axisLabels:z.tuple([z.string(),z.string(),z.string()])}),
]);
export const resultSchema=z.object({queryPlan:workspaceContextSchema.shape.plan,presentation:workspaceContextSchema.shape.presentation.optional(),intent:z.enum(['policies','renewals','claims','endorsements']),interpretation:z.string(),sourceMode:z.enum(['client_gateway','secure_demo']),spec:z.object({title:z.string(),description:z.string(),source:z.string(),generatedIn:z.string(),blocks:z.array(block).min(1).max(8)}),safety:z.object({readOnly:z.literal(true),rawSqlAccepted:z.literal(false),fieldsAccessed:z.number(),permittedFields:z.number(),sensitiveData:z.literal('masked'),maximumRows:z.number().max(200),returnedRows:z.number().max(200)})}).passthrough();
