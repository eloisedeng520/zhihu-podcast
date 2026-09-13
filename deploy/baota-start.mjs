import { loadEnvFile } from "node:process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const releaseDirectory = dirname(fileURLToPath(import.meta.url));
process.chdir(releaseDirectory);

try {
  loadEnvFile(join(releaseDirectory, ".env.production"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

await import("./server.js");
