import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const tools = [
  ["dns-lookup", "lookup"],
  ["dns-trace", "trace"],
  ["dns-change-checker", "change-checker"],
  ["nameserver-checker", "nameserver-checker"],
  ["dnssec-checker", "dnssec-checker"],
  ["soa-checker", "soa-checker"],
  ["caa-checker", "caa-checker"],
];

function textFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const filePath = path.join(dir, entry);
    const stat = statSync(filePath);
    if (stat.isDirectory()) return entry === "node_modules" || entry === ".next" || entry === "tests" ? [] : textFiles(filePath);
    if (filePath === path.join(root, "scripts", "verify-repository.mjs")) return [];
    return /\.(?:css|js|json|md|mjs|ts|tsx|ya?ml)$/.test(entry) ? [filePath] : [];
  });
}

for (const [page, api] of tools) {
  assert.ok(existsSync(path.join(root, "app", "(site)", page, "page.tsx")), `missing flat page ${page}`);
  assert.ok(existsSync(path.join(root, "app", "api", "dns", api, "route.ts")), `missing API ${api}`);
  assert.ok(existsSync(path.join(root, "docs", "tools", page, "README.md")), `missing docs ${page}`);
  assert.ok(existsSync(path.join(root, "tests", "pages", page, "page.spec.ts")), `missing page test ${page}`);
}

const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
assert.equal(packageJson.dependencies.pg, undefined);
assert.equal(packageJson.dependencies["@supabase/supabase-js"], undefined);
assert.match(packageJson.scripts.dev, /1273/);
assert.equal(packageJson.overrides.postcss, "8.5.10");
assert.equal(packageJson.repository.url, "https://github.com/version127/dns-tools.git");

for (const required of [
  "README.md",
  "LICENSE",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "openapi.yaml",
  "Dockerfile",
  "docker-compose.yml",
  ".env.example",
  "docs/launch-checklist.md",
  "docs/maintainers/syncing-with-version127.md",
  "tests/pages/home/page.spec.ts",
  "tests/shared/dns-tools.spec.ts",
  "public/version127-logo-white.png",
]) {
  assert.ok(existsSync(path.join(root, required)), `missing ${required}`);
}

const dockerfile = readFileSync(path.join(root, "Dockerfile"), "utf8");
assert.match(dockerfile, /USER nextjs/);
assert.match(dockerfile, /EXPOSE 1273/);

const header = readFileSync(path.join(root, "app", "site-header.tsx"), "utf8");
assert.match(header, /version127-logo-white\.png/);
assert.doesNotMatch(header, /Built by Version127/);

const source = textFiles(root).map((file) => readFileSync(file, "utf8")).join("\n");
assert.doesNotMatch(source, /DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|public\.version127_pages|the Version127 site/);
assert.doesNotMatch(source, /https?:\/\/[^\s"']+:[^\s"']+@/);

console.log(`Repository check passed: ${tools.length} pages, ${tools.length} APIs, no database dependency, no embedded secrets.`);
