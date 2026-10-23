import type {WorkspaceContext} from './context';
import type {WorkspacePlanReview} from './plan-review';

type ReviewSession={enabled:boolean;review:WorkspacePlanReview|null;context?:WorkspaceContext};
type ReviewAction=
 | {type:'start';review:boolean}
 | {type:'ready';review:WorkspacePlanReview}
 | {type:'toggle';enabled:boolean}
 | {type:'executed'|'reset'};
export const initialReviewSession:ReviewSession={enabled:false,review:null};

export function reviewSessionReducer(state:ReviewSession,action:ReviewAction):ReviewSession {
 switch(action.type){
  case 'start':return action.review?{...state,enabled:true,review:null}:initialReviewSession;
  case 'ready':return {enabled:true,review:action.review,context:action.review.definition.context};
  case 'toggle':return {...state,enabled:action.enabled};
  case 'executed':return {enabled:state.enabled,review:null};
  case 'reset':return initialReviewSession;
 }
}
