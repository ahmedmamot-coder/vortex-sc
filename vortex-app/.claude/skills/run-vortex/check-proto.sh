#!/bin/bash
# Check proto.html after editing it: does the app class still parse, and does every
# {{ binding }} in the template have a prop behind it? The 224 "unbound" it reports on a clean
# tree are props built by spread rather than a literal key — compare against that baseline
# rather than expecting zero.
# Extract the x-dc script block from proto.html and syntax-check it, then check
# every {{ binding }} in the template has a prop somewhere in the script.
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
F=${1:-$ROOT/vortex-app/public/proto.html}
D=$(mktemp -d)
python3 - "$F" "$D" <<'PY'
import re,sys,subprocess
f,d=sys.argv[1],sys.argv[2]
s=open(f).read()
m=re.search(r'<script type="text/x-dc"[^>]*>(.*)</script>', s, re.S)
if not m:
    print("FAIL: could not find the x-dc script block"); sys.exit(1)
js=m.group(1)
open(d+"/_proto_block.js","w").write(js)
r=subprocess.run(["node","--check",d+"/_proto_block.js"],capture_output=True,text=True)
if r.returncode!=0:
    print("FAIL: JavaScript syntax error"); print(r.stderr[:2000]); sys.exit(1)
print("OK: x-dc script parses (%d lines)" % js.count("\n"))

tpl=s[:m.start()]
binds={b.strip() for b in re.findall(r'\{\{([^}]+)\}\}', tpl)}
# Only check plain identifiers - the template also holds expressions and loop-scoped vars.
plain={b for b in binds if re.fullmatch(r'[A-Za-z_$][A-Za-z0-9_$]*', b)}
loopvars=set(re.findall(r'as="([A-Za-z0-9_$]+)"', tpl))
missing=sorted(b for b in plain
               if b not in loopvars
               and not re.search(r'(^|[^A-Za-z0-9_$.])'+re.escape(b)+r'\s*:', js))
print("template bindings:", len(plain), "| unbound:", len(missing))
if missing: print("  unbound:", missing[:25])
PY
