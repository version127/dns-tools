"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { formatAuthoritativeTtl } from "@/lib/dns/format-record.ts";
import {
  TRACE_RECORD_TYPES,
  type DnsTraceRecordType,
  type DnsTraceResponse,
  type DnsTraceStep,
} from "@/lib/dns/trace-types.ts";
import styles from "./dns-trace.module.css";

function stageTitle(step: DnsTraceStep) {
  if (step.stage === "root") return "Root nameserver";
  if (step.stage === "tld") return `.${step.zone} nameserver`;
  return `Nameserver for ${step.zone}`;
}

function traceAsText(result: DnsTraceResponse) {
  const lines = [`DNS trace for ${result.query.normalizedName} (${result.query.recordType})`];
  for (const step of result.steps) {
    lines.push("", `${step.sequence}. ${stageTitle(step)}`, step.message);
    if (step.server) lines.push(`Server: ${step.server.hostname} (${step.server.address})`);
    lines.push(`Question: ${step.questionName} ${step.requestedType}`);
    if (step.responseCode) lines.push(`Response: ${step.responseCode}${step.durationMs === null ? "" : ` in ${step.durationMs} ms`}`);
    if (step.nameservers.length) lines.push(`Nameservers: ${step.nameservers.join(", ")}`);
    for (const record of step.glueRecords) lines.push(`Glue: ${record.ownerName} ${record.type} ${record.value}`);
    for (const record of step.additionalAddressRecords) lines.push(`Included nameserver address: ${record.ownerName} ${record.type} ${record.value}`);
    for (const record of step.answerRecords) lines.push(`Answer: ${record.ownerName} ${record.type} ${record.value} TTL ${record.resolverTtlSeconds ?? "not reported"}`);
    for (const attempt of step.attempts) lines.push(`Earlier attempt: ${attempt.server.hostname} (${attempt.server.address}) — ${attempt.error}`);
  }
  return lines.join("\n");
}

function RecordRows({ records }: { records: DnsTraceStep["answerRecords"] }) {
  if (records.length === 0) return null;
  return (
    <div className={styles.records}>
      {records.map((record, index) => (
        <div className={styles.record} key={`${record.ownerName}-${record.type}-${record.value}-${index}`}>
          <span><code>{record.type}</code> for <code>{record.ownerName}</code></span>
          <code className={styles.recordValue}>{record.value}</code>
          <small><strong>TTL</strong> {formatAuthoritativeTtl(record.resolverTtlSeconds)}</small>
        </div>
      ))}
    </div>
  );
}

function ExpandableCodes({ label, values }: { label: string; values: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = values.length > 4;
  const visible = expanded ? values : values.slice(0, 4);
  return (
    <div>
      {visible.map((value) => <code key={value}>{value}</code>)}
      {hasMore ? (
        <button
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {expanded ? `Show fewer ${label}` : `Show all ${values.length} ${label}`}
        </button>
      ) : null}
    </div>
  );
}

function TraceStep({ step }: { step: DnsTraceStep }) {
  return (
    <li className={styles.step} data-trace-step={step.stage}>
      <span aria-hidden="true" className={styles.marker}>{step.sequence}</span>
      <div className={styles.stepBody}>
        <header className={styles.stepHeader}>
          <div>
            <h3>{stageTitle(step)}</h3>
            <p>{step.message}</p>
          </div>
          <span className={`${styles.state} ${styles[step.outcome]}`}>{step.responseCode ?? "Stopped"}</span>
        </header>

        {step.server ? (
          <p className={styles.serverLine}>
            We asked <code>{step.server.hostname}</code> at <code>{step.server.address}</code> for <code>{step.requestedType}</code> on <code>{step.questionName}</code>.
            {step.durationMs === null ? null : <> It replied in {step.durationMs.toLocaleString("en-US")} ms.</>}
          </p>
        ) : null}

        {step.nameservers.length > 0 ? (
          <div className={styles.referralBlock}>
            <span>Nameservers in the referral</span>
            <ExpandableCodes label="nameservers" values={step.nameservers} />
          </div>
        ) : null}

        {step.glueRecords.length > 0 ? (
          <div className={styles.referralBlock}>
            <span>Glue from this referral</span>
            <ExpandableCodes label="glue addresses" values={step.glueRecords.map((record) => `${record.ownerName} → ${record.value}`)} />
          </div>
        ) : null}

        {step.additionalAddressRecords.length > 0 ? (
          <div className={styles.referralBlock}>
            <span>Nameserver addresses included with this referral</span>
            <ExpandableCodes label="nameserver addresses" values={step.additionalAddressRecords.map((record) => `${record.ownerName} → ${record.value}`)} />
          </div>
        ) : null}

        <RecordRows records={step.answerRecords} />

        {step.attempts.length > 0 ? (
          <div className={styles.attempts}>
            <p>The trace tried another server first:</p>
            {step.attempts.map((attempt, index) => (
              <p key={`${attempt.server.address}-${index}`}><code>{attempt.server.hostname}</code> — {attempt.error}</p>
            ))}
          </div>
        ) : null}

        <details className={styles.raw}>
          <summary>Raw response from this step</summary>
          <pre>{JSON.stringify(step.rawResponse ?? { attempts: step.attempts }, null, 2)}</pre>
        </details>
      </div>
    </li>
  );
}

function TraceResults({ result }: { result: DnsTraceResponse }) {
  const [copied, setCopied] = useState(false);
  const lastStep = result.steps.at(-1);
  const authority = lastStep?.authoritative === true
    ? "was authoritative"
    : lastStep?.authoritative === false
      ? "was not authoritative"
      : "did not report whether it was authoritative";
  const finalResponse = lastStep?.responseCode
    ? `The last response ${authority} and returned ${lastStep.responseCode}.`
    : "The last step did not return a DNS response code.";
  return (
    <section aria-live="polite" className={styles.results} tabIndex={-1}>
      <header className={styles.resultHeader}>
        <div>
          <h2>{result.query.normalizedName}</h2>
          <p>The trace took {result.steps.length.toLocaleString("en-US")} {result.steps.length === 1 ? "step" : "steps"} and {result.durationMs.toLocaleString("en-US")} ms. {finalResponse}</p>
        </div>
        <button
          aria-label="Copy trace"
          onClick={async () => {
            await navigator.clipboard.writeText(traceAsText(result));
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
          type="button"
        >
          {copied ? "Copied" : "Copy trace"}
        </button>
      </header>

      <ol className={styles.timeline}>
        {result.steps.map((step) => <TraceStep key={step.sequence} step={step} />)}
      </ol>

      {result.outcome === "found" ? (
        <p className={styles.complete}>The trace reached an answer for <code>{result.finalName}</code>.</p>
      ) : result.warnings.length > 0 ? (
        <div className={styles.warning}>{result.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>
      ) : null}
      {result.outcome === "error" ? <p className={styles.nextCheck}><a href={`/nameserver-checker?name=${encodeURIComponent(result.query.normalizedName)}`}>Check the nameserver delegation</a> to compare the parent handoff, glue, and the answers from each nameserver.</p> : null}
    </section>
  );
}

export function DnsTraceTool({
  initialName = "",
  initialRecordType = "A",
}: {
  initialName?: string;
  initialRecordType?: DnsTraceRecordType;
}) {
  const [name, setName] = useState(initialName);
  const [recordType, setRecordType] = useState<DnsTraceRecordType>(initialRecordType);
  const [result, setResult] = useState<DnsTraceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const requestBody = useMemo(() => ({ name, recordType }), [name, recordType]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Enter a domain or hostname.");
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/dns/trace", {
        body: JSON.stringify(requestBody),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "The DNS trace failed.");
      setResult(data as DnsTraceResponse);
    } catch (traceError) {
      if (!controller.signal.aborted) setError(traceError instanceof Error ? traceError.message : "The DNS trace failed.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  return (
    <section aria-label="DNS trace form" className="dns-tool">
      <form className="dns-lookup-form" onSubmit={submit}>
        <label className="dns-name-field">
          <span>Domain or hostname</span>
          <input
            autoCapitalize="none"
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
            placeholder="www.google.com"
            spellCheck={false}
            type="text"
            value={name}
          />
        </label>
        <fieldset className="dns-record-type-picker" role="radiogroup">
          <legend>Record type</legend>
          <div className="dns-record-type-options">
            {TRACE_RECORD_TYPES.map((type) => (
              <label key={type}>
                <input checked={recordType === type} name="trace-record-type" onChange={() => setRecordType(type)} type="radio" value={type} />
                <span>{type}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button className="dns-submit" disabled={loading} type="submit">{loading ? "Tracing DNS..." : "Trace DNS"}</button>
        {error ? <p className="dns-form-error" role="alert">{error}</p> : null}
      </form>
      {result ? <TraceResults result={result} /> : null}
    </section>
  );
}
