#!/bin/sh
# Rebuilds docs/index.html (the GitHub Pages demo) from template.html and watt's drawing code.
# Run from anywhere after changing hooks/raster.ts, track.ts, plan.ts or the template.
set -e
here=$(cd "$(dirname "$0")" && pwd)
bundle=$(mktemp)
npx -y esbuild@0.24.0 "$here/entry.ts" --bundle --format=iife --minify --target=es2020 --log-level=warning --outfile="$bundle"
python3 -I - "$here" "$bundle" <<'PY'
import pathlib, sys
here, bundle = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]).read_text()
assert '</script' not in bundle
head = ('<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n')
page = (here / 'template.html').read_text().replace('/*WATT_BUNDLE*/', bundle.strip())
(here.parent / 'index.html').write_text(head + page)
PY
rm -f "$bundle"
echo "wrote $here/../index.html"
