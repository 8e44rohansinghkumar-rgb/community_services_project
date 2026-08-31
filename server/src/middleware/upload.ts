/**
 * Multer configuration for image uploads.
 *
 * Memory storage on purpose: nothing attacker-supplied is ever written to disk
 * before it has been validated and re-encoded by image.service. Limits here are
 * the first gate; the deep checks happen in the processing pipeline.
 */
import multer from 'multer';
import { config } from '../config/env';
import { ALLOWED_MIME_TYPES } from '../modules/storage/image.service';
import { UnsupportedMediaTypeError } from '../utils/errors';

export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.MAX_FILE_SIZE,
    files: config.MAX_FILES_PER_ISSUE,
    fields: 20,
    fieldNameSize: 100,
    fieldSize: 10_000,
    parts: config.MAX_FILES_PER_ISSUE + 20,
  },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype as (typeof ALLOWED_MIME_TYPES)[number])) {
      callback(new UnsupportedMediaTypeError('Only JPEG, PNG and WebP images are accepted'));
      return;
    }
    callback(null, true);
  },
});

/** Accepts up to MAX_FILES_PER_ISSUE files under the field name "images". */
export const uploadIssueImages = imageUpload.array('images', config.MAX_FILES_PER_ISSUE);
