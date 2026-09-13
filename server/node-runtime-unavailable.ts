import type { AppEnv } from "./api.ts";

export function getNodeEnvironment(): AppEnv {
  throw new Error("The Node runtime adapter is unavailable in the Cloudflare build");
}
