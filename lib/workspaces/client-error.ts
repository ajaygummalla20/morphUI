export class WorkspaceRequestError extends Error {
  readonly requestId?:string;
  constructor(message:string,readonly code:string,requestId?:string){
    const reference=typeof requestId==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId)?requestId:undefined;
    super(reference&&code!=='unsupported_workspace_request'?`${message} Reference: ${reference}.`:message);
    this.name='WorkspaceRequestError';this.requestId=reference;
  }
  get needsClarification(){return this.code==='unsupported_workspace_request';}
}
