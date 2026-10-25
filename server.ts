import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import { extractText } from 'unpdf';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import {
  CORE_SAFETY_AND_ACCURACY_RULES,
  getLanguageSpecificSystemDirective,
  getSkillCorpusRecords,
  LEGAL_SKILLS,
  SUPPORTED_LANGUAGES
} from './src/config/skills.ts';
import {
  LEGAL_CORPUS_RECORDS,
  verifyCitationsInText
} from './src/config/citationVerifier.ts';
import {
  generateOfflineDeterministicDraft,
  OFFLINE_AI_CAPABILITY_DISCLOSURE,
  searchOfflineLegalKnowledge
} from './src/config/offlineLegalKnowledge.ts';
import {
  performOnlineLegalResearch,
  verifyCitationsWithOnlineResearch
} from './src/services/onlineResearchServer.ts';
import {
  DocumentExtractionResponse,
  DraftingLanguage,
  DraftRequestPayload,
  DraftResponsePayload,
  LegalSkillId,
  OfflineKnowledgeSearchRequest,
  OnlineLegalResearchRequest
} from './src/types/legal.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES
  }
});

function createGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim() === '') {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
}

function tryCreateGeminiClient(): GoogleGenAI | null {
  try {
    return createGeminiClient();
  } catch {
    return null;
  }
}

function detectSupportedFileType(
  originalName: string,
  mimeType: string
): 'pdf' | 'docx' | 'txt' | null {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === '.pdf' || mimeType === 'application/pdf') {
    return 'pdf';
  }
  if (
    ext === '.docx' ||
    mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx';
  }
  if (ext === '.txt' || mimeType === 'text/plain') {
    return 'txt';
  }
  return null;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '5mb' }));
  app.use(
    (
      err: any,
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (err instanceof SyntaxError && 'body' in err) {
        return res.status(400).json({
          error: 'Malformed JSON request payload.'
        });
      }
      return next(err);
    }
  );

  app.get('/api/health', (_req, res) => {
    const hasKey = Boolean(
      process.env.GEMINI_API_KEY &&
        process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY' &&
        process.env.GEMINI_API_KEY.trim() !== ''
    );
    res.json({
      status: 'ok',
      phase: 6,
      geminiConfigured: hasKey,
      offlineAiAvailable: false,
      offlineAiDisclosure: OFFLINE_AI_CAPABILITY_DISCLOSURE,
      offlineFallbackEngine: 'Deterministic Local Template & Rule-Based Engine',
      onlineSearchMechanism: 'Live HTTP Legal Source Retrieval + Direct HTTP Source Verifier',
      supportedFormats: ['pdf', 'docx', 'txt'],
      corpusRecordsCount: LEGAL_CORPUS_RECORDS.length,
      model: 'gemini-3.8-flash'
    });
  });

  app.post('/api/offline/search', (req, res) => {
    try {
      const body = req.body as OfflineKnowledgeSearchRequest;
      if (!body || typeof body.query !== 'string') {
        return res.status(400).json({
          error: 'A search query string is required for offline knowledge search.'
        });
      }
      const result = searchOfflineLegalKnowledge(body);
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'Failed to execute offline legal knowledge search.'
      });
    }
  });

  app.post('/api/citations/verify', async (req, res) => {
    try {
      const { text, referenceText, verifyOnline, offlineMode } = req.body as {
        text?: string;
        referenceText?: string;
        verifyOnline?: boolean;
        offlineMode?: boolean;
      };

      if (typeof text !== 'string') {
        return res.status(400).json({
          error: 'Document text is required for citation verification.'
        });
      }

      if (verifyOnline && !offlineMode) {
        const ai = tryCreateGeminiClient();
        const onlineReport = await verifyCitationsWithOnlineResearch(
          ai,
          text,
          referenceText
        );
        return res.json(onlineReport);
      }

      const report = verifyCitationsInText(text, referenceText);
      return res.json(report);
    } catch (err: any) {
      console.error('Error in /api/citations/verify:', err);
      return res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'Failed to complete citation verification.'
      });
    }
  });

  app.post('/api/research/search', async (req, res) => {
    try {
      const body = req.body as OnlineLegalResearchRequest & { offlineMode?: boolean };
      if (body.offlineMode) {
        return res.status(403).json({
          error:
            'Online research requests are disabled while Offline Mode is active. Use the Offline Legal Knowledge & Uploaded Document Search instead.',
          networkRequestsMade: 0
        });
      }

      if (
        (!body.query || typeof body.query !== 'string' || !body.query.trim()) &&
        (!body.targetUrl || typeof body.targetUrl !== 'string' || !body.targetUrl.trim())
      ) {
        return res.status(400).json({
          error: 'Please enter a legal research query, citation, or source URL.'
        });
      }

      const ai = tryCreateGeminiClient();
      const result = await performOnlineLegalResearch(ai, body);
      return res.json(result);
    } catch (err: any) {
      console.error('Error in /api/research/search:', err);
      return res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred during online legal research.'
      });
    }
  });

  app.post('/api/documents/extract', (req, res) => {
    upload.single('file')(req, res, async (uploadErr: any) => {
      if (uploadErr) {
        if (uploadErr instanceof multer.MulterError && uploadErr.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            error: 'File exceeds the maximum allowed size of 10 MB.'
          });
        }
        return res.status(400).json({
          error: uploadErr.message || 'Invalid file upload request.'
        });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({
          error: 'No file provided. Please upload a PDF, DOCX, or TXT document.'
        });
      }

      if (file.size === 0) {
        return res.status(400).json({
          error: 'Uploaded file is empty (0 bytes).'
        });
      }

      const fileType = detectSupportedFileType(file.originalname, file.mimetype);
      if (!fileType) {
        return res.status(415).json({
          error: `Unsupported file format ("${
            path.extname(file.originalname) || file.mimetype
          }"). Only PDF (.pdf), Word (.docx), and Plain Text (.txt) files are supported.`
        });
      }

      try {
        let extractedText = '';
        let pageCount: number | undefined;

        if (fileType === 'txt') {
          extractedText = file.buffer.toString('utf-8');
          if (extractedText.includes('\uFFFD')) {
            return res.status(422).json({
              error:
                'Text file contains invalid or binary characters and could not be decoded as UTF-8 text.'
            });
          }
        } else if (fileType === 'docx') {
          const result = await mammoth.extractRawText({ buffer: file.buffer });
          extractedText = result.value || '';
        } else if (fileType === 'pdf') {
          const pdfData = new Uint8Array(file.buffer);
          const result = await extractText(pdfData, { mergePages: true });
          pageCount = result.totalPages;
          extractedText = typeof result.text === 'string' ? result.text : '';

          const nonWhitespaceLength = extractedText.replace(/\s+/g, '').length;
          if ((pageCount ?? 0) > 0 && nonWhitespaceLength < 15) {
            return res.status(422).json({
              error:
                'This PDF contains no extractable text layer (it appears to be a scanned image PDF). OCR is required to extract text from scanned PDFs and is unavailable in this environment.'
            });
          }
        }

        const cleanedText = extractedText
          .replace(/\r\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();

        if (!cleanedText) {
          return res.status(422).json({
            error: `No readable text could be extracted from "${file.originalname}". Ensure the document contains selectable text.`
          });
        }

        const words = cleanedText.split(/\s+/).filter(Boolean);

        const responsePayload: DocumentExtractionResponse = {
          fileName: file.originalname,
          fileType,
          sizeBytes: file.size,
          text: cleanedText,
          wordCount: words.length,
          charCount: cleanedText.length,
          ...(pageCount !== undefined ? { pageCount } : {})
        };

        return res.json(responsePayload);
      } catch (err: any) {
        console.error(`Document extraction error for ${file.originalname}:`, err);
        return res.status(422).json({
          error: `Failed to parse ${fileType.toUpperCase()} file "${file.originalname}": ${
            err instanceof Error
              ? err.message
              : 'Corrupted or unsupported document structure.'
          }`
        });
      }
    });
  });

  app.post('/api/draft', async (req, res) => {
    try {
      const {
        skill,
        language,
        instruction,
        currentDraft,
        referenceDocument,
        verifyOnline,
        offlineMode,
        mode
      } = req.body as DraftRequestPayload;

      const isSummarizeMode = mode === 'summarize';

      if (
        !isSummarizeMode &&
        (!instruction || typeof instruction !== 'string' || !instruction.trim())
      ) {
        return res.status(400).json({
          error: 'Please provide drafting or revision instructions.'
        });
      }

      if (
        isSummarizeMode &&
        (!referenceDocument ||
          typeof referenceDocument.text !== 'string' ||
          !referenceDocument.text.trim())
      ) {
        return res.status(400).json({
          error:
            'Please upload and extract a reference document before requesting a summary.'
        });
      }

      const validSkill: LegalSkillId =
        skill && skill in LEGAL_SKILLS ? skill : 'legal_notice';
      const validLanguage: DraftingLanguage = SUPPORTED_LANGUAGES.some(
        (l) => l.id === language
      )
        ? language
        : 'English';

      // Explicit Offline Mode: execute 100% locally with zero external network or AI API calls
      if (offlineMode) {
        const offlineDraft = generateOfflineDeterministicDraft({
          skill: validSkill,
          language: validLanguage,
          instruction: instruction || '',
          currentDraft,
          referenceDocument,
          verifyOnline: false,
          offlineMode: true,
          mode: mode || 'generate'
        });
        return res.json(offlineDraft);
      }

      const skillConfig = LEGAL_SKILLS[validSkill];
      const languageConfig = SUPPORTED_LANGUAGES.find((l) => l.id === validLanguage)!;
      const skillCorpus = getSkillCorpusRecords(validSkill);

      const isRevision =
        mode === 'revise' &&
        typeof currentDraft === 'string' &&
        currentDraft.trim().length > 0;

      const hasReferenceDoc =
        referenceDocument &&
        typeof referenceDocument.text === 'string' &&
        referenceDocument.text.trim().length > 0;

      try {
        const ai = createGeminiClient();

        const skillCorpusContext = skillCorpus
          .map(
            (rec) =>
              `- ${rec.canonicalCitation}: ${rec.summary}\n  Verbatim Excerpt: "${rec.verbatimExcerpt}"\n  Official Source: ${rec.officialSourceLabel} (${rec.officialSourceUrl})`
          )
          .join('\n');

        const referenceBlock = hasReferenceDoc
          ? `\n\nUPLOADED REFERENCE DOCUMENT ("${referenceDocument!.fileName}"):\n"""\n${referenceDocument!.text
              .trim()
              .slice(0, 30000)}\n"""\nUse the facts, clauses, parties, dates, and obligations from this uploaded reference document accurately. Do not invent facts outside this document and user instructions.`
          : '';

        const systemInstruction = [
          'You are DraftMate AI, a professional AI Legal Drafting Assistant.',
          `Selected Legal Skill: ${skillConfig.label} — ${skillConfig.systemDirective}`,
          `Skill Mandatory Checklist:\n${skillConfig.skillChecklist
            .map((item, idx) => `${idx + 1}. ${item}`)
            .join('\n')}`,
          `Skill Grounded Corpus Records (Use these exact statutory citations when applicable to the user's matter):\n${skillCorpusContext}`,
          `Target Output Language: ${languageConfig.label} (${languageConfig.description}).`,
          getLanguageSpecificSystemDirective(validLanguage),
          CORE_SAFETY_AND_ACCURACY_RULES
        ].join('\n\n');

        let userPrompt = '';

        if (isSummarizeMode) {
          userPrompt = `TASK: Prepare a comprehensive, structured Legal Summary & Analysis of the uploaded reference document ("${referenceDocument!.fileName}") in ${validLanguage}.
Include:
1. Document Overview & Parties Involved (preserving exact party names, dates, amounts, and reference numbers)
2. Key Dates, Financial Terms & Core Obligations
3. Applicable Statutory Provisions (preserving exact canonical statutory citations, never translating a citation in a way that changes its identity) & Notable Legal Risks
4. Actionable Next Steps
${
  instruction && instruction.trim()
    ? `\nADDITIONAL USER FOCUS:\n${instruction.trim()}`
    : ''
}${referenceBlock}`;
        } else if (isRevision) {
          userPrompt = `TASK: Revise and update the existing legal draft below strictly according to the user's revision instructions.
Target Output Language: ${validLanguage}
Selected Skill: ${skillConfig.label}

USER REVISION INSTRUCTIONS:
${instruction.trim()}

EXISTING DRAFT IN WORKSPACE:
${currentDraft!.trim()}${referenceBlock}

MANDATORY REVISION & MULTILINGUAL RULES:
- Strictly preserve all existing party names, dates, monetary amounts, invoice/instrument numbers, section numbers, case names, and quotations unless the user's revision instruction explicitly asks to change that specific item.
- Never translate a legal citation in a way that changes its identity (keep canonical citations such as "Section 73 of the Indian Contract Act, 1872" intact).
- If translating or revising across languages could alter the legal meaning of a clause, flag the uncertainty with "[TRANSLATION UNCERTAINTY FLAG: ...]".`;
        } else {
          userPrompt = `TASK: Generate a complete, well-structured output for the selected legal skill (${skillConfig.label}) in ${validLanguage}.

USER INSTRUCTIONS:
${instruction.trim()}${referenceBlock}

MANDATORY DRAFTING & MULTILINGUAL RULES:
- Respect the selected output language (${validLanguage}) while preserving all names, dates, amounts, invoice numbers, section numbers, case names, and quotations.
- Never translate a legal citation in a way that changes its identity (cite exact canonical provisions such as "Section 73 of the Indian Contract Act, 1872").
- If translating any user instruction or reference term could alter legal meaning, include an explicit "[TRANSLATION UNCERTAINTY FLAG: ...]".`;
        }

        let activeModel = 'gemini-3.8-flash';
        let response;
        try {
          response = await ai.models.generateContent({
            model: activeModel,
            contents: userPrompt,
            config: {
              systemInstruction,
              temperature: 0.3
            }
          });
        } catch (primaryModelErr: any) {
          activeModel = 'gemini-2.5-flash';
          response = await ai.models.generateContent({
            model: activeModel,
            contents: userPrompt,
            config: {
              systemInstruction,
              temperature: 0.3
            }
          });
        }

        const generatedText = response.text?.trim();
        if (!generatedText) {
          throw new Error('The AI model returned an empty response.');
        }

        const citationReport = verifyOnline
          ? await verifyCitationsWithOnlineResearch(
              ai,
              generatedText,
              hasReferenceDoc ? referenceDocument!.text : undefined
            )
          : verifyCitationsInText(
              generatedText,
              hasReferenceDoc ? referenceDocument!.text : undefined
            );

        const payload: DraftResponsePayload = {
          draft: generatedText,
          skill: validSkill,
          language: validLanguage,
          mode: isSummarizeMode ? 'summarize' : isRevision ? 'revise' : 'generate',
          ...(hasReferenceDoc ? { usedReferenceDocument: referenceDocument!.fileName } : {}),
          citationReport,
          model: activeModel,
          executionMode: 'online_ai',
          offlineAiAvailable: false,
          networkRequestsMade: verifyOnline ? 2 : 1,
          timestamp: new Date().toISOString()
        };

        return res.json(payload);
      } catch (onlineErr: any) {
        const fallbackReason =
          onlineErr instanceof Error
            ? onlineErr.message
            : 'Online AI service unavailable.';
        const fallbackDraft = generateOfflineDeterministicDraft(
          {
            skill: validSkill,
            language: validLanguage,
            instruction: instruction || '',
            currentDraft,
            referenceDocument,
            verifyOnline: false,
            offlineMode: true,
            mode: mode || 'generate'
          },
          fallbackReason
        );
        return res.json(fallbackDraft);
      }
    } catch (error: any) {
      console.error('Error in /api/draft:', error);
      const message =
        error instanceof Error
          ? error.message
          : 'An unexpected server error occurred while generating the legal draft.';
      return res.status(500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`DraftMate AI (Phase 5) server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
