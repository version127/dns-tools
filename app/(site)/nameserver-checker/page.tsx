import { AppShell } from "../../app-shell";
import { DnsToolsSidebar } from "../_dns-tools/dns-tools-sidebar";
import { NameserverChecker } from "./nameserver-checker";
import styles from "../_dns-tools/dns-diagnostics.module.css";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";

export default async function NameserverCheckerPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  return (
    <AppShell mainLabel="Nameserver Delegation Checker" menuLabel="DNS tools" sidebar={<DnsToolsSidebar active="nameserver" />} sidebarLabel="DNS tools sidebar">
      <main className={styles.main}>
        <header className="dns-page-header">
          <h1>Nameserver Delegation Checker</h1>
          <p>
            NS records name the servers that are supposed to answer for your domain. This tool
            follows the whole handoff: it asks the parent zone which nameservers it points to,
            asks those servers what your domain says about itself, compares the two lists, checks
            the glue addresses that make the handoff work, and tests each server directly over both
            UDP and TCP.
          </p>
        </header>
        <NameserverChecker initialName={first(params.name)} />
        <article className="dns-reference-content">
          <section>
            <h2>How to run the check</h2>
            <p>
              Enter a domain, or any hostname under it. The tool works out which zone is in charge,
              asks that zone's parent which nameservers it hands off to, then asks those
              nameservers what the zone says about itself. It also looks up every nameserver's IP
              address and talks to each server directly, so you learn more than a plain NS lookup
              would tell you.
            </p>
          </section>
          <section>
            <h2>How the handoff works</h2>
            <p>
              DNS is a chain of handoffs. No single server knows every domain, so each level points
              to the next. When someone looks up <code>example.com</code>, they start high up at the{" "}
              <code>com</code> zone, which does not hold your records but knows where to send the
              question. That pointing step is called delegation: <code>com</code> delegates{" "}
              <code>example.com</code> to your nameservers and steps out of the way. Your
              nameservers are the ones that actually hold the zone and answer for it, which is what
              authoritative means. They are the source, not a cache passing along someone else's
              copy.
            </p>
            <figure className="dns-answer-path">
              <div>
                <code>com</code>
                <span aria-hidden="true">→</span>
                <code>your nameservers</code>
                <span aria-hidden="true">→</span>
                <code>example.com zone</code>
              </div>
              <figcaption>
                The parent zone points at your nameservers, and your nameservers answer from inside
                your zone. Both sides should describe the same set of servers.
              </figcaption>
            </figure>
          </section>
          <section>
            <h2>What glue is and when you need it</h2>
            <p>
              There is a catch when a nameserver lives inside the zone it serves. If{" "}
              <code>ns1.example.com</code> is the server for <code>example.com</code>, a resolver
              cannot find <code>ns1.example.com</code> without first asking a server for{" "}
              <code>example.com</code>, which is the exact thing it is trying to reach. Glue breaks
              that loop: the parent zone publishes the IP address of <code>ns1.example.com</code>{" "}
              directly, so the resolver gets an address instead of a dead end. A nameserver that
              lives outside your zone, like <code>ns1.someprovider.net</code>, is found through
              normal lookups and does not need glue in your delegation.
            </p>
          </section>
          <section>
            <h2>Reading the result</h2>
            <p>
              When the parent's list and your zone's own list name the same servers, the handoff is
              consistent and resolvers will land where you expect. For each server, "Answered" means
              it replied on that address at all. "Authoritative SOA" is the stronger check: the
              server not only replied, it claimed authority for this zone, which is what you
              actually want from a nameserver.
            </p>
            <p>
              A server that shows up on only one side is the common warning sign. It usually means a
              provider move that was started but never finished: the new server was added in one
              place, or the old one was removed in one place, and the matching change never happened
              on the other side. Nothing breaks immediately, because resolvers may still reach a
              working server, but the delegation is now inconsistent and the odd server out is the
              first thing to reconcile.
            </p>
          </section>
          <section>
            <h2>Fixing a mismatch</h2>
            <p>
              Start at the parent side, which is your registrar's delegation, and compare it against
              the NS records at your DNS provider. Remove old servers from both places, add every new
              server to both places, and add the required glue before you switch to a nameserver that
              lives inside the zone. If a server is listed correctly but does not answer
              authoritatively, fix that server or drop it from the delegation rather than waiting for
              DNS caches to sort it out. A stale delegation does not heal on its own.
            </p>
          </section>
        </article>
      </main>
    </AppShell>
  );
}
