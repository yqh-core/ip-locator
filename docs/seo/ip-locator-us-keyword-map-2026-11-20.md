# IP Locator US/EU SEO keyword map and technical backlog — 2026-11-20

Status: source-verified intent map. Candidate terms are not search-volume or ranking claims. This pass does not claim production crawl, indexing or traffic improvement.

## Market rules
- Target US first, then English-speaking Europe; English-first.
- Map keywords to existing useful pages. Do not create thin doorway pages.
- Geolocation copy must say approximate/estimated; IP lookup does not identify a person or exact physical address.
- Distinguish lookup of the visitor's own IP (Cloudflare edge metadata) from a manually entered public IP (third-party IP data providers).
- Distinguish geolocation lookup from local CIDR calculation and DNS/reverse-DNS queries.

## Verified URL and intent map

The repository sitemap currently contains six URLs:

| URL | Intended query intent | Primary candidate | Supporting candidates |
|---|---|---|---|
| https://ip.digdevbox.com/ | Interactive IP lookup + network utilities | IP geolocation lookup | IP lookup; IPv4 lookup; IPv6 lookup; ASN lookup; ISP lookup; DNS lookup; reverse DNS lookup |
| https://ip.digdevbox.com/ip-address-lookup/ | Practical lookup guide | IP address lookup | how to look up an IP address; public IP lookup; IPv4 address lookup; IPv6 address lookup; IP address location lookup |
| https://ip.digdevbox.com/ip-geolocation/ | Geolocation explainer | IP geolocation lookup explained | how IP geolocation works; IP location accuracy; IP geolocation accuracy; does IP lookup show exact location |
| https://ip.digdevbox.com/docs | Network concepts reference | IP address guide | IPv4 vs IPv6; CIDR explained; what is ASN; public vs private IP; PTR record |
| https://ip.digdevbox.com/guides | Task-oriented tutorials | IP lookup guides | how to check your public IP; find ISP from IP; check ASN; troubleshoot inaccurate IP location |
| https://ip.digdevbox.com/faq | Question-based support | IP lookup FAQ | can IP lookup find exact address; VPN IP location; private IP lookup; IPv6 lookup accuracy; IP lookup privacy |

The homepage source describes public IPv4/IPv6 lookup, location, ISP/ASN, CIDR, DNS and rDNS. The /ip-address-lookup/ and /ip-geolocation/ pages are both present in the sitemap and both target broad IP lookup/geolocation intent. Keep their roles distinct: practical step-by-step lookup vs explanatory geolocation accuracy. Review GSC query/page overlap before deciding whether to consolidate or redirect either URL.

## Important source observations
1. ip-address-lookup/index.html has a self-canonical to /ip-address-lookup/, a distinct practical how-to page, and current sitemap lastmod 2026-11-20.
2. ip-geolocation/index.html has a self-canonical to /ip-geolocation/, a geolocation explainer, and sitemap lastmod 2026-11-19.
3. Homepage title is IP Geolocation Lookup — IP Address, ASN & DNS | DigDevBox; H1 is IP Geolocation Lookup.
4. docs.html, guides.html and faq.html have distinct English titles, descriptions, H1s and self-canonicals.
5. about.html is Chinese-language (zh-CN), noindex, follow, and not in the sitemap. Do not include it in English search landing-page expansion unless intentionally localized and technically reviewed.
6. robots.txt allows crawling and references the canonical sitemap.
7. Homepage JSON-LD declares a WebApplication and describes IPv4/IPv6, CIDR, DNS/rDNS, local client information and browser-local lookup history.
8. Source templates contain repeated defer inclusion of /analytics-consent.js in some pages. Verify whether deployed HTML still has duplicates and whether the script guards repeat initialization before changing it; this is a tracking correctness issue, not a keyword change.
9. The functions/api/ip.js source documents two different data paths: visitor self-lookup uses Cloudflare request metadata; arbitrary public IP lookups call ipwho.is and ipinfo.io. Avoid blanket claims that all lookups are local or never leave the site.
10. CIDR calculation is local; DNS lookups use Cloudflare DoH. Explain each data path separately.

## Candidate long-tail clusters
These are semantic variants for page copy and GSC comparison, not verified volume:
- ip address lookup by ip; look up public ip address; ipv4 address lookup; ipv6 address lookup
- ip geolocation lookup; ip location lookup; ip address location; find isp from ip; asn lookup
- ip geolocation accuracy; how accurate is ip geolocation; can an ip address show exact location; ip lookup city accuracy
- cidr subnet calculator; ipv6 cidr calculator; calculate ipv4 subnet; what is an asn
- dns lookup online; reverse dns lookup; ptr record lookup; check a record; aaaa lookup
- what is my public ip; check my public ip address; find my ip address

## Technical SEO and content backlog

P0 — verify production behavior before changing copy:
1. Crawl all six sitemap URLs and record HTTP status, final URL, canonical, robots, title, description, H1, structured data and internal links.
2. Confirm /ip-address-lookup/ and /ip-geolocation/ both return 200 and their self-canonicals are correct. Compare GSC queries and landing-page performance to decide whether intent separation is sufficient.
3. Confirm the generated sitemap is reachable at /sitemap.xml, includes exactly the intended indexable URLs, and contains no staging/redirecting URLs.
4. Verify Googlebot and ordinary browser receive equivalent crawler-visible HTML for title, description, H1 and canonical.
5. Check whether duplicated analytics-consent script tags are present in production. Inspect script idempotence and GA4 event counts before removing any inclusion.

P1 — improve intent clarity without creating thin pages:
1. Homepage: keep tool-first copy; clarify that results vary by source and geolocation is approximate. Use descriptive links to lookup guide, docs, guides and FAQ.
2. /ip-address-lookup/: make the user workflow the main content; link back to the live input and explain IPv4/IPv6, ASN/ISP and source attribution.
3. /ip-geolocation/: focus on methodology, accuracy limits, VPN/CDN/ISP egress and why databases disagree. Avoid repeating the practical lookup guide.
4. Docs: link from concept definitions to the relevant tool controls and task guides.
5. Guides: each tutorial should have a distinct task and link to the relevant tool section.
6. FAQ: use concise direct answers and link to the detailed guide or docs where appropriate.

P2 — data-driven optimization:
1. Pull GSC page + query + country data for ip.digdevbox.com (last 28 and 90 days) and Bing Webmaster page/query data (last 28 days).
2. Compare impressions, clicks, CTR and average position for the two lookup landing pages and the homepage. Use actual query-to-page associations to confirm cannibalization or separation.
3. Prioritize titles/descriptions only where impressions exist and CTR is weak; don't rewrite metadata solely from keyword suggestions.
4. Track index coverage, discovered/crawled-not-indexed, duplicate canonical, and sitemap processing in GSC.

## Evidence boundaries
- Source inspected 2026-11-20: index.html, ip-address-lookup/index.html, ip-geolocation/index.html, docs.html, guides.html, faq.html, about.html, sitemap.xml, robots.txt, and functions/api/ip.js.
- Search-volume, ranking, indexing, backlink and traffic evidence for this domain was not retrieved in this pass.
- All keyword phrases above are candidate intent variants only.
- No production metadata or URL behavior is claimed verified by source inspection alone.
