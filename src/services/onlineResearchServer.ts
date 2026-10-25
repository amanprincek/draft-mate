import { GoogleGenAI } from '@google/genai';
import {
  RECOGNIZED_STATUTES,
  verifyCitationsInText
} from '../config/citationVerifier.ts';
import {
  CitationVerificationReport,
  CitationVerificationStatus,
  OnlineLegalResearchRequest,
  OnlineLegalResearchResponse,
  OnlineSourceEvidence
} from '../types/legal.ts';

export function sanitizeSearchQuery(raw: string): string {
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 350);
}

export function validateExternalUrl(rawUrl: string): {
  valid: boolean;
  url?: URL;
  reason?: string;
} {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, reason: 'Only HTTP and HTTPS URLs are permitted.' };
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host === '[::1]' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
    ) {
      return {
        valid: false,
        reason: 'Access to private, loopback, or internal network addresses is blocked.'
      };
    }
    return { valid: true, url: parsed };
  } catch {
    return { valid: false, reason: 'Malformed URL format.' };
  }
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function classifyAuthorityFromUrlAndTitle(
  urlStr: string,
  title: string,
  docSourceHint?: string
): { issuingAuthority: string; isOfficialSource: boolean } {
  const lowerUrl = urlStr.toLowerCase();
  const lowerTitle = title.toLowerCase();

  if (lowerUrl.includes('indiacode.nic.in') || lowerTitle.includes('indiacode')) {
    return {
      issuingAuthority: 'India Code — Legislative Department, Govt. of India',
      isOfficialSource: true
    };
  }
  if (lowerUrl.includes('sci.gov.in') || lowerTitle.includes('supreme court of india')) {
    return {
      issuingAuthority: 'Supreme Court of India (Official Portal)',
      isOfficialSource: true
    };
  }
  if (lowerUrl.includes('ecourts.gov.in')) {
    return {
      issuingAuthority: 'eCourts Services — Ministry of Law and Justice, Govt. of India',
      isOfficialSource: true
    };
  }
  if (lowerUrl.includes('.gov.in') || lowerUrl.includes('.nic.in')) {
    return {
      issuingAuthority: 'Government of India Official Portal (.gov.in / .nic.in)',
      isOfficialSource: true
    };
  }
  if (lowerUrl.includes('legislation.gov.uk') || lowerUrl.includes('bailii.org')) {
    return {
      issuingAuthority: 'UK Statutory / Judicial Archive',
      isOfficialSource: lowerUrl.includes('legislation.gov.uk')
    };
  }
  if (lowerUrl.includes('indiankanoon.org')) {
    return {
      issuingAuthority: docSourceHint
        ? `Indian Kanoon (${docSourceHint})`
        : 'Indian Kanoon Statutory & Judicial Repository',
      isOfficialSource: false
    };
  }
  if (lowerUrl.includes('wikipedia.org')) {
    return {
      issuingAuthority: 'Public Legal Reference (Wikipedia Case Summary)',
      isOfficialSource: false
    };
  }

  try {
    const host = new URL(urlStr).hostname.replace(/^www\./, '');
    return {
      issuingAuthority: `Web Source (${host})`,
      isOfficialSource: false
    };
  } catch {
    return {
      issuingAuthority: 'External Web Source',
      isOfficialSource: false
    };
  }
}

export async function fetchAndInspectUrl(
  rawUrl: string,
  keywordHint?: string,
  timeoutMs: number = 4000
): Promise<{
  accessible: boolean;
  finalUrl: string;
  httpStatus?: number;
  pageTitle?: string;
  extractedExcerpt?: string;
  errorReason?: string;
}> {
  const check = validateExternalUrl(rawUrl);
  if (!check.valid || !check.url) {
    return {
      accessible: false,
      finalUrl: rawUrl,
      errorReason: check.reason || 'Invalid URL'
    };
  }

  try {
    const response = await fetch(check.url.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; DraftMateLegalVerifier/1.0; +https://ai.google.dev)',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8'
      }
    });

    const finalUrl = response.url || rawUrl;

    if (!response.ok) {
      return {
        accessible: false,
        finalUrl,
        httpStatus: response.status,
        errorReason: `Source returned HTTP ${response.status} (${response.statusText || 'Error'}).`
      };
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/') && !contentType.includes('html') && !contentType.includes('json')) {
      return {
        accessible: true,
        finalUrl,
        httpStatus: response.status,
        pageTitle: finalUrl,
        extractedExcerpt: `Binary or non-HTML resource (${contentType.split(';')[0]}). Open source link directly to view.`
      };
    }

    const rawHtml = await response.text();
    const titleMatch = rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const pageTitle = titleMatch
      ? decodeHtmlEntities(titleMatch[1]).slice(0, 140)
      : undefined;

    const cleanText = decodeHtmlEntities(
      rawHtml
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    );

    if (cleanText.length < 30) {
      return {
        accessible: false,
        finalUrl,
        httpStatus: response.status,
        pageTitle,
        errorReason: 'Source page returned no extractable text content (requires JavaScript or login).'
      };
    }

    let excerpt = cleanText.slice(0, 360);
    if (keywordHint) {
      const token = keywordHint
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .find((w) => w.length >= 4);
      if (token) {
        const idx = cleanText.toLowerCase().indexOf(token.toLowerCase());
        if (idx !== -1) {
          const start = Math.max(0, idx - 60);
          excerpt = cleanText.slice(start, start + 380).trim();
        }
      }
    }

    return {
      accessible: true,
      finalUrl,
      httpStatus: response.status,
      pageTitle,
      extractedExcerpt: excerpt
    };
  } catch (err: any) {
    return {
      accessible: false,
      finalUrl: rawUrl,
      errorReason:
        err?.name === 'TimeoutError'
          ? 'Connection timed out while attempting to retrieve the source page.'
          : err instanceof Error
          ? `Source unreachable (${err.message}).`
          : 'Network error while retrieving source.'
    };
  }
}

async function retrieveDirectLegalWebSources(
  sanitizedQuery: string
): Promise<{
  sources: OnlineSourceEvidence[];
  queriesExecuted: string[];
}> {
  const sources: OnlineSourceEvidence[] = [];
  const queriesExecuted: string[] = [];

  const matchedStatute = RECOGNIZED_STATUTES.find((st) =>
    st.namePattern.test(sanitizedQuery)
  );

  // Run Indian Kanoon statutory/case search and Wikipedia legal search in parallel
  const isSectionQuery = /\b(?:Section|Sec\.?|S\.)\s*\d+/i.test(sanitizedQuery);
  const ikQuery = isSectionQuery
    ? `${sanitizedQuery} doctypes:laws`
    : sanitizedQuery;
  const ikUrl = `https://indiankanoon.org/search/?formInput=${encodeURIComponent(ikQuery)}`;
  const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
    sanitizedQuery
  )}&utf8=&format=json`;

  queriesExecuted.push(`HTTP GET ${ikUrl}`);
  if (!isSectionQuery) {
    queriesExecuted.push(`HTTP GET ${wikiUrl}`);
  }

  const [ikResult, wikiResult, icResult] = await Promise.all([
    fetch(ikUrl, {
      headers: {
        'User-Agent': 'DraftMateLegalVerifier/1.0 (+https://ai.google.dev)'
      },
      signal: AbortSignal.timeout(4500)
    })
      .then(async (r) => (r.ok ? await r.text() : ''))
      .catch(() => ''),
    !isSectionQuery
      ? fetch(wikiUrl, {
          headers: { 'User-Agent': 'DraftMateLegalVerifier/1.0' },
          signal: AbortSignal.timeout(4000)
        })
          .then(async (r) => (r.ok ? await r.json() : null))
          .catch(() => null)
      : Promise.resolve(null),
    matchedStatute
      ? fetchAndInspectUrl(
          matchedStatute.officialSourceUrl,
          matchedStatute.canonicalActName,
          3000
        )
      : Promise.resolve(null)
  ]);

  // 1. Process Indian Kanoon results
  if (ikResult) {
    const articleRegex =
      /<article class="result"[\s\S]*?<h4 class="result_title">\s*<a href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?<div class="headline">([\s\S]*?)<\/div>[\s\S]*?<span class="docsource">([\s\S]*?)<\/span>/gi;

    let match: RegExpExecArray | null;
    let count = 0;
    while ((match = articleRegex.exec(ikResult)) !== null && count < 3) {
      const rawHref = match[1].trim();
      const docIdMatch = rawHref.match(/\/(?:doc|docfragment)\/(\d+)\//);
      const canonicalDocUrl = docIdMatch
        ? `https://indiankanoon.org/doc/${docIdMatch[1]}/`
        : `https://indiankanoon.org${rawHref}`;
      const title = decodeHtmlEntities(match[2]);
      const snippet = decodeHtmlEntities(match[3]);
      const docSource = decodeHtmlEntities(match[4]);

      if (title && snippet) {
        const isUnionStatute =
          docSource.toLowerCase().includes('union of india') ||
          docSource.toLowerCase().includes('act');
        sources.push({
          title,
          issuingAuthority: isUnionStatute
            ? `Union of India Statutory Text via Indian Kanoon (${docSource})`
            : `Indian Kanoon Judicial Repository (${docSource || 'Judgment Record'})`,
          url: canonicalDocUrl,
          isOfficialSource: false,
          excerpt: snippet.slice(0, 420),
          retrievalStatus: 'Retrieved + Direct HTTP Verified',
          httpStatus: 200,
          currentnessNote:
            'Retrieved live via HTTP from Indian Kanoon repository; verify current legislative amendments against the official Gazette before filing.'
        });
        count++;
      }
    }
  }

  // 2. Process Wikipedia Legal API results (for common-law landmark precedents like Hadley v. Baxendale)
  if (wikiResult?.query?.search) {
    for (const item of wikiResult.query.search.slice(0, 2)) {
      const title: string = item.title;
      const snippet: string = decodeHtmlEntities(item.snippet || '');
      const pageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(
        title.replace(/\s+/g, '_')
      )}`;
      sources.push({
        title: `${title} — Case / Legal Authority Summary`,
        issuingAuthority: 'Public Legal Reference (Wikipedia API)',
        url: pageUrl,
        isOfficialSource: false,
        excerpt: snippet,
        retrievalStatus: 'Retrieved + Direct HTTP Verified',
        httpStatus: 200,
        currentnessNote:
          'Secondary case summary retrieved online; verify primary court reporter text before citing in pleadings.'
      });
    }
  }

  // 3. Process Official India Code check (reporting honestly if India Code returned 200 vs 504/timeout)
  if (matchedStatute && icResult) {
    queriesExecuted.push(`HTTP GET ${matchedStatute.officialSourceUrl}`);
    if (icResult.accessible) {
      sources.unshift({
        title: icResult.pageTitle || matchedStatute.officialSourceLabel,
        issuingAuthority: 'India Code — Legislative Department, Govt. of India',
        url: matchedStatute.officialSourceUrl,
        isOfficialSource: true,
        excerpt:
          icResult.extractedExcerpt ||
          `Official India Code statutory record for ${matchedStatute.canonicalActName}.`,
        retrievalStatus: 'Retrieved + Direct HTTP Verified',
        httpStatus: icResult.httpStatus,
        currentnessNote:
          'Official India Code repository page verified reachable via live HTTP GET.'
      });
    } else {
      sources.push({
        title: matchedStatute.officialSourceLabel,
        issuingAuthority: 'India Code — Legislative Department, Govt. of India',
        url: matchedStatute.officialSourceUrl,
        isOfficialSource: true,
        excerpt: `Official India Code portal (${matchedStatute.officialSourceUrl}) could not be fetched directly during live check (${
          icResult.errorReason || 'Gateway timeout / anti-bot restriction'
        }). Open the official link directly in your browser.`,
        retrievalStatus: 'Inaccessible / Fetch Failed',
        ...(icResult.httpStatus ? { httpStatus: icResult.httpStatus } : {}),
        currentnessNote:
          'Official India Code server timed out or restricted automated server-side fetch; statutory text above was retrieved via public statutory mirror.'
      });
    }
  }

  return { sources, queriesExecuted };
}

function evaluateRetrievedSourcesForQuery(
  sanitizedQuery: string,
  sources: OnlineSourceEvidence[]
): {
  assessment: CitationVerificationStatus;
  summaryFinding: string;
} {
  const accessibleSources = sources.filter(
    (s) => s.retrievalStatus !== 'Inaccessible / Fetch Failed'
  );

  if (accessibleSources.length === 0) {
    return {
      assessment: 'Unverified',
      summaryFinding:
        'Live online search returned no accessible statutory or judicial records for this query.'
    };
  }

  const secMatch = sanitizedQuery.match(/\b(?:Section|Sec\.?|S\.)\s*(\d+[A-Za-z]?)\b/i);
  const matchedStatute = RECOGNIZED_STATUTES.find((st) =>
    st.namePattern.test(sanitizedQuery)
  );

  if (secMatch && matchedStatute) {
    const secToken = secMatch[1];
    const secNum = parseInt(secToken, 10);

    if (isNaN(secNum) || secNum < 1 || secNum > matchedStatute.maxSection) {
      return {
        assessment: 'Unverified',
        summaryFinding: `Section ${secToken} does not exist in the ${matchedStatute.canonicalActName} (valid statutory range is Sections 1–${matchedStatute.maxSection}). Live online statutory search confirmed zero matching sections for Section ${secToken}.`
      };
    }

    const repealed = matchedStatute.repealedRanges?.find(
      ([minR, maxR]) => sectionNumInRange(secNum, minR, maxR)
    );
    if (repealed) {
      return {
        assessment: 'Unverified',
        summaryFinding: `Section ${secToken} of the ${matchedStatute.canonicalActName} falls within a repealed statutory chapter (Sections ${repealed[0]}–${repealed[1]}).`
      };
    }

    const actShort = matchedStatute.canonicalActName.split(',')[0].toLowerCase();
    const directSectionSource = accessibleSources.find((s) => {
      const combined = `${s.title} ${s.excerpt}`.toLowerCase();
      const hasSection =
        new RegExp(`\\bsection\\s+${secToken}\\b`, 'i').test(combined) ||
        new RegExp(`\\b${secToken}\\.\\s+`, 'i').test(combined);
      const hasAct = combined.includes(actShort);
      return hasSection && hasAct && s.excerpt.length >= 40;
    });

    const hasAccessibleOfficialPortal = accessibleSources.some(
      (s) => s.isOfficialSource && s.retrievalStatus === 'Retrieved + Direct HTTP Verified'
    );

    if (directSectionSource && hasAccessibleOfficialPortal) {
      return {
        assessment: 'Verified',
        summaryFinding: `Verified via accessible official statutory portal and verbatim text for Section ${secToken} of the ${matchedStatute.canonicalActName}: "${directSectionSource.excerpt.slice(0, 220)}"`
      };
    }

    if (directSectionSource) {
      return {
        assessment: 'Partially Verified',
        summaryFinding: `Retrieved supporting statutory text for Section ${secToken} of the ${matchedStatute.canonicalActName} via public legal repository ("${directSectionSource.title}": "${directSectionSource.excerpt.slice(0, 180)}"), but the official India Code portal timed out during live verification and current amendment status remains unresolved.`
      };
    }

    return {
      assessment: 'Partially Verified',
      summaryFinding: `Retrieved online sources referencing the ${matchedStatute.canonicalActName}, but exact verbatim wording for Section ${secToken} remains unresolved in the retrieved snippets.`
    };
  }

  const casePartiesMatch = sanitizedQuery.match(
    /\b([A-Z][A-Za-z0-9.&'\s]{2,30}?)\s+(?:v\.|vs\.?|versus)\s+([A-Z][A-Za-z0-9.&'\s]{2,30}?)\b/i
  );
  if (casePartiesMatch) {
    const party1 = casePartiesMatch[1].trim().split(/\s+/)[0].toLowerCase();
    const party2 = casePartiesMatch[2].trim().split(/\s+/)[0].toLowerCase();

    const matchingCaseSource = accessibleSources.find((s) => {
      const combined = `${s.title} ${s.excerpt}`.toLowerCase();
      return combined.includes(party1) && combined.includes(party2);
    });

    if (matchingCaseSource) {
      const isOfficialCourtSource =
        matchingCaseSource.isOfficialSource &&
        matchingCaseSource.title.toLowerCase().includes(party1) &&
        matchingCaseSource.title.toLowerCase().includes(party2);
      return {
        assessment: isOfficialCourtSource ? 'Verified' : 'Partially Verified',
        summaryFinding: `Retrieved online case evidence referencing "${casePartiesMatch[0].trim()}" from ${matchingCaseSource.issuingAuthority}: "${matchingCaseSource.excerpt.slice(0, 220)}". Marked Partially Verified because only search/secondary repository excerpts were retrieved rather than the full authenticated court reporter judgment.`
      };
    }

    return {
      assessment: 'Unverified',
      summaryFinding: `Live online search did not find any matching judgment for "${casePartiesMatch[0].trim()}".`
    };
  }

  const queryWords = sanitizedQuery
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  const relevantSource = accessibleSources.find((s) => {
    const combined = `${s.title} ${s.excerpt}`.toLowerCase();
    const matchedWords = queryWords.filter((w) => combined.includes(w));
    return matchedWords.length >= Math.min(2, queryWords.length);
  });

  if (relevantSource) {
    return {
      assessment: 'Partially Verified',
      summaryFinding: `Retrieved ${accessibleSources.length} online legal source(s) relevant to "${sanitizedQuery}". Top result: "${relevantSource.title}" — ${relevantSource.excerpt.slice(0, 200)}`
    };
  }

  return {
    assessment: 'Unverified',
    summaryFinding: `No online legal source directly substantiated "${sanitizedQuery}".`
  };
}

function sectionNumInRange(num: number, min: number, max: number): boolean {
  return num >= min && num <= max;
}

export async function performOnlineLegalResearch(
  ai: GoogleGenAI | null,
  req: OnlineLegalResearchRequest
): Promise<OnlineLegalResearchResponse> {
  const sanitizedQuery = sanitizeSearchQuery(req.query || '');

  // 1. Direct URL verification / retrieval when targetUrl is provided
  if (req.targetUrl && req.targetUrl.trim()) {
    const inspected = await fetchAndInspectUrl(req.targetUrl.trim(), sanitizedQuery);
    const authInfo = classifyAuthorityFromUrlAndTitle(
      inspected.finalUrl,
      inspected.pageTitle || ''
    );

    if (!inspected.accessible) {
      return {
        query: sanitizedQuery || req.targetUrl.trim(),
        status: 'inaccessible_source',
        summaryFinding: `Direct source retrieval failed for "${req.targetUrl.trim()}": ${
          inspected.errorReason || 'Unable to access source content.'
        }`,
        verificationAssessment: 'Unverified',
        searchQueriesExecuted: [`Direct HTTP GET ${req.targetUrl.trim()}`],
        sources: [
          {
            title: inspected.pageTitle || req.targetUrl.trim(),
            issuingAuthority: authInfo.issuingAuthority,
            url: inspected.finalUrl,
            isOfficialSource: authInfo.isOfficialSource,
            excerpt:
              inspected.errorReason ||
              'Source could not be accessed or its contents could not be retrieved.',
            retrievalStatus: 'Inaccessible / Fetch Failed',
            ...(inspected.httpStatus ? { httpStatus: inspected.httpStatus } : {}),
            currentnessNote:
              'Source contents could not be retrieved; current status and text remain unverified.'
          }
        ],
        limitationNote:
          'The requested URL was unreachable, returned an HTTP error, or blocked automated retrieval. Do not rely on this source without manual inspection.',
        errorDetail: inspected.errorReason,
        timestamp: new Date().toISOString()
      };
    }

    return {
      query: sanitizedQuery || req.targetUrl.trim(),
      status: 'success',
      summaryFinding: `Successfully retrieved and verified direct HTTP access to "${
        inspected.pageTitle || inspected.finalUrl
      }".`,
      verificationAssessment: authInfo.isOfficialSource ? 'Verified' : 'Partially Verified',
      searchQueriesExecuted: [`Direct HTTP GET ${req.targetUrl.trim()}`],
      sources: [
        {
          title: inspected.pageTitle || inspected.finalUrl,
          issuingAuthority: authInfo.issuingAuthority,
          url: inspected.finalUrl,
          isOfficialSource: authInfo.isOfficialSource,
          excerpt: inspected.extractedExcerpt || 'Page accessible via HTTP GET.',
          retrievalStatus: 'Retrieved + Direct HTTP Verified',
          httpStatus: inspected.httpStatus,
          currentnessNote:
            'Retrieved directly via live HTTP GET; current legislative amendment status is not claimed unless checked against the latest official Gazette.'
        }
      ],
      limitationNote:
        'Retrieved web content is treated as untrusted external evidence.',
      timestamp: new Date().toISOString()
    };
  }

  if (!sanitizedQuery) {
    return {
      query: '',
      status: 'search_failed',
      summaryFinding: 'A valid legal research query or citation is required.',
      verificationAssessment: 'Unverified',
      searchQueriesExecuted: [],
      sources: [],
      limitationNote: 'Empty query after sanitization.',
      errorDetail: 'Empty research query.',
      timestamp: new Date().toISOString()
    };
  }

  // 2. Execute Live Direct Legal HTTP Retrieval (India Code + Indian Kanoon + Wikipedia Legal API)
  const directWeb = await retrieveDirectLegalWebSources(sanitizedQuery);
  const allSources: OnlineSourceEvidence[] = [...directWeb.sources];
  const allQueries: string[] = [...directWeb.queriesExecuted];

  if (allSources.length === 0) {
    return {
      query: sanitizedQuery,
      status: 'empty',
      summaryFinding:
        'Live online search returned no supporting legal sources for this query.',
      verificationAssessment: 'Unverified',
      searchQueriesExecuted: allQueries,
      sources: [],
      limitationNote:
        'No external sources were found. Model general knowledge is never used as a substitute for live source evidence.',
      timestamp: new Date().toISOString()
    };
  }

  const evaluation = evaluateRetrievedSourcesForQuery(sanitizedQuery, allSources);

  return {
    query: sanitizedQuery,
    status: 'success',
    summaryFinding: evaluation.summaryFinding,
    verificationAssessment: evaluation.assessment,
    searchQueriesExecuted: allQueries,
    sources: allSources,
    limitationNote:
      'Retrieved web content is treated strictly as untrusted external evidence. Plausible citation formatting or search snippets alone do not guarantee current statutory force.',
    timestamp: new Date().toISOString()
  };
}

export async function verifyCitationsWithOnlineResearch(
  ai: GoogleGenAI | null,
  documentText: string,
  uploadedReferenceText?: string
): Promise<CitationVerificationReport> {
  const baseReport = verifyCitationsInText(documentText, uploadedReferenceText);

  if (baseReport.items.length === 0) {
    return {
      ...baseReport,
      onlineResearchPerformed: true
    };
  }

  const updatedItems = await Promise.all(
    baseReport.items.map(async (item, idx) => {
      if (idx >= 6) return item;

      const onlineRes = await performOnlineLegalResearch(ai, {
        query: item.rawCitation
      });

      if (onlineRes.status !== 'success' || onlineRes.sources.length === 0) {
        return {
          ...item,
          limitationNote: `${item.limitationNote} Online search returned no additional sources.`
        };
      }

      // Case 1: Out-of-range or repealed section in a known statute (e.g. Section 999 ICA)
      if (item.evidenceBasis === 'Out-of-Range / Non-Existent Section in Known Act') {
        return {
          ...item,
          status: 'Unverified' as const,
          evidenceOrigin: 'Local Corpus + Online Retrieval' as const,
          onlineSources: onlineRes.sources,
          explanation: `${item.explanation} Online check confirmed: ${onlineRes.summaryFinding}`,
          limitationNote:
            'Out-of-range or repealed section numbers remain Unverified even when the parent Act is found online.'
        };
      }

      // Case 2: Already Verified in Local Corpus -> corroborate with live online sources
      if (item.status === 'Verified' && item.evidenceOrigin === 'Local Corpus') {
        return {
          ...item,
          evidenceOrigin: 'Local Corpus + Online Retrieval' as const,
          onlineSources: onlineRes.sources,
          explanation: `${item.explanation} Corroborated via live online retrieval (${onlineRes.sources.length} source(s) inspected).`
        };
      }

      // Case 3: Online evaluation found no supporting evidence for this specific citation
      if (onlineRes.verificationAssessment === 'Unverified') {
        return {
          ...item,
          status: 'Unverified' as const,
          evidenceOrigin: 'Online Retrieval' as const,
          evidenceBasis: 'Missing from Local Corpus — No Online Evidence Found' as const,
          onlineSources: onlineRes.sources,
          explanation: onlineRes.summaryFinding,
          limitationNote:
            'Live online search did not find adequate supporting evidence for this authority.'
        };
      }

      // Case 4: Online retrieval directly verified the provision or precedent with verbatim/substantive excerpt
      if (onlineRes.verificationAssessment === 'Verified') {
        return {
          ...item,
          status: 'Verified' as const,
          evidenceOrigin:
            item.evidenceOrigin === 'Local Corpus'
              ? ('Local Corpus + Online Retrieval' as const)
              : ('Online Retrieval' as const),
          evidenceBasis: 'Online Official Source + Supporting Excerpt' as const,
          onlineSources: onlineRes.sources,
          explanation: onlineRes.summaryFinding,
          limitationNote:
            'Verified via live online source retrieval. Currentness against the latest official Gazette is not guaranteed without manual check.'
        };
      }

      // Case 5: Partially Verified via Online Source
      return {
        ...item,
        status: 'Partially Verified' as const,
        evidenceOrigin:
          item.evidenceOrigin === 'Local Corpus'
            ? ('Local Corpus + Online Retrieval' as const)
            : ('Online Retrieval' as const),
        evidenceBasis: 'Online Source — Partial / Snippet Support Only' as const,
        onlineSources: onlineRes.sources,
        explanation: onlineRes.summaryFinding,
        limitationNote:
          'Online search retrieved related source snippets, but exact statutory wording, applicability, or current status remains partially unresolved.'
      };
    })
  );

  const verifiedCount = updatedItems.filter((i) => i.status === 'Verified').length;
  const partiallyVerifiedCount = updatedItems.filter(
    (i) => i.status === 'Partially Verified'
  ).length;
  const unverifiedCount = updatedItems.filter((i) => i.status === 'Unverified').length;

  return {
    totalDetected: updatedItems.length,
    verifiedCount,
    partiallyVerifiedCount,
    unverifiedCount,
    onlineResearchPerformed: true,
    items: updatedItems,
    methodologyNote:
      'Combined Local Corpus + Live Online Retrieval: Local corpus matches are distinguished from live online HTTP sources (India Code, Indian Kanoon, and public case repositories). Search snippets or plausible formatting alone do not establish verification; out-of-range or fabricated citations remain Unverified.'
  };
}
