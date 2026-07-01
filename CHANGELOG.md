# Changelog

## [1.0.2] - 2026-07-01
### Fixed
- Popup no longer flashes "Loading AI model…" unnecessarily on cold 
  starts when the bookmark index is already cached and up to date.
  The embedding pipeline now loads lazily on first search rather than 
  eagerly on every service worker respawn (#1).

## [1.0.1]
- Initial release improvements.