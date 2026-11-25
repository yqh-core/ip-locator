# IP Locator — Developer handoff

**Site:** https://ip.digdevbox.com  
**Repository:** https://github.com/yqh-core/ip-locator  
**Portfolio role:** MAINTAIN / selective growth — preserve core lookup, CIDR, IPv6 and DNS workflows; prioritize reliability and concrete user value.

## Product workflows

- Look up IPv4 and IPv6 address information, including available location, ISP, ASN, organization and timezone fields.
- The self-IP path uses Cloudflare edge-provided request data; arbitrary-IP lookups use upstream geolocation providers, with the actual data source surfaced in the UI.
- CIDR/subnet calculations run locally in the browser, including IPv4 and IPv6 calculations.
- DNS and reverse-DNS workflows depend on their configured lookup path; inspect source and Network requests before changing privacy claims.

Do not describe all IP lookups as local-only. Third-party/upstream lookup requests are part of the product's data flow.

## Local preview

The repository README describes the frontend as static ES modules and notes that opening `index.html` directly via `file://` is not supported. No root `package.json` was found in the handoff check, so no npm build/test scripts are documented.

Run from the repository root:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/`. Some lookup paths may require the configured Pages Functions or upstream services and therefore cannot be fully validated by a static local server alone.

## Maintenance checklist

- [ ] Check current issue/PR and exact branch/head before editing.
- [ ] Preserve IPv4/IPv6 parsing, CIDR boundaries and large IPv6 address-count behavior.
- [ ] Test valid, invalid, private, reserved and boundary IP inputs.
- [ ] Check lookup provider failure/fallback and clearly identify the data source.
- [ ] Test DNS/reverse-DNS errors and timeouts.
- [ ] Verify mobile layout and copyable result fields.
- [ ] Inspect Network activity and ensure privacy copy matches actual lookup behavior.
- [ ] Record exact commit, reproducible checks, Preview and production evidence separately.

## Scope and release boundaries

This is a maintenance/selective-growth product, not a Tier A expansion target. Do not add broad features without evidence. Verify the Cloudflare Pages project, exact deployment SHA and official domain through current authorized evidence before calling a release production-verified. No DNS or account-level changes are authorized by this guide.