import {
  DraftingLanguage,
  LegalSkillId,
  WorkspaceConnectivityMode
} from '../types/legal';

export type SupportedRecognitionLocale = 'en-IN' | 'en-US' | 'hi-IN';

export interface RecognitionLocaleOption {
  locale: SupportedRecognitionLocale;
  label: string;
  languageNote: string;
}

export const SUPPORTED_RECOGNITION_LOCALES: RecognitionLocaleOption[] = [
  {
    locale: 'en-IN',
    label: 'English (India — en-IN)',
    languageNote:
      'Recognizes Indian English legal dictation. For Hinglish speech, use en-IN and review/edit the Roman-script transcript before submitting.'
  },
  {
    locale: 'hi-IN',
    label: 'Hindi (हिन्दी — hi-IN)',
    languageNote:
      'Recognizes spoken Hindi in Devanagari script where supported by the browser.'
  },
  {
    locale: 'en-US',
    label: 'English (US — en-US)',
    languageNote: 'Fallback English recognition locale.'
  }
];

export const VOICE_OFFLINE_AND_HINGLISH_DISCLOSURE =
  'Voice Recognition Notice: Browser SpeechRecognition supports English (en-IN/en-US) and Hindi (hi-IN). Reliable native Hinglish speech recognition is not claimed; review and edit all recognized text before submitting. Browser speech recognition and TTS depend on browser-provided engines that may not function offline, whereas DraftMate AI drafting strictly follows your selected Online/Offline mode.';

export type VoiceCommandType =
  | 'new_draft'
  | 'select_skill'
  | 'revise_draft'
  | 'summarize_document'
  | 'switch_mode';

export interface ParsedVoiceCommand {
  status: 'matched' | 'ambiguous' | 'not_a_command';
  rawTranscript: string;
  commandType?: VoiceCommandType;
  actionSummary: string;
  requiresConfirmation: boolean;
  confirmationReason?: string;
  targetSkill?: LegalSkillId;
  targetMode?: WorkspaceConnectivityMode;
  extractedInstruction?: string;
}

export interface SpeechErrorMapping {
  code: string;
  userMessage: string;
  isPermissionDenied: boolean;
}

/**
 * Maps Web Speech API error codes and browser capability checks into clear, actionable messages.
 */
export function mapSpeechRecognitionError(errorCode: string): SpeechErrorMapping {
  const normalized = (errorCode || '').toLowerCase().trim();

  switch (normalized) {
    case 'unsupported-browser':
      return {
        code: 'unsupported-browser',
        userMessage:
          'Speech recognition is not supported in this browser (Web Speech API unavailable). Please use the typed instruction input and workspace controls.',
        isPermissionDenied: false
      };
    case 'not-allowed':
    case 'service-not-allowed':
    case 'permission-denied':
      return {
        code: 'not-allowed',
        userMessage:
          'Microphone permission was denied or blocked by the browser. Allow microphone access in your browser site settings or continue using typed instructions.',
        isPermissionDenied: true
      };
    case 'no-speech':
    case 'empty-transcript':
      return {
        code: 'no-speech',
        userMessage:
          'No recognizable speech was detected. Your instruction text was not changed; please speak clearly near the microphone or type your instruction.',
        isPermissionDenied: false
      };
    case 'audio-capture':
      return {
        code: 'audio-capture',
        userMessage:
          'No working microphone hardware was detected. Connect a microphone or use typed controls.',
        isPermissionDenied: false
      };
    case 'language-not-supported':
      return {
        code: 'language-not-supported',
        userMessage:
          'The selected speech recognition language is not supported by your current browser. Switch to English (en-IN / en-US) or type your instructions.',
        isPermissionDenied: false
      };
    case 'network':
      return {
        code: 'network',
        userMessage:
          'The browser speech recognition engine could not reach its recognition service (browser speech-to-text often requires network access). Please type your instructions directly.',
        isPermissionDenied: false
      };
    default:
      return {
        code: normalized || 'unknown-error',
        userMessage: `Voice recognition encountered an error (${
          normalized || 'unknown'
        }). Please review your text or use typed controls.`,
        isPermissionDenied: false
      };
  }
}

/**
 * Parses a recognized voice transcript to determine if it is a structured workspace voice command,
 * an ambiguous command that must not be executed, or regular dictation text.
 */
export function parseVoiceCommand(
  transcript: string,
  hasExistingDraft: boolean = true
): ParsedVoiceCommand {
  const cleaned = (transcript || '').trim();
  const lower = cleaned
    .toLowerCase()
    .replace(/[.!?]+$/g, '')
    .trim();

  if (!lower) {
    return {
      status: 'not_a_command',
      rawTranscript: '',
      actionSummary: 'Empty transcript.',
      requiresConfirmation: false
    };
  }

  // 1. Ambiguous / Unclear Command Detection (Must NOT execute)
  if (
    /^(switch\s+mode|change\s+mode|toggle\s+mode|मोड\s+बदलें)$/i.test(lower) ||
    /^(select\s+skill|change\s+skill|switch\s+skill|स्किल\s+चुनें)$/i.test(lower) ||
    /^(delete|clear|reset|replace|remove|हटाएं|डिलीट)$/i.test(lower) ||
    /^(revise|revise\s+draft|update\s+draft|संशोधित\s+करें)$/i.test(lower)
  ) {
    return {
      status: 'ambiguous',
      rawTranscript: cleaned,
      actionSummary:
        'Ambiguous or incomplete voice command. Specify the exact target (e.g., "Switch to Offline Mode", "Select Contract Review", "Start a new draft", or "Revise draft: change notice period to 30 days").',
      requiresConfirmation: false
    };
  }

  // 2. Start a New Draft / Reset Workspace (Destructive — always requires confirmation)
  if (
    /^(?:command\s*:?\s*)?(?:start\s+a?\s*new\s+draft|new\s+draft|clear\s+draft|reset\s+workspace|नया\s+ड्राफ्ट(?:\s+शुरू\s+करें)?|ड्राफ्ट\s+साफ\s+करें)$/i.test(
      lower
    )
  ) {
    return {
      status: 'matched',
      rawTranscript: cleaned,
      commandType: 'new_draft',
      actionSummary:
        'Clear the current document editor and start a blank legal draft.',
      requiresConfirmation: true,
      confirmationReason:
        'This command will delete and clear the current draft in the document editor. Please confirm before proceeding.'
    };
  }

  // 3. Switch between Online Mode and Offline Mode
  if (
    /^(?:command\s*:?\s*)?(?:switch\s+to\s+offline(?:\s+mode)?|enable\s+offline(?:\s+mode)?|go\s+offline|offline\s+mode|ऑफलाइन\s+मोड(?:\s+चालू\s+करें)?)$/i.test(
      lower
    )
  ) {
    return {
      status: 'matched',
      rawTranscript: cleaned,
      commandType: 'switch_mode',
      targetMode: 'offline',
      actionSummary:
        'Switch workspace connectivity to Offline Mode (local corpus, session uploaded documents, and deterministic templates only; 0 network requests).',
      requiresConfirmation: false
    };
  }

  if (
    /^(?:command\s*:?\s*)?(?:switch\s+to\s+online(?:\s+mode)?|enable\s+online(?:\s+mode)?|go\s+online|online\s+mode|ऑनलाइन\s+मोड(?:\s+चालू\s+करें)?)$/i.test(
      lower
    )
  ) {
    return {
      status: 'matched',
      rawTranscript: cleaned,
      commandType: 'switch_mode',
      targetMode: 'online',
      actionSummary:
        'Switch workspace connectivity to Online Mode (enables Gemini AI drafting and live online source retrieval).',
      requiresConfirmation: false
    };
  }

  // 4. Select a Supported Legal Skill
  const skillPatterns: Array<{ skill: LegalSkillId; label: string; regex: RegExp }> = [
    {
      skill: 'legal_notice',
      label: 'Legal Notice',
      regex:
        /^(?:command\s*:?\s*)?(?:select|switch\s+to|use|open|चुनें)?\s*(?:skill\s*)?(?:legal\s+notice|demand\s+notice|कानूनी\s+नोटिस)(?:\s+skill)?$/i
    },
    {
      skill: 'contract_drafting',
      label: 'Contract Drafting',
      regex:
        /^(?:command\s*:?\s*)?(?:select|switch\s+to|use|open|चुनें)?\s*(?:skill\s*)?(?:contract\s+drafting|draft\s+contract|अनुबंध\s+ड्राफ्टिंग)(?:\s+skill)?$/i
    },
    {
      skill: 'contract_review',
      label: 'Contract Review',
      regex:
        /^(?:command\s*:?\s*)?(?:select|switch\s+to|use|open|चुनें)?\s*(?:skill\s*)?(?:contract\s+review|review\s+contract|अनुबंध\s+समीक्षा)(?:\s+skill)?$/i
    },
    {
      skill: 'legal_research',
      label: 'Legal Research',
      regex:
        /^(?:command\s*:?\s*)?(?:select|switch\s+to|use|open|चुनें)?\s*(?:skill\s*)?(?:legal\s+research|कानूनी\s+शोध)(?:\s+skill)?$/i
    }
  ];

  for (const sp of skillPatterns) {
    if (sp.regex.test(lower)) {
      return {
        status: 'matched',
        rawTranscript: cleaned,
        commandType: 'select_skill',
        targetSkill: sp.skill,
        actionSummary: `Select legal skill: "${sp.label}".`,
        requiresConfirmation: false
      };
    }
  }

  // 5. Summarize the Current Document (Destructive if replacing existing draft in editor)
  if (
    /^(?:command\s*:?\s*)?(?:summarize\s+(?:the\s+)?(?:current\s+|uploaded\s+)?document|summarize\s+document|दस्तावेज़\s+का\s+सारांश(?:\s+बनाएं)?)$/i.test(
      lower
    )
  ) {
    return {
      status: 'matched',
      rawTranscript: cleaned,
      commandType: 'summarize_document',
      actionSummary:
        'Summarize the uploaded reference document and place the summary in the document editor.',
      requiresConfirmation: hasExistingDraft,
      confirmationReason: hasExistingDraft
        ? 'Summarizing the uploaded document will replace the current draft in the editor. Please confirm before proceeding.'
        : undefined
    };
  }

  // 6. Revise the Current Draft Using a Spoken Instruction (Requires Confirmation before modifying draft)
  const reviseMatch = cleaned.match(
    /^(?:command\s*:?\s*)?(?:revise\s+(?:the\s+)?(?:current\s+)?draft(?:\s+to|\s+by|\s+with|\s*:)?|ड्राफ्ट\s+संशोधित\s+करें\s*:?)\s+(.+)$/i
  );
  if (reviseMatch && reviseMatch[1].trim().length >= 3) {
    const spokenInstruction = reviseMatch[1].trim();
    return {
      status: 'matched',
      rawTranscript: cleaned,
      commandType: 'revise_draft',
      extractedInstruction: spokenInstruction,
      actionSummary: `Revise current draft with spoken instruction: "${spokenInstruction}"`,
      requiresConfirmation: true,
      confirmationReason:
        'Revising the current draft will modify or replace the existing document text in the editor. Review the recognized revision instruction and confirm to proceed.'
    };
  }

  return {
    status: 'not_a_command',
    rawTranscript: cleaned,
    actionSummary:
      'Inserted recognized speech into the editable drafting instruction box for review.',
    requiresConfirmation: false
  };
}

/**
 * Selects a matching SpeechSynthesisVoice for English, Hindi, or Hinglish if available.
 */
export function selectBestTtsVoice(
  voices: SpeechSynthesisVoice[],
  language: DraftingLanguage
): { voice: SpeechSynthesisVoice | null; langTag: string; warning?: string } {
  if (!voices || voices.length === 0) {
    return {
      voice: null,
      langTag: language === 'Hindi' ? 'hi-IN' : 'en-IN',
      warning:
        'No browser speech synthesis voices were reported; attempting playback with default system voice.'
    };
  }

  if (language === 'Hindi') {
    const hindiVoice =
      voices.find((v) => v.lang.toLowerCase().startsWith('hi')) ||
      voices.find((v) => v.name.toLowerCase().includes('hindi'));
    if (hindiVoice) {
      return { voice: hindiVoice, langTag: hindiVoice.lang };
    }
    return {
      voice: voices[0] || null,
      langTag: 'hi-IN',
      warning:
        'A dedicated Hindi (hi-IN) voice is not installed in this browser; Devanagari text may not be pronounced accurately.'
    };
  }

  const enInVoice =
    voices.find((v) => v.lang.toLowerCase() === 'en-in') ||
    voices.find((v) => v.lang.toLowerCase().startsWith('en'));

  if (enInVoice) {
    return { voice: enInVoice, langTag: enInVoice.lang };
  }

  return {
    voice: voices[0] || null,
    langTag: 'en-IN',
    warning: 'No English voice was found in the browser; using default voice.'
  };
}
