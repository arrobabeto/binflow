import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import { DomainError } from '@binflow/domain';

export interface ArtifactStore {
  delete(key: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  put(
    input: Readonly<{
      bytes: Uint8Array;
      key: string;
      mime: string;
      sha256: string;
    }>,
  ): Promise<void>;
}

const assertKey = (key: string): void => {
  if (
    key.startsWith('/') ||
    key.includes('..') ||
    !/^[a-z0-9][a-z0-9/_\-.]{1,500}$/u.test(key)
  )
    throw new DomainError('policy_denied', 'Artifact storage key is unsafe.');
};

export class S3ArtifactStore implements ArtifactStore {
  private readonly client: S3Client;

  public constructor(
    private readonly bucket: string,
    options: Readonly<{
      accessKeyId: string;
      endpoint: string;
      region?: string;
      secretAccessKey: string;
    }>,
  ) {
    this.client = new S3Client({
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
      endpoint: options.endpoint,
      forcePathStyle: true,
      region: options.region ?? 'us-east-1',
    });
  }

  public async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  public async put(
    input: Readonly<{
      bytes: Uint8Array;
      key: string;
      mime: string;
      sha256: string;
    }>,
  ): Promise<void> {
    assertKey(input.key);
    await this.client.send(
      new PutObjectCommand({
        Body: input.bytes,
        Bucket: this.bucket,
        ContentType: input.mime,
        Key: input.key,
        Metadata: { sha256: input.sha256 },
      }),
    );
  }

  public async get(key: string): Promise<Uint8Array> {
    assertKey(key);
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (response.Body === undefined)
      throw new DomainError('provider_final', 'Artifact body is missing.');
    const body = response.Body as {
      transformToByteArray: () => Promise<Uint8Array>;
    };
    return body.transformToByteArray();
  }

  public async delete(key: string): Promise<void> {
    assertKey(key);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

export class MemoryArtifactStore implements ArtifactStore {
  public readonly values = new Map<string, Uint8Array>();

  public put(
    input: Readonly<{ bytes: Uint8Array; key: string }>,
  ): Promise<void> {
    return Promise.resolve().then(() => {
      assertKey(input.key);
      this.values.set(input.key, input.bytes.slice());
    });
  }

  public get(key: string): Promise<Uint8Array> {
    return Promise.resolve().then(() => {
      assertKey(key);
      const value = this.values.get(key);
      if (value === undefined)
        throw new DomainError('validation_error', 'Artifact was not found.');
      return value.slice();
    });
  }

  public delete(key: string): Promise<void> {
    return Promise.resolve().then(() => {
      assertKey(key);
      this.values.delete(key);
    });
  }
}
