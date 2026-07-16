import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const hostedStyleFiles = [
  "app/(site)/dns-tools.css",
  "app/(site)/dns-diagnostics.module.css",
  "app/(site)/dns-trace/dns-trace.module.css",
];
const repositoryStyleFiles = [
  "repos/app/(site)/_dns-tools/dns-tools.css",
  "repos/app/(site)/_dns-tools/dns-diagnostics.module.css",
  "repos/app/(site)/dns-trace/dns-trace.module.css",
];
const standaloneStyleFiles = repositoryStyleFiles.map((file) => file.replace("repos/", ""));
const runningInHostedRepo = existsSync(path.join(root, hostedStyleFiles[0]));
const dnsStyleFiles = runningInHostedRepo
  ? [...hostedStyleFiles, ...repositoryStyleFiles]
  : standaloneStyleFiles;

test("DNS tool boxes never use a colored left-edge accent", () => {
  const styles = dnsStyleFiles.map((file) => readFileSync(path.join(root, file), "utf8")).join("\n");
  const leftEdges = [...styles.matchAll(/border-(?:left|inline-start)(?:-color)?:\s*([^;]+);/g)]
    .map((match) => match[1].trim());

  assert.deepEqual(
    leftEdges,
    Array.from({ length: runningInHostedRepo ? 2 : 1 }, () => "1px solid var(--color-border-strong)"),
  );
});
