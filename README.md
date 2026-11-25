# IP Address Lookup & Network Tools

**Live site:** https://ip.digdevbox.com/  
**Repository:** https://github.com/yqh-core/ip-locator  
**Portfolio status:** Maintenance / selective growth. Keep fixes evidence-led; do not assume this repository is a Tier A feature-expansion target.

IP Locator is an English-first browser tool for looking up your public IP or a specified IPv4/IPv6 address. It also includes IP address classification, IPv4/IPv6 CIDR calculations, DNS and reverse-DNS utilities.

## Features

- Detect your current public IP and look up a specified IPv4 or IPv6 address.
- Display approximate country, region, city, postal code, coordinates, time zone, ASN, ISP and organization when upstream data provides them.
- Show the responding data source and preserve source/provenance fields.
- Copy individual values and inspect normalized JSON.
- Keep recent lookup history in the browser.
- Classify special-purpose, private, loopback, link-local and global address ranges.
- Calculate IPv4 and IPv6 networks and subnets locally in the browser.
- Query DNS records and reverse DNS through Cloudflare DNS-over-HTTPS.
- Responsive interface with English-first page metadata and shared DigDevBox shell styling.

Geolocation is approximate network-registration data, not a device's precise physical location. VPNs, proxies, mobile carriers and CDNs can make the reported location differ from the end user's location.

## Data flow, providers and privacy

The implementation has two IP-geolocation paths:

1. **Lookup of the visitor's own IP:** the Pages Function reads Cloudflare request metadata (`request.cf`) when the required fields are available. If that metadata is insufficient, the server may fall back to the configured upstream providers.
2. **Lookup of a specified IP:** the Pages Function checks its edge cache, then concurrently requests the configured upstreams and uses the first valid response. The current server-side upstream list in `functions/api/ip.js` contains **ipwho.is** and **ipinfo.io**. The response includes source attribution. The browser adapter in `js/ip-sources.js` also contains direct-provider fallback paths for cases where the Pages Function is unavailable.

The code currently sets a one-hour cache for specified-IP results and a shorter cache for visitor self-lookups. Verify the current source before changing cache behavior or making retention claims.

**Provider terms are not interchangeable with code availability.** The repository's historical notes record a concern about commercial-use terms for anonymous/free provider tiers, but this README does not certify that either provider's current terms authorize every use case. Before changing providers, enabling additional traffic, or making commercial-compliance claims, review the providers' current official terms/pricing and obtain any required plan or written permission. Do not re-enable `ipapi.co` without a documented authorization decision.

Privacy and release checks:
- The IP address being looked up is sent to the selected geolocation provider(s); this is necessary for third-party lookup.
- DNS questions are sent to Cloudflare's public DNS-over-HTTPS endpoint.
- The app includes analytics and advertising integrations in its HTML/runtime. Review the consent implementation and current privacy policy before changing tracking or third-party scripts.
- Lookup history and client information are handled in browser code; inspect the current implementation before making absolute claims about local storage or data retention.
- Never add credentials, personal data or provider secrets to the repository.

## Repository structure

```text
.
├── index.html                 # Main lookup interface
├── about.html                 # About page
├── privacy.html               # Privacy policy
├── terms.html                 # Terms
├── contact.html               # Contact page
├── faq.html                   # FAQ
├── guides.html                # Guides
├── docs.html                  # Documentation
├── ip-address-lookup/         # English search landing page
├── ip-geolocation/            # Geolocation landing content
├── css/                       # Site and shared-shell styles
├── js/
│   ├── app.js                 # UI, events and result rendering
│   ├── ip-sources.js          # IP providers, validation and normalization
│   ├── net-tools.js           # IP classification, CIDR and DNS logic
│   └── ...
├── functions/
│   └── api/ip.js              # Cloudflare Pages Function for IP lookup
└── scripts/
    └── build.mjs              # Explicit Cloudflare Pages dist/ assembly
```

The Pages build script uses an allowlist to assemble `dist/`, checks required files, excludes backup/temp files, checks Pages file-size/count limits and rejects internal links ending in `.html`. Keep the allowlist synchronized when adding publishable files or routes.

## Local development and preview

This repository is a static HTML/CSS/JavaScript project with a Cloudflare Pages Function. No root `package.json`, lockfile or npm test/build scripts were found during the README audit. Do not document `npm install`, `npm test` or `npm run build` as supported commands unless a package manifest is added and verified.

For a simple static UI preview, use Python 3 from the repository root:

```bash
python -m http.server 8000
```

Open http://localhost:8000 and stop the server with Ctrl+C.

**Important:** this static server does not execute `functions/api/ip.js`. The `/api/ip` route, Cloudflare request metadata, edge cache and DNS/network behavior must be verified in a Cloudflare Pages-compatible local environment or on an authorized Preview deployment. A static preview is not a production test.

## Build output

When Node.js is available, the repository's explicit packaging script can assemble the static Pages output:

```bash
node scripts/build.mjs
```

Expected output is `dist/`. The script is not a substitute for the Cloudflare Pages deployment pipeline and does not itself publish the site. Review its allowlist and inspect the resulting directory before deployment.

## Maintenance and verification checklist

Before changing code:

1. Check the default branch, working tree, recent commits, open PRs and current execution-board task.
2. Read the relevant HTML, JavaScript, CSS, Pages Function and build allowlist.
3. Preserve the separation between UI (`js/app.js`), provider normalization (`js/ip-sources.js`), network tools (`js/net-tools.js`) and server lookup (`functions/api/ip.js`).
4. For IP validation, test valid/invalid IPv4 and IPv6, compressed IPv6, IPv4-mapped IPv6, private/special-purpose ranges and malformed inputs.
5. For geolocation, test visitor self-lookup, specified-IP lookup, cache hit/miss, each upstream failing, malformed responses, timeout and source attribution.
6. For CIDR and DNS, test IPv4/IPv6 boundaries, /0 and host prefixes, invalid masks, common DNS record types, PTR and upstream failure.
7. Check mobile and desktop layouts, keyboard operation, error/retry states, copy controls and local history behavior.
8. Inspect browser Network activity and consent behavior when modifying analytics, advertising, provider requests or DNS.
9. Verify the Pages Function and production domain separately from static preview; record the exact commit and deployment evidence.

No automated test suite or package-manager workflow was confirmed during this documentation audit. Record any test commands actually discovered and executed; do not infer a pass from a successful static preview or packaging script.

## Deployment boundary

The repository contains a Cloudflare Pages Function and a custom `dist/` assembly script. Deployment should use the authorized Cloudflare Pages project configuration and the exact intended build output. Do not use the generic Nginx/Docker snippets from older README revisions as the canonical production procedure; they do not reproduce the Pages Function runtime or `request.cf` behavior.

Before release, confirm:
- Cloudflare Pages project, build command and output directory.
- Pages Function routing for `/api/ip`.
- Production domain and HTTPS response.
- Exact deployed commit / deployment identifier.
- Self-lookup and specified-IP lookup against real upstream behavior.
- Privacy, consent, provider terms and attribution.
- Rollback target and owner authorization.

## License and third-party notices

The repository includes an MIT license and a notice that portions are derived from `mzlong/ip`, also MIT-licensed. Preserve the upstream attribution when modifying or redistributing those portions. Review the `LICENSE` file before changing licensing or distribution terms.

## Related DigDevBox tools

- [DigDevBox Developer Toolbox](https://digdevbox.com/)
- [DigImg Image Compressor](https://img.digdevbox.com/)
- [StreamPlay HLS Player](https://play.digdevbox.com/)
