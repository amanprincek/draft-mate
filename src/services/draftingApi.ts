import { verifyCitationsInText } from '../config/citationVerifier';
import {
  generateOfflineDeterministicDraft,
  searchOfflineLegalKnowledge
} from '../config/offlineLegalKnowledge';
import {
  CitationVerificationReport,
  DocumentExtractionResponse,
  DraftRequestPayload,
  DraftResponsePayload,
  OfflineKnowledgeSearchRequest,
  OfflineKnowledgeSearchResponse,
  OnlineLegalResearchRequest,
  OnlineLegalResearchResponse
} from '../types/legal';

export async function generateOrReviseDraft(
  payload: DraftRequestPayload
): Promise<DraftResponsePayload> {
  // In explicit Offline Mode, execute 100% locally with zero network requests
  if (payload.offlineMode) {
    return generateOfflineDeterministicDraft({
      ...payload,
      verifyOnline: false
    });
  }

  try {
    const response = await fetch('/api/draft', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const errorMessage =
        data?.error || `Request failed with status ${response.status}.`;
      // Reliable Offline Fallback when online AI service fails
      return generateOfflineDeterministicDraft(
        { ...payload, verifyOnline: false },
        errorMessage
      );
    }

    return data as DraftResponsePayload;
  } catch (err: any) {
    // Reliable Offline Fallback when network is disconnected or unreachable
    const reason =
      err instanceof Error ? err.message : 'Network unreachable during online drafting.';
    return generateOfflineDeterministicDraft(
      { ...payload, verifyOnline: false },
      reason
    );
  }
}

export async function uploadAndExtractDocument(
  file: File
): Promise<DocumentExtractionResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/documents/extract', {
    method: 'POST',
    body: formData
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMessage =
      data?.error || `Document extraction failed with status ${response.status}.`;
    throw new Error(errorMessage);
  }

  return data as DocumentExtractionResponse;
}

export async function verifyDraftCitations(
  text: string,
  referenceText?: string,
  verifyOnline: boolean = false,
  offlineMode: boolean = false
): Promise<CitationVerificationReport> {
  // In Offline Mode (or when local-only verification is requested offline), run locally with 0 network requests
  if (offlineMode || !verifyOnline) {
    return verifyCitationsInText(text, referenceText);
  }

  try {
    const response = await fetch('/api/citations/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text, referenceText, verifyOnline })
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      return verifyCitationsInText(text, referenceText);
    }

    return data as CitationVerificationReport;
  } catch {
    return verifyCitationsInText(text, referenceText);
  }
}

export function searchOfflineKnowledgeBase(
  request: OfflineKnowledgeSearchRequest
): OfflineKnowledgeSearchResponse {
  return searchOfflineLegalKnowledge(request);
}

export async function searchOnlineLegalSources(
  payload: OnlineLegalResearchRequest
): Promise<OnlineLegalResearchResponse> {
  const response = await fetch('/api/research/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMessage =
      data?.error || `Online legal research failed with status ${response.status}.`;
    throw new Error(errorMessage);
  }

  return data as OnlineLegalResearchResponse;
}
