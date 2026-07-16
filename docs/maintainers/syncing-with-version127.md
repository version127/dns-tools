# Synchronizing with Version127

The public `version127/dns-tools` repository is maintained from the private Version127 application repository. Its local source tree lives at `repos/dns-tools`.

## Ownership boundary

The synchronization command copies only reviewed shared code:

- `lib/dns`;
- `app/api/dns`;
- DNS engine unit tests.

The public repository owns its flat page routes, header and footer, indexing defaults, Docker files, public CI, screenshots, and public documentation. Those files are not overwritten by the core sync.

This is intentionally one-way. Do not run a blind directory copy in either direction.

## Preparing an update

From the private Version127 repository:

```bash
npm run version127:dns-tools:sync
npm run version127:dns-tools:sync-check
npm --prefix repos/dns-tools run quality
```

Review the complete `repos/dns-tools` diff. Confirm that no environment files, credentials, internal hostnames, database values, deployment tokens, or private-only documentation are present.

## Publishing

The public target is always `version127/dns-tools` on `main`. The private application remains under the maintainer's personal GitHub account.

The Version127 publishing script verifies the repository configuration, sync state, tracked-file boundary, and common secret patterns before creating a subtree commit for `repos/dns-tools` and pushing that commit to the public repository.

Public releases should update `CHANGELOG.md` when behavior changes. A documentation-only synchronization does not require a version bump unless maintainers are preparing a tagged release.
