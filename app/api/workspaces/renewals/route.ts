// Generation is a cookie-authenticated POST operation, never a side-effecting GET.
export function GET() {
  return Response.json({error:"Use POST /api/workspaces/generate with a signed-in session.",code:"endpoint_retired"},{status:410,headers:{"Cache-Control":"no-store"}});
}
