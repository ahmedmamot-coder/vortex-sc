#!/bin/bash
#
# Vortex SC — what a session needs before it can do anything useful.
#
# The app is not at the repository root: it lives in vortex-app/, and npm run test, npm run lint
# and next build all have to be run from there. A session that does not know that spends its first
# few minutes finding out, usually by running npm test at the root and getting ENOENT.
#
# Everything here is idempotent and non-interactive, and it runs only in Claude Code on the web —
# on a laptop the dependencies are already installed and this would just be a slow no-op.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

APP="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}/vortex-app"

cd "$APP"

# npm install rather than npm ci: the container image is cached after this hook completes, and
# install reuses what is already there. ci deletes node_modules first and re-downloads every time.
echo "vortex-sc: installing dependencies in vortex-app/"
npm install --no-audit --no-fund

# Playwright's browsers are pre-installed in this image at a pinned build. Say so, so a session
# that wants to drive the app reaches for the right binary instead of running
# `npx playwright install` (which is blocked, and which would fetch a build that is not there).
if [ -x /opt/pw-browsers/chromium ]; then
  {
    echo 'export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers'
    echo 'export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1'
    echo 'export VX_CHROMIUM=/opt/pw-browsers/chromium'
  } >> "${CLAUDE_ENV_FILE:-/dev/null}"
fi

# Where the commands live, so nobody has to go looking.
echo 'export VX_APP_DIR="'"$APP"'"' >> "${CLAUDE_ENV_FILE:-/dev/null}"

echo "vortex-sc: ready — run npm test / npm run lint / npm run dev from vortex-app/"
