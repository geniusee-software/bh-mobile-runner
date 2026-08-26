#!/usr/bin/env bash
# Deploys the trace collector: an S3 bucket for the traces, a role that can
# reach it, and a Lambda behind a Function URL.
#
# Idempotent — safe to re-run to ship a code change.
#
#   AWS_REGION=eu-central-1 ./deploy.sh
set -euo pipefail

REGION="${AWS_REGION:-eu-central-1}"
NAME="${NAME:-bh-trace-collector}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="${BUCKET:-${NAME}-${ACCOUNT}}"
ROLE="${NAME}-role"
HERE="$(cd "$(dirname "$0")" && pwd)"
BUILD="${HERE}/.build"

echo "==> account ${ACCOUNT} region ${REGION}"

echo "==> bucket ${BUCKET}"
aws s3api head-bucket --bucket "${BUCKET}" 2>/dev/null || \
  aws s3api create-bucket --bucket "${BUCKET}" --region "${REGION}" \
    --create-bucket-configuration LocationConstraint="${REGION}" >/dev/null
# Traces contain application screen contents; they must never be public.
aws s3api put-public-access-block --bucket "${BUCKET}" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

echo "==> role ${ROLE}"
if ! aws iam get-role --role-name "${ROLE}" >/dev/null 2>&1; then
  aws iam create-role --role-name "${ROLE}" \
    --assume-role-policy-document '{
      "Version":"2012-10-17",
      "Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]
    }' >/dev/null
  aws iam attach-role-policy --role-name "${ROLE}" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "    waiting for the role to propagate"
  sleep 12
fi

aws iam put-role-policy --role-name "${ROLE}" --policy-name trace-bucket-access \
  --policy-document "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:GetObject", "s3:ListBucket"],
    "Resource": ["arn:aws:s3:::${BUCKET}", "arn:aws:s3:::${BUCKET}/*"]
  }]
}
JSON
)"

echo "==> bundling"
rm -rf "${BUILD}" && mkdir -p "${BUILD}"
# Bundling to a single CommonJS file keeps the deployment package to one entry
# and avoids shipping node_modules for the AWS SDK, which the runtime provides.
bun build "${HERE}/src/handler.ts" \
  --target node --format cjs --minify \
  --external "@aws-sdk/*" \
  --outfile "${BUILD}/index.js" >/dev/null
(cd "${BUILD}" && zip -q -r function.zip index.js)

ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/${ROLE}"

echo "==> lambda ${NAME}"
if aws lambda get-function --function-name "${NAME}" --region "${REGION}" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "${NAME}" --region "${REGION}" \
    --zip-file "fileb://${BUILD}/function.zip" >/dev/null
  aws lambda wait function-updated --function-name "${NAME}" --region "${REGION}"
  aws lambda update-function-configuration --function-name "${NAME}" --region "${REGION}" \
    --environment "Variables={TRACE_BUCKET=${BUCKET}}" --timeout 60 --memory-size 512 >/dev/null
else
  aws lambda create-function --function-name "${NAME}" --region "${REGION}" \
    --runtime nodejs22.x --handler index.handler --role "${ROLE_ARN}" \
    --zip-file "fileb://${BUILD}/function.zip" \
    --environment "Variables={TRACE_BUCKET=${BUCKET}}" \
    --timeout 60 --memory-size 512 >/dev/null
fi
aws lambda wait function-updated --function-name "${NAME}" --region "${REGION}"

echo "==> function url"
if ! aws lambda get-function-url-config --function-name "${NAME}" --region "${REGION}" >/dev/null 2>&1; then
  # AWS_IAM rather than NONE: traces carry application screen contents, so the
  # endpoint is signed rather than open to anyone who learns the URL.
  aws lambda create-function-url-config --function-name "${NAME}" --region "${REGION}" \
    --auth-type AWS_IAM >/dev/null
fi

URL="$(aws lambda get-function-url-config --function-name "${NAME}" --region "${REGION}" --query FunctionUrl --output text)"
echo
echo "Deployed."
echo "  bucket: s3://${BUCKET}"
echo "  url:    ${URL}"
echo
echo "Point the runner at it:  export BH_TRACE_URL=${URL}"
