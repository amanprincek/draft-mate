import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileCheck,
  FileSearch,
  FileText,
  Globe,
  HelpCircle,
  Layers,
  Loader2,
  Mic,
  MicOff,
  Plus,
  RefreshCw,
  RotateCcw,
  Scale,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
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
  SupportedRecognitionLocale
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
  // Connectivity & Execution Mode
  const [connectivityMode, setConnectivityMode] = useState<WorkspaceConnectivityMode>('online');
  const [lastExecutionMode, setLastExecutionMode] = useState<
    'online_ai' | 'offline_deterministic_template' | 'online_failed_offline_fallback' | null
  >(null);
  const [lastFallbackReason, setLastFallbackReason] = useState<string | null>(null);
  const [offlineOnlineRequestBlockedMsg, setOfflineOnlineRequestBlockedMsg] = useState<string | null>(null);

  // Step 1: Legal Skill & Language
  const [selectedSkill, setSelectedSkill] = useState<LegalSkillId>('legal_notice');
  const [selectedLanguage, setSelectedLanguage] = useState<DraftingLanguage>('English');

  // Step 2: Uploaded Document & In-Memory Store
  const [uploadedDoc, setUploadedDoc] = useState<DocumentExtractionResponse | null>(null);
  const [sessionDocs, setSessionDocs] = useState<DocumentExtractionResponse[]>([]);
  const [useDocAsReference, setUseDocAsReference] = useState<boolean>(true);
  const [showDocPreview, setShowDocPreview] = useState<boolean>(false);
  const [isExtractingDoc, setIsExtractingDoc] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Step 3: Instruction & Voice
  const [instruction, setInstruction] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingAction, setLoadingAction] = useState<'generate' | 'revise' | 'summarize'>('generate');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Step 4: Draft Workspace
  const [documentTitle, setDocumentTitle] = useState<string>('Untitled Legal Draft');
  const [draftContent, setDraftContent] = useState<string>('');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [lastUsedReference, setLastUsedReference] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string>('');

  // Citations & Evidence
  const [citationReport, setCitationReport] = useState<CitationVerificationReport | null>(null);
  const [isVerifyingCitations, setIsVerifyingCitations] = useState<boolean>(false);
  const [verifyOnlineOnDraft, setVerifyOnlineOnDraft] = useState<boolean>(false);

  // Advanced Tools Accordion / Tabs (Collapsed by default)
  const [isAdvancedOpen, setIsAdvancedOpen] = useState<boolean>(false);
  const [advancedTab, setAdvancedTab] = useState<'citations' | 'research' | 'offline' | 'voice'>('citations');

  // Online Research State (Inside Advanced Section)
  const [researchQuery, setResearchQuery] = useState<string>('');
  const [targetSourceUrl, setTargetSourceUrl] = useState<string>('');
  const [isSearchingOnline, setIsSearchingOnline] = useState<boolean>(false);
  const [onlineResearchResult, setOnlineResearchResult] = useState<OnlineLegalResearchResponse | null>(null);

  // Offline Knowledge Search State (Inside Advanced Section)
  const [offlineQuery, setOfflineQuery] = useState<string>('');
  const [offlineSearchScope, setOfflineSearchScope] = useState<'all' | 'corpus_only' | 'uploaded_only'>('all');
  const [offlineSearchResult, setOfflineSearchResult] = useState<OfflineKnowledgeSearchResponse | null>(null);

  // Voice Interaction State (Speech-to-Text & Text-to-Speech)
  const [recognitionLocale, setRecognitionLocale] = useState<SupportedRecognitionLocale>('en-IN');
  const [isListening, setIsListening] = useState<boolean>(false);
  const [lastRecognizedTranscript, setLastRecognizedTranscript] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [pendingVoiceCommand, setPendingVoiceCommand] = useState<ParsedVoiceCommand | null>(null);
  const [executedVoiceCommandNotice, setExecutedVoiceCommandNotice] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [ttsStatusMessage, setTtsStatusMessage] = useState<string | null>(null);

  const isOfflineMode = connectivityMode === 'offline';
  const activeSkillConfig = LEGAL_SKILLS[selectedSkill];
  const activeSkillCorpus = useMemo(() => getSkillCorpusRecords(selectedSkill), [selectedSkill]);

  const wordCount = useMemo(() => {
    const trimmed = draftContent.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
  }, [draftContent]);

  const charCount = draftContent.length;

  // Handlers
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

      // Execute non-destructive command
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

    // Standard dictation
    setPendingVoiceCommand(null);
    setInstruction((prev) => (prev.trim() ? `${prev.trim()} ${trimmed}` : trimmed));
    setExecutedVoiceCommandNotice(
      `Voice Dictation: added to instructions. Review and click Generate or Revise.`
    );
  };

  const handleConfirmVoiceCommand = async () => {
    if (!pendingVoiceCommand) return;
    const cmd = pendingVoiceCommand;
    setPendingVoiceCommand(null);

    if (cmd.commandType === 'new_draft') {
      handleNewBlankDraft();
      setExecutedVoiceCommandNotice(
        `Confirmed ("${cmd.rawTranscript}"): Cleared workspace and started new draft.`
      );
    } else if (cmd.commandType === 'revise_draft') {
      const revInst = cmd.extractedInstruction || instruction.trim();
      if (revInst) setInstruction(revInst);
      setExecutedVoiceCommandNotice(
        `Confirmed ("${cmd.rawTranscript}"): Revising draft in ${
          isOfflineMode ? 'Offline Mode' : 'Online Mode'
        }.`
      );
      await handleRunDraft('revise');
    } else if (cmd.commandType === 'summarize_document') {
      setExecutedVoiceCommandNotice(
        `Confirmed ("${cmd.rawTranscript}"): Summarizing document in ${
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
      `Cancelled command ("${cancelledText}"). Document was not changed.`
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
      setTtsStatusMessage('Text-to-Speech is not supported in this browser.');
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
        setTtsStatusMessage('Speech synthesis playback encountered an error.');
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
        `Unsupported file type ("${file.name}"). Please upload a PDF (.pdf), Word (.docx), or Plain Text (.txt) file.`
      );
      return;
    }

    if (file.size === 0) {
      setUploadError(`The selected file "${file.name}" is empty (0 bytes).`);
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError(
        `File "${file.name}" (${(file.size / (1024 * 1024)).toFixed(2)} MB) exceeds 10 MB.`
      );
      return;
    }

    setIsExtractingDoc(true);
    try {
      let extracted: DocumentExtractionResponse;
      if (lowerName.endsWith('.txt')) {
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
        err instanceof Error ? err.message : 'Failed to extract text from the document.'
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
        'Online citation retrieval was bypassed because Offline Mode is active. Executed 100% local corpus & uploaded-document citation verification.'
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

    if (isOfflineMode) {
      setOfflineOnlineRequestBlockedMsg(
        `Online web search for "${q || u}" was redirected to local knowledge search because Offline Mode is active.`
      );
      handleRunOfflineSearch(q || u, 'all');
      setIsAdvancedOpen(true);
      setAdvancedTab('offline');
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
      const errMsg =
        err instanceof Error ? err.message : 'Online search request failed.';
      setOnlineResearchResult({
        query: q || u,
        status: 'search_failed',
        summaryFinding: `${errMsg} Automatic Offline Fallback: searched local corpus and session docs.`,
        verificationAssessment: 'Unverified',
        searchQueriesExecuted: [],
        sources: [],
        limitationNote: 'Online research endpoint unreachable; fell back to local search.',
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
      setErrorMessage('Please enter instructions in Step 3 before generating or revising.');
      return;
    }

    if (mode === 'revise' && !draftContent.trim()) {
      setErrorMessage(
        'There is no existing draft in the editor to revise. Generate a draft first.'
      );
      return;
    }

    if (mode === 'summarize' && !uploadedDoc) {
      setErrorMessage('Please upload a document in Step 2 first to summarize it.');
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
        err instanceof Error ? err.message : 'Failed to generate legal draft.'
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
      setCopyStatus('Copied!');
      setTimeout(() => setCopyStatus(''), 2000);
    } catch {
      setErrorMessage('Unable to copy text to clipboard.');
    }
  };

  const handleDownloadDraft = (ext: 'txt' | 'md' = 'txt') => {
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

  const openCitationEvidenceInAdvanced = () => {
    setIsAdvancedOpen(true);
    setAdvancedTab('citations');
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-sm tracking-wide">
              DM
            </div>
            <div>
              <span className="font-bold text-base sm:text-lg text-slate-900 tracking-tight leading-tight block">
                DraftMate AI
              </span>
              <span className="text-[11px] text-slate-500 hidden sm:block">
                Hybrid Multilingual Legal Drafting Studio
              </span>
            </div>
          </div>

          {/* Clean Online / Offline Toggle & Reset */}
          <div className="flex items-center gap-2 sm:gap-3">
            <div
              role="group"
              aria-label="Workspace Connectivity Mode"
              className="flex items-center p-0.5 bg-slate-100 border border-slate-200 rounded-lg text-xs"
            >
              <button
                type="button"
                onClick={() => handleSwitchMode('online')}
                className={`px-3 py-1.5 font-medium rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                  !isOfflineMode
                    ? 'bg-slate-900 text-white shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Wifi className="w-3.5 h-3.5" />
                <span>Online</span>
              </button>
              <button
                type="button"
                onClick={() => handleSwitchMode('offline')}
                className={`px-3 py-1.5 font-medium rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                  isOfflineMode
                    ? 'bg-amber-800 text-white shadow-xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <WifiOff className="w-3.5 h-3.5" />
                <span>Offline</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleNewBlankDraft}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Clear current draft and start fresh"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">New Draft</span>
            </button>
          </div>
        </div>

        {/* Concise Offline / Fallback Notice */}
        {isOfflineMode && (
          <div className="bg-amber-50 border-t border-amber-200 text-amber-900 text-xs px-4 sm:px-6 py-2">
            <div className="max-w-7xl mx-auto flex items-center gap-2">
              <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                Offline mode uses the local legal corpus and template-based drafting. Generative AI is unavailable offline.
              </span>
            </div>
          </div>
        )}

        {!isOfflineMode && lastExecutionMode === 'online_failed_offline_fallback' && (
          <div className="bg-amber-50 border-t border-amber-200 text-amber-900 text-xs px-4 sm:px-6 py-2">
            <div className="max-w-7xl mx-auto flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                Online service was temporarily unreachable ({lastFallbackReason}). Draft was assembled locally via deterministic template fallback.
              </span>
            </div>
          </div>
        )}
      </header>

      {/* Main 4-Step Simplified Workflow */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Global Error Banner */}
        {errorMessage && (
          <div
            role="alert"
            className="p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-start justify-between gap-3 text-xs text-red-900"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-red-700 hover:text-red-900 font-semibold cursor-pointer shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Offline blocked message if online search attempted */}
        {offlineOnlineRequestBlockedMsg && (
          <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-950 flex items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <WifiOff className="w-4 h-4 text-amber-800 shrink-0 mt-0.5" />
              <span>{offlineOnlineRequestBlockedMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setOfflineOnlineRequestBlockedMsg(null)}
              className="text-amber-800 hover:text-amber-950 shrink-0 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 2-Column Responsive Layout: Left = Steps 1, 2, 3; Right = Step 4 (Draft Editor) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column (Steps 1, 2, 3) */}
          <div className="lg:col-span-5 space-y-5">
            {/* STEP 1: Choose a Task */}
            <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-900 text-white text-[11px] font-bold flex items-center justify-center">
                    1
                  </span>
                  <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                    Choose a Task
                  </h2>
                </div>
                <span className="text-xs text-slate-500 font-medium">
                  {activeSkillConfig.label}
                </span>
              </div>

              {/* 4 Clear Cards */}
              <div className="grid grid-cols-2 gap-2.5">
                {LEGAL_SKILL_LIST.map((skill) => {
                  const isSelected = selectedSkill === skill.id;
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => setSelectedSkill(skill.id)}
                      className={`p-3 text-left rounded-lg border transition-all cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                          : 'bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <span className="font-semibold text-xs leading-snug">
                          {skill.label}
                        </span>
                        {isSelected && <Check className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-400" />}
                      </div>
                      <span
                        className={`text-[11px] mt-1 line-clamp-2 ${
                          isSelected ? 'text-slate-300' : 'text-slate-500'
                        }`}
                      >
                        {skill.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {/* STEP 2: Add Your Document (Optional) */}
            <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-900 text-white text-[11px] font-bold flex items-center justify-center">
                    2
                  </span>
                  <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                    Add Your Document
                  </h2>
                </div>
                <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                  Optional
                </span>
              </div>

              <p className="text-xs text-slate-500">
                Upload a PDF, DOCX, or TXT file to provide background context or analyze clauses.
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                onChange={handleFileChange}
                className="hidden"
              />

              {/* Upload Drop/Button Area */}
              {!uploadedDoc ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 hover:border-slate-400 bg-slate-50 hover:bg-slate-100/80 rounded-lg p-4 text-center cursor-pointer transition-colors space-y-1.5"
                >
                  <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center mx-auto">
                    {isExtractingDoc ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4" />
                    )}
                  </div>
                  <div className="text-xs font-semibold text-slate-800">
                    {isExtractingDoc ? 'Extracting readable text...' : 'Click to Upload Document'}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Supports PDF, DOCX, TXT (up to 10 MB)
                  </div>
                </div>
              ) : (
                /* Uploaded File Info Card */
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 truncate">
                        <FileCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span className="truncate">{uploadedDoc.fileName}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono-tabular mt-0.5">
                        <span className="uppercase font-semibold">{uploadedDoc.fileType}</span>
                        <span>·</span>
                        <span>{(uploadedDoc.sizeBytes / 1024).toFixed(1)} KB</span>
                        <span>·</span>
                        <span>{uploadedDoc.wordCount} words</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearUploadedDoc}
                      className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors cursor-pointer"
                      title="Remove file"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Actions for uploaded document */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 text-xs">
                    <label className="flex items-center gap-1.5 font-medium text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useDocAsReference}
                        onChange={(e) => setUseDocAsReference(e.target.checked)}
                        className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                      />
                      <span>Use as Context</span>
                    </label>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowDocPreview((prev) => !prev)}
                        className="text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer font-medium"
                      >
                        {showDocPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        <span>{showDocPreview ? 'Hide' : 'Preview'}</span>
                      </button>
                      <span className="text-slate-300">·</span>
                      <button
                        type="button"
                        onClick={handleLoadExtractedIntoEditor}
                        className="text-slate-700 hover:text-slate-900 underline cursor-pointer font-medium"
                      >
                        Open in Editor
                      </button>
                    </div>
                  </div>

                  {/* Collapsible Extracted Preview */}
                  {showDocPreview && (
                    <div className="max-h-36 overflow-y-auto p-2 bg-white border border-slate-200 rounded text-xs font-mono-tabular text-slate-800 whitespace-pre-wrap leading-relaxed">
                      {uploadedDoc.text.slice(0, 1500)}
                      {uploadedDoc.text.length > 1500 && '... [truncated in preview]'}
                    </div>
                  )}

                  {/* Quick Summarize Action */}
                  <button
                    type="button"
                    disabled={isLoading}
                    onClick={() => handleRunDraft('summarize')}
                    className="w-full py-1.5 px-3 bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <FileSearch className="w-3.5 h-3.5 text-slate-600" />
                    <span>Summarize & Analyze Uploaded Document</span>
                  </button>
                </div>
              )}

              {/* Upload Error */}
              {uploadError && (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{uploadError}</span>
                </div>
              )}
            </section>

            {/* STEP 3: Describe What You Need */}
            <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-slate-900 text-white text-[11px] font-bold flex items-center justify-center">
                    3
                  </span>
                  <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                    Describe What You Need
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={handleLoadSampleInstruction}
                  className="text-xs font-medium text-slate-600 hover:text-slate-900 underline flex items-center gap-1 cursor-pointer"
                >
                  <Sparkles className="w-3 h-3 text-amber-600" />
                  <span>Load Example</span>
                </button>
              </div>

              {/* Language Selector */}
              <div className="flex items-center justify-between gap-2 p-1 bg-slate-100 rounded-lg text-xs">
                <span className="text-[11px] font-semibold text-slate-600 pl-2">
                  Language:
                </span>
                <div className="flex items-center gap-1">
                  {SUPPORTED_LANGUAGES.map((lang) => {
                    const isSelected = selectedLanguage === lang.id;
                    return (
                      <button
                        key={lang.id}
                        type="button"
                        onClick={() => setSelectedLanguage(lang.id)}
                        className={`px-3 py-1 font-medium rounded-md transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-white text-slate-900 font-semibold shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {lang.id}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Large Instruction Textarea with Voice Dictation */}
              <div className="relative">
                <textarea
                  id="instruction-input"
                  rows={4}
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder={
                    uploadedDoc && useDocAsReference
                      ? `Instruct how to use "${uploadedDoc.fileName}" (e.g. draft a response notice citing failure of consideration, or review risk clauses)...`
                      : activeSkillConfig.placeholderPrompt
                  }
                  className="w-full p-3.5 pr-11 text-sm bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:bg-white focus:ring-2 focus:ring-slate-900 leading-relaxed resize-y"
                />

                {/* Quick Dictate Mic Button */}
                <button
                  type="button"
                  aria-label={isListening ? 'Stop listening' : 'Dictate instruction with microphone'}
                  title={isListening ? 'Stop recording' : 'Dictate instructions'}
                  onClick={handleToggleVoiceListening}
                  className={`absolute right-2.5 top-3 p-1.5 rounded-md transition-colors cursor-pointer ${
                    isListening
                      ? 'bg-red-700 text-white animate-pulse'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200'
                  }`}
                >
                  {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
              </div>

              {/* Listening Status & Voice Feedback */}
              {isListening && (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-900 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-red-700 shrink-0" />
                  <span>Listening ({recognitionLocale})... Speak your instruction.</span>
                </div>
              )}

              {executedVoiceCommandNotice && (
                <div className="p-2 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-950 flex items-center justify-between gap-2">
                  <span>{executedVoiceCommandNotice}</span>
                  <button
                    type="button"
                    onClick={() => setExecutedVoiceCommandNotice(null)}
                    className="text-emerald-700 hover:text-emerald-900"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {voiceError && (
                <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-900 flex items-center justify-between gap-2">
                  <span>{voiceError}</span>
                  <button
                    type="button"
                    onClick={() => setVoiceError(null)}
                    className="text-red-700 hover:text-red-900"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Destructive Voice Confirmation dialog */}
              {pendingVoiceCommand && (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-950 space-y-2">
                  <div className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-800 shrink-0" />
                    <span>Confirm Voice Command: "{pendingVoiceCommand.rawTranscript}"</span>
                  </div>
                  <p>{pendingVoiceCommand.actionSummary}</p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleConfirmVoiceCommand}
                      className="px-3 py-1 bg-amber-900 text-white font-semibold rounded hover:bg-amber-950 cursor-pointer"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelVoiceCommand}
                      className="px-3 py-1 bg-white border border-slate-300 rounded font-semibold text-slate-800 hover:bg-slate-100 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Primary "Generate Legal Draft" Button */}
              <button
                type="button"
                disabled={isLoading}
                onClick={() => handleRunDraft('generate')}
                className={`w-full py-3 px-4 text-white text-sm font-semibold rounded-lg transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs disabled:opacity-50 ${
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
                        : `Generate Legal Draft`}
                    </span>
                  </>
                )}
              </button>

              {/* Secondary "Revise Existing Draft" Button (when draft exists) */}
              {draftContent.trim() && (
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => handleRunDraft('revise')}
                  className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-900 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isLoading && loadingAction === 'revise' ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Revising Draft...</span>
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-3.5 h-3.5 text-slate-700" />
                      <span>Revise Existing Draft</span>
                    </>
                  )}
                </button>
              )}
            </section>
          </div>

          {/* Right Column: STEP 4 — View Your Draft */}
          <div className="lg:col-span-7 space-y-4">
            <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-xs space-y-4">
              {/* Step 4 Header & Only 4 Primary Actions Nearby */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-5 h-5 rounded-full bg-slate-900 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                    4
                  </span>
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                      View Your Draft
                    </h2>
                    <input
                      type="text"
                      aria-label="Document Title"
                      value={documentTitle}
                      onChange={(e) => setDocumentTitle(e.target.value)}
                      className="text-xs font-medium text-slate-600 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-900 focus:outline-none w-52 sm:w-72 truncate"
                    />
                  </div>
                </div>

                {/* The 4 Primary Actions: Verify Citations, Copy, Download TXT, Read Aloud */}
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  {/* Action 1: Verify Citations */}
                  <button
                    type="button"
                    disabled={!draftContent.trim() || isVerifyingCitations}
                    onClick={() => handleVerifyCurrentDraft(undefined, !isOfflineMode)}
                    className="px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shadow-xs"
                    title={isOfflineMode ? 'Verify citations using local corpus' : 'Verify citations using corpus and online sources'}
                  >
                    {isVerifyingCitations ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ShieldCheck className="w-3.5 h-3.5" />
                    )}
                    <span>{isVerifyingCitations ? 'Verifying...' : 'Verify Citations'}</span>
                  </button>

                  {/* Action 2: Copy */}
                  <button
                    type="button"
                    disabled={!draftContent.trim()}
                    onClick={handleCopyDraft}
                    className="px-2.5 sm:px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    title="Copy draft to clipboard"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>{copyStatus || 'Copy'}</span>
                  </button>

                  {/* Action 3: Download TXT */}
                  <button
                    type="button"
                    disabled={!draftContent.trim()}
                    onClick={() => handleDownloadDraft('txt')}
                    className="px-2.5 sm:px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    title="Download draft as plain text"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download TXT</span>
                  </button>

                  {/* Action 4: Read Aloud */}
                  <button
                    type="button"
                    disabled={!draftContent.trim()}
                    onClick={handleToggleReadAloud}
                    className={`px-2.5 sm:px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-40 ${
                      isSpeaking
                        ? 'bg-amber-800 text-white hover:bg-amber-900'
                        : 'text-slate-700 bg-slate-100 hover:bg-slate-200'
                    }`}
                    title={isSpeaking ? 'Stop text-to-speech audio' : 'Read draft aloud using browser Text-to-Speech'}
                  >
                    {isSpeaking ? (
                      <>
                        <VolumeX className="w-3.5 h-3.5" />
                        <span>Stop</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-3.5 h-3.5" />
                        <span>Read Aloud</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* TTS Status banner */}
              {ttsStatusMessage && (
                <div className="p-2 bg-slate-50 border border-slate-200 rounded text-xs text-slate-700 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-slate-600" />
                    <span>{ttsStatusMessage}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTtsStatusMessage(null)}
                    className="text-slate-400 hover:text-slate-700"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Loading State Skeleton */}
              {isLoading && (
                <div className="p-5 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                  <div className="flex items-center justify-between text-xs font-medium text-slate-700">
                    <span className="flex items-center gap-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-900" />
                      {loadingAction === 'summarize'
                        ? `Summarizing "${uploadedDoc?.fileName}" in ${selectedLanguage}...`
                        : loadingAction === 'revise'
                        ? `Revising draft in ${selectedLanguage}...`
                        : `Generating ${activeSkillConfig.label} in ${selectedLanguage}...`}
                    </span>
                    <span className="font-mono-tabular text-slate-500 text-[11px]">
                      {isOfflineMode
                        ? 'Offline Deterministic Template Engine'
                        : 'Gemini AI'}
                    </span>
                  </div>
                  <div className="space-y-2 animate-pulse pt-2">
                    <div className="h-3 bg-slate-200 rounded w-1/3" />
                    <div className="h-3 bg-slate-200 rounded w-full" />
                    <div className="h-3 bg-slate-200 rounded w-5/6" />
                    <div className="h-3 bg-slate-200 rounded w-2/3" />
                  </div>
                </div>
              )}

              {/* Empty State vs Editable Document Canvas */}
              {!draftContent && !isLoading ? (
                <div className="py-16 px-6 bg-slate-50/70 border border-dashed border-slate-300 rounded-xl text-center space-y-3">
                  <div className="w-12 h-12 rounded-full bg-slate-200/80 text-slate-600 flex items-center justify-center mx-auto">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold text-slate-800">
                      No draft generated yet
                    </h3>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                      Choose a task, describe what you need, and generate your draft.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleLoadSampleInstruction}
                    className="px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg transition-colors inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                    <span>Load Example</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <textarea
                    aria-label="Editable Legal Document Workspace"
                    rows={18}
                    value={draftContent}
                    onChange={(e) => setDraftContent(e.target.value)}
                    placeholder="Your legal draft will appear here for editing..."
                    className="w-full p-4 bg-slate-50/50 border border-slate-200 rounded-lg font-legal text-sm leading-relaxed text-slate-900 focus:outline-none focus:bg-white focus:border-slate-400 shadow-inner"
                  />
                  {/* Status footer for editor */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 font-mono-tabular px-1">
                    <div className="flex items-center gap-2">
                      <span>Words: {wordCount}</span>
                      <span>·</span>
                      <span>Chars: {charCount}</span>
                      {lastUpdated && (
                        <>
                          <span>·</span>
                          <span>Updated: {lastUpdated}</span>
                        </>
                      )}
                    </div>
                    {lastExecutionMode && (
                      <span
                        className={
                          lastExecutionMode === 'online_ai'
                            ? 'text-emerald-700 font-semibold'
                            : 'text-amber-800 font-semibold'
                        }
                      >
                        {lastExecutionMode === 'online_ai'
                          ? 'Engine: Gemini AI'
                          : 'Engine: Offline Template'}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Compact Citation Status Summary Bar (When citations have been verified) */}
              {citationReport && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-800">Citations:</span>
                    <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold text-[11px]">
                      Verified: {citationReport.verifiedCount}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold text-[11px]">
                      Partially Verified: {citationReport.partiallyVerifiedCount}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-red-100 text-red-800 font-semibold text-[11px]">
                      Unverified: {citationReport.unverifiedCount}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={openCitationEvidenceInAdvanced}
                    className="text-xs font-semibold text-slate-900 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <span>View Detailed Evidence</span>
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </section>
          </div>
        </div>

        {/* Collapsible Advanced Tools Section (Progressive Disclosure - Collapsed by Default) */}
        <section className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
          {/* Collapsible Header */}
          <button
            type="button"
            onClick={() => setIsAdvancedOpen((prev) => !prev)}
            className="w-full px-5 py-4 flex items-center justify-between bg-slate-50 hover:bg-slate-100/80 transition-colors text-left cursor-pointer border-b border-slate-200"
          >
            <div className="flex items-center gap-2.5">
              <Sliders className="w-4 h-4 text-slate-700" />
              <div>
                <span className="text-sm font-bold text-slate-900">
                  Advanced Tools & Legal Research
                </span>
                <span className="text-xs text-slate-500 ml-2 hidden sm:inline">
                  (Online Search, Offline Knowledge, Detailed Citations, Voice Settings)
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <span>{isAdvancedOpen ? 'Collapse' : 'Expand'}</span>
              {isAdvancedOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </button>

          {/* Collapsed content container */}
          {isAdvancedOpen && (
            <div className="p-5 sm:p-6 space-y-5">
              {/* Tabs Bar */}
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-3 text-xs">
                {[
                  { id: 'citations' as const, label: 'Citation Evidence & Presets', icon: ShieldCheck },
                  { id: 'research' as const, label: 'Online Legal Research', icon: Globe },
                  { id: 'offline' as const, label: 'Offline Knowledge Search', icon: Database },
                  { id: 'voice' as const, label: 'Voice Settings & Commands', icon: Mic }
                ].map((tab) => {
                  const Icon = tab.icon;
                  const isActive = advancedTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setAdvancedTab(tab.id)}
                      className={`px-3 py-1.5 font-medium rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer ${
                        isActive
                          ? 'bg-slate-900 text-white font-semibold'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* TAB 1: Citation Evidence & Presets */}
              {advancedTab === 'citations' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Citation Verification Details & Test Presets
                      </h3>
                      <p className="text-xs text-slate-500">
                        Detailed statutory breakdown, local corpus matching, and live online retrieval.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleLoadCitationTestSample(false)}
                        className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                      >
                        Load Test Sample (Local)
                      </button>
                      <button
                        type="button"
                        disabled={isVerifyingCitations || isOfflineMode}
                        onClick={() => handleLoadCitationTestSample(true)}
                        className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 rounded-lg transition-colors cursor-pointer"
                      >
                        Load Test Sample + Online
                      </button>
                    </div>
                  </div>

                  {citationReport ? (
                    <div className="space-y-3">
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
                        <div className="font-semibold text-slate-900">Methodology & Boundary:</div>
                        <p className="text-slate-600">{citationReport.methodologyNote}</p>
                      </div>

                      {citationReport.items.length === 0 ? (
                        <div className="py-6 text-center text-xs text-slate-500 bg-slate-50 rounded-lg border border-slate-200">
                          No statutory or judicial citations were detected in the draft.
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-200">
                          {citationReport.items.map((item, idx) => (
                            <div key={idx} className="py-3.5 space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  {item.status === 'Verified' && (
                                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                  )}
                                  {item.status === 'Partially Verified' && (
                                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                                  )}
                                  {item.status === 'Unverified' && (
                                    <ShieldAlert className="w-4 h-4 text-red-600 shrink-0" />
                                  )}
                                  <span className="font-bold text-xs font-mono-tabular text-slate-900">
                                    {item.rawCitation}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-xs font-mono-tabular">
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
                                  <span>·</span>
                                  <span className="text-slate-600">Origin: {item.evidenceOrigin}</span>
                                </div>
                              </div>

                              <p className="text-xs text-slate-700">{item.explanation}</p>

                              {item.matchedRecord && (
                                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded text-xs space-y-1">
                                  <div className="font-semibold text-slate-900">
                                    Local Corpus Record: {item.matchedRecord.canonicalCitation}
                                  </div>
                                  <p className="text-slate-600">{item.matchedRecord.summary}</p>
                                  {item.matchedRecord.verbatimExcerpt && (
                                    <blockquote className="p-2 bg-white border border-slate-200 rounded italic text-slate-800">
                                      "{item.matchedRecord.verbatimExcerpt}"
                                    </blockquote>
                                  )}
                                </div>
                              )}

                              {item.onlineSources && item.onlineSources.length > 0 && (
                                <div className="p-2.5 bg-slate-50 border border-slate-200 rounded text-xs space-y-1.5">
                                  <div className="font-semibold text-slate-900 flex items-center gap-1">
                                    <Globe className="w-3.5 h-3.5 text-slate-700" />
                                    <span>Online Sources ({item.onlineSources.length})</span>
                                  </div>
                                  {item.onlineSources.map((src, sIdx) => (
                                    <div key={sIdx} className="p-2 bg-white border border-slate-200 rounded text-xs">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="font-semibold">{src.title}</span>
                                        <a
                                          href={src.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-slate-900 underline flex items-center gap-1"
                                        >
                                          <span>Link</span>
                                          <ExternalLink className="w-3 h-3" />
                                        </a>
                                      </div>
                                      <div className="text-[11px] text-slate-500 font-mono-tabular">
                                        {src.issuingAuthority} · {src.retrievalStatus}
                                      </div>
                                      <p className="italic text-slate-700 mt-1">"{src.excerpt}"</p>
                                    </div>
                                  ))}
                                </div>
                              )}

                              <div className="text-[11px] text-slate-500">
                                <strong>Boundary:</strong> {item.limitationNote}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="py-8 text-center text-xs text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-lg">
                      No citations verified yet. Click "Verify Citations" above or load the test sample.
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: Online Legal Research */}
              {advancedTab === 'research' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Live Online Legal Research & URL Inspector
                    </h3>
                    <p className="text-xs text-slate-500">
                      Search statutes or inspect official repository links via live retrieval.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                    <input
                      type="text"
                      value={researchQuery}
                      onChange={(e) => setResearchQuery(e.target.value)}
                      placeholder="Search query (e.g. Section 56 Indian Contract Act)..."
                      className="md:col-span-6 px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                    <input
                      type="text"
                      value={targetSourceUrl}
                      onChange={(e) => setTargetSourceUrl(e.target.value)}
                      placeholder="Optional Source URL (https://...)"
                      className="md:col-span-4 px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 font-mono-tabular focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                    <button
                      type="button"
                      disabled={isSearchingOnline || (!researchQuery.trim() && !targetSourceUrl.trim())}
                      onClick={() => handleRunOnlineSearch()}
                      className="md:col-span-2 px-3 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      {isSearchingOnline ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Search className="w-3.5 h-3.5" />
                      )}
                      <span>{isSearchingOnline ? 'Searching...' : 'Search'}</span>
                    </button>
                  </div>

                  {/* Quick Presets */}
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="text-slate-500">Presets:</span>
                    {[
                      { label: 'Section 73 ICA', q: 'Section 73 Indian Contract Act, 1872' },
                      { label: 'Section 56 (Frustration)', q: 'Section 56 Indian Contract Act, 1872' },
                      { label: 'Hadley v Baxendale', q: 'Hadley v Baxendale 1854 EWHC J70' }
                    ].map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => handleRunOnlineSearch(p.q, '')}
                        className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded text-slate-700 cursor-pointer"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  {/* Research Results */}
                  {onlineResearchResult && (
                    <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">
                          Result for: "{onlineResearchResult.query}"
                        </span>
                        <span className="font-semibold font-mono-tabular">
                          Assessment: {onlineResearchResult.verificationAssessment}
                        </span>
                      </div>
                      <p className="text-slate-700">{onlineResearchResult.summaryFinding}</p>

                      {onlineResearchResult.sources.length > 0 && (
                        <div className="space-y-1.5 pt-1">
                          {onlineResearchResult.sources.map((src, i) => (
                            <div key={i} className="p-2 bg-white border border-slate-200 rounded">
                              <div className="flex items-center justify-between">
                                <span className="font-semibold">{src.title}</span>
                                <a
                                  href={src.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="underline text-slate-900 flex items-center gap-1"
                                >
                                  <span>View Source</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>
                              <p className="italic text-slate-600 mt-1">"{src.excerpt}"</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: Offline Knowledge Search */}
              {advancedTab === 'offline' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Offline Legal Knowledge Base & Document Search
                    </h3>
                    <p className="text-xs text-slate-500">
                      Works 100% offline with zero network calls. Searches local corpus & uploaded files.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                    <input
                      type="text"
                      value={offlineQuery}
                      onChange={(e) => setOfflineQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRunOfflineSearch();
                      }}
                      placeholder="Search section, keyword, or text..."
                      className="md:col-span-7 px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900"
                    />
                    <select
                      value={offlineSearchScope}
                      onChange={(e) =>
                        setOfflineSearchScope(
                          e.target.value as 'all' | 'corpus_only' | 'uploaded_only'
                        )
                      }
                      className="md:col-span-3 px-2.5 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-800"
                    >
                      <option value="all">All (Corpus + Uploaded)</option>
                      <option value="corpus_only">Bundled Corpus Only</option>
                      <option value="uploaded_only">
                        Uploaded Docs ({sessionDocs.length})
                      </option>
                    </select>
                    <button
                      type="button"
                      disabled={!offlineQuery.trim()}
                      onClick={() => handleRunOfflineSearch()}
                      className="md:col-span-2 px-3 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>Search Local</span>
                    </button>
                  </div>

                  {/* Offline Search Presets */}
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="text-slate-500">Presets:</span>
                    {[
                      { label: 'Section 73 ICA', q: 'Section 73 Indian Contract Act' },
                      { label: 'Dishonour of Cheque', q: 'dishonour of cheque 138' },
                      { label: 'Absent Sec 56', q: 'Section 56 Indian Contract Act' }
                    ].map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => handleRunOfflineSearch(p.q, 'all')}
                        className="px-2 py-0.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded text-slate-700 cursor-pointer"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  {/* Offline Search Results */}
                  {offlineSearchResult && (
                    <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-3">
                      <div className="flex items-center justify-between font-mono-tabular">
                        <span className="font-semibold text-slate-900">
                          Query: "{offlineSearchResult.query}"
                        </span>
                        <span>
                          Matches: {offlineSearchResult.corpusMatches.length + offlineSearchResult.uploadedDocMatches.length} · Network: 0
                        </span>
                      </div>

                      {offlineSearchResult.corpusMatches.map((m) => (
                        <div key={m.id} className="p-2.5 bg-white border border-slate-200 rounded space-y-1">
                          <div className="font-semibold text-slate-900">
                            {m.canonicalCitation} ({m.sectionOrRule})
                          </div>
                          <p className="text-slate-700">{m.summary}</p>
                          <blockquote className="italic text-slate-600 bg-slate-50 p-1.5 rounded">
                            "{m.verbatimExcerpt}"
                          </blockquote>
                        </div>
                      ))}

                      {offlineSearchResult.corpusMatches.length === 0 &&
                        offlineSearchResult.uploadedDocMatches.length === 0 && (
                          <div className="p-2 text-slate-500">
                            No local matches found in bundled corpus or session files.
                          </div>
                        )}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: Voice Settings & Command Cheatsheet */}
              {advancedTab === 'voice' && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Voice Recognition Settings & Command Presets
                    </h3>
                    <p className="text-xs text-slate-500">
                      Configure your speech locale or test commands without a microphone.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <label className="font-semibold text-slate-700">Recognition Locale:</label>
                    <select
                      value={recognitionLocale}
                      onChange={(e) =>
                        setRecognitionLocale(e.target.value as SupportedRecognitionLocale)
                      }
                      className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-800"
                    >
                      {SUPPORTED_RECOGNITION_LOCALES.map((l) => (
                        <option key={l.locale} value={l.locale}>
                          {l.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-800">
                      Test Speech Commands (Click to simulate microphone):
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {[
                        { label: 'New Draft', cmd: 'Start a new draft' },
                        { label: 'Select Legal Notice', cmd: 'Select Legal Notice' },
                        { label: 'Select Contract Review', cmd: 'Select Contract Review' },
                        { label: 'Switch to Offline', cmd: 'Switch to Offline Mode' },
                        { label: 'Switch to Online', cmd: 'Switch to Online Mode' }
                      ].map((c) => (
                        <button
                          key={c.label}
                          type="button"
                          onClick={() => handleProcessSpeechTranscript(c.cmd)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-md text-slate-700 cursor-pointer"
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      {/* Clean Footer */}
      <footer className="mt-auto border-t border-slate-200 bg-white px-4 sm:px-6 py-4 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <span>DraftMate AI · Hybrid Multilingual Legal Drafting Studio</span>
          <span>Online Gemini AI + Offline Local Knowledge & Templates</span>
        </div>
      </footer>
    </div>
  );
}
