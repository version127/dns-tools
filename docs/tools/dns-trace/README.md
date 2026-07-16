# DNS Trace Explorer

DNS Trace Explorer follows one question from reviewed DNS root-server addresses through referrals until it reaches an answer or a useful stopping point. It performs genuine non-recursive DNS queries rather than assembling a path from recursive resolver responses.

Choose one record type. A trace deliberately does not offer All, ANY, PTR, or a public resolver picker.

Every step records the server and address contacted, the exact question name and type, response code, time, referral zone, nameservers, actual referral glue, other supplied nameserver addresses, answer records, failed attempts, authority status, and raw response.

When a non-CNAME question returns only an alias, the trace starts another iterative walk for that target. Alias loops, referral depth, nested nameserver resolution, server attempts, and total questions are bounded.

The trace shows the path seen from this DNS Tools server. It does not show a visitor's ISP cache, geography, or worldwide propagation. It can display DNSSEC records but does not validate their signatures; DNSSEC Chain Checker does that separately.
