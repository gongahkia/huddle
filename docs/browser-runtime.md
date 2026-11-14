# Local browser runtime

Use Node 24.21.0, pnpm 10.33.0 and the frozen Playwright 1.65.0 dependency. Install its matching browsers with `pnpm exec playwright install chromium firefox webkit`. On supported CI Ubuntu hosts, `pnpm exec playwright install --with-deps chromium firefox webkit` supplies their system dependencies.

On the current Linux x86_64 development host, the cached Chromium 158.0.8127.18 and Firefox 159.0 launch normally. WebKit's Ubuntu build needs ICU 74 and the libxml2.so.2 ABI, which are absent from that host. An optional **private test-only** compatibility runtime avoids changing system libraries or the shared Playwright cache:

```sh
pnpm fixtures:webkit
HUDDLE_WEBKIT_EXECUTABLE="$PWD/output/runtime/webkit-compat-1/webkit" pnpm test:browser
```

Preparation downloads only the following pinned Ubuntu AMD64 packages, verifies SHA-256 and extracts their data into ignored output/runtime/webkit-compat-1. It runs no package installation/maintainer scripts. The launcher supplies the private library path to the existing WPE browser binary; its sandbox settings are unchanged. Preparation and reuse both launch the browser and verify a page/button interaction. Cached library and launcher hashes, source browser location and an ownership marker are checked before reuse. Unverified existing directories are rejected; cleanup removes only a newly created runtime with this invocation's nonce.

| Package | SHA-256 |
| --- | --- |
| libicu74 74.2-1ubuntu3.1 | c9a70989678660eed9a1e904c74fa043da8bec8e2036856fc16e31ced79b04f8 |
| libxml2 2.9.14+dfsg-1.3ubuntu3.10 | c5a065f85c1e6f605741e365e40cad71c3ceb0e85e2791400bd35b8896e12ad1 |

The hashes were independently matched against Ubuntu's [noble-updates package index](https://archive.ubuntu.com/ubuntu/dists/noble-updates/main/binary-amd64/Packages.xz); downloads use the official [ICU](https://archive.ubuntu.com/ubuntu/pool/main/i/icu/) and [libxml2](https://archive.ubuntu.com/ubuntu/pool/main/libx/libxml2/) pools. The script needs ar and bsdtar. It is optional on supported native hosts and does not claim support for other operating systems, architectures or browser builds. Clear the executable override to use Playwright's normal launcher. Browser results and limitations belong in the progress record; a successful runtime probe alone does not establish application acceptance.
