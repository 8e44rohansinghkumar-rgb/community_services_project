/**
 * Future AI extension point (spec §26).
 *
 * The application NEVER depends on this. When AI_CLASSIFIER_URL is unset the
 * NullClassifier is used and every code path behaves exactly as if the feature
 * did not exist. Adding a model later means implementing this one interface.
 */
import { config } from '../../config/env';
import { logger } from '../../utils/logger';

export interface ClassificationResult {
  /** Category slug the model believes matches the image. */
  categorySlug: string;
  confidence: number;
  suggestedSeverity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export interface AiClassifier {
  readonly name: string;
  readonly enabled: boolean;
  classify(imageBuffer: Buffer, mimeType: string): Promise<ClassificationResult | null>;
}

/** Default: does nothing, always returns null. */
class NullClassifier implements AiClassifier {
  readonly name = 'null-classifier';
  readonly enabled = false;
  async classify(): Promise<null> {
    return null;
  }
}

/**
 * HTTP classifier for a self-hosted model. Guard rails matter here: this posts
 * to an operator-configured URL only (never a user-supplied one), which is the
 * mitigation for SSRF (OWASP A10).
 */
class HttpClassifier implements AiClassifier {
  readonly name = 'http-classifier';
  readonly enabled = true;
  constructor(private readonly endpoint: string) {}

  async classify(imageBuffer: Buffer, mimeType: string): Promise<ClassificationResult | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': mimeType },
        body: imageBuffer,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) return null;
      const data = (await response.json()) as ClassificationResult;
      if (typeof data?.categorySlug !== 'string' || typeof data?.confidence !== 'number') return null;
      return data;
    } catch (error) {
      // A classifier outage must never fail an issue submission.
      logger.warn({ err: error }, 'AI classification failed; continuing without a suggestion');
      return null;
    }
  }
}

export const aiClassifier: AiClassifier = config.AI_CLASSIFIER_URL
  ? new HttpClassifier(config.AI_CLASSIFIER_URL)
  : new NullClassifier();
