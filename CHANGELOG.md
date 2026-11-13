# Changelog

All notable changes to BRouter are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### Fixed

- Share identical concurrent directions requests within one routing process. Canceling a request leaves other riders’ requests active. Only validated routes enter the cache.
