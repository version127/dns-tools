import { AppShell } from "../../app-shell";
import { DnsToolsSidebar } from "../_dns-tools/dns-tools-sidebar";
import { SoaChecker } from "./soa-checker";
import styles from "../_dns-tools/dns-diagnostics.module.css";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";

export default async function SoaCheckerPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  return <AppShell mainLabel="SOA Consistency Checker" menuLabel="DNS tools" sidebar={<DnsToolsSidebar active="soa" />} sidebarLabel="DNS tools sidebar">
    <main className={styles.main}>
      <header className="dns-page-header">
        <h1>SOA Consistency Checker</h1>
        <p>
          A zone can be answered by several nameservers, and they are all supposed to hold the
          same copy of your DNS. This tool asks every one of them for the zone&apos;s SOA record,
          then lines the replies up so you can see if any server is out of date. SOA stands for
          Start of Authority: it is the single record that carries a zone&apos;s version number and
          its timing settings.
        </p>
      </header>
      <SoaChecker initialName={first(params.name)} />
      <article className="dns-reference-content">
        <section>
          <h2>How the comparison works</h2>
          <p>
            Type a domain or hostname and run the check. We find the authoritative zone it belongs
            to, look up every nameserver&apos;s address, and ask each address directly for its SOA
            record. When a server answers the same way over IPv4 and IPv6, we keep those together
            in one row. When a server hands back a different serial or a different timing value, it
            gets its own row so the odd one out stands out.
          </p>
          <figure className="dns-answer-path">
            <div>
              <code>Your zone</code>
              <span aria-hidden="true">→</span>
              <code>ns1</code>
              <span aria-hidden="true">→</span>
              <code>ns2</code>
              <span aria-hidden="true">→</span>
              <code>Compare SOA</code>
            </div>
            <figcaption>Every nameserver for the zone is asked the same question, and the answers are compared side by side.</figcaption>
          </figure>
        </section>
        <section>
          <h2>What the serial tells you</h2>
          <p>
            Think of the serial as a version number for your zone. Every time you change your DNS,
            it should go up. When two nameservers show the same serial, they are almost certainly
            holding the same copy of your records. When the numbers differ, one server is behind,
            and the higher serial is the one a healthy secondary should catch up to.
          </p>
          <p>
            One catch: a smaller number is not always the older one. Serials are counters that roll
            back to zero after they reach 4,294,967,295, so a server that just wrapped can show a
            low number while actually being newest. To handle that, this page compares serials with
            DNS serial arithmetic rather than treating them as plain numbers.
          </p>
        </section>
        <section>
          <h2>What each SOA value means</h2>
          <div className="dns-table-scroll">
            <table className="dns-status-table">
              <tbody>
                <tr>
                  <th>Primary</th>
                  <td>The nameserver listed as the original source of the zone, the one every other server copies from.</td>
                </tr>
                <tr>
                  <th>Mailbox</th>
                  <td>The contact for the zone, written as a DNS name. Read the first dot as the <code>@</code> in an email address, so <code>admin.example.com</code> means <code>admin@example.com</code>.</td>
                </tr>
                <tr>
                  <th>Refresh</th>
                  <td>How often a secondary checks with the primary to see if anything changed.</td>
                </tr>
                <tr>
                  <th>Retry</th>
                  <td>How long a secondary waits before trying again after a failed check.</td>
                </tr>
                <tr>
                  <th>Expire</th>
                  <td>How long a secondary keeps serving its copy while it cannot reach the primary at all, before it gives up.</td>
                </tr>
                <tr>
                  <th>Negative cache</th>
                  <td>How long a resolver is allowed to remember that a name does not exist. It is the lower of the SOA TTL and the MINIMUM value.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section>
          <h2>When a mismatch is worth worrying about</h2>
          <p>
            A brief difference is normal. It usually just means a change is still spreading from the
            primary to the secondaries and has not landed everywhere yet. What deserves a closer
            look is a mismatch that outlasts the refresh and retry schedule, since by then every
            server should have caught up. If one is stuck, check whether it can reach the primary,
            whether zone transfers are allowed to it, and whether it is still meant to serve the
            zone at all. There is no single correct timing value, so this tool just shows you what
            differs instead of handing out a made-up grade.
          </p>
        </section>
      </article>
    </main>
  </AppShell>;
}
