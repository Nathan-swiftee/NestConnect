import { createHash, createHmac } from "node:crypto";
import { env } from "../config/env";

/** SHA-256 hex of an empty body (used for GET / no-body requests). */
const EMPTY_SHA = createHash("sha256").update("").digest("hex");

function sha256hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}
function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

export interface SigV4Input {
  method: string;
  path: string; // already-encoded canonical URI
  query?: string;
  amzDate: string; // YYYYMMDDTHHMMSSZ
  payloadHash: string;
  region: string;
  service: string;
  accessKey: string;
  secretKey: string;
  /** Headers to sign, as [name, value]. Sorted + lowercased internally. */
  headers: Array<[string, string]>;
}

/**
 * AWS Signature V4 Authorization header. Pure + deterministic so it can be
 * checked against the official SigV4 test vectors (see r2.driver.spec).
 */
export function signV4(input: SigV4Input): string {
  const dateStamp = input.amzDate.slice(0, 8);
  const sorted = [...input.headers]
    .map(([k, v]) => [k.toLowerCase(), v.trim()] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const signedHeaders = sorted.map(([k]) => k).join(";");
  const canonicalHeaders = sorted.map(([k, v]) => `${k}:${v}\n`).join("");
  const canonicalRequest = [
    input.method,
    input.path,
    input.query ?? "",
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    input.amzDate,
    scope,
    sha256hex(canonicalRequest),
  ].join("\n");

  const kDate = hmac(`AWS4${input.secretKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  return `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

/** Encode an object key for the URL path, preserving `/` separators. */
function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function amzNow(): string {
  return new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
}

/**
 * Cloudflare R2 object storage over its S3-compatible API. Server-side PUT/GET
 * with SigV4 (region "auto", service "s3"). Only used when all four R2 env vars
 * are set; otherwise StorageService falls back to local disk.
 */
export class R2Driver {
  private readonly host = `${env.r2.accountId}.r2.cloudflarestorage.com`;

  async put(key: string, body: Buffer, contentType = "application/octet-stream"): Promise<void> {
    const res = await this.signed("PUT", key, body, contentType);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`R2 PUT ${key} → ${res.status}: ${detail}`);
    }
  }

  async get(key: string): Promise<Buffer | null> {
    const res = await this.signed("GET", key);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 GET ${key} → ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  private signed(method: "GET" | "PUT", key: string, body?: Buffer, contentType?: string) {
    const amzDate = amzNow();
    const path = `/${env.r2.bucket}/${encodeKey(key)}`;
    const payloadHash = body ? sha256hex(body) : EMPTY_SHA;
    const authorization = signV4({
      method,
      path,
      amzDate,
      payloadHash,
      region: "auto",
      service: "s3",
      accessKey: env.r2.accessKeyId,
      secretKey: env.r2.secretAccessKey,
      headers: [
        ["host", this.host],
        ["x-amz-content-sha256", payloadHash],
        ["x-amz-date", amzDate],
      ],
    });
    const headers: Record<string, string> = {
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      authorization,
    };
    if (body && contentType) headers["content-type"] = contentType;
    return fetch(`https://${this.host}${path}`, { method, headers, body });
  }
}
