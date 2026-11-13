# Changelog

All notable changes to BRouter are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### Fixed

- Share identical concurrent directions requests within one routing process. Canceling a request leaves other riders’ requests active. Only validated routes enter the cache.
- Keep the correct traversal at crossings and retraced segments. Arrival now also checks distance remaining along the active route.

### Changed

- Prepare v0.1.1 for the navigation fixes and check version consistency in CI.

- Document the in-app bike-share journey, server-side routing setup, and physical-device verification limits in the README and operating guide.
