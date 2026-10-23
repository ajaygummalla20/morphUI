import {z} from 'zod';
import {workspaceReviewedDefinitionSchema} from './context';

export const workspacePlanReviewSchema=z.object({
  type:z.literal('plan_review'),
  definition:workspaceReviewedDefinitionSchema,
  sourceMode:z.enum(['client_gateway','secure_demo']),
  summary:z.object({
    dataset:z.string().min(1).max(100),
    measure:z.string().min(1).max(240),
    grouping:z.string().min(1).max(240),
    format:z.string().min(1).max(240),
    fields:z.array(z.string().max(100)).max(30),
    filters:z.array(z.object({field:z.string().max(100),operator:z.string().max(40),value:z.union([z.string().max(500),z.number()])}).strict()).max(12),
    period:z.string().max(100).nullable(),
    comparison:z.string().max(100),
    rowLimit:z.number().int().min(1).max(200),
  }).strict(),
}).strict();
export type WorkspacePlanReview=z.infer<typeof workspacePlanReviewSchema>;
