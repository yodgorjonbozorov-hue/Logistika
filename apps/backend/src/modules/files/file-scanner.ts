import { Injectable, Logger } from '@nestjs/common';

export interface ScanResult {
  clean: boolean;
  /** Name of the detected threat, when the scanner reports one. */
  threat?: string;
}

/**
 * Anti-virus hook. Drivers upload photos from their own phones and accountants
 * upload PDFs from anywhere, so the files are genuinely untrusted.
 *
 * A real ClamAV integration is a later stage; this interface exists now so the
 * call site is in place and turning it on is a provider swap, not a change to
 * the upload path.
 */
export abstract class FileScanner {
  abstract scan(buffer: Buffer, filename?: string): Promise<ScanResult>;
}

@Injectable()
export class NoopFileScanner extends FileScanner {
  private readonly logger = new Logger(NoopFileScanner.name);
  private warned = false;

  scan(): Promise<ScanResult> {
    if (!this.warned) {
      // Said once per process: a permanently silent no-op scanner is how
      // "we have AV scanning" ends up in a security questionnaire untruthfully.
      this.logger.warn('No anti-virus scanner configured — uploads are stored unscanned');
      this.warned = true;
    }
    return Promise.resolve({ clean: true });
  }
}
