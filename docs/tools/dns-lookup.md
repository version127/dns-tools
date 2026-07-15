# DNS Lookup

DNS Lookup shows the records currently returned for an exact name. Choose one record type when you know what you need, or leave All selected to run separate A, AAAA, CNAME, MX, NS, TXT, CAA, SOA, SRV, DS, and DNSKEY questions. It never sends an ANY query.

Public resolver choices are Cloudflare, Google Public DNS, Quad9, OpenDNS, AdGuard DNS, Control D, and Yandex DNS. Authoritative mode discovers and queries a server that hosts the zone. PTR is a separate reverse lookup and requires an IPv4 or IPv6 address.

The result preserves the actual owner name of every terminal record. CNAME edges are deduplicated into one alias path only when separate questions agree. Inconsistent aliases, loops, and excessive depth remain visible as warnings.

`Resolver TTL` is the remaining cache lifetime reported by the selected recursive resolver. It can be lower than the TTL configured by the domain owner. A direct authoritative result is labeled `Authoritative TTL`.

Returned A and AAAA addresses can include best-effort ASN and announced-prefix context. Nameserver hostnames can include separately resolved addresses, but those addresses are not automatically called glue. Each record section keeps its own raw provider response, and the complete result can be exported as CSV.

A TXT lookup for `_dmarc.example.com` returns the TXT value. It does not validate DMARC policy.
