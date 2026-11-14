import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

@Injectable()
export class R2StorageService {
  private readonly logger = new Logger(R2StorageService.name);
  private readonly s3Client: S3Client | null;
  private readonly bucketName: string;
  private readonly publicUrl: string;
  private readonly objectPrefix: string;

  constructor() {
    const accountId = process.env.R2_ACCOUNT_ID?.trim();
    const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
    this.bucketName = process.env.R2_BUCKET_NAME?.trim() || "";
    this.objectPrefix = (process.env.R2_PREFIX?.trim() || "").replace(/^\/+|\/+$/g, "");
    this.publicUrl = process.env.R2_PUBLIC_URL?.trim().replace(/\/$/, "") || "";
    let validUrl = false;
    try { validUrl = new URL(this.publicUrl).protocol === "https:"; } catch {}
    if (accountId && accessKeyId && secretAccessKey && this.bucketName && validUrl) {
      this.s3Client = new S3Client({
        region: "auto",
        endpoint: process.env.R2_ENDPOINT_URL?.trim() || `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
        maxAttempts: 2,
      });
      this.logger.log("R2 configuration loaded. Uploads require successful storage and public URL verification.");
    } else {
      this.s3Client = null;
      this.logger.warn("R2 is not fully configured. Image uploads are unavailable; local fallback is disabled.");
    }
  }

  async uploadImage(fileBuffer: Buffer, _originalName: string, mimeType: string): Promise<string> {
    if (!fileBuffer.length || fileBuffer.length > 10 * 1024 * 1024) {
      throw new BadRequestException("Choose a nonempty image no larger than 10 MB.");
    }
    const png = fileBuffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg = fileBuffer[0] === 0xff && fileBuffer[1] === 0xd8 && fileBuffer[2] === 0xff;
    const webp = fileBuffer.toString("ascii", 0, 4) === "RIFF" && fileBuffer.toString("ascii", 8, 12) === "WEBP";
    const extension = png && mimeType === "image/png" ? "png" : jpeg && mimeType === "image/jpeg" ? "jpg" : webp && mimeType === "image/webp" ? "webp" : null;
    if (!extension) throw new BadRequestException("Upload a valid PNG, JPEG or WebP image.");
    if (!this.s3Client) throw new ServiceUnavailableException("Image storage is not configured. Check the backend R2 settings.");
    const key = `${this.objectPrefix ? `${this.objectPrefix}/` : ""}offers/${randomUUID()}.${extension}`;
    try {
      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.bucketName, Key: key, Body: fileBuffer, ContentType: mimeType,
        CacheControl: "public, max-age=31536000, immutable",
      }));
    } catch (error) {
      // Do not log SDK request objects or credentials.
      const name = typeof error?.name === "string" ? error.name : "StorageError";
      this.logger.error(`R2 upload failed (${name}). No local copy was saved.`);
      const detail = name === "SignatureDoesNotMatch" ? " Verify the R2 access key and secret key." : " Check R2 credentials and bucket permissions.";
      throw new ServiceUnavailableException(`R2 upload failed.${detail}`);
    }
    const url = `${this.publicUrl}/${key}`;
    try {
      const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error("Image is not publicly accessible");
    } catch {
      this.logger.warn("Object was uploaded but its public URL could not be verified.");
      throw new ServiceUnavailableException("Image uploaded, but public access could not be verified. Check R2_PUBLIC_URL and bucket public access before retrying.");
    }
    return url;
  }
}
