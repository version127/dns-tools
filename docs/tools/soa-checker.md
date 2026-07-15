# SOA Consistency Checker

SOA Consistency Checker asks every authoritative nameserver address for the zone's SOA record and compares the answers.

It keeps MNAME, RNAME, serial, refresh, retry, expire, minimum, and SOA TTL visible. Serial ordering follows RFC 1982 arithmetic so a wraparound does not make a newer serial appear older.

Identical IPv4 and IPv6 observations from one nameserver may be grouped. Different serials or different SOA values always remain separate. The negative-cache value is the lower of the SOA record TTL and the MINIMUM field; MINIMUM alone is not presented as a guaranteed cache time.

The tool reports agreement and exact differences without inventing universal ideal timing ranges or a zone score. Every per-address observation and raw response can be exported.
