/**
 * Secure image ingestion.
 *
 * The central idea: DO NOT trust, RE-ENCODE. Rather than inspecting a file and
 * hoping it is safe, every upload is decoded and re-written by sharp. That
 *   - proves the bytes really are a decodable raster image,
 *   - discards EXIF/XMP/ICC (including GPS coordinates of the photographer),
 *   - neutralises polyglot files (a JPEG that is also valid HTML/JS),
 *   - normalises to a known-safe format at a bounded resolution.
 *
 * SVG is rejected outright: it is XML, can carry <script>, and there is no
 * legitimate need for vector artwork in a civic photo report.
 */
import sharp from 'sharp';
import { config } from '../../config/env';
import { UnsupportedMediaTypeError, ValidationError, PayloadTooLargeError } from '../../utils/errors';
import { storageService } from './storage.service';
import { logger } from '../../utils/logger';

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;

const MAX_DIMENSION = 2048;
const MAX_PIXELS = 40_000_000; // decompression-bomb guard

export interface ProcessedImage {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
}

/**
 * Magic-number sniffing. The Content-Type header and the file extension are
 * both attacker-controlled, so the actual bytes are checked independently.
 */
function detectSignature(buffer: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return 'png';
  }

  // WebP: "RIFF" .... "WEBP"
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp';
  }

  return null;
}

export function assertAllowedUpload(file: { mimetype: string; originalname: string; size: number }): void {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype as (typeof ALLOWED_MIME_TYPES)[number])) {
    throw new UnsupportedMediaTypeError('Only JPEG, PNG and WebP images are accepted');
  }

  const lower = file.originalname.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot) : '';
  if (!ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])) {
    throw new UnsupportedMediaTypeError('Only .jpg, .png and .webp files are accepted');
  }

  // Blocks "photo.php.jpg" style double extensions.
  const withoutFinal = lower.slice(0, dot);
  if (/\.(php|phtml|js|mjs|cjs|html?|htm|svg|exe|sh|bat|jsp|asp|aspx|py|rb|pl)$/.test(withoutFinal)) {
    throw new UnsupportedMediaTypeError('This filename is not permitted');
  }

  if (file.size > config.MAX_FILE_SIZE) {
    throw new PayloadTooLargeError(
      `Each image must be ${Math.floor(config.MAX_FILE_SIZE / (1024 * 1024))} MB or smaller`,
    );
  }
}

/**
 * Validate, strip metadata, resize and persist. Returns the storage key and the
 * true dimensions/size after processing.
 */
export async function processAndStore(buffer: Buffer, declaredMime: string): Promise<ProcessedImage> {
  const signature = detectSignature(buffer);
  if (!signature) {
    throw new UnsupportedMediaTypeError('That file is not a valid JPEG, PNG or WebP image');
  }

  // The real bytes must agree with what the client claimed.
  const expectedMime = `image/${signature}`;
  if (expectedMime !== declaredMime) {
    throw new UnsupportedMediaTypeError('The file contents do not match the declared image type');
  }

  let pipeline: sharp.Sharp;
  let metadata: sharp.Metadata;
  try {
    // limitInputPixels rejects decompression bombs before allocation.
    pipeline = sharp(buffer, { limitInputPixels: MAX_PIXELS, sequentialRead: true, animated: false });
    metadata = await pipeline.metadata();
  } catch (error) {
    logger.warn({ err: error }, 'Rejected an undecodable image upload');
    throw new ValidationError('That image could not be read. Please try a different photo.');
  }

  if (!metadata.width || !metadata.height) {
    throw new ValidationError('That image could not be read. Please try a different photo.');
  }
  if (metadata.width * metadata.height > MAX_PIXELS) {
    throw new PayloadTooLargeError('That image has too many pixels. Please upload a smaller photo.');
  }
  if (signature === 'png' && metadata.format !== 'png') {
    throw new UnsupportedMediaTypeError('The file contents do not match the declared image type');
  }

  // Re-encode. Neither withMetadata() nor any EXIF passthrough is used, so all
  // metadata (including GPS) is dropped. Output format is fixed by us.
  const outputFormat = signature === 'png' ? 'png' : 'jpeg';
  const extension = outputFormat === 'png' ? 'png' : 'jpg';
  const mimeType = outputFormat === 'png' ? 'image/png' : 'image/jpeg';

  let processed: Buffer;
  try {
    const resized = sharp(buffer, { limitInputPixels: MAX_PIXELS, animated: false })
      .rotate() // apply EXIF orientation, then discard the tag
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true });

    processed =
      outputFormat === 'png'
        ? await resized.png({ compressionLevel: 9, palette: true }).toBuffer()
        : await resized.jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  } catch (error) {
    logger.warn({ err: error }, 'Image re-encoding failed');
    throw new ValidationError('That image could not be processed. Please try a different photo.');
  }

  const finalMeta = await sharp(processed).metadata();
  const stored = await storageService.put(processed, extension);

  return {
    storageKey: stored.key,
    mimeType,
    sizeBytes: stored.size,
    width: finalMeta.width ?? 0,
    height: finalMeta.height ?? 0,
  };
}
