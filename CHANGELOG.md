# Changelog

## [Unreleased]

## [1.0.2] - 2026-07-01
### Fixed
- Popup no longer flashes "Loading AI model…" unnecessarily on cold
  starts when the bookmark index is already cached and up to date.
  The embedding pipeline now loads lazily on first search rather than
  eagerly on every service worker respawn.
  ([#7](https://github.com/daveshenal/findmark/issues/7), [#9](https://github.com/daveshenal/findmark/pull/9))

## [1.0.1] - 2026-06-02
### Fixed
- Initial release improvements.

## [1.0.0] - 2026-06-01
### Added
- Test release.
