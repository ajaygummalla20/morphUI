export class WorkspaceRequestError extends Error {
  constructor(message:string,readonly code:string){super(message);this.name='WorkspaceRequestError';}
  get needsClarification(){return this.code==='unsupported_workspace_request';}
}
