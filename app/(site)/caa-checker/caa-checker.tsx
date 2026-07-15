"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { CaaRecord } from "@/lib/dns/diagnostic-types.ts";
import { csvFromRows } from "@/lib/dns/diagnostic-presentation.ts";
import { DiagnosticResultHeader, DownloadResultButton } from "../_dns-tools/diagnostic-result-ui";
import styles from "../_dns-tools/dns-diagnostics.module.css";

type SearchReason = "requested" | "alias" | "parent";
type Level = { name: string; searchReason: SearchReason; responseCode: string | null; records: CaaRecord[]; aliasTarget: string | null; rawResponse: unknown; error: string | null };
type Result = { checkedAt: string; durationMs: number; query: { inputName: string }; status: "undetermined" | "policy_found" | "no_policy"; effectiveName: string | null; levels: Level[]; records: CaaRecord[]; normal: { unrestricted: boolean; denied: boolean; issuers: string[] }; wildcard: { unrestricted: boolean; denied: boolean; issuers: string[] }; usesIssueForWildcard: boolean; iodef: Array<{ value: string; validUrl: boolean }>; unknownCriticalTags: string[]; malformedRecords: number; error: string | null };

function Policy({ title, policy, note }: { title: string; policy: Result["normal"]; note?: string }) {
  const sentence = policy.denied ? "No certificate authority is allowed." : policy.unrestricted ? "CAA does not restrict this kind of certificate." : `${policy.issuers.join(", ")} ${policy.issuers.length === 1 ? "is" : "are"} allowed.`;
  return <div className={styles.finding} data-tone={policy.denied ? "warning" : "good"}><p><strong>{title}</strong><br/>{sentence}{note ? ` ${note}` : ""}</p></div>;
}

function reasonText(reason: SearchReason) {
  if (reason === "requested") return "Started with the certificate name";
  if (reason === "alias") return "Followed its CNAME";
  return "Moved to the next parent of the certificate name";
}

function resultCsv(result: Result) {
  return csvFromRows([
    ["effective name", "owner", "flags", "critical", "tag", "value", "resolver ttl seconds", "valid"],
    ...result.records.map((record) => [result.effectiveName, record.ownerName, record.flags, record.critical, record.tag, record.value, record.ttlSeconds, record.valid]),
  ]);
}

export function CaaChecker({ initialName = "" }: { initialName?: string }) {
  const [name, setName] = useState(initialName);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const csv = useMemo(() => result ? resultCsv(result) : "", [result]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError("Enter a domain or hostname.");
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/dns/caa-checker", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "The CAA check failed.");
      setResult(data);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The CAA check failed."); }
    finally { setLoading(false); }
  }

  return <section className="dns-tool" aria-label="CAA policy checker">
    <form className="dns-lookup-form" onSubmit={submit}><label className="dns-name-field"><span>Domain or hostname</span><input autoCapitalize="none" autoComplete="off" onChange={(event) => setName(event.target.value)} placeholder="www.github.com" spellCheck={false} value={name} /></label><button className="dns-submit" disabled={loading}>{loading ? "Finding CAA policy..." : "Check CAA policy"}</button>{error ? <p className="dns-form-error" role="alert">{error}</p> : null}</form>
    {result ? <section className={styles.results} aria-live="polite">
      <DiagnosticResultHeader action={<DownloadResultButton contents={csv} filename={`${result.query.inputName}-caa.csv`} />} checkedAt={result.checkedAt} durationMs={result.durationMs} hostname={result.query.inputName}>
        <p>{result.status === "undetermined" ? `We could not determine the effective CAA policy. ${result.error ?? "The DNS search did not complete."}` : result.status === "no_policy" ? "No CAA policy was found on this name or its parents, so CAA does not restrict which certificate authority may issue." : `The policy that applies to this name was found at ${result.effectiveName}.`}</p>
      </DiagnosticResultHeader>
      {result.status !== "undetermined" ? <div className={styles.grid}><Policy title="Normal certificates" policy={result.normal} /><Policy title="Wildcard certificates" policy={result.wildcard} note={result.usesIssueForWildcard ? "There is no issuewild record, so the issue records apply here too." : undefined} /></div> : null}
      {result.records.length ? <section className={styles.section}><h3>The records that create this policy</h3><div className="dns-table-scroll"><table className={`dns-status-table ${styles.compactTable}`}><thead><tr><th>Flag</th><th>Tag</th><th>Value</th><th>Resolver TTL</th></tr></thead><tbody>{result.records.map((record, index) => <tr key={`${record.tag}-${record.value}-${index}`}><td>{record.flags}{record.critical ? " · critical" : ""}</td><td><code>{record.tag || "Malformed"}</code></td><td><code>{record.value}</code></td><td>{record.ttlSeconds === null ? "Not reported" : `${record.ttlSeconds.toLocaleString("en-US")}s`}</td></tr>)}</tbody></table></div>{result.iodef.length ? <p className={styles.inlineNote}>Incident reports: {result.iodef.map((entry) => `${entry.value}${entry.validUrl ? "" : " (not a valid mailto or HTTP URL)"}`).join(", ")}</p> : null}</section> : null}
      {result.unknownCriticalTags.length ? <div className={styles.finding} data-tone="warning"><p>The policy contains an unknown critical tag: {result.unknownCriticalTags.join(", ")}. A certificate authority must understand that tag before it can issue.</p></div> : null}
      {result.malformedRecords ? <div className={styles.finding} data-tone="warning"><p>{result.malformedRecords} CAA record{result.malformedRecords === 1 ? " is" : "s are"} malformed, so the policy may not be interpreted as intended.</p></div> : null}
      <section className={styles.section}><h3>Where the policy came from</h3><div className={styles.sources}>{result.levels.map((level, index) => <div className={styles.source} key={`${level.name}-${index}`}><header className={styles.sourceHeader}><h3><code>{level.name}</code></h3><span className={level.records.length ? styles.stateGood : level.error ? styles.stateBad : styles.stateQuiet}>{level.records.length ? "Policy found" : level.error ? "Lookup failed" : "No CAA here"}</span></header><p>{reasonText(level.searchReason)}{level.aliasTarget ? ` and found an alias to ${level.aliasTarget}.` : "."}</p><details className={styles.raw}><summary>Raw CAA response</summary><pre>{JSON.stringify(level.rawResponse ?? { error: level.error }, null, 2)}</pre></details></div>)}</div></section>
    </section> : null}
  </section>;
}
