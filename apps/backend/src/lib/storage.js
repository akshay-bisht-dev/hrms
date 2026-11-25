// @ts-check
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Presigned URLs live for one minute (Phase 3, FILE-01/FILE-05). */
export const URL_TTL_SEC = 60;

/**
 * S3 client. With S3_ENDPOINT (local SeaweedFS) it uses path-style URLs and only adds checksums when required,
 * because S3-compatible stores reject the SDK's default checksum parameters on presigned URLs.
 * In AWS no endpoint is set and credentials come from the task role.
 * Local stores get explicit credentials (S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY) so a developer's ambient AWS
 * credentials are never sent to them — and local test files never reach a real AWS account.
 * @param {{ AWS_REGION: string, S3_ENDPOINT?: string, S3_ACCESS_KEY_ID?: string, S3_SECRET_ACCESS_KEY?: string }} env
 */
export function createS3(env) {
  if (env.S3_ENDPOINT && !(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY)) {
    throw new Error('S3_ENDPOINT is set, so S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required');
  }
  return new S3Client({
    region: env.AWS_REGION,
    ...(env.S3_ENDPOINT
      ? {
          endpoint: env.S3_ENDPOINT,
          forcePathStyle: true,
          credentials: {
            accessKeyId: /** @type {string} */ (env.S3_ACCESS_KEY_ID),
            secretAccessKey: /** @type {string} */ (env.S3_SECRET_ACCESS_KEY),
          },
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
        }
      : {}),
  });
}

/**
 * Object keys are always built from records already loaded under tenant scope — never from client input
 * (Phase 3, TEN-06). File names are not part of the key; they are stored in the database and sanitized on download.
 */
export const keys = {
  /** @param {string} tenantId @param {string} employeeId @param {string} documentId @param {string} ext */
  employeeDocument: (tenantId, employeeId, documentId, ext) =>
    `tenant/${tenantId}/employees/${employeeId}/documents/${documentId}.${ext}`,
  /** @param {string} tenantId @param {string} jobId */
  importFile: (tenantId, jobId) => `tenant/${tenantId}/imports/${jobId}/source.csv`,
  /** @param {string} tenantId @param {string} jobId */
  importResult: (tenantId, jobId) => `tenant/${tenantId}/imports/${jobId}/result.csv`,
};

/** RFC 6266 attachment header with a safe ASCII fallback and the UTF-8 name. @param {string} name */
export function attachmentDisposition(name) {
  const ascii =
    name
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\/]/g, '_')
      .slice(0, 150) || 'download';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name.slice(0, 150))}`;
}

/**
 * @param {S3Client} s3
 */
export function storage(s3) {
  return {
    /** Presigned PUT bound to an exact key and content type. @param {string} bucket @param {string} key @param {string} contentType */
    uploadUrl: (bucket, key, contentType) =>
      getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), {
        expiresIn: URL_TTL_SEC,
      }),
    /** Presigned GET that downloads as an attachment, never renders inline. @param {string} bucket @param {string} key @param {string} fileName */
    downloadUrl: (bucket, key, fileName) =>
      getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseContentDisposition: attachmentDisposition(fileName),
          ResponseCacheControl: 'no-store',
        }),
        { expiresIn: URL_TTL_SEC },
      ),
    /** @param {string} bucket @param {string} key */
    head: (bucket, key) => s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })),
    /** @param {string} bucket @param {string} key @returns {Promise<Buffer>} */
    async get(bucket, key) {
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return Buffer.from(await /** @type {any} */ (out.Body).transformToByteArray());
    },
    /** @param {string} bucket @param {string} key @param {Buffer | string} body @param {string} contentType */
    put: (bucket, key, body, contentType) =>
      s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType })),
    /** @param {string} bucket @param {string} key */
    remove: (bucket, key) => s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
    /** Local development only: buckets in AWS are created by Terraform. @param {string[]} buckets */
    async ensureBuckets(buckets) {
      for (const Bucket of buckets) {
        try {
          await s3.send(new CreateBucketCommand({ Bucket }));
        } catch (e) {
          if (!/BucketAlready(Exists|OwnedByYou)/.test(String(/** @type {any} */ (e)?.name))) throw e;
        }
      }
    },
  };
}
