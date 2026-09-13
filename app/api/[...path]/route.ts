import { handleApi } from "../../../server/api.ts";

export const dynamic = "force-dynamic";

async function nodeApi(request: Request): Promise<Response> {
  // Keep Node-only built-ins out of the Cloudflare worker's startup path. The
  // existing worker intercepts /api/* before this route is reached.
  const { getNodeEnvironment } = await import("@/server/node-runtime.ts");
  return handleApi(request, getNodeEnvironment());
}

export const GET = nodeApi;
export const HEAD = nodeApi;
export const POST = nodeApi;
export const DELETE = nodeApi;
