# CAA Policy Checker

CAA Policy Checker finds the effective certificate authority policy for the exact hostname a certificate will cover.

It checks the requested name, follows an alias target exactly when needed, and then resumes the parent search from the original certificate name. It stops at the first non-empty CAA record set. A failed level makes the policy undetermined instead of being silently skipped.

Normal and wildcard issuance are explained separately. `issuewild` overrides `issue` for wildcard certificates. Without `issuewild`, `issue` applies to both. A policy containing only `issuewild` does not restrict normal issuance.

The result preserves empty issuer values, multiple allowed issuers, the critical flag, unknown tags, malformed records, and `iodef` syntax. It validates an `iodef` destination's format without contacting it. This is a policy check, not certificate history or a promise that an allowed authority will issue.
