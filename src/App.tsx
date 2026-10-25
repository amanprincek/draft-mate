import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FilePlus,
  FileSearch,
  FileText,
  Globe,
  Loader2,
  Mic,
  MicOff,
  RefreshCw,
  Scale,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  Wand2,
  Wifi,
  WifiOff,
  X
} from 'lucide-react';
import {
  OFFLINE_AI_CAPABILITY_DISCLOSURE,
  OFFLINE_CORPUS_SCOPE_DISCLOSURE,
  SESSION_PERSISTENCE_DISCLOSURE
} from './config/offlineLegalKnowledge';
import {
  getSkillCorpusRecords,
  LEGAL_SKILL_LIST,
  LEGAL_SKILLS,
  SUPPORTED_LANGUAGES
} from './config/skills';
import {
  generateOrReviseDraft,
  searchOfflineKnowledgeBase,
  searchOnlineLegalSources,
  uploadAndExtractDocument,
  verifyDraftCitations
} from './services/draftingApi';
import {
  mapSpeechRecognitionError,
  ParsedVoiceCommand,
  parseVoiceCommand,
  selectBestTtsVoice,
  SUPPORTED_RECOGNITION_LOCALES,
  SupportedRecognitionLocale,
  VOICE_OFFLINE_AND_HINGLISH_DISCLOSURE
} from './services/voiceInteraction';
import {
  CitationVerificationReport,
  DocumentExtractionResponse,
  DraftingLanguage,
  LegalSkillId,
  OfflineKnowledgeSearchResponse,
  OnlineLegalResearchResponse,
  WorkspaceConnectivityMode
} from './types/legal';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.txt'];

const CITATION_TEST_SAMPLE_DRAFT = `LEGAL NOTICE FOR BREACH OF COMMERCIAL SERVICE CONTRACT

1. Known Corpus Statutory Provision:
The Respondent's failure to pay Invoice #INV-2026-104 constitutes a material breach of contract, entitling the Claimant to compensation for direct loss and damage caused by such breach under Section 73 of the Indian Contract Act, 1872.

2. Recognized Statute — Missing from Local Corpus (Requires Online Retrieval):
The Respondent's plea of commercial inconvenience does not amount to frustration or impossibility of performance under Section 56 of the Indian Contract Act, 1872.

3. Landmark Judicial Precedent (Requires Online Retrieval):
Damages must be proximate and foreseeable as established in Hadley v. Baxendale [1854] EWHC J70.

4. Fabricated Out-of-Range Section (Must Remain Unverified):
Furthermore, the Claimant demands summary attachment of all corporate bank accounts under Section 999 of the Indian Contract Act, 1872.`;

export default function App() {
  // Phase 5: Workspace Connectivity Mode ('online' | 'offline')
  const [connectivityMode, setConnectivityMode] =
    useState<WorkspaceConnectivityMode>('online');
  const [lastExecutionMode, setLastExecutionMode] = useState<
    'online_ai' | 'offline_deterministic_template' | 'online_failed_offline_fallback' | null
  >(null);
  const [lastFallbackReason, setLastFallbackReason] = useState<string | null>(null);
  const [offlineOnlineRequestBlockedMsg, setOfflineOnlineRequestBlockedMsg] = useState<
    string | null
  >(null);

  const [selectedSkill, setSelectedSkill] = useState<LegalSkillId>('legal_notice');
  const [selectedLanguage, setSelectedLanguage] = useState<DraftingLanguage>('English');
  const [instruction, setInstruction] = useState<string>('');
  const [documentTitle, setDocumentTitle] = useState<string>('Untitled Legal Draft');
  const [draftContent, setDraftContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingAction, setLoadingAction] = useState<'generate' | 'revise' | 'summarize'>(
    'generate'
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [lastUsedReference, setLastUsedReference] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string>('');

  // Phase 2 & 5: Document Upload & Session In-Memory Document Store
  const [uploadedDoc, setUploadedDoc] = useState<DocumentExtractionResponse | null>(null);
  const [sessionDocs, setSessionDocs] = useState<DocumentExtractionResponse[]>([]);
  const [useDocAsReference, setUseDocAsReference] = useState<boolean>(true);
  const [showDocPreview, setShowDocPreview] = useState<boolean>(true);
  const [isExtractingDoc, setIsExtractingDoc] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Phase 3 & 4: Citation Verification & Online Research State
  const [citationReport, setCitationReport] = useState<CitationVerificationReport | null>(
    null
  );
  const [isVerifyingCitations, setIsVerifyingCitations] = useState<boolean>(false);
  const [verifyOnlineOnDraft, setVerifyOnlineOnDraft] = useState<boolean>(false);

  const [researchQuery, setResearchQuery] = useState<string>('');
  const [targetSourceUrl, setTargetSourceUrl] = useState<string>('');
  const [isSearchingOnline, setIsSearchingOnline] = useState<boolean>(false);
  const [onlineResearchResult, setOnlineResearchResult] =
    useState<OnlineLegalResearchResponse | null>(null);

  // Phase 5: Offline Legal Knowledge Base & Uploaded Document Search State
  const [offlineQuery, setOfflineQuery] = useState<string>('');
  const [offlineSearchScope, setOfflineSearchScope] = useState<
    'all' | 'corpus_only' | 'uploaded_only'
  >('all');
  const [offlineSearchResult, setOfflineSearchResult] =
    useState<OfflineKnowledgeSearchResponse | null>(null);

  // Phase 6: Voice Input, Voice Commands & Text-to-Speech State
  const [recognitionLocale, setRecognitionLocale] =
    useState<SupportedRecognitionLocale>('en-IN');
  const [isListening, setIsListening] = useState<boolean>(false);
  const [lastRecognizedTranscript, setLastRecognizedTranscript] = useState<string | null>(
    null
  );
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [pendingVoiceCommand, setPendingVoiceCommand] =
    useState<ParsedVoiceCommand | null>(null);
  const [executedVoiceCommandNotice, setExecutedVoiceCommandNotice] = useState<
    string | null
  >(null);
  const recognitionRef = useRef<any>(null);

  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [ttsStatusMessage, setTtsStatusMessage] = useState<string | null>(null);

  const isOfflineMode = connectivityMode === 'offline';

  const activeSkillConfig = LEGAL_SKILLS[selectedSkill];
  const activeSkillCorpus = useMemo(
    () => getSkillCorpusRecords(selectedSkill),
    [selectedSkill]
  );

  const wordCount = useMemo(() => {
    const trimmed = draftContent.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
  }, [draftContent]);

  const charCount = draftContent.length;

  const handleSwitchMode = (mode: WorkspaceConnectivityMode) => {
    setConnectivityMode(mode);
    setOfflineOnlineRequestBlockedMsg(null);
    if (mode === 'offline') {
      setVerifyOnlineOnDraft(false);
    }
  };

  const handleProcessSpeechTranscript = (rawTranscript: string) => {
    setVoiceError(null);
    setExecutedVoiceCommandNotice(null);

    const trimmed = (rawTranscript || '').trim();
    if (!trimmed) {
      const mapped = mapSpeechRecognitionError('empty-transcript');
      setVoiceError(mapped.userMessage);
      return;
    }

    setLastRecognizedTranscript(trimmed);
    const parsedCmd = parseVoiceCommand(trimmed, Boolean(draftContent.trim()));

    if (parsedCmd.status === 'ambiguous') {
      setPendingVoiceCommand(null);
      setVoiceError(parsedCmd.actionSummary);
      return;
    }

    if (parsedCmd.status === 'matched') {
      if (parsedCmd.extractedInstruction) {
        setInstruction(parsedCmd.extractedInstruction);
      }

      if (parsedCmd.requiresConfirmation) {
        setPendingVoiceCommand(parsedCmd);
        return;
      }

      // Execute non-destructive voice command immediately and show notice
      if (parsedCmd.commandType === 'switch_mode' && parsedCmd.targetMode) {
        handleSwitchMode(parsedCmd.targetMode);
        setExecutedVoiceCommandNotice(
          `Voice Command Executed ("${parsedCmd.rawTranscript}"): ${parsedCmd.actionSummary}`
        );
      } else if (parsedCmd.commandType === 'select_skill' && parsedCmd.targetSkill) {
        setSelectedSkill(parsedCmd.targetSkill);
        setExecutedVoiceCommandNotice(
          `Voice Command Executed ("${parsedCmd.rawTranscript}"): ${parsedCmd.actionSummary}`
        );
      } else if (parsedCmd.commandType === 'summarize_document') {
        setExecutedVoiceCommandNotice(
          `Voice Command Executed ("${parsedCmd.rawTranscript}"): ${parsedCmd.actionSummary}`
        );
        handleRunDraft('summarize');
      }
      return;
    }

    // Standard dictation: convert recognized speech into editable text WITHOUT auto-submitting
    setPendingVoiceCommand(null);
    setInstruction((prev) => (prev.trim() ? `${prev.trim()} ${trimmed}` : trimmed));
    setExecutedVoiceCommandNotice(
      `Voice Dictation Recognized ("${trimmed}"): Placed into editable instruction box. Review and edit before clicking Generate or Revise.`
    );
  };

  const handleConfirmVoiceCommand = async () => {
    if (!pendingVoiceCommand) return;
    const cmd = pendingVoiceCommand;
    setPendingVoiceCommand(null);

    if (cmd.commandType === 'new_draft') {
      handleNewBlankDraft();
      setExecutedVoiceCommandNotice(
        `Confirmed Voice Command ("${cmd.rawTranscript}"): Cleared workspace and started a new blank draft.`
      );
    } else if (cmd.commandType === 'revise_draft') {
      const revInst = cmd.extractedInstruction || instruction.trim();
      if (revInst) setInstruction(revInst);
      setExecutedVoiceCommandNotice(
        `Confirmed Voice Command ("${cmd.rawTranscript}"): Running revision in ${
          isOfflineMode ? 'Offline Mode' : 'Online Mode'
        }.`
      );
      await handleRunDraft('revise');
    } else if (cmd.commandType === 'summarize_document') {
      setExecutedVoiceCommandNotice(
        `Confirmed Voice Command ("${cmd.rawTranscript}"): Summarizing uploaded document in ${
          isOfflineMode ? 'Offline Mode' : 'Online Mode'
        }.`
      );
      await handleRunDraft('summarize');
    }
  };

  const handleCancelVoiceCommand = () => {
    if (!pendingVoiceCommand) return;
    const cancelledText = pendingVoiceCommand.rawTranscript;
    setPendingVoiceCommand(null);
    setExecutedVoiceCommandNotice(
      `Cancelled destructive voice command ("${cancelledText}"). Document was not modified.`
    );
  };

  const handleToggleVoiceListening = () => {
    setVoiceError(null);
    setExecutedVoiceCommandNotice(null);

    if (isListening && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore stop error
      }
      setIsListening(false);
      return;
    }

    const SpeechRecognitionCtor =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;

    if (!SpeechRecognitionCtor) {
      const mapped = mapSpeechRecognitionError('unsupported-browser');
      setVoiceError(mapped.userMessage);
      return;
    }

    try {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = recognitionLocale;
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
        setVoiceError(null);
      };

      recognition.onresult = (event: any) => {
        const transcript = event?.results?.[0]?.[0]?.transcript || '';
        handleProcessSpeechTranscript(transcript);
      };

      recognition.onerror = (event: any) => {
        const errCode = event?.error || 'unknown-error';
        const mapped = mapSpeechRecognitionError(errCode);
        setVoiceError(mapped.userMessage);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      const mapped = mapSpeechRecognitionError(
        err?.name === 'NotAllowedError' ? 'not-allowed' : err?.message || 'unknown-error'
      );
      setVoiceError(mapped.userMessage);
      setIsListening(false);
    }
  };

  const handleToggleReadAloud = () => {
    setTtsStatusMessage(null);
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setTtsStatusMessage(
        'Text-to-Speech (window.speechSynthesis) is not supported in this browser.'
      );
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      setTtsStatusMessage('Stopped audio playback.');
      return;
    }

    const textToRead = draftContent.trim();
    if (!textToRead) {
      setTtsStatusMessage('Editor is empty. Generate or enter a draft to read aloud.');
      return;
    }

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(textToRead.slice(0, 4000));
      const voices = window.speechSynthesis.getVoices() || [];
      const selected = selectBestTtsVoice(voices, selectedLanguage);
      if (selected.voice) {
        utterance.voice = selected.voice;
      }
      utterance.lang = selected.langTag;
      utterance.rate = 0.98;

      if (selected.warning) {
        setTtsStatusMessage(selected.warning);
      } else {
        setTtsStatusMessage(
          `Reading draft aloud (${selected.langTag}${
            selected.voice ? ` · ${selected.voice.name}` : ''
          })...`
        );
      }

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => {
        setIsSpeaking(false);
        setTtsStatusMessage(null);
      };
      utterance.onerror = () => {
        setIsSpeaking(false);
        setTtsStatusMessage(
          'Speech synthesis playback encountered an error or no audio output device is available.'
        );
      };

      setIsSpeaking(true);
      window.speechSynthesis.speak(utterance);
    } catch {
      setIsSpeaking(false);
      setTtsStatusMessage('Unable to start browser Text-to-Speech playback.');
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = '';
    setUploadError(null);

    const lowerName = file.name.toLowerCase();
    const hasValidExt = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
    if (!hasValidExt) {
      setUploadError(
        `Unsupported file type ("${file.name}"). Please upload a PDF (.pdf), Word (.docx), or Plain Text (.txt) document.`
      );
      return;
    }

    if (file.size === 0) {
      setUploadError(`The selected file "${file.name}" is empty (0 bytes).`);
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError(
        `File "${file.name}" (${(file.size / (1024 * 1024)).toFixed(2)} MB) exceeds the 10 MB maximum size limit.`
      );
      return;
    }

    setIsExtractingDoc(true);
    try {
      let extracted: DocumentExtractionResponse;
      if (lowerName.endsWith('.txt')) {
        // Plain text files can be decoded locally in browser memory if offline, or via extraction endpoint
        try {
          extracted = await uploadAndExtractDocument(file);
        } catch {
          const text = await file.text();
          const cleaned = text.replace(/\r\n/g, '\n').trim();
          if (!cleaned) {
            throw new Error(`No readable text could be extracted from "${file.name}".`);
          }
          const words = cleaned.split(/\s+/).filter(Boolean);
          extracted = {
            fileName: file.name,
            fileType: 'txt',
            sizeBytes: file.size,
            text: cleaned,
            wordCount: words.length,
            charCount: cleaned.length
          };
        }
      } else {
        extracted = await uploadAndExtractDocument(file);
      }

      setUploadedDoc(extracted);
      setSessionDocs((prev) => {
        const filtered = prev.filter((d) => d.fileName !== extracted.fileName);
        return [extracted, ...filtered];
      });
      setUseDocAsReference(true);
      setShowDocPreview(true);
    } catch (err: any) {
      setUploadedDoc(null);
      setUploadError(
        err instanceof Error
          ? err.message
          : 'Failed to extract text from the uploaded document.'
      );
    } finally {
      setIsExtractingDoc(false);
    }
  };

  const handleClearUploadedDoc = () => {
    if (uploadedDoc) {
      setSessionDocs((prev) => prev.filter((d) => d.fileName !== uploadedDoc.fileName));
    }
    setUploadedDoc(null);
    setUploadError(null);
    setLastUsedReference(null);
  };

  const handleLoadExtractedIntoEditor = async () => {
    if (!uploadedDoc) return;
    setDraftContent(uploadedDoc.text);
    setDocumentTitle(uploadedDoc.fileName.replace(/\.[^.]+$/, ''));
    setLastUpdated(new Date().toLocaleTimeString());
    try {
      const report = await verifyDraftCitations(
        uploadedDoc.text,
        uploadedDoc.text,
        false,
        true
      );
      setCitationReport(report);
    } catch {
      // Ignore verification error on manual load
    }
  };

  const handleRunOfflineSearch = (
    customQuery?: string,
    customScope?: 'all' | 'corpus_only' | 'uploaded_only'
  ) => {
    const q = (customQuery !== undefined ? customQuery : offlineQuery).trim();
    const sc = customScope !== undefined ? customScope : offlineSearchScope;
    if (customQuery !== undefined) setOfflineQuery(customQuery);
    if (customScope !== undefined) setOfflineSearchScope(customScope);

    const activeDocs =
      sessionDocs.length > 0
        ? sessionDocs
        : uploadedDoc
        ? [uploadedDoc]
        : [];

    const result = searchOfflineKnowledgeBase({
      query: q,
      scope: sc,
      sessionDocuments: activeDocs.map((d) => ({
        fileName: d.fileName,
        fileType: d.fileType,
        text: d.text
      }))
    });

    setOfflineSearchResult(result);
  };

  const handleVerifyCurrentDraft = async (
    customText?: string,
    useOnline: boolean = false
  ) => {
    const targetText = typeof customText === 'string' ? customText : draftContent;
    if (!targetText.trim()) {
      setErrorMessage('Editor is empty. Generate or enter a legal draft to verify citations.');
      return;
    }

    if (isOfflineMode && useOnline) {
      setOfflineOnlineRequestBlockedMsg(
        'Online citation retrieval was bypassed because Offline Mode is active. Executed 100% local corpus & uploaded-document citation verification (0 network requests).'
      );
    } else {
      setOfflineOnlineRequestBlockedMsg(null);
    }

    setIsVerifyingCitations(true);
    setErrorMessage(null);
    try {
      const report = await verifyDraftCitations(
        targetText,
        uploadedDoc && useDocAsReference ? uploadedDoc.text : undefined,
        isOfflineMode ? false : useOnline,
        isOfflineMode
      );
      setCitationReport(report);
    } catch (err: any) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to verify citations.'
      );
    } finally {
      setIsVerifyingCitations(false);
    }
  };

  const handleRunOnlineSearch = async (customQuery?: string, customUrl?: string) => {
    const q = (customQuery !== undefined ? customQuery : researchQuery).trim();
    const u = (customUrl !== undefined ? customUrl : targetSourceUrl).trim();
    if (!q && !u) return;

    if (customQuery !== undefined) setResearchQuery(customQuery);
    if (customUrl !== undefined) setTargetSourceUrl(customUrl);

    // Phase 5 Requirement 4 & 5: In Offline Mode, stop all online requests and fall back to local knowledge search
    if (isOfflineMode) {
      setOfflineOnlineRequestBlockedMsg(
        `Online web search for "${q || u}" was blocked because Offline Mode is active (0 network requests made). Showing results from the local legal corpus and session uploaded documents below.`
      );
      handleRunOfflineSearch(q || u, 'all');
      return;
    }

    setOfflineOnlineRequestBlockedMsg(null);
    setIsSearchingOnline(true);
    try {
      const res = await searchOnlineLegalSources({
        query: q,
        ...(u ? { targetUrl: u } : {})
      });
      setOnlineResearchResult(res);
    } catch (err: any) {
      // Reliable Offline Fallback when online research fails
      const errMsg =
        err instanceof Error ? err.message : 'Online search request failed.';
      setOnlineResearchResult({
        query: q || u,
        status: 'search_failed',
        summaryFinding: `${errMsg} Automatic Offline Fallback triggered: searched bundled local corpus and session uploaded documents below.`,
        verificationAssessment: 'Unverified',
        searchQueriesExecuted: [],
        sources: [],
        limitationNote:
          'Online research endpoint was unreachable; fell back to local offline knowledge search.',
        errorDetail: errMsg,
        timestamp: new Date().toISOString()
      });
      handleRunOfflineSearch(q || u, 'all');
    } finally {
      setIsSearchingOnline(false);
    }
  };

  const handleLoadCitationTestSample = async (withOnline: boolean = false) => {
    setDraftContent(CITATION_TEST_SAMPLE_DRAFT);
    setDocumentTitle('Citation Verification Test Sample');
    setLastUpdated(new Date().toLocaleTimeString());
    await handleVerifyCurrentDraft(CITATION_TEST_SAMPLE_DRAFT, withOnline);
  };

  const handleRunDraft = async (mode: 'generate' | 'revise' | 'summarize') => {
    const trimmedInstruction = instruction.trim();

    if (mode !== 'summarize' && !trimmedInstruction) {
      setErrorMessage('Please enter drafting or revision instructions before submitting.');
      return;
    }

    if (mode === 'revise' && !draftContent.trim()) {
      setErrorMessage(
        'There is no existing draft in the editor to revise. Use "Generate Draft" first.'
      );
      return;
    }

    if (mode === 'summarize' && !uploadedDoc) {
      setErrorMessage('Please upload a PDF, DOCX, or TXT document first to summarize it.');
      return;
    }

    setErrorMessage(null);
    setIsLoading(true);
    setLoadingAction(mode);

    const shouldAttachRef =
      mode === 'summarize' || (Boolean(uploadedDoc) && useDocAsReference);

    try {
      const result = await generateOrReviseDraft({
        skill: selectedSkill,
        language: selectedLanguage,
        instruction:
          mode === 'summarize' && !trimmedInstruction
            ? `Summarize the uploaded document "${uploadedDoc?.fileName}" and highlight key obligations, dates, financial terms, and legal risks.`
            : trimmedInstruction,
        currentDraft: mode === 'revise' ? draftContent : undefined,
        referenceDocument:
          shouldAttachRef && uploadedDoc
            ? {
                fileName: uploadedDoc.fileName,
                text: uploadedDoc.text
              }
            : undefined,
        verifyOnline: isOfflineMode ? false : verifyOnlineOnDraft,
        offlineMode: isOfflineMode,
        mode
      });

      setDraftContent(result.draft);
      setCitationReport(result.citationReport);
      setLastExecutionMode(result.executionMode);
      setLastFallbackReason(result.fallbackReason || null);

      if (mode === 'summarize' && uploadedDoc) {
        setDocumentTitle(`Legal Summary — ${uploadedDoc.fileName} (${selectedLanguage})`);
      } else if (mode === 'generate' || documentTitle === 'Untitled Legal Draft') {
        setDocumentTitle(`${activeSkillConfig.label} (${selectedLanguage})`);
      }
      setLastUpdated(new Date(result.timestamp).toLocaleTimeString());
      setLastUsedReference(result.usedReferenceDocument || null);
    } catch (err: any) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Failed to generate legal draft.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadSampleInstruction = () => {
    setInstruction(activeSkillConfig.sampleInstruction);
    setErrorMessage(null);
  };

  const handleCopyDraft = async () => {
    if (!draftContent.trim()) return;
    try {
      await navigator.clipboard.writeText(draftContent);
      setCopyStatus('Copied');
      setTimeout(() => setCopyStatus(''), 2000);
    } catch {
      setErrorMessage('Unable to copy text to clipboard.');
    }
  };

  const handleDownloadDraft = (ext: 'txt' | 'md') => {
    if (!draftContent.trim()) return;
    const content =
      ext === 'md' ? `# ${documentTitle}\n\n${draftContent}` : draftContent;
    const mime =
      ext === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${
      documentTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'legal-draft'
    }.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleNewBlankDraft = () => {
    setDraftContent('');
    setDocumentTitle('Untitled Legal Draft');
    setCitationReport(null);
    setOnlineResearchResult(null);
    setOfflineSearchResult(null);
    setLastExecutionMode(null);
    setLastFallbackReason(null);
    setOfflineOnlineRequestBlockedMsg(null);
    setLastUpdated(null);
    setLastUsedReference(null);
    setErrorMessage(null);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar Contract: 3 Zones */}
      <header className="flex flex-wrap items-center justify-between gap-4 px-6 py-3.5 bg-white border-b border-slate-200 sticky top-0 z-20">
        {/* Zone 1: Brand Title */}
        <a
          href="#workspace"
          onClick={(e) => e.preventDefault()}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          DraftMate AI
        </a>

        {/* Zone 2: Concise single-line skill quick-navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          {LEGAL_SKILL_LIST.map((skill) => (
            <a
              key={skill.id}
              href={`#${skill.id}`}
              onClick={(e) => {
                e.preventDefault();
                setSelectedSkill(skill.id);
              }}
              className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 py-1 ${
                selectedSkill === skill.id
                  ? 'text-slate-900 underline underline-offset-8 decoration-2'
                  : ''
              }`}
            >
              {skill.label}
            </a>
          ))}
        </nav>

        {/* Zone 3: Online / Offline Mode Selector & Reset Workspace */}
        <div className="flex items-center gap-3 shrink-0">
          <div
            role="group"
            aria-label="Workspace Connectivity Mode"
            className="flex items-center p-1 bg-slate-100 border border-slate-200 rounded-lg"
          >
            <button
              type="button"
              onClick={() => handleSwitchMode('online')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                !isOfflineMode
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Wifi className="w-3.5 h-3.5" />
              <span>Online Mode</span>
            </button>
            <button
              type="button"
              onClick={() => handleSwitchMode('offline')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                isOfflineMode
                  ? 'bg-amber-800 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <WifiOff className="w-3.5 h-3.5" />
              <span>Offline Mode</span>
            </button>
          </div>

          <button
            type="button"
            onClick={handleNewBlankDraft}
            className="px-3.5 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Reset Workspace
          </button>
        </div>
      </header>

      {/* Connectivity & Offline Fallback Status Strip */}
      <div
        className={`px-6 py-2.5 border-b text-xs transition-colors ${
          isOfflineMode
            ? 'bg-amber-50 border-amber-200 text-amber-950'
            : lastExecutionMode === 'online_failed_offline_fallback'
            ? 'bg-amber-50 border-amber-200 text-amber-950'
            : 'bg-slate-100/80 border-slate-200 text-slate-700'
        }`}
      >
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {isOfflineMode ? (
              <>
                <WifiOff className="w-4 h-4 text-amber-800 shrink-0" />
                <span>
                  <strong>Offline Mode Active (0 External Network Requests):</strong> Using
                  only the Bundled Local Legal Corpus (8 provisions), Session Uploaded
                  Documents ({sessionDocs.length}), and the Deterministic Local Template
                  Engine.
                </span>
              </>
            ) : lastExecutionMode === 'online_failed_offline_fallback' ? (
              <>
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                <span>
                  <strong>Reliable Offline Fallback Triggered:</strong> Online service was
                  unreachable ({lastFallbackReason}). Draft was assembled locally using the
                  Deterministic Template Engine and Bundled Local Corpus.
                </span>
              </>
            ) : (
              <>
                <Wifi className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>
                  <strong>Online Mode Active:</strong> Connected to Gemini AI Drafting,
                  Live Online Legal Research, and Local Corpus + Online Citation Verification
                  (with automatic local fallback if offline).
                </span>
              </>
            )}
          </div>
          <span className="font-mono-tabular text-[11px] text-slate-600">
            Local Generative AI Runtime: Unavailable (Rule-Based Template Fallback)
          </span>
        </div>
      </div>

      {/* Main Responsive Workspace */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Panel: Skill, Language, Reference Document Upload & Instruction Controls (5 columns) */}
          <aside className="lg:col-span-5 space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="border-b border-slate-200 pb-3">
                <h1 className="text-base font-semibold text-slate-900">
                  01. Drafting Configuration & Legal Skill
                </h1>
                <p className="text-xs text-slate-500 mt-1">
                  Select a legal skill and language, upload an optional reference document,
                  and provide instructions.
                </p>
              </div>

              {/* Legal Skill Selector */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-800">
                  Legal Skill
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {LEGAL_SKILL_LIST.map((skill) => {
                    const isActive = selectedSkill === skill.id;
                    return (
                      <button
                        key={skill.id}
                        type="button"
                        onClick={() => setSelectedSkill(skill.id)}
                        className={`px-3 py-2.5 text-left rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                          isActive
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        <div className="font-semibold whitespace-nowrap truncate">
                          {skill.label}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {activeSkillConfig.description}
                </p>

                {/* Connected Skill Checklist & Corpus Authorities */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2 mt-2">
                  <div className="text-[11px] font-semibold text-slate-800">
                    Active Skill Checklist & Grounded Corpus Provisions (
                    {activeSkillCorpus.length})
                  </div>
                  <ul className="space-y-1 text-[11px] text-slate-600 list-disc pl-4">
                    {activeSkillConfig.skillChecklist.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                  <div className="pt-1 border-t border-slate-200/80 text-[11px] text-slate-500 font-mono-tabular">
                    Corpus Records:{' '}
                    {activeSkillCorpus.map((c) => c.canonicalCitation).join(' · ')}
                  </div>
                </div>
              </div>

              {/* Language Selector (English, Hindi, Hinglish) */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-800">
                  Drafting Language
                </label>
                <div className="grid grid-cols-3 gap-2 p-1 bg-slate-100 rounded-lg">
                  {SUPPORTED_LANGUAGES.map((lang) => {
                    const isActive = selectedLanguage === lang.id;
                    return (
                      <button
                        key={lang.id}
                        type="button"
                        onClick={() => setSelectedLanguage(lang.id)}
                        className={`py-2 px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          isActive
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {lang.id}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-slate-500">
                  {SUPPORTED_LANGUAGES.find((l) => l.id === selectedLanguage)?.description}
                </p>
              </div>

              {/* Phase 2 & 5: Reference Document Upload & Session In-Memory Extraction */}
              <div className="space-y-3 pt-2 border-t border-slate-200">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="block text-xs font-semibold text-slate-800">
                      02. Reference Document Upload (PDF, DOCX, TXT)
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Max 10 MB · Current session in-memory only (not persisted after session ends)
                    </span>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    disabled={isExtractingDoc}
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {isExtractingDoc ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Extracting...</span>
                      </>
                    ) : (
                      <>
                        <Upload className="w-3.5 h-3.5" />
                        <span>Upload Document</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Upload / Extraction Error Banner */}
                {uploadError && (
                  <div
                    role="alert"
                    className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-start justify-between gap-2"
                  >
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                      <span className="leading-relaxed">{uploadError}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setUploadError(null)}
                      className="text-red-700 hover:text-red-900 shrink-0 cursor-pointer"
                      aria-label="Dismiss upload error"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* Extracted Document Card & Readable Preview */}
                {uploadedDoc && (
                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 truncate">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                          <span className="truncate">{uploadedDoc.fileName}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 font-mono-tabular mt-0.5">
                          <span>{uploadedDoc.fileType.toUpperCase()}</span>
                          <span aria-hidden="true">·</span>
                          <span>{(uploadedDoc.sizeBytes / 1024).toFixed(1)} KB</span>
                          {uploadedDoc.pageCount !== undefined && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{uploadedDoc.pageCount} pages</span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <span>{uploadedDoc.wordCount} words</span>
                          <span aria-hidden="true">·</span>
                          <span>Session Memory Only</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleClearUploadedDoc}
                        className="text-xs text-slate-500 hover:text-slate-900 shrink-0 cursor-pointer"
                        title="Remove uploaded document"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Reference Context Toggle & Actions */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/80">
                      <label className="flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={useDocAsReference}
                          onChange={(e) => setUseDocAsReference(e.target.checked)}
                          className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                        />
                        <span>Use as Drafting Reference Context</span>
                      </label>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowDocPreview((prev) => !prev)}
                          className="text-xs font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
                        >
                          {showDocPreview ? (
                            <>
                              <EyeOff className="w-3.5 h-3.5" />
                              <span>Hide Preview</span>
                            </>
                          ) : (
                            <>
                              <Eye className="w-3.5 h-3.5" />
                              <span>Show Preview</span>
                            </>
                          )}
                        </button>
                        <span className="text-slate-300">|</span>
                        <button
                          type="button"
                          onClick={handleLoadExtractedIntoEditor}
                          className="text-xs font-medium text-slate-700 hover:text-slate-900 underline cursor-pointer"
                        >
                          Open in Editor
                        </button>
                      </div>
                    </div>

                    {/* Readable Extracted Text Preview */}
                    {showDocPreview && (
                      <div className="space-y-1">
                        <div className="text-[11px] font-semibold text-slate-600">
                          Extracted Text Preview:
                        </div>
                        <div className="max-h-44 overflow-y-auto p-2.5 bg-white border border-slate-200 rounded text-xs font-legal text-slate-800 whitespace-pre-wrap leading-relaxed">
                          {uploadedDoc.text}
                        </div>
                      </div>
                    )}

                    {/* Direct Summarize Uploaded Document Action */}
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={() => handleRunDraft('summarize')}
                      className="w-full py-2 px-3 bg-white hover:bg-slate-100 disabled:opacity-50 text-slate-900 border border-slate-300 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      {isLoading && loadingAction === 'summarize' ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Summarizing Document in {selectedLanguage}...</span>
                        </>
                      ) : (
                        <>
                          <FileSearch className="w-3.5 h-3.5" />
                          <span>
                            {isOfflineMode
                              ? `Deterministic Offline Extraction Summary (${selectedLanguage})`
                              : `Summarize & Analyze Uploaded Document (${selectedLanguage})`}
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* User Instruction Input + Phase 6 Voice Input & Voice Commands */}
              <div className="space-y-3 pt-2 border-t border-slate-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="instruction-input"
                    className="block text-xs font-semibold text-slate-800"
                  >
                    03. Drafting Instructions & Voice Interaction
                  </label>
                  <button
                    type="button"
                    onClick={handleLoadSampleInstruction}
                    className="text-xs font-medium text-slate-600 hover:text-slate-900 underline cursor-pointer"
                  >
                    Load Example Prompt
                  </button>
                </div>

                {/* Phase 6: Voice Input & Command Bar */}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <label
                        htmlFor="voice-locale-select"
                        className="text-[11px] font-semibold text-slate-700"
                      >
                        Speech Recognition Locale:
                      </label>
                      <select
                        id="voice-locale-select"
                        aria-label="Speech Recognition Language Locale"
                        value={recognitionLocale}
                        onChange={(e) =>
                          setRecognitionLocale(
                            e.target.value as SupportedRecognitionLocale
                          )
                        }
                        className="px-2 py-1 text-xs bg-white border border-slate-300 rounded text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
                      >
                        {SUPPORTED_RECOGNITION_LOCALES.map((opt) => (
                          <option key={opt.locale} value={opt.locale}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      type="button"
                      aria-label={
                        isListening
                          ? 'Stop microphone voice recognition'
                          : 'Start microphone voice recognition'
                      }
                      onClick={handleToggleVoiceListening}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer ${
                        isListening
                          ? 'bg-red-700 hover:bg-red-800 text-white'
                          : 'bg-slate-900 hover:bg-slate-800 text-white'
                      }`}
                    >
                      {isListening ? (
                        <>
                          <MicOff className="w-3.5 h-3.5 animate-pulse" />
                          <span>Stop Listening</span>
                        </>
                      ) : (
                        <>
                          <Mic className="w-3.5 h-3.5" />
                          <span>Voice Input / Command</span>
                        </>
                      )}
                    </button>
                  </div>

                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    {
                      SUPPORTED_RECOGNITION_LOCALES.find(
                        (l) => l.locale === recognitionLocale
                      )?.languageNote
                    }
                  </p>

                  {/* Listening Status Indicator */}
                  {isListening && (
                    <div
                      role="status"
                      className="p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-900 flex items-center gap-2"
                    >
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-red-700 shrink-0" />
                      <span>
                        Listening ({recognitionLocale})... Speak your legal instruction or a
                        voice command (e.g., "Start a new draft", "Select Contract Review",
                        "Switch to Offline Mode").
                      </span>
                    </div>
                  )}

                  {/* Recognized Transcript Review Banner */}
                  {lastRecognizedTranscript && !isListening && (
                    <div className="p-2.5 bg-white border border-slate-200 rounded text-xs text-slate-800 flex items-start justify-between gap-2">
                      <div>
                        <span className="font-semibold text-slate-900">
                          Last Recognized Speech:{' '}
                        </span>
                        <span className="font-mono-tabular">
                          "{lastRecognizedTranscript}"
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setLastRecognizedTranscript(null)}
                        className="text-slate-400 hover:text-slate-700 shrink-0 cursor-pointer"
                        aria-label="Clear recognized transcript notice"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Voice Command Confirmation Prompt (Destructive Actions) */}
                  {pendingVoiceCommand && (
                    <div
                      role="alertdialog"
                      aria-label="Confirm Voice Command"
                      className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-950 space-y-2"
                    >
                      <div className="font-semibold flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 text-amber-800 shrink-0" />
                        <span>
                          Confirm Voice Command: "{pendingVoiceCommand.rawTranscript}"
                        </span>
                      </div>
                      <p className="leading-relaxed">
                        <strong>Action:</strong> {pendingVoiceCommand.actionSummary}
                      </p>
                      {pendingVoiceCommand.confirmationReason && (
                        <p className="text-[11px] text-amber-900">
                          {pendingVoiceCommand.confirmationReason}
                        </p>
                      )}
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={handleConfirmVoiceCommand}
                          className="px-3 py-1.5 bg-amber-900 hover:bg-amber-950 text-white font-semibold rounded transition-colors cursor-pointer"
                        >
                          Confirm & Execute
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelVoiceCommand}
                          className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 font-semibold rounded transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Executed Voice Command or Dictation Notice */}
                  {executedVoiceCommandNotice && (
                    <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-950 flex items-start justify-between gap-2">
                      <span>{executedVoiceCommandNotice}</span>
                      <button
                        type="button"
                        onClick={() => setExecutedVoiceCommandNotice(null)}
                        className="text-emerald-800 hover:text-emerald-950 shrink-0 cursor-pointer"
                        aria-label="Dismiss voice command notice"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Voice Error / Unsupported Browser / Permission Denied Banner */}
                  {voiceError && (
                    <div
                      role="alert"
                      className="p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-900 flex items-start justify-between gap-2"
                    >
                      <div className="flex items-start gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-red-700 shrink-0 mt-0.5" />
                        <span>{voiceError}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setVoiceError(null)}
                        className="text-red-700 hover:text-red-900 shrink-0 cursor-pointer"
                        aria-label="Dismiss voice error"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {/* Keyboard / Non-Microphone Accessible Voice Command & Transcript Test Controls */}
                  <div className="pt-1.5 border-t border-slate-200/80 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="text-slate-500">
                      Test Voice Input / Commands (Accessible Fallback):
                    </span>
                    {[
                      {
                        label: 'Dictate English (en-IN)',
                        t: 'Draft a legal notice for non-payment of Invoice #INV-2026-104 of INR 4,50,000 under Section 73 of the Indian Contract Act, 1872.'
                      },
                      {
                        label: 'Dictate Hindi (hi-IN)',
                        t: 'भारतीय संविदा अधिनियम, 1872 की धारा 73 के अंतर्गत INR 4,50,000 की बकाया राशि हेतु 15 दिनों का कानूनी नोटिस तैयार करें।'
                      },
                      {
                        label: 'Cmd: New Draft (Needs Confirm)',
                        t: 'Start a new draft'
                      },
                      {
                        label: 'Cmd: Revise Draft (Needs Confirm)',
                        t: 'Revise draft: extend the notice cure period from 15 days to 30 days'
                      },
                      {
                        label: 'Cmd: Select Contract Review',
                        t: 'Select Contract Review'
                      },
                      {
                        label: 'Cmd: Switch Offline/Online',
                        t: isOfflineMode ? 'Switch to Online Mode' : 'Switch to Offline Mode'
                      },
                      {
                        label: 'Ambiguous Cmd Test',
                        t: 'Switch mode'
                      }
                    ].map((vc) => (
                      <button
                        key={vc.label}
                        type="button"
                        onClick={() => handleProcessSpeechTranscript(vc.t)}
                        className="px-2 py-0.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded transition-colors cursor-pointer"
                      >
                        {vc.label}
                      </button>
                    ))}
                  </div>
                </div>

                <textarea
                  id="instruction-input"
                  rows={5}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder={
                    uploadedDoc && useDocAsReference
                      ? `Instruct how to use "${uploadedDoc.fileName}" (e.g., Draft a reply notice, review clauses for risk, or draft an addendum)...`
                      : activeSkillConfig.placeholderPrompt
                  }
                  className="w-full p-3.5 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:bg-white focus:ring-2 focus:ring-slate-900 leading-relaxed"
                />

                <label
                  className={`flex items-center gap-2 text-xs pt-1 ${
                    isOfflineMode
                      ? 'text-slate-400 cursor-not-allowed'
                      : 'text-slate-700 cursor-pointer'
                  }`}
                >
                  <input
                    type="checkbox"
                    disabled={isOfflineMode}
                    checked={isOfflineMode ? false : verifyOnlineOnDraft}
                    onChange={(e) => setVerifyOnlineOnDraft(e.target.checked)}
                    className="rounded border-slate-300 text-slate-900 focus:ring-slate-900 disabled:opacity-50"
                  />
                  <span>
                    {isOfflineMode
                      ? 'Online citation retrieval disabled in Offline Mode (Local Corpus Audit only)'
                      : 'Run live online citation retrieval automatically after generating draft'}
                  </span>
                </label>

                {/* Offline AI Capability Disclosure Box when Offline Mode is Active */}
                {isOfflineMode && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-950 space-y-1">
                    <div className="font-semibold flex items-center gap-1.5">
                      <WifiOff className="w-3.5 h-3.5 text-amber-800 shrink-0" />
                      <span>Offline Mode — Local Template & Rule-Based Assistance</span>
                    </div>
                    <p className="leading-relaxed">{OFFLINE_AI_CAPABILITY_DISCLOSURE}</p>
                  </div>
                )}
              </div>

              {/* Action Buttons: Generate vs Revise */}
              <div className="space-y-2.5 pt-1">
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => handleRunDraft('generate')}
                  className={`w-full py-2.5 px-4 disabled:bg-slate-400 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer ${
                    isOfflineMode
                      ? 'bg-amber-800 hover:bg-amber-900'
                      : 'bg-slate-900 hover:bg-slate-800'
                  }`}
                >
                  {isLoading && loadingAction === 'generate' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Generating {activeSkillConfig.label}...</span>
                    </>
                  ) : (
                    <>
                      <Scale className="w-4 h-4" />
                      <span>
                        {isOfflineMode
                          ? `Generate Offline Template Draft (${activeSkillConfig.label})`
                          : `Generate New ${activeSkillConfig.label}`}
                        {uploadedDoc && useDocAsReference ? ' (Using Uploaded Doc)' : ''}
                      </span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={isLoading || !draftContent.trim()}
                  onClick={() => handleRunDraft('revise')}
                  className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 disabled:bg-slate-100 disabled:text-slate-400 text-slate-900 text-xs font-semibold rounded-lg border border-slate-300 disabled:border-slate-200 transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isLoading && loadingAction === 'revise' ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Revising Current Draft...</span>
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-4 h-4" />
                      <span>
                        {isOfflineMode
                          ? 'Apply Offline Deterministic Revision to Draft'
                          : 'Revise Current Draft in Editor'}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </aside>

          {/* Right Panel: Editable Workspace, Offline Knowledge Base + Uploaded Doc Search, & Citation Review (7 columns) */}
          <section className="lg:col-span-7 space-y-6">
            {/* Card 1: Editable Document Workspace */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              {/* Workspace Header */}
              <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
                <div className="flex-1 min-w-[220px]">
                  <input
                    type="text"
                    aria-label="Document Title"
                    value={documentTitle}
                    onChange={(e) => setDocumentTitle(e.target.value)}
                    className="w-full text-base font-bold text-slate-900 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-900 focus:outline-none pb-0.5"
                  />
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mt-1 font-mono-tabular">
                    <span>Skill: {activeSkillConfig.label}</span>
                    <span aria-hidden="true">·</span>
                    <span>Language: {selectedLanguage}</span>
                    <span aria-hidden="true">·</span>
                    <span>Words: {wordCount}</span>
                    <span aria-hidden="true">·</span>
                    <span>Chars: {charCount}</span>
                    {lastExecutionMode && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            lastExecutionMode === 'online_ai'
                              ? 'text-emerald-700 font-semibold'
                              : 'text-amber-800 font-semibold'
                          }
                        >
                          Engine:{' '}
                          {lastExecutionMode === 'online_ai'
                            ? 'Online Gemini AI'
                            : lastExecutionMode === 'online_failed_offline_fallback'
                            ? 'Offline Fallback (Rule-Based)'
                            : 'Offline Local Template'}
                        </span>
                      </>
                    )}
                    {lastUsedReference && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Ref: {lastUsedReference}</span>
                      </>
                    )}
                    {lastUpdated && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Updated: {lastUpdated}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Editor Toolbar Actions */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!draftContent.trim() || isVerifyingCitations}
                    onClick={() => handleVerifyCurrentDraft(undefined, false)}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Local Verify</span>
                  </button>
                  <button
                    type="button"
                    disabled={!draftContent.trim() || isVerifyingCitations || isOfflineMode}
                    title={
                      isOfflineMode
                        ? 'Disabled in Offline Mode to prevent external network requests'
                        : 'Verify citations using live online research'
                    }
                    onClick={() => handleVerifyCurrentDraft(undefined, true)}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>
                      {isVerifyingCitations ? 'Verifying...' : 'Verify + Online Research'}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={
                      isSpeaking
                        ? 'Stop reading draft aloud'
                        : 'Read current draft aloud using browser Text-to-Speech'
                    }
                    disabled={!draftContent.trim()}
                    onClick={handleToggleReadAloud}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 ${
                      isSpeaking
                        ? 'bg-amber-800 text-white hover:bg-amber-900'
                        : 'text-slate-700 bg-slate-100 hover:bg-slate-200'
                    }`}
                  >
                    {isSpeaking ? (
                      <>
                        <VolumeX className="w-3.5 h-3.5" />
                        <span>Stop TTS</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>Read Aloud</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={!draftContent.trim()}
                    onClick={handleCopyDraft}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{copyStatus || 'Copy'}</span>
                  </button>
                  <button
                    type="button"
                    disabled={!draftContent.trim()}
                    onClick={() => handleDownloadDraft('txt')}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>.TXT</span>
                  </button>
                  <button
                    type="button"
                    disabled={!draftContent.trim()}
                    onClick={handleNewBlankDraft}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear</span>
                  </button>
                </div>
              </div>

              {/* Optional Text-to-Speech Status / Warning Banner */}
              {ttsStatusMessage && (
                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-700 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Volume2 className="w-3.5 h-3.5 text-slate-700 shrink-0" />
                    <span>{ttsStatusMessage}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTtsStatusMessage(null)}
                    className="text-slate-400 hover:text-slate-700 shrink-0 cursor-pointer"
                    aria-label="Dismiss TTS message"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Error State Banner */}
              {errorMessage && (
                <div
                  role="alert"
                  className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start justify-between gap-3 text-xs text-red-800"
                >
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold">Workspace Notice</div>
                      <p className="mt-0.5 leading-relaxed">{errorMessage}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setErrorMessage(null)}
                    className="text-xs font-semibold text-red-700 hover:text-red-900 underline whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Loading State Overlay / Skeleton */}
              {isLoading && (
                <div className="p-5 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-700">
                    <span className="flex items-center gap-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-900" />
                      {loadingAction === 'summarize'
                        ? `Summarizing "${uploadedDoc?.fileName}" in ${selectedLanguage}...`
                        : loadingAction === 'revise'
                        ? `Revising ${activeSkillConfig.label} in ${selectedLanguage}...`
                        : `Generating ${activeSkillConfig.label} in ${selectedLanguage}...`}
                    </span>
                    <span className="font-mono-tabular text-slate-500">
                      {isOfflineMode
                        ? 'Local Deterministic Template Engine (0 Network Calls)'
                        : `Gemini AI ${
                            verifyOnlineOnDraft
                              ? '+ Online Citation Research'
                              : '+ Local Corpus Audit'
                          }`}
                    </span>
                  </div>
                  <div className="space-y-2 animate-pulse">
                    <div className="h-3 bg-slate-200 rounded w-1/3" />
                    <div className="h-3 bg-slate-200 rounded w-full" />
                    <div className="h-3 bg-slate-200 rounded w-11/12" />
                    <div className="h-3 bg-slate-200 rounded w-4/5" />
                  </div>
                </div>
              )}

              {/* Empty State vs Editable Document Canvas */}
              {!draftContent && !isLoading ? (
                <div className="py-14 px-6 bg-slate-50/60 border border-dashed border-slate-300 rounded-lg text-center space-y-4">
                  <div className="w-10 h-10 rounded-full bg-slate-200/70 text-slate-700 flex items-center justify-center mx-auto">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="max-w-md mx-auto space-y-1.5">
                    <h2 className="text-sm font-semibold text-slate-900">
                      Legal Document Workspace is Empty
                    </h2>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Generate a draft using the selected skill (in Online AI Mode or Offline
                      Deterministic Template Mode), upload a reference document, or search the
                      Offline Legal Knowledge Base below.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={handleLoadSampleInstruction}
                      className="px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      <span>Load Sample Skill Prompt</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleLoadCitationTestSample(false)}
                      className="px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Load Citation Test Sample</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDraftContent(
                          `[${activeSkillConfig.label.toUpperCase()} — WORKING DRAFT]\n\n[INSERT DATE]\n\n`
                        )
                      }
                      className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <FilePlus className="w-3.5 h-3.5" />
                      <span>Start Typing Manually</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <textarea
                    aria-label="Editable Legal Document Workspace"
                    rows={16}
                    value={draftContent}
                    onChange={(e) => setDraftContent(e.target.value)}
                    placeholder="Your generated, summarized, or manually entered legal draft will appear here for editing..."
                    className="w-full p-5 bg-slate-50/60 border border-slate-200 rounded-lg font-legal text-[15px] leading-relaxed text-slate-900 focus:outline-none focus:bg-white focus:border-slate-400"
                  />
                </div>
              )}
            </div>

            {/* Card 2: Phase 5 Offline Legal Knowledge Base & Session Uploaded Document Search */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                    <Database className="w-4 h-4 text-slate-800" />
                    <span>
                      04. Offline Legal Knowledge Base & Uploaded Document Search
                    </span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Works 100% offline with zero network calls. Searches bundled statutory
                    provisions and extracted documents in the current session.
                  </p>
                </div>
                <span className="text-[11px] font-mono-tabular px-2.5 py-1 rounded bg-slate-100 text-slate-700 border border-slate-200">
                  Network Requests: 0 · Session Docs: {sessionDocs.length}
                </span>
              </div>

              {/* Offline Search Bar & Scope Selector */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                  <input
                    type="text"
                    aria-label="Offline Legal Knowledge Search Input"
                    value={offlineQuery}
                    onChange={(e) => setOfflineQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRunOfflineSearch();
                    }}
                    placeholder="Search topic, statute, section, keyword, or uploaded document text (e.g., Section 73, cheque dishonour, Section 56)..."
                    className="md:col-span-7 px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                  <select
                    aria-label="Offline Search Scope"
                    value={offlineSearchScope}
                    onChange={(e) =>
                      setOfflineSearchScope(
                        e.target.value as 'all' | 'corpus_only' | 'uploaded_only'
                      )
                    }
                    className="md:col-span-3 px-2.5 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  >
                    <option value="all">All Local (Corpus + Uploaded)</option>
                    <option value="corpus_only">Bundled Local Corpus Only</option>
                    <option value="uploaded_only">
                      Uploaded Session Docs ({sessionDocs.length})
                    </option>
                  </select>
                  <button
                    type="button"
                    disabled={!offlineQuery.trim()}
                    onClick={() => handleRunOfflineSearch()}
                    className="md:col-span-2 px-3 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 rounded-lg transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Search Local</span>
                  </button>
                </div>

                {/* Quick Offline Test Presets */}
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="text-slate-500">Offline Search Test Presets:</span>
                  {[
                    {
                      label: '1. Known Corpus Entry (Section 73 ICA)',
                      q: 'Section 73 Indian Contract Act, 1872 compensation for breach',
                      scope: 'all' as const
                    },
                    {
                      label: '2. Topic Search (Dishonour of Cheque / Sec 138)',
                      q: 'dishonour of cheque insufficiency of funds 15 days notice',
                      scope: 'corpus_only' as const
                    },
                    {
                      label: '3. Absent Section (Section 56 ICA)',
                      q: 'Section 56 of the Indian Contract Act, 1872 frustration',
                      scope: 'corpus_only' as const
                    },
                    {
                      label: '4. Out-of-Range Section (Section 999 ICA)',
                      q: 'Section 999 of the Indian Contract Act, 1872',
                      scope: 'corpus_only' as const
                    },
                    ...(sessionDocs.length > 0
                      ? [
                          {
                            label: `5. Search Uploaded Doc ("${sessionDocs[0].fileName}")`,
                            q:
                              sessionDocs[0].text
                                .split(/\s+/)
                                .filter((w) => w.length >= 5)
                                .slice(0, 3)
                                .join(' ') || 'contract',
                            scope: 'uploaded_only' as const
                          }
                        ]
                      : [])
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => handleRunOfflineSearch(preset.q, preset.scope)}
                      className="px-2 py-0.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded transition-colors cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {/* Offline Search Results Display */}
                {offlineSearchResult && (
                  <div className="p-4 bg-white border border-slate-200 rounded-lg space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 text-xs">
                      <span className="font-semibold text-slate-900">
                        Offline Search Results for: "{offlineSearchResult.query}"
                      </span>
                      <span className="font-mono-tabular text-slate-600">
                        Corpus Matches: {offlineSearchResult.corpusMatches.length} · Uploaded
                        Doc Matches: {offlineSearchResult.uploadedDocMatches.length} ·
                        Network Calls: {offlineSearchResult.networkRequestsMade}
                      </span>
                    </div>

                    {/* Absent Authority Disclosures */}
                    {offlineSearchResult.absentAuthorities.length > 0 && (
                      <div className="space-y-2">
                        {offlineSearchResult.absentAuthorities.map((abs, idx) => (
                          <div
                            key={idx}
                            className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-950 space-y-1"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-semibold flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                                <span>
                                  Authority Absent from Bundled Local Corpus:{' '}
                                  {abs.queriedAuthority}
                                </span>
                              </span>
                              <span className="font-mono-tabular font-semibold text-amber-800">
                                Offline Status: {abs.status}
                              </span>
                            </div>
                            <p className="leading-relaxed">{abs.reason}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Bundled Local Corpus Matches */}
                    {offlineSearchResult.corpusMatches.length > 0 && (
                      <div className="space-y-2.5">
                        <div className="text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                          Bundled Local Legal Corpus Matches (
                          {offlineSearchResult.corpusMatches.length})
                        </div>
                        {offlineSearchResult.corpusMatches.map((item) => (
                          <div
                            key={item.id}
                            className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1.5"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-bold text-slate-900 font-mono-tabular">
                                {item.canonicalCitation} ({item.sectionOrRule})
                              </span>
                              <span className="text-[11px] font-mono-tabular px-2 py-0.5 bg-white border border-slate-200 rounded text-slate-700">
                                Origin: {item.origin}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono-tabular">
                              Act: {item.actOrCaseName} ({item.enactedOrDecidedYear}) ·
                              Matched By: {item.matchReasons.join(' | ')}
                            </div>
                            <p className="text-slate-700">{item.summary}</p>
                            <blockquote className="p-2 bg-white border border-slate-200 rounded font-legal italic text-slate-800">
                              "{item.verbatimExcerpt}"
                            </blockquote>
                            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 pt-0.5">
                              <span>
                                Keywords: {item.subjectKeywords.slice(0, 8).join(', ')}
                              </span>
                              <span>
                                Stored Metadata Ref: {item.officialSourceLabel} (Offline —
                                Not Live Verified)
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Uploaded Reference Document Matches */}
                    {offlineSearchResult.uploadedDocMatches.length > 0 && (
                      <div className="space-y-2.5">
                        <div className="text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                          Session Uploaded Document Matches (
                          {offlineSearchResult.uploadedDocMatches.length})
                        </div>
                        {offlineSearchResult.uploadedDocMatches.map((docMatch, idx) => (
                          <div
                            key={`${docMatch.fileName}-${idx}`}
                            className="p-3 bg-emerald-50/50 border border-emerald-200 rounded-lg text-xs space-y-1.5"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-bold text-slate-900 flex items-center gap-1.5">
                                <FileText className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                                <span>
                                  {docMatch.fileName} (Paragraph #{docMatch.paragraphNumber})
                                </span>
                              </span>
                              <span className="text-[11px] font-mono-tabular px-2 py-0.5 bg-white border border-emerald-200 rounded text-emerald-900">
                                Origin: {docMatch.origin}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono-tabular">
                              Format: {docMatch.fileType.toUpperCase()} · Total Term Matches in
                              Document: {docMatch.matchCountInDocument}
                            </div>
                            <blockquote className="p-2.5 bg-white border border-slate-200 rounded font-legal text-slate-800 whitespace-pre-wrap">
                              "{docMatch.matchingExcerpt}"
                            </blockquote>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Empty Search Result Message */}
                    {offlineSearchResult.corpusMatches.length === 0 &&
                      offlineSearchResult.uploadedDocMatches.length === 0 && (
                        <div className="p-3 bg-slate-50 border border-slate-200 rounded text-xs text-slate-700">
                          <strong>No Local Matches Found:</strong> No matching provisions were
                          found in the bundled local corpus, and{' '}
                          {sessionDocs.length === 0
                            ? 'no reference documents have been uploaded in the current session.'
                            : `no matching passages were found in your ${sessionDocs.length} uploaded session document(s).`}
                        </div>
                      )}

                    {/* Mandatory Scope & Session Persistence Disclosures */}
                    <div className="text-[11px] text-slate-500 pt-2 border-t border-slate-100 space-y-1">
                      <div>
                        <strong>Corpus Scope:</strong>{' '}
                        {offlineSearchResult.corpusScopeDisclosure}
                      </div>
                      <div>
                        <strong>Session Document Boundary:</strong>{' '}
                        {offlineSearchResult.sessionPersistenceDisclosure}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Card 3: Phase 3 & 4 Citation Review & Online Legal Research Panel */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-200">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    05. Citation Review & Online Source-Backed Research
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Distinguishes local corpus matches from live online search grounding and
                    direct HTTP source verification.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleLoadCitationTestSample(false)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Load Test Sample (Local)
                  </button>
                  <button
                    type="button"
                    disabled={isVerifyingCitations || isOfflineMode}
                    title={
                      isOfflineMode
                        ? 'Disabled in Offline Mode — switch to Online Mode for live web verification'
                        : 'Verify citations using live online research'
                    }
                    onClick={() => handleLoadCitationTestSample(true)}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>
                      {isVerifyingCitations
                        ? 'Retrieving Online Evidence...'
                        : 'Verify Draft Online'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Offline Mode Online Request Prevention Notice */}
              {offlineOnlineRequestBlockedMsg && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-950 flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <WifiOff className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
                    <span>{offlineOnlineRequestBlockedMsg}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOfflineOnlineRequestBlockedMsg(null)}
                    className="text-amber-800 hover:text-amber-950 shrink-0 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Direct Online Legal Research & Source URL Verifier Box */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-slate-700" />
                    <span>Live Online Legal Research & Source URL Verifier</span>
                  </div>
                  {isOfflineMode && (
                    <span className="text-[11px] font-semibold text-amber-800">
                      Offline Mode: Web calls disabled (redirects to local search)
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                  <input
                    type="text"
                    value={researchQuery}
                    onChange={(e) => setResearchQuery(e.target.value)}
                    placeholder="Search statute, section, or judgment (e.g., Section 56 Indian Contract Act, 1872 or Hadley v Baxendale)..."
                    className="md:col-span-6 px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                  <input
                    type="text"
                    value={targetSourceUrl}
                    onChange={(e) => setTargetSourceUrl(e.target.value)}
                    placeholder="Optional: Direct Source URL to inspect (https://...)"
                    className="md:col-span-4 px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 font-mono-tabular focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                  <button
                    type="button"
                    disabled={
                      isSearchingOnline || (!researchQuery.trim() && !targetSourceUrl.trim())
                    }
                    onClick={() => handleRunOnlineSearch()}
                    className="md:col-span-2 px-3 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 rounded-lg transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {isSearchingOnline ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Search className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {isSearchingOnline
                        ? 'Searching...'
                        : isOfflineMode
                        ? 'Local Fallback'
                        : 'Search Web'}
                    </span>
                  </button>
                </div>

                {/* Quick Online Test Queries */}
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="text-slate-500">Quick Research Presets:</span>
                  {[
                    {
                      label: 'Known Statute (Sec 73 ICA)',
                      q: 'Section 73 Indian Contract Act, 1872 India Code verbatim text',
                      u: ''
                    },
                    {
                      label: 'Unindexed Section (Sec 56 ICA)',
                      q: 'Section 56 Indian Contract Act, 1872 agreement to do impossible act',
                      u: ''
                    },
                    {
                      label: 'Precedent (Hadley v Baxendale)',
                      q: 'Hadley v Baxendale 1854 EWHC J70 remoteness of damages rule',
                      u: ''
                    },
                    {
                      label: 'Fabricated Section (Sec 999 ICA)',
                      q: 'Section 999 Indian Contract Act, 1872',
                      u: ''
                    },
                    {
                      label: 'Inaccessible URL Test',
                      q: 'Section 10 Indian Contract Act',
                      u: 'https://invalid-portal.indiacode-nonexistent.gov.in/act/9999'
                    }
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      disabled={isSearchingOnline}
                      onClick={() => handleRunOnlineSearch(preset.q, preset.u)}
                      className="px-2 py-0.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded transition-colors cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {/* Online Research Loading State */}
                {isSearchingOnline && (
                  <div className="p-4 bg-white border border-slate-200 rounded-lg flex items-center gap-2.5 text-xs text-slate-700">
                    <Loader2 className="w-4 h-4 animate-spin text-slate-900 shrink-0" />
                    <span>
                      Executing live online legal retrieval and inspecting source
                      reachability...
                    </span>
                  </div>
                )}

                {/* Online Research Result Display (Success / Empty / Failed Search / Inaccessible Source) */}
                {!isSearchingOnline && onlineResearchResult && (
                  <div className="p-4 bg-white border border-slate-200 rounded-lg space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                      <div className="text-xs font-semibold text-slate-900">
                        Online Research Result: "{onlineResearchResult.query}"
                      </div>
                      <div className="flex items-center gap-2 text-xs font-mono-tabular">
                        <span>Origin: Online Retrieval</span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={`font-semibold ${
                            onlineResearchResult.verificationAssessment === 'Verified'
                              ? 'text-emerald-700'
                              : onlineResearchResult.verificationAssessment ===
                                'Partially Verified'
                              ? 'text-amber-700'
                              : 'text-red-700'
                          }`}
                        >
                          Assessment: {onlineResearchResult.verificationAssessment}
                        </span>
                      </div>
                    </div>

                    {/* Specific States: Empty / Search Failed / Inaccessible Source */}
                    {onlineResearchResult.status === 'empty' && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900">
                        <strong>Empty Search Result:</strong>{' '}
                        {onlineResearchResult.summaryFinding}
                      </div>
                    )}

                    {onlineResearchResult.status === 'search_failed' && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-900">
                        <strong>Search Failed:</strong> {onlineResearchResult.summaryFinding}
                      </div>
                    )}

                    {onlineResearchResult.status === 'inaccessible_source' && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-900">
                        <strong>Inaccessible Source:</strong>{' '}
                        {onlineResearchResult.summaryFinding}
                      </div>
                    )}

                    {onlineResearchResult.status === 'success' && (
                      <p className="text-xs text-slate-700 leading-relaxed">
                        {onlineResearchResult.summaryFinding}
                      </p>
                    )}

                    {/* Retrieved Online Sources List */}
                    {onlineResearchResult.sources.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[11px] font-semibold text-slate-700">
                          Retrieved Source Evidence ({onlineResearchResult.sources.length}):
                        </div>
                        {onlineResearchResult.sources.map((src, sIdx) => (
                          <div
                            key={sIdx}
                            className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1.5"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-semibold text-slate-900">
                                {src.title}
                              </span>
                              <a
                                href={src.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-slate-900 font-semibold underline hover:text-slate-600 flex items-center gap-1 whitespace-nowrap"
                              >
                                <span>Open Original Source</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 font-mono-tabular">
                              <span>Authority: {src.issuingAuthority}</span>
                              <span aria-hidden="true">·</span>
                              <span>
                                {src.isOfficialSource
                                  ? 'Official Government/Court Domain'
                                  : 'Public Legal/Web Repository'}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>Status: {src.retrievalStatus}</span>
                            </div>
                            <blockquote className="p-2 bg-white border border-slate-200 rounded font-legal italic text-slate-800">
                              "{src.excerpt}"
                            </blockquote>
                            <div className="text-[11px] text-slate-500">
                              {src.currentnessNote}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                      <span className="font-semibold">Limitation Note: </span>
                      {onlineResearchResult.limitationNote}
                    </div>
                  </div>
                )}
              </div>

              {/* Draft Citation Verification Report */}
              {citationReport ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono-tabular text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="font-semibold text-slate-900">
                        Draft Citations: {citationReport.totalDetected}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="text-emerald-700 font-semibold">
                        Verified: {citationReport.verifiedCount}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="text-amber-700 font-semibold">
                        Partially Verified: {citationReport.partiallyVerifiedCount}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="text-red-700 font-semibold">
                        Unverified: {citationReport.unverifiedCount}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-600">
                      Mode:{' '}
                      {citationReport.onlineResearchPerformed
                        ? 'Local Corpus + Online Retrieval'
                        : 'Local Corpus Only (Offline-Ready)'}
                    </span>
                  </div>

                  <p className="text-xs text-slate-500 leading-relaxed">
                    {citationReport.methodologyNote}
                  </p>

                  {citationReport.items.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-500 bg-slate-50/50 rounded-lg border border-slate-200">
                      No statutory or judicial citations were detected in the current document
                      text.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-200">
                      {citationReport.items.map((item, idx) => (
                        <div key={idx} className="py-4 space-y-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              {item.status === 'Verified' && (
                                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                              )}
                              {item.status === 'Partially Verified' && (
                                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                              )}
                              {item.status === 'Unverified' && (
                                <ShieldAlert className="w-4 h-4 text-red-700 shrink-0" />
                              )}
                              <span className="text-sm font-bold font-mono-tabular text-slate-900">
                                {item.rawCitation}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 text-xs font-mono-tabular">
                              <span
                                className={`font-semibold ${
                                  item.status === 'Verified'
                                    ? 'text-emerald-700'
                                    : item.status === 'Partially Verified'
                                    ? 'text-amber-700'
                                    : 'text-red-700'
                                }`}
                              >
                                {item.status}
                              </span>
                              <span aria-hidden="true" className="text-slate-300">
                                ·
                              </span>
                              <span className="text-slate-700 font-medium">
                                Origin: {item.evidenceOrigin}
                              </span>
                              <span aria-hidden="true" className="text-slate-300">
                                ·
                              </span>
                              <span className="text-slate-500">{item.evidenceBasis}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  isOfflineMode
                                    ? handleRunOfflineSearch(item.rawCitation, 'all')
                                    : handleRunOnlineSearch(item.rawCitation, '')
                                }
                                className="ml-1 px-2 py-0.5 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-800 rounded transition-colors cursor-pointer"
                              >
                                {isOfflineMode ? 'Check Local Corpus' : 'Research Online'}
                              </button>
                            </div>
                          </div>

                          <p className="text-xs text-slate-700 leading-relaxed">
                            {item.explanation}
                          </p>

                          <div className="text-[11px] text-slate-500 font-mono-tabular bg-slate-50 p-2.5 rounded border border-slate-200">
                            Draft Context: "...{item.contextSnippet}..."
                          </div>

                          {/* Local Corpus Match Block */}
                          {item.matchedRecord && (
                            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1.5">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-semibold text-slate-900">
                                  Local Corpus Record: {item.matchedRecord.canonicalCitation} (
                                  {item.matchedRecord.sectionOrRule})
                                </span>
                                {item.matchedRecord.officialSourceUrl && (
                                  <a
                                    href={item.matchedRecord.officialSourceUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-slate-900 font-medium underline hover:text-slate-600 flex items-center gap-1"
                                  >
                                    <span>
                                      {item.matchedRecord.officialSourceLabel ||
                                        'Official Repository'}
                                    </span>
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                )}
                              </div>
                              <p className="text-slate-600">{item.matchedRecord.summary}</p>
                              {item.matchedRecord.verbatimExcerpt && (
                                <blockquote className="p-2 bg-white border border-slate-200 rounded font-legal italic text-slate-800">
                                  "{item.matchedRecord.verbatimExcerpt}"
                                </blockquote>
                              )}
                            </div>
                          )}

                          {/* Retrieved Online Sources Block for this Citation */}
                          {item.onlineSources && item.onlineSources.length > 0 && (
                            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-2">
                              <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                                <Globe className="w-3.5 h-3.5 text-slate-700" />
                                <span>
                                  Retrieved Online Evidence ({item.onlineSources.length}{' '}
                                  source(s))
                                </span>
                              </div>
                              <div className="space-y-2">
                                {item.onlineSources.map((src, sIdx) => (
                                  <div
                                    key={sIdx}
                                    className="p-2.5 bg-white border border-slate-200 rounded space-y-1"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="font-semibold text-slate-900">
                                        {src.title}
                                      </span>
                                      <a
                                        href={src.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-slate-900 underline hover:text-slate-600 flex items-center gap-1 whitespace-nowrap"
                                      >
                                        <span>Open Original Source</span>
                                        <ExternalLink className="w-3 h-3" />
                                      </a>
                                    </div>
                                    <div className="text-[11px] text-slate-500 font-mono-tabular">
                                      {src.issuingAuthority} · {src.retrievalStatus}
                                    </div>
                                    <blockquote className="font-legal italic text-slate-800 pt-0.5">
                                      "{src.excerpt}"
                                    </blockquote>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="text-[11px] text-slate-500">
                            <span className="font-semibold text-slate-600">
                              Verification Boundary:{' '}
                            </span>
                            {item.limitationNote}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-8 text-center text-xs text-slate-500 bg-slate-50/60 border border-dashed border-slate-200 rounded-lg space-y-2">
                  <p>
                    Click <strong>"Load Test Sample (Local)"</strong> or{' '}
                    <strong>"Verify Draft Online"</strong> above, or use the Offline Legal
                    Knowledge Base to search local statutory provisions and uploaded session
                    documents.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-200 bg-white px-6 py-4 text-xs text-slate-500">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-4">
          <span>DraftMate AI — Hybrid Multilingual Legal Drafting Studio</span>
          <span>
            Online AI + Live Web Research · Offline Local Corpus + Session Document Search +
            Deterministic Template Fallback
          </span>
        </div>
      </footer>
    </div>
  );
}
