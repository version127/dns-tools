import { AppShell } from "../../app-shell";
import { DnsToolsSidebar } from "../_dns-tools/dns-tools-sidebar";
import { DnsChangeChecker } from "./dns-change-checker";
import { CHANGE_RECORD_TYPES, type ChangeRecordType } from "@/lib/dns/diagnostic-types.ts";
import styles from "../_dns-tools/dns-diagnostics.module.css";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";

function initialType(value: string): ChangeRecordType {
  const upper = value.toUpperCase();
  return CHANGE_RECORD_TYPES.includes(upper as ChangeRecordType) ? upper as ChangeRecordType : "A";
}

export default async function DnsChangeCheckerPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  return (
    <AppShell mainLabel="DNS Change Checker" menuLabel="DNS tools" sidebar={<DnsToolsSidebar active="change" />} sidebarLabel="DNS tools sidebar">
      <main className={styles.main}>
        <header className="dns-page-header">
          <h1>DNS Change Checker</h1>
          <p>You changed a DNS record and now you want to know if the internet has caught up. This tool asks the source of truth, your domain's own nameservers, whether the change is live, then checks the big public resolvers to see which ones are still handing out the old cached answer. You get the authoritative records, the cached answers, the TTLs, and the raw responses side by side.</p>
        </header>
        <DnsChangeChecker initialName={first(params.name)} initialRecordType={initialType(first(params.type))} />
        <article className="dns-reference-content">
          <section>
            <h2>How to check a DNS change</h2>
            <p>Enter the exact domain or hostname you changed, choose the record type, and run the check. If you know the new value, add it as the expected answer so the tool can tell you at a glance which servers match it. We ask your domain's authoritative nameservers first, then compare their answer with Cloudflare, Google, Quad9, and the other public resolvers available in the lookup tool.</p>
            <p>People often call this a DNS propagation check. DNS does not push one change across the world all at once. Your nameservers publish the new answer, then each resolver replaces its cached copy when that copy is ready to refresh. This page shows those two parts separately so you can tell whether the source is correct or a cache is simply old.</p>
          </section>
          <section>
            <h2>Authoritative source versus a resolver cache</h2>
            <p>Authoritative nameservers are the source of truth for your domain: they are the servers your DNS provider runs, and they hold the real records. A public resolver, like the one at 1.1.1.1 or 8.8.8.8, does not hold your records. It asks the authoritative servers once, keeps a copy of the answer for a while, and hands that copy to everyone who asks in the meantime. That saved copy is the cache. It is why a change can be live at the source and still look old to you: you are seeing a resolver's copy, not the source.</p>
            <figure className="dns-answer-path">
              <div>
                <code>Your nameservers</code>
                <span aria-hidden="true">→</span>
                <code>Resolver cache</code>
                <span aria-hidden="true">→</span>
                <code>You</code>
              </div>
              <figcaption>The source publishes the change first. Each resolver keeps its own cached copy, so it can lag behind for a while before it asks again.</figcaption>
            </figure>
            <p>If all of your authoritative servers return the new record, your DNS provider is publishing the change consistently and the rest is just caches expiring. If those authoritative servers disagree with each other, fix that first. Waiting on caches will not make an inconsistent source correct.</p>
          </section>
          <section>
            <h2>What TTL means and how to read Resolver TTL</h2>
            <p>TTL, short for time to live, is roughly how long a resolver is allowed to keep reusing an answer before it has to check with the source again. A record set to 300 means five minutes; one set to 86400 means a day. When you shorten a TTL before a change, resolvers refresh sooner, so the change spreads faster. But the shorter TTL only takes effect after the old cached copy, with its old TTL, has expired.</p>
            <p>Resolver TTL in the results is the time that resolver says is left on its current cached copy. A smaller number usually means it is close to refreshing, but treat it as a hint, not a guaranteed countdown. A resolver can refresh early, keep serving a stale answer if the source is unreachable, or answer from a different location than the one you reached a moment ago.</p>
          </section>
          <section>
            <h2>When different answers are normal</h2>
            <p>Not every difference means a change is stuck. Large services return different A or AAAA records depending on where the request comes from, so two resolvers can each be correct while showing different addresses. Some providers rotate addresses between replies on purpose. The order of MX, NS, and TXT records can also shift from one answer to the next without the actual set of records changing. This checker ignores order when it compares, but it only measures the resolvers it asks. It does not claim to see DNS everywhere in the world.</p>
          </section>
        </article>
      </main>
    </AppShell>
  );
}
