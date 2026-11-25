// Creates the local S3 buckets in SeaweedFS (development only; AWS buckets come from Terraform).
import { loadEnv } from '../src/config/env.js';
import { createS3, storage } from '../src/lib/storage.js';

const env = loadEnv(process.env);
if (!env.S3_ENDPOINT) {
  console.error('S3_ENDPOINT is not set: this script is for local S3-compatible storage only.');
  process.exit(1);
}
await storage(createS3(env)).ensureBuckets([
  env.S3_BUCKET_DOCUMENTS,
  env.S3_BUCKET_REPORTS,
  env.S3_BUCKET_SCREENSHOTS,
]);
console.log('Buckets ready:', env.S3_BUCKET_DOCUMENTS, env.S3_BUCKET_REPORTS, env.S3_BUCKET_SCREENSHOTS);
