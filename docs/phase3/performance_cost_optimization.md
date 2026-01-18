# Phase 3: Performance Hardening + Cost Optimization

## Baseline Metrics
- API latency: P50/P95/P99 per endpoint
- Error rate: 4xx/5xx by route
- DB latency: query timings on catalog/search
- Queue depth: ingestion processing backlog

## Caching Strategy (Initial)
- Catalog search: in-memory cache with 30s TTL
- Playlist endpoints: cache 15s for anonymous traffic
- Invalidation on catalog updates and stem processing

## Cost Hotspots
- Large audio uploads (storage + egress)
- Stem processing compute
- Analytics ingestion volume
- On-chain transaction retries

## Budget Targets
- Storage cost per published track under $0.10/mo
- Stem processing under $0.05 per minute of audio
- API serving under $0.002 per request

## Load Test Plan
- Scenario: 100 concurrent uploads + 500 concurrent catalog searches
- Scenario: 1k session starts per minute
- Duration: 20 minutes per test run
- Success: P95 latency < 1s, error rate < 1%

## Next Steps
- Add Redis cache for catalog and session state
- Add CDN for static assets and audio previews
- Enable DB connection pooling
