import Link from "next/link";
import { AppShell } from "../../app-shell";
import { DnsToolsSidebar } from "../_dns-tools/dns-tools-sidebar";
import { DnsTraceTool } from "./dns-trace-tool";
import { TRACE_RECORD_TYPES, type DnsTraceRecordType } from "@/lib/dns/trace-types.ts";
import styles from "./dns-trace.module.css";

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function initialRecordType(value: string): DnsTraceRecordType {
  const normalized = value.toUpperCase();
  return TRACE_RECORD_TYPES.includes(normalized as DnsTraceRecordType)
    ? normalized as DnsTraceRecordType
    : "A";
}

export default async function DnsTracePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  return (
    <AppShell
      mainLabel="DNS Trace Explorer"
      menuLabel="DNS tools"
      sidebar={<DnsToolsSidebar active="trace" />}
      sidebarLabel="DNS tools sidebar"
    >
      <main className={styles.main}>
        <header className="dns-page-header">
          <h1>DNS Trace Explorer</h1>
          <p>This tool follows one DNS question the long way, starting at the root nameservers at the top of DNS and walking down until it reaches the server that holds the final answer. At each hop it shows you which server it asked, what that server said, and where it pointed next. If the trip stops early, you can see the exact step where it broke.</p>
        </header>

        <DnsTraceTool
          initialName={firstValue(params.name)}
          initialRecordType={initialRecordType(firstValue(params.type))}
        />

        <article className="dns-reference-content">
          <section id="how-dns-trace-works">
            <h2>How a DNS trace works</h2>
            <p>DNS is built as a chain of handoffs. The root nameservers know who runs <code>.com</code>. The <code>.com</code> nameservers know who runs <code>example.com</code>. And that domain's own nameserver holds the final record. Normally a public resolver does this whole walk for you and just hands back the result. This tool does the walk itself, in the open, so you can watch every handoff instead of trusting a single cached answer.</p>
            <figure className={styles.journey}>
              <div><code>Root</code><span aria-hidden="true">→</span><code>.com</code><span aria-hidden="true">→</span><code>example.com</code><span aria-hidden="true">→</span><code>Answer</code></div>
              <figcaption>At each stop, a server either hands back the answer or points the trace one step closer to it.</figcaption>
            </figure>
          </section>

          <section id="reading-a-trace">
            <h2>What each step tells you</h2>
            <p>Most steps end in a referral. That is just one nameserver saying, “I do not have the answer, but here are the servers that are closer to it.” It names the next set of nameservers and sends you their way.</p>
            <p>Sometimes those next nameservers live inside the very domain you are looking up, like <code>ns1.example.com</code> serving <code>example.com</code>. That creates a loop: to find the nameserver you would need to look up the domain, but to look up the domain you need the nameserver. Glue is how DNS breaks the loop. The parent zone tacks the nameserver's IP address straight onto the referral, so the trace can move on without getting stuck. When you see glue in a step, that is the shortcut address that came bundled with the referral.</p>
            <p>For each step, the trace keeps everything together: the server it asked, how long the reply took, the response code, the nameservers it was pointed to, any glue, the TTL, and the raw reply. That way you can trace where every detail came from.</p>
          </section>

          <section id="trace-stops">
            <h2>Where a DNS trace can stop</h2>
            <p>A healthy trace ends one of two ways: with the record you asked for, or with a clear answer that the name simply does not exist. When something is broken instead, the last step that finished is your best clue about which part of the chain to look at.</p>
            <div className="dns-table-scroll">
              <table className="dns-status-table">
                <thead><tr><th scope="col">Where it stops</th><th scope="col">What that usually means</th></tr></thead>
                <tbody>
                  <tr><th scope="row">At the root</th><td>The top-level domain, like the part after the last dot, may not exist, or the trace never reached a root server in the first place.</td></tr>
                  <tr><th scope="row">At the TLD</th><td>The <code>.com</code> or other TLD zone did not hand off the domain to any nameservers, so there was nowhere to go next.</td></tr>
                  <tr><th scope="row">Before the domain's server</th><td>The handoff named some nameservers, but the trace could not find a usable public address to reach them.</td></tr>
                  <tr><th scope="row">At the domain's server</th><td>The nameserver was reached but did not answer cleanly: it timed out, refused the question, returned an error, or replied without the record type you asked for.</td></tr>
                  <tr><th scope="row">After an alias</th><td>The name is a CNAME pointing somewhere else, and that target is missing, unreachable, or points back in a loop.</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="trace-vs-lookup">
            <h2>DNS trace and DNS lookup are different</h2>
            <p>DNS Lookup tells you the answer a resolver like Cloudflare, Google, or an authoritative server is handing out right now. DNS Trace Explorer skips those cached answers and walks the chain of handoffs from the root instead. Reach for the lookup when you want the answer real people are getting. Reach for the trace when you want to understand how DNS gets to that answer, or why it cannot.</p>
          </section>

          <aside className="dns-scope-note">
            <p>The trace runs from this DNS Tools server, so it shows what that one machine sees. It cannot tell you what your ISP has cached, and it does not test whether a change has spread worldwide. It can display DNSSEC records, but the <Link href="/dnssec-checker">DNSSEC Chain Checker</Link> is the tool that verifies their signatures and chain of trust. This installation does not store the names you trace or send them to analytics.</p>
          </aside>
        </article>
      </main>
    </AppShell>
  );
}
