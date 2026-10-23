import assert from 'node:assert/strict';
import {test} from 'node:test';
import {initialReviewSession,reviewSessionReducer} from '../lib/workspaces/plan-review-session';
import type {WorkspacePlanReview} from '../lib/workspaces/plan-review';
const review={definition:{context:{plan:{filters:[{field:'start_date',operator:'between',value:'2026-02-01..2026-02-28'}]}}}} as WorkspacePlanReview;

test('failed refinements retain the draft definition while replacing the displayed review',()=>{
 const ready=reviewSessionReducer(initialReviewSession,{type:'ready',review});
 const refining=reviewSessionReducer(ready,{type:'start',review:true});
 assert.equal(refining.review,null);assert.deepEqual(refining.context,review.definition.context);
 // Failure leaves this state intact; the next chat request must use February,
 // even when an older successful canvas still shows January.
 const next=reviewSessionReducer(refining,{type:'start',review:true});
 assert.deepEqual(next.context,review.definition.context);
});
test('run keeps the review available for retry, and execution clears its draft context',()=>{
 const ready=reviewSessionReducer(initialReviewSession,{type:'ready',review});
 assert.equal(ready.review,review);
 const executed=reviewSessionReducer(ready,{type:'executed'});
 assert.equal(executed.review,null);assert.equal(executed.context,undefined);assert.equal(executed.enabled,true);
});
test('cancel, discard and new workspace reset review mode; direct Build always starts immediate execution',()=>{
 const ready=reviewSessionReducer(initialReviewSession,{type:'ready',review});
 assert.deepEqual(reviewSessionReducer(ready,{type:'reset'}),initialReviewSession);
 assert.deepEqual(reviewSessionReducer(ready,{type:'start',review:false}),initialReviewSession);
 const failedInitial=reviewSessionReducer(initialReviewSession,{type:'start',review:true});
 assert.equal(failedInitial.enabled,true);
 assert.equal(reviewSessionReducer(failedInitial,{type:'start',review:false}).enabled,false);
});
