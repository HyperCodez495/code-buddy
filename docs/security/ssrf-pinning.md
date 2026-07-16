# SSRF DNS pinning

Outbound HTTP(S) requests resolve and validate every address for a hostname before connecting. The fetch then uses a per-request Undici dispatcher whose DNS lookup returns one of those validated addresses, so a later DNS response cannot redirect the connection to a private, loopback, link-local, or metadata address. Every redirect target is independently resolved, validated, and pinned.

IP literals and configurations with DNS resolution disabled keep the existing direct-fetch path because no second hostname resolution can be rebound. Explicitly trusted hosts also retain their allowlisted behavior. Dispatcher creation fails closed: a hostname with validated addresses is never fetched without pinning if the dispatcher is unavailable.

Pinning covers DNS rebinding between validation and connection while preserving the original hostname for HTTP `Host` and TLS SNI. It does not replace redirect validation, IP-range classification, TLS certificate verification, proxy policy, or application-level response limits.
