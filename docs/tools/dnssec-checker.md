# DNSSEC Chain Checker

DNSSEC Chain Checker validates one ordinary DNS answer cryptographically from the root trust anchor. It uses the pure-TypeScript Namefi DNSSEC Audit validator and returns `secure`, `insecure`, `bogus`, or `indeterminate`.

The verdict is never inferred from a resolver's AD flag. A secure result can be a signed positive answer, a signed proof that the requested type is absent, or a signed proof that the name does not exist. An insecure result is a proven unsigned delegation rather than a broken signed chain.

The result shows the validator's ordered walk, the requested answer, DS and DNSKEY evidence for each zone, and every RRSIG validity window used by the validator. Each signature keeps its own inception, expiration, covered type, signer, algorithm, key tag, and remaining time.

Unsupported algorithms, incomplete network work, or a validator failure return `indeterminate` instead of guessing. The complete structured validator report can be downloaded as JSON.
