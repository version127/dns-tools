# Contributing

Thanks for helping make DNS Tools more accurate and useful.

## Before you start

Open an issue before making a large behavioral change. DNS output can look plausible while still being technically wrong, so changes to TTL wording, CNAME handling, CAA inheritance, delegation, DNSSEC validation, or authoritative querying need a clear test case.

## Local setup

```bash
npm install
npm run dev
```

Open `http://localhost:1273`.

## Checks

Run the complete local gate before opening a pull request:

```bash
npm run quality
```

Unit tests should use injected transports or recorded DNS structures instead of depending on a live resolver. Live DNS checks belong in manual verification or scheduled smoke tests because outside networks can fail independently of the code.

## Writing and interface

Keep explanations direct and human. Functional form labels and table headings are useful. Decorative labels, health scores, worldwide propagation claims, and large caveat panels are not.

## Security

Do not open a public issue for a vulnerability that could expose a self-hoster or turn the service into a network proxy. Follow `SECURITY.md` instead.
