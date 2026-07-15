# Privacy

DNS Tools does not need accounts and does not store lookup history in a database.

The name entered by a visitor leaves the installation when the selected job requires it:

- Public lookups send it to the selected DNS resolver.
- Authoritative and trace checks send questions to the relevant public nameservers.
- Nameserver-address lookups use Cloudflare as a fixed bootstrap resolver.
- Public returned addresses may be placed in Team Cymru DNS query names to retrieve ASN and announced-prefix context.
- The browser may request `https://<hostname>/favicon.ico` directly for website-style names.

The included application does not require analytics. A self-hoster's Node process, container platform, reverse proxy, firewall, resolver, and operating system may still keep their own logs. Review those systems if queried domain names are sensitive.

Raw DNS responses remain in the visitor's rendered result and downloads. They are not written by the application after the request finishes.
