import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

process.env.HOSTNAME ??= "0.0.0.0";
process.env.PORT ??= "1273";

const standaloneDir = path.join(process.cwd(), ".next", "standalone");
const staticSource = path.join(process.cwd(), ".next", "static");
const staticTarget = path.join(standaloneDir, ".next", "static");
if (existsSync(staticSource)) {
  mkdirSync(path.dirname(staticTarget), { recursive: true });
  cpSync(staticSource, staticTarget, { recursive: true, force: true });
}

const publicSource = path.join(process.cwd(), "public");
const publicTarget = path.join(standaloneDir, "public");
if (existsSync(publicSource)) cpSync(publicSource, publicTarget, { recursive: true, force: true });

await import("../.next/standalone/server.js");
