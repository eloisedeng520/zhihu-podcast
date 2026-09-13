import { spawnSync } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const cli = resolve("node_modules", "vinext", "dist", "cli.js");
const result = spawnSync(process.execPath, [cli, "build"], {
  cwd: process.cwd(),
  env: { ...process.env, VINEXT_DEPLOY_TARGET: "node" },
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const releaseDirectory = resolve("dist", "standalone");
// Local content is served with its canonical Zhihu image URLs. These source
// snapshots are hundreds of megabytes and are not referenced at runtime.
rmSync(resolve(releaseDirectory, "public", "data", "content-images"), { recursive: true, force: true });
rmSync(resolve(releaseDirectory, "dist", "client", "data", "content-images"), { recursive: true, force: true });
copyFileSync(resolve("deploy", "baota-start.mjs"), resolve(releaseDirectory, "baota-start.mjs"));
copyFileSync(resolve(".env.example"), resolve(releaseDirectory, ".env.production.example"));
copyFileSync(resolve("docs", "BAOTA_DEPLOYMENT.md"), resolve(releaseDirectory, "BAOTA_DEPLOYMENT.md"));
console.log("  Added Baota launcher, environment template, and deployment guide.\n");
