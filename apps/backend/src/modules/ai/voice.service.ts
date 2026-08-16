import { HttpStatus, Injectable } from '@nestjs/common';
import { AiFeature } from '@prisma/client';
import type { CurrentUserPayload } from 'shared';
import { AppException } from '../../common/exceptions/app.exception';
import { FilesService } from '../files/files.service';
import { AiService } from './ai.service';
import { TranscribeClient } from './transcribe.client';
import {
  MIN_VOICE_CONFIDENCE_BP,
  VOICE_SYSTEM_PROMPT,
  VOICE_TOOL,
  parseVoice,
  type VoiceEntry,
} from './voice.prompt';

const AUDIO_PREFIX = 'audio/';

export interface VoiceProposal {
  requestId: string;
  fileId: string;
  /** What was heard — shown as-is, so the driver can see where a slip came from. */
  transcript: string;
  fields: VoiceEntry;
  confidenceBp: number | null;
  /**
   * True when confidence is under 0.7: TZ §8.2 says the app must ask again
   * rather than fill the form in. The proposal is still returned so the driver
   * can accept it deliberately if the reading happens to be right.
   */
  needsRetry: boolean;
}

/**
 * AI-1 — the driver speaks instead of typing (TZ §8.2).
 *
 * Recording → transcript → structured proposal. Nothing is saved: the entry is
 * created by the ordinary event or expense endpoint after the driver taps
 * confirm, which is the same boundary AI-2 keeps.
 */
@Injectable()
export class VoiceService {
  constructor(
    private readonly ai: AiService,
    private readonly files: FilesService,
    private readonly transcriber: TranscribeClient,
  ) {}

  get available(): boolean {
    return this.transcriber.configured && this.ai.available;
  }

  async readNote(
    actor: CurrentUserPayload,
    fileId: string,
    language?: string,
  ): Promise<VoiceProposal> {
    const companyId = actor.companyId as string;
    const file = await this.files.read(companyId, fileId);
    if (!file.mimeType.startsWith(AUDIO_PREFIX)) {
      throw new AppException(
        'FILE_TYPE_NOT_ALLOWED',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        undefined,
        {
          mimeType: file.mimeType,
        },
      );
    }

    const transcript = await this.transcriber.transcribe({
      audio: file.body,
      mimeType: file.mimeType,
      language,
    });

    const result = await this.ai.run({
      companyId,
      userId: actor.userId,
      feature: AiFeature.VOICE,
      inputType: 'audio',
      inputRef: fileId,
      system: VOICE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: transcript }],
      tools: [VOICE_TOOL],
      parse: parseVoice,
      confidenceBp: (fields) => fields.confidenceBp,
      maxTokens: 600,
    });

    return {
      requestId: result.requestId,
      fileId,
      transcript,
      fields: result.data,
      confidenceBp: result.confidenceBp,
      needsRetry: result.confidenceBp === null || result.confidenceBp < MIN_VOICE_CONFIDENCE_BP,
    };
  }
}
