#!/bin/sh
# Publishes every non-private package under packages/* to the given registry:
#   scripts/publish-packages.sh [--stage] <registry url>
# With --stage, tarballs are packed by bun and submitted via `npm stage publish`
# for stage-only npm tokens (E_STAGE_REQUIRED).
# Versions already present on the registry are skipped so reruns are idempotent.
set -eu

stage=false
if [ "${1:-}" = "--stage" ]; then
  stage=true
  shift
fi

registry="$1"

wrong=$(cat .npmrc packages/*/.npmrc 2>/dev/null | grep '^@prunellejs:registry=' | grep -vxF "@prunellejs:registry=$registry" || true)
if [ -n "$wrong" ]; then
  echo "A project .npmrc sends @prunellejs elsewhere than $registry: $wrong"
  exit 1
fi

for manifest in packages/*/package.json; do
  configured=$(jq -r '.publishConfig.registry // empty' "$manifest")
  if [ -n "$configured" ] && [ "$configured" != "$registry" ]; then
    echo "$manifest publishes to $configured, not $registry"
    exit 1
  fi
done

publish() {
  name="$(jq -r '.name' package.json)"
  version="$(jq -r '.version' package.json)"
  package="${name}@${version}"

  if bun pm view "$package" version > /dev/null 2>&1; then
    echo "$package is already published"
  elif [ "$stage" = true ]; then
    tarball="/tmp/prunelle-publish-$$.tgz"
    trap 'rm -f "$tarball"' EXIT
    if ! bun pm pack --quiet --filename "$tarball" > /dev/null; then
      rm -f "$tarball"
      trap - EXIT
      return 1
    fi
    echo "Staging $package..."
    if ! npm stage publish --access public "$tarball"; then
      rm -f "$tarball"
      trap - EXIT
      return 1
    fi
    rm -f "$tarball"
    trap - EXIT
  else
    echo "Publishing $package..."
    if ! bun publish --access public; then
      return 1
    fi
  fi
}

for dir in packages/*/; do
  private="$(jq -r '.private // false' "$dir/package.json")"
  if [ "$private" = true ]; then
    continue
  fi
  (
    set -eu
    cd "$dir"
    publish
  )
done
