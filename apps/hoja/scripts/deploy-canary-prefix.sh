#!/usr/bin/env bash
set -euo pipefail

bucket="mnemosyne-dev-canary-frontend"
distribution_id="E3I20UO9MVQ619"
mode="${1:-plan}"

if [[ "$mode" != "plan" && "$mode" != "--apply" ]]; then
  echo "usage: $0 [plan|--apply]" >&2
  exit 2
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
cd "$script_dir/.."

VITE_GATEWAY_BASE_URL="${VITE_GATEWAY_BASE_URL:-https://api.canary.sophia-labs.com}" \
VITE_COGNITO_REGION="${VITE_COGNITO_REGION:-us-west-1}" \
VITE_COGNITO_CLIENT_ID="${VITE_COGNITO_CLIENT_ID:-46raltmjse1gjkkt6hvq30tsk7}" \
pnpm build:cloud

if [[ ! -f dist/index.html ]] || [[ -z "$(find dist -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  echo "REFUSED: cloud build is empty or missing dist/index.html" >&2
  exit 1
fi

target="s3://${bucket}/hoja/"
if [[ "$mode" == "plan" ]]; then
  echo "Plan only: prefix-scoped sync; root keys are never a target."
  aws s3 sync dist/ "$target" --delete --dryrun
  echo "Would invalidate CloudFront path /hoja/* on ${distribution_id}."
  exit 0
fi

echo "About to sync only dist/ -> ${target} with prefix-local --delete."
echo "No root bucket key can be deleted by this command."
printf 'Proceed? type hoja: '
read -r confirmation
[[ "$confirmation" == "hoja" ]] || { echo "not confirmed" >&2; exit 1; }

aws s3 sync dist/ "$target" --delete
aws cloudfront create-invalidation \
  --distribution-id "$distribution_id" \
  --paths "/hoja/*" \
  --query "Invalidation.Id" \
  --output text

echo "Deployed: https://canary.sophia-labs.com/hoja/"
