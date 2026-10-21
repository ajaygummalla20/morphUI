import {generateWorkspaceResponse} from "@/lib/server/workspace-generation";
export const dynamic="force-dynamic";
export async function POST(request:Request){return generateWorkspaceResponse(request);}
