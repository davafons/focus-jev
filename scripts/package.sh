#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version=$(node -p "require('$project_dir/extension/manifest.json').version")
output_dir="$project_dir/dist"
output="$output_dir/focus-jev-chrome-$version.zip"

mkdir -p "$output_dir"
rm -f "$output"
(
  cd "$project_dir/extension"
  zip -qr "$output" . -x 'icons/icon.svg'
)

unzip -t "$output" >/dev/null
printf '%s\n' "$output"
