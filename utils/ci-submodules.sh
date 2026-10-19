#!/usr/bin/env bash
# Fetches the submodules for CI: shallow and in parallel, and only the packages PetPlay uses from
# the three large nested repos (their docs and examples are most of their size).
# Run from the repository root after a checkout without submodules.
set -euo pipefail

git -c protocol.version=2 submodule update --init --depth=1 --jobs=16

parent=submodules/threewebxrwebgpudeno
nested() {
  local path=$1
  shift
  local dir=$parent/$path
  local url sha
  url=$(git -C "$parent" config -f .gitmodules "submodule.$path.url")
  sha=$(git -C "$parent" rev-parse "HEAD:$path")
  git init -q "$dir"
  git -C "$dir" remote add origin "$url"
  git -C "$dir" sparse-checkout set --cone "$@"
  git -C "$dir" -c protocol.version=2 fetch -q --depth=1 --filter=blob:none origin "$sha"
  git -C "$dir" -c advice.detachedHead=false checkout -q FETCH_HEAD
  echo "$dir: $sha (sparse: $*)"
}

nested submodules/iwer packages/iwer &
nested submodules/xr packages/handle packages/pointer-events packages/react packages/xr &
nested submodules/uikit packages/msdfonts packages/pub-sub packages/react packages/uikit &
for job in $(jobs -p); do wait "$job"; done
