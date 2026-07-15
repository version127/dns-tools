# Nameserver Delegation Checker

Nameserver Delegation Checker inspects the handoff from the parent zone to the authoritative servers. It finds the closest delegated zone, compares the parent NS set with the child NS set, and checks every public server address over UDP and TCP.

A reachable address is not enough. The server must return an authoritative SOA for the delegated zone.

The result distinguishes required in-zone glue, optional sibling glue, and out-of-bailiwick nameserver addresses that do not need glue in that referral. It compares referral glue with A and AAAA records published by the authoritative zone and keeps direct transport evidence separate.

Shared IP addresses are visible warnings. Shared ASNs or announced prefixes are context, not a health score. Parent, child, address, UDP, and TCP raw responses remain available, and the result can be exported as CSV.
