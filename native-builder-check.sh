#!/usr/bin/env bash
# Native-builder acceptance hook for the immutable Planter pool image.
set -Eeuo pipefail

image="${NATIVE_BUILDER_IMAGE:?NATIVE_BUILDER_IMAGE is required}"
image_id="${NATIVE_BUILDER_IMAGE_ID:?NATIVE_BUILDER_IMAGE_ID is required}"
source_revision="${NATIVE_BUILDER_SOURCE_REVISION:?NATIVE_BUILDER_SOURCE_REVISION is required}"
context_sha="${NATIVE_BUILDER_CONTEXT_SHA256:?NATIVE_BUILDER_CONTEXT_SHA256 is required}"

observed_id="$(docker image inspect --format '{{.Id}}' "$image")"
observed_user="$(docker image inspect --format '{{.Config.User}}' "$image")"
observed_source="$(docker image inspect --format '{{index .Config.Labels "dev.sophia.source-revision"}}' "$image")"

[[ "$observed_id" == "$image_id" ]]
[[ "$observed_user" == "node" || "$observed_user" =~ ^[1-9][0-9]*(:[1-9][0-9]*)?$ ]]
[[ "$observed_source" == "$source_revision" ]]

container_id=""
cleanup() {
  if [[ -n "$container_id" ]]; then
    docker rm -f "$container_id" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

container_id="$(docker run -d \
  --network none \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  -e PLANTER_GATEWAY_ORIGIN=https://api.canary.sophia-labs.com \
  -e PLANTER_GATEWAY_SERVICE_TOKEN=native-builder-check \
  -e PLANTER_INTERNAL_SERVICE_SECRET=native-builder-check \
  "$image")"

healthy=false
for _attempt in {1..30}; do
  if docker exec "$container_id" /nodejs/bin/node -e \
    'fetch("http://127.0.0.1:8793/healthz").then(async r => { const body=await r.json(); if (r.status !== 200 || body.ok !== true || body.service !== "planter-pool") process.exit(1) }).catch(() => process.exit(1))'; then
    healthy=true
    break
  fi
  sleep 1
done
if [[ "$healthy" != true ]]; then
  docker logs "$container_id" >&2 || true
  exit 1
fi
cleanup
container_id=""
trap - EXIT

jq -S -c -n \
  --arg schema 'sophia-native-builder-check-v1' \
  --arg component 'planter-pool' \
  --arg image_id "$image_id" \
  --arg user "$observed_user" \
  --arg source_revision "$source_revision" \
  --arg context_sha256 "$context_sha" \
  '{schema:$schema,component:$component,image_id:$image_id,user:$user,source_revision:$source_revision,context_sha256:$context_sha256,accepted:true}'
