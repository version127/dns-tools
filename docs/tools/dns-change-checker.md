# DNS Change Checker

DNS Change Checker compares the source of a DNS record with the copies currently held by reviewed public resolver caches. Enter one name and one record type. You can also provide the new value you expect.

The tool discovers the zone and asks every reachable authoritative address before asking the public resolvers. Authoritative observations always appear first. Record sets are compared without treating order as meaningful, and aliases and owner names remain intact.

A different resolver answer is evidence of a different cached value, not proof of worldwide propagation or a broken resolver. When authoritative replies differ, the record set returned by the largest number of usable authoritative sources becomes the resolver comparison baseline. The first server to answer never gets special weight. Location-aware A and AAAA answers can also differ legitimately.

Repeated sources with the same record set are grouped without discarding source names, addresses, TTL values, errors, or raw responses. Resolver TTL and Authoritative TTL remain separate concepts. The complete comparison and raw evidence can be downloaded as JSON.
