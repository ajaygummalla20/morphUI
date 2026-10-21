import {interactionId} from './interaction-id';
import type {WorkspaceClarification} from "./context";
export type ConversationMessage={id:string;role:'user'|'assistant';content:string;kind?:'response'|'error'|'cancelled'};
const retain=(messages:ConversationMessage[])=>messages.slice(-40);
export function startConversation(messages:ConversationMessage[],content:string,followup:boolean):ConversationMessage[]{
 return retain([...(followup?messages:[]),{id:interactionId(),role:'user',content}]);
}
export function appendAssistantMessage(messages:ConversationMessage[],content:string,kind:ConversationMessage['kind']='response'):ConversationMessage[]{
 return retain([...messages,{id:interactionId(),role:'assistant',content,kind}]);
}

export function continueClarification(previous:WorkspaceClarification|undefined,lastRequest:string,question:string):WorkspaceClarification {
 return {request:previous?.request??lastRequest,question,answers:previous?[...(previous.answers??[]),lastRequest].slice(-6):[]};
}

export function clarificationForReply(previous:WorkspaceClarification|undefined,lastRequest:string|undefined,question:string|null):WorkspaceClarification|undefined {
 const activeQuestion=question??previous?.question;
 return lastRequest&&activeQuestion?continueClarification(previous,lastRequest,activeQuestion):undefined;
}
