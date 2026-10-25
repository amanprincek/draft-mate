export type LegalSkillId =
  | 'legal_notice'
  | 'contract_drafting'
  | 'contract_review'
  | 'legal_research';

export type DraftingLanguage = 'English' | 'Hindi' | 'Hinglish';

export type CitationVerificationStatus =
  | 'Verified'
  | 'Partially Verified'
  | 'Unverified';

export type EvidenceOrigin =
  | 'Local Corpus'
  | 'Online Retrieval'
  | 'Local Corpus + Online Retrieval'
  | 'Uploaded Reference Document'
  | 'None';

export interface OnlineSourceEvidence {
  title: string;
  issuingAuthority: string;
  url: string;
  isOfficialSource: boolean;
  excerpt: string;
  retrievalStatus:
    | 'Retrieved (Grounded Web Evidence)'
    | 'Retrieved + Direct HTTP Verified'
    | 'Grounded Snippet Only (Direct Page Fetch Restricted)'
    | 'Inaccessible / Fetch Failed';
  httpStatus?: number;
  currentnessNote: string;
}

export interface LegalCorpusRecord {
  id: string;
  canonicalCitation: string;
  actOrCaseName: string;
  sectionOrRule: string;
  enactedOrDecidedYear: number;
  aliases: string[];
  summary: string;
  verbatimExcerpt: string;
  subjectKeywords: string[];
  officialSourceUrl: string;
  officialSourceLabel: string;
}

export interface CitationVerificationItem {
  rawCitation: string;
  normalizedCitation: string;
  status: CitationVerificationStatus;
  evidenceOrigin: EvidenceOrigin;
  evidenceBasis:
    | 'Corpus Match + Verbatim Excerpt'
    | 'Corpus Match — Context Diverges'
    | 'Online Official Source + Supporting Excerpt'
    | 'Online Source — Partial / Snippet Support Only'
    | 'Recognized Act — Section Not in Local Corpus'
    | 'Matched in Uploaded Reference Document Only'
    | 'Out-of-Range / Non-Existent Section in Known Act'
    | 'Missing from Local Corpus — No Online Evidence Found';
  explanation: string;
  limitationNote: string;
  contextSnippet: string;
  matchedRecord?: {
    id: string;
    canonicalCitation: string;
    actOrCaseName: string;
    sectionOrRule: string;
    summary: string;
    verbatimExcerpt?: string;
    officialSourceUrl?: string;
    officialSourceLabel?: string;
  };
  onlineSources?: OnlineSourceEvidence[];
}

export interface CitationVerificationReport {
  totalDetected: number;
  verifiedCount: number;
  partiallyVerifiedCount: number;
  unverifiedCount: number;
  onlineResearchPerformed: boolean;
  items: CitationVerificationItem[];
  methodologyNote: string;
}

export interface OnlineLegalResearchRequest {
  query: string;
  targetUrl?: string;
}

export interface OnlineLegalResearchResponse {
  query: string;
  status: 'success' | 'empty' | 'inaccessible_source' | 'search_failed';
  summaryFinding: string;
  verificationAssessment: CitationVerificationStatus;
  searchQueriesExecuted: string[];
  sources: OnlineSourceEvidence[];
  limitationNote: string;
  errorDetail?: string;
  timestamp: string;
}

export interface LegalSkillConfig {
  id: LegalSkillId;
  label: string;
  description: string;
  placeholderPrompt: string;
  sampleInstruction: string;
  systemDirective: string;
  skillChecklist: string[];
  corpusReferenceIds: string[];
}

export interface ReferenceDocumentContext {
  fileName: string;
  fileType: 'pdf' | 'docx' | 'txt';
  text: string;
  wordCount: number;
  charCount: number;
  pageCount?: number;
}

export interface DocumentExtractionResponse {
  fileName: string;
  fileType: 'pdf' | 'docx' | 'txt';
  sizeBytes: number;
  text: string;
  wordCount: number;
  charCount: number;
  pageCount?: number;
}

export type WorkspaceConnectivityMode = 'online' | 'offline';

export interface OfflineCorpusMatchItem {
  id: string;
  canonicalCitation: string;
  actOrCaseName: string;
  sectionOrRule: string;
  enactedOrDecidedYear: number;
  summary: string;
  verbatimExcerpt: string;
  subjectKeywords: string[];
  officialSourceUrl: string;
  officialSourceLabel: string;
  origin: 'Bundled Local Legal Corpus';
  matchReasons: string[];
}

export interface AbsentAuthorityDisclosure {
  queriedAuthority: string;
  recognizedActName?: string;
  sectionToken?: string;
  status: 'Partially Verified' | 'Unverified';
  reason: string;
  officialActUrl?: string;
  officialActLabel?: string;
}

export interface UploadedDocMatchItem {
  fileName: string;
  fileType: 'pdf' | 'docx' | 'txt';
  matchingExcerpt: string;
  matchCountInDocument: number;
  paragraphNumber: number;
  origin: 'Session Uploaded Reference Document (In-Memory Only)';
}

export interface OfflineKnowledgeSearchRequest {
  query: string;
  scope?: 'all' | 'corpus_only' | 'uploaded_only';
  sessionDocuments?: Array<{
    fileName: string;
    fileType: 'pdf' | 'docx' | 'txt';
    text: string;
  }>;
}

export interface OfflineKnowledgeSearchResponse {
  query: string;
  scope: 'all' | 'corpus_only' | 'uploaded_only';
  corpusMatches: OfflineCorpusMatchItem[];
  uploadedDocMatches: UploadedDocMatchItem[];
  absentAuthorities: AbsentAuthorityDisclosure[];
  corpusScopeDisclosure: string;
  sessionPersistenceDisclosure: string;
  networkRequestsMade: 0;
  timestamp: string;
}

export interface DraftRequestPayload {
  skill: LegalSkillId;
  language: DraftingLanguage;
  instruction: string;
  currentDraft?: string;
  referenceDocument?: {
    fileName: string;
    text: string;
  };
  verifyOnline?: boolean;
  offlineMode?: boolean;
  mode: 'generate' | 'revise' | 'summarize';
}

export interface DraftResponsePayload {
  draft: string;
  skill: LegalSkillId;
  language: DraftingLanguage;
  mode: 'generate' | 'revise' | 'summarize';
  usedReferenceDocument?: string;
  citationReport: CitationVerificationReport;
  model: string;
  executionMode: 'online_ai' | 'offline_deterministic_template' | 'online_failed_offline_fallback';
  fallbackReason?: string;
  offlineAiAvailable: boolean;
  networkRequestsMade?: number;
  timestamp: string;
}

