import { GetObjectCommand, ListObjectsV2Command,PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface S3Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
}

export function createS3Client(config: S3Config): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true, // Required for MinIO
  });
}

function sessionKey(projectId: string, datasetId: string, sessionId: string): string {
  return `sessions/${projectId}/${datasetId}/${sessionId}.jsonl`;
}

export async function putSessionLog(
  client: S3Client,
  bucket: string,
  projectId: string,
  datasetId: string,
  sessionId: string,
  content: string
): Promise<void> {
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: sessionKey(projectId, datasetId, sessionId),
    Body: content,
    ContentType: "application/x-ndjson",
  }));
}

export async function getSessionLog(
  client: S3Client,
  bucket: string,
  projectId: string,
  datasetId: string,
  sessionId: string
): Promise<string | null> {
  try {
    const response = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: sessionKey(projectId, datasetId, sessionId),
    }));
    return await response.Body?.transformToString() ?? null;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "NoSuchKey") return null;
    throw err;
  }
}

export async function listSessionLogs(
  client: S3Client,
  bucket: string,
  projectId: string,
  datasetId: string
): Promise<string[]> {
  const prefix = `sessions/${projectId}/${datasetId}/`;
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));

    for (const obj of response.Contents ?? []) {
      if (obj.Key?.endsWith(".jsonl")) {
        keys.push(obj.Key.replace(prefix, "").replace(".jsonl", ""));
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}
