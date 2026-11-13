# Changelog

All notable changes to BRouter are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- Show the trip planner and in-app directions in the README with screenshots captured from BRouter.

## [0.1.1]

### Fixed

- Share identical concurrent directions requests within one routing process. Canceling a request leaves other riders’ requests active. Only validated routes enter the cache.
- Keep route progress on the correct traversal at crossings and retraced segments, including when location fixes are closely spaced. Arrival now also checks distance remaining along the active route.

### Changed

- Prepare v0.1.1 for the navigation fixes and check version consistency in CI.
- Document the in-app bike-share journey, server-side routing setup, and physical-device verification limits in the README and operating guide.

[0.1.1]: https://github.com/ant0n-grachev/BRouter/commit/bcfdbd4cfd0568aaa11cf90b3ee83cdc371ef96c
