#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NOMEN_DIR="$ROOT_DIR/nomen"
PACKAGE_JSON="$NOMEN_DIR/package.json"
MANIFEST_JSON="$NOMEN_DIR/manifest.json"

read_json_version() {
  local file="$1"
  sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$file" | head -n 1
}

require_clean_git_tree() {
  if [[ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]]; then
    echo "Git tree is not clean. Commit or stash existing changes first."
    exit 1
  fi
}

require_current_branch() {
  local branch
  branch="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)"
  if [[ "$branch" == "HEAD" ]]; then
    echo "Detached HEAD is not supported for release publishing."
    exit 1
  fi
  printf '%s' "$branch"
}

validate_version() {
  local version="$1"
  if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Version must look like x.y.z"
    exit 1
  fi
}

replace_version() {
  local file="$1"
  local old_version="$2"
  local new_version="$3"
  OLD_VERSION="$old_version" NEW_VERSION="$new_version" perl -0pi -e '
    s/"version":\s*"\Q$ENV{OLD_VERSION}\E"/"version": "$ENV{NEW_VERSION}"/
      or die "Failed to update version in $ARGV\n";
  ' "$file"
}

current_package_version="$(read_json_version "$PACKAGE_JSON")"
current_manifest_version="$(read_json_version "$MANIFEST_JSON")"

if [[ -z "$current_package_version" || -z "$current_manifest_version" ]]; then
  echo "Failed to read current version from nomen package/manifest."
  exit 1
fi

if [[ "$current_package_version" != "$current_manifest_version" ]]; then
  echo "Version mismatch:"
  echo "  package.json  = $current_package_version"
  echo "  manifest.json = $current_manifest_version"
  exit 1
fi

require_clean_git_tree
current_branch="$(require_current_branch)"

echo "Current Nomen version: $current_package_version"
printf "Next Nomen version: "
read -r next_version

if [[ -z "$next_version" ]]; then
  echo "No version entered. Aborting."
  exit 1
fi

validate_version "$next_version"

if [[ "$next_version" == "$current_package_version" ]]; then
  echo "Next version must differ from current version."
  exit 1
fi

tag_name="nomen-v$next_version"
if git -C "$ROOT_DIR" rev-parse -q --verify "refs/tags/$tag_name" >/dev/null; then
  echo "Tag $tag_name already exists."
  exit 1
fi

replace_version "$PACKAGE_JSON" "$current_package_version" "$next_version"
replace_version "$MANIFEST_JSON" "$current_manifest_version" "$next_version"

echo "Building Nomen release artifacts..."
(cd "$NOMEN_DIR" && npm run pack)
(cd "$NOMEN_DIR" && npm run pack:discovery)
(cd "$ROOT_DIR" && node scripts/build-pages-site.mjs)

git -C "$ROOT_DIR" add \
  "nomen/package.json" \
  "nomen/manifest.json"

git -C "$ROOT_DIR" commit -m "release(nomen): v$next_version"
git -C "$ROOT_DIR" tag "$tag_name"
git -C "$ROOT_DIR" push origin "$current_branch"
git -C "$ROOT_DIR" push origin "$tag_name"

echo "Published Nomen v$next_version"
