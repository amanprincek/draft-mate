import {
  AbsentAuthorityDisclosure,
  DraftRequestPayload,
  DraftResponsePayload,
  OfflineCorpusMatchItem,
  OfflineKnowledgeSearchRequest,
  OfflineKnowledgeSearchResponse,
  UploadedDocMatchItem
} from '../types/legal';
import {
  LEGAL_CORPUS_RECORDS,
  RECOGNIZED_STATUTES,
  verifyCitationsInText
} from './citationVerifier';
import { getSkillCorpusRecords, LEGAL_SKILLS } from './skills';

export const OFFLINE_CORPUS_SCOPE_DISCLOSURE =
  'Bundled Local Legal Corpus contains 8 curated statutory provisions across 5 Indian Acts (Indian Contract Act 1872, Negotiable Instruments Act 1881, Arbitration and Conciliation Act 1996, Transfer of Property Act 1882, and Code of Civil Procedure 1908). It is a bounded offline reference — not a comprehensive or live-verified statutory database.';

export const SESSION_PERSISTENCE_DISCLOSURE =
  'Uploaded reference documents are held strictly in volatile memory for the active browser session only and are cleared when the page is refreshed or the session ends.';

export const OFFLINE_AI_CAPABILITY_DISCLOSURE =
  'Genuine local generative AI (such as a local LLM runtime or browser LanguageModel API) is not available in this environment. Offline Mode uses DraftMate’s deterministic rule-based legal template and statutory extraction engine. Full generative AI drafting requires a reachable model in Online Mode.';

/**
 * Searches the bundled local legal corpus and session-uploaded reference documents
 * with zero network requests.
 */
export function searchOfflineLegalKnowledge(
  req: OfflineKnowledgeSearchRequest
): OfflineKnowledgeSearchResponse {
  const rawQuery = (req.query || '').trim();
  const scope = req.scope || 'all';
  const sessionDocs = req.sessionDocuments || [];

  if (!rawQuery) {
    return {
      query: '',
      scope,
      corpusMatches: [],
      uploadedDocMatches: [],
      absentAuthorities: [],
      corpusScopeDisclosure: OFFLINE_CORPUS_SCOPE_DISCLOSURE,
      sessionPersistenceDisclosure: SESSION_PERSISTENCE_DISCLOSURE,
      networkRequestsMade: 0,
      timestamp: new Date().toISOString()
    };
  }

  const lowerQuery = rawQuery.toLowerCase();
  const stopWords = new Set([
    'the',
    'and',
    'for',
    'with',
    'under',
    'from',
    'that',
    'this',
    'what',
    'when',
    'where',
    'which',
    'act',
    'section',
    'sec',
    'indian',
    'code',
    'law',
    'legal'
  ]);

  const queryTokens = lowerQuery
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((tok) => tok.length >= 2 && !stopWords.has(tok));

  // Extract explicit section number if queried (e.g. "Section 73", "Sec 56", "S. 138", or bare number with Act)
  const explicitSecMatch = rawQuery.match(/\b(?:section|sec\.?|s\.?|धारा)\s*(\d+[A-Za-z]?)\b/i);
  const queriedSecToken = explicitSecMatch ? explicitSecMatch[1].toLowerCase() : null;

  const corpusMatches: OfflineCorpusMatchItem[] = [];
  const absentAuthorities: AbsentAuthorityDisclosure[] = [];

  if (scope === 'all' || scope === 'corpus_only') {
    for (const rec of LEGAL_CORPUS_RECORDS) {
      const matchReasons: string[] = [];
      const recSecNum = rec.sectionOrRule.replace(/^section\s+/i, '').toLowerCase();

      // 1. Check exact section match
      if (queriedSecToken && recSecNum === queriedSecToken) {
        // If user also specified an Act name in the query, ensure the Act aligns
        const actWords = rec.actOrCaseName
          .toLowerCase()
          .split(/[\s,]+/)
          .filter((w) => w.length >= 4 && w !== 'indian' && w !== '1872' && w !== '1881');
        const queryMentionsAnotherKnownAct = RECOGNIZED_STATUTES.some(
          (st) =>
            st.namePattern.test(rawQuery) &&
            st.canonicalActName.toLowerCase() !== rec.actOrCaseName.toLowerCase()
        );
        if (!queryMentionsAnotherKnownAct) {
          matchReasons.push(`Exact Section Number Match (${rec.sectionOrRule})`);
        } else if (actWords.some((w) => lowerQuery.includes(w))) {
          matchReasons.push(`Exact Section & Statute Match (${rec.canonicalCitation})`);
        }
      }

      // 2. Check canonical citation or alias match
      if (
        lowerQuery.includes(rec.canonicalCitation.toLowerCase()) ||
        rec.aliases.some((al) => lowerQuery.includes(al.toLowerCase()))
      ) {
        matchReasons.push(`Canonical / Alias Citation Match (${rec.canonicalCitation})`);
      }

      // 3. Check statute name match (only when user didn't ask for a DIFFERENT specific section of that Act)
      const queriedDifferentSectionSameAct =
        queriedSecToken !== null && recSecNum !== queriedSecToken;

      if (!queriedDifferentSectionSameAct) {
        if (lowerQuery.includes(rec.actOrCaseName.split(',')[0].toLowerCase())) {
          matchReasons.push(`Statute Name Match (${rec.actOrCaseName})`);
        }

        // 4. Check subject keywords (topic match)
        const matchedKeywords = rec.subjectKeywords.filter((kw) =>
          lowerQuery.includes(kw.toLowerCase())
        );
        if (matchedKeywords.length > 0) {
          matchReasons.push(`Legal Topic / Keyword Match (${matchedKeywords.join(', ')})`);
        }

        // 5. Check verbatim excerpt / summary token match
        if (queryTokens.length > 0) {
          const hay = `${rec.summary} ${rec.verbatimExcerpt}`.toLowerCase();
          const matchedTextTokens = queryTokens.filter(
            (tok) => tok.length >= 4 && hay.includes(tok)
          );
          if (matchedTextTokens.length >= 2 || (queryTokens.length === 1 && matchedTextTokens.length === 1)) {
            matchReasons.push(
              `Statutory Passage Content Match (${matchedTextTokens.slice(0, 4).join(', ')})`
            );
          }
        }
      }

      if (matchReasons.length > 0) {
        corpusMatches.push({
          id: rec.id,
          canonicalCitation: rec.canonicalCitation,
          actOrCaseName: rec.actOrCaseName,
          sectionOrRule: rec.sectionOrRule,
          enactedOrDecidedYear: rec.enactedOrDecidedYear,
          summary: rec.summary,
          verbatimExcerpt: rec.verbatimExcerpt,
          subjectKeywords: rec.subjectKeywords,
          officialSourceUrl: rec.officialSourceUrl,
          officialSourceLabel: rec.officialSourceLabel,
          origin: 'Bundled Local Legal Corpus',
          matchReasons
        });
      }
    }

    // Detect requested statutory sections or case citations that are ABSENT from the local corpus
    const statutoryCitationRegex =
      /\b(?:Section|Sec\.?|S\.|धारा)\s*(\d+[A-Za-z]?)\s*(?:of\s+the\s+|,\s*|\s+in\s+the\s+|\s+)?([A-Za-z\s]+?Act(?:,?\s*\d{4})?)?\b/gi;
    let statMatch: RegExpExecArray | null;
    const checkedKeys = new Set<string>();

    while ((statMatch = statutoryCitationRegex.exec(rawQuery)) !== null) {
      const secTok = statMatch[1].trim();
      const secNum = parseInt(secTok, 10);
      const actPart = (statMatch[2] || rawQuery).trim();
      const key = `${secTok.toLowerCase()}::${actPart.toLowerCase()}`;
      if (checkedKeys.has(key)) continue;
      checkedKeys.add(key);

      const recognizedStatute = RECOGNIZED_STATUTES.find(
        (st) => st.namePattern.test(actPart) || st.namePattern.test(rawQuery)
      );

      if (recognizedStatute) {
        const existsInCorpus = LEGAL_CORPUS_RECORDS.some(
          (r) =>
            r.actOrCaseName.toLowerCase() ===
              recognizedStatute.canonicalActName.toLowerCase() &&
            r.sectionOrRule.toLowerCase() === `section ${secTok.toLowerCase()}`
        );

        if (!existsInCorpus) {
          if (isNaN(secNum) || secNum < 1 || secNum > recognizedStatute.maxSection) {
            absentAuthorities.push({
              queriedAuthority: `Section ${secTok}, ${recognizedStatute.canonicalActName}`,
              recognizedActName: recognizedStatute.canonicalActName,
              sectionToken: secTok,
              status: 'Unverified',
              reason: `Section ${secTok} is outside the enacted statutory range (Sections 1–${recognizedStatute.maxSection}) of the ${recognizedStatute.canonicalActName} and does not exist in the local corpus.`,
              officialActUrl: recognizedStatute.officialSourceUrl,
              officialActLabel: recognizedStatute.officialSourceLabel
            });
          } else {
            const repealedRange = recognizedStatute.repealedRanges?.find(
              ([minR, maxR]) => secNum >= minR && secNum <= maxR
            );
            if (repealedRange) {
              absentAuthorities.push({
                queriedAuthority: `Section ${secTok}, ${recognizedStatute.canonicalActName}`,
                recognizedActName: recognizedStatute.canonicalActName,
                sectionToken: secTok,
                status: 'Unverified',
                reason: `Section ${secTok} of the ${recognizedStatute.canonicalActName} falls within a repealed chapter (Sections ${repealedRange[0]}–${repealedRange[1]}) and is not active in the local corpus.`,
                officialActUrl: recognizedStatute.officialSourceUrl,
                officialActLabel: recognizedStatute.officialSourceLabel
              });
            } else {
              absentAuthorities.push({
                queriedAuthority: `Section ${secTok}, ${recognizedStatute.canonicalActName}`,
                recognizedActName: recognizedStatute.canonicalActName,
                sectionToken: secTok,
                status: 'Partially Verified',
                reason: `The statute (${recognizedStatute.canonicalActName}) is recognized and Section ${secTok} falls within its valid enacted range (1–${recognizedStatute.maxSection}), but Section ${secTok} is ABSENT from the bundled local legal corpus. No statutory text is invented offline; switch to Online Mode or check India Code to verify the exact wording.`,
                officialActUrl: recognizedStatute.officialSourceUrl,
                officialActLabel: recognizedStatute.officialSourceLabel
              });
            }
          }
        }
      } else if (corpusMatches.length === 0) {
        absentAuthorities.push({
          queriedAuthority: statMatch[0].trim(),
          sectionToken: secTok,
          status: 'Unverified',
          reason: `"${statMatch[0].trim()}" is absent from the bundled local legal corpus. Offline Mode never invents statutory provisions or URLs.`
        });
      }
    }

    // Also check if user searched for a case citation (e.g. "X v. Y")
    const caseQueryMatch = rawQuery.match(
      /\b([A-Z][A-Za-z0-9.&'\s]{1,30}?)\s+(?:v\.|vs\.?|versus)\s+([A-Z][A-Za-z0-9.&'\s]{1,30}?)\b/i
    );
    if (caseQueryMatch) {
      absentAuthorities.push({
        queriedAuthority: caseQueryMatch[0].trim(),
        status: 'Unverified',
        reason: `Judicial precedent "${caseQueryMatch[0].trim()}" is absent from the bundled local statutory corpus (which indexes statutory provisions only). Check uploaded session documents or switch to Online Mode to retrieve case law excerpts.`
      });
    }
  }

  // Search session-uploaded reference documents
  const uploadedDocMatches: UploadedDocMatchItem[] = [];
  if ((scope === 'all' || scope === 'uploaded_only') && sessionDocs.length > 0) {
    const searchTerms = [
      rawQuery.toLowerCase(),
      ...queryTokens.filter((t) => t.length >= 3)
    ];

    for (const doc of sessionDocs) {
      if (!doc.text || !doc.text.trim()) continue;
      const paragraphs = doc.text
        .split(/\n{2,}|\r\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean);

      let totalMatchesInDoc = 0;
      const matchedParagraphs: Array<{ paragraphNumber: number; excerpt: string; score: number }> =
        [];

      paragraphs.forEach((para, idx) => {
        const lowerPara = para.toLowerCase();
        let score = 0;
        if (lowerPara.includes(lowerQuery)) {
          score += 5;
          totalMatchesInDoc += 1;
        }
        for (const tok of queryTokens) {
          if (tok.length >= 3 && lowerPara.includes(tok)) {
            score += 1;
            totalMatchesInDoc += 1;
          }
        }
        if (score > 0) {
          matchedParagraphs.push({
            paragraphNumber: idx + 1,
            excerpt: para.length > 420 ? `${para.slice(0, 420)}...` : para,
            score
          });
        }
      });

      // Fallback if single-block document had no double newlines
      if (matchedParagraphs.length === 0 && searchTerms.some((t) => doc.text.toLowerCase().includes(t))) {
        const lowerFull = doc.text.toLowerCase();
        const matchIdx = lowerFull.indexOf(lowerQuery) !== -1
          ? lowerFull.indexOf(lowerQuery)
          : lowerFull.indexOf(queryTokens[0] || lowerQuery);
        if (matchIdx !== -1) {
          const start = Math.max(0, matchIdx - 100);
          const end = Math.min(doc.text.length, matchIdx + 280);
          matchedParagraphs.push({
            paragraphNumber: 1,
            excerpt: doc.text.slice(start, end).trim(),
            score: 2
          });
          totalMatchesInDoc = 1;
        }
      }

      matchedParagraphs
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .forEach((mp) => {
          uploadedDocMatches.push({
            fileName: doc.fileName,
            fileType: doc.fileType,
            matchingExcerpt: mp.excerpt,
            matchCountInDocument: totalMatchesInDoc,
            paragraphNumber: mp.paragraphNumber,
            origin: 'Session Uploaded Reference Document (In-Memory Only)'
          });
        });
    }
  }

  return {
    query: rawQuery,
    scope,
    corpusMatches,
    uploadedDocMatches,
    absentAuthorities,
    corpusScopeDisclosure: OFFLINE_CORPUS_SCOPE_DISCLOSURE,
    sessionPersistenceDisclosure: SESSION_PERSISTENCE_DISCLOSURE,
    networkRequestsMade: 0,
    timestamp: new Date().toISOString()
  };
}

/**
 * Deterministic Local Template & Rule-Based Legal Drafting Fallback Engine.
 * Never simulates generative AI; extracts concrete entities from user instructions
 * and uploaded documents, grounds provisions in the local corpus, and explicitly
 * flags any absent authorities.
 */
export function generateOfflineDeterministicDraft(
  payload: DraftRequestPayload,
  fallbackReason?: string
): DraftResponsePayload {
  const skillConfig = LEGAL_SKILLS[payload.skill] || LEGAL_SKILLS.legal_notice;
  const language = payload.language || 'English';
  const instruction = (payload.instruction || '').trim();
  const refDoc = payload.referenceDocument;
  const hasRefDoc = Boolean(refDoc && refDoc.text && refDoc.text.trim());

  // Search local knowledge for matching corpus provisions and absent authorities mentioned in instruction
  const knowledgeResult = searchOfflineLegalKnowledge({
    query: instruction || skillConfig.label,
    scope: 'all',
    sessionDocuments: hasRefDoc
      ? [
          {
            fileName: refDoc!.fileName,
            fileType: 'txt',
            text: refDoc!.text
          }
        ]
      : []
  });

  const skillCorpus = getSkillCorpusRecords(skillConfig.id);
  const relevantCorpus =
    knowledgeResult.corpusMatches.length > 0
      ? knowledgeResult.corpusMatches
      : skillCorpus.map((c) => ({
          ...c,
          origin: 'Bundled Local Legal Corpus' as const,
          matchReasons: ['Default Skill Grounded Provision']
        }));

  // Deterministic entity extraction from instruction + currentDraft (on revision) + uploaded reference text
  const combinedSourceText = `${instruction}\n${
    payload.currentDraft ? payload.currentDraft.slice(0, 6000) : ''
  }\n${hasRefDoc ? refDoc!.text.slice(0, 4000) : ''}`;
  const amountMatches = combinedSourceText.match(
    /(?:INR|Rs\.?|₹)\s*[\d,]+(?:\.\d{1,2})?(?:\s*(?:lakhs?|crores?))?/gi
  );
  const detectedAmount =
    amountMatches && amountMatches.length > 0
      ? amountMatches[0]
      : '[INSERT CLAIM / CONTRACT AMOUNT]';

  const invoiceMatches = combinedSourceText.match(
    /(?:Invoice|Inv|Cheque|Agreement|Contract|Ref)\s*(?:No\.?|#)?\s*[A-Z0-9-/]{3,25}/gi
  );
  const detectedRefId =
    invoiceMatches && invoiceMatches.length > 0
      ? invoiceMatches[0]
      : '[INSERT INVOICE / AGREEMENT REF NO.]';

  const dateMatches = combinedSourceText.match(
    /\b(?:\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/gi
  );
  const detectedDate =
    dateMatches && dateMatches.length > 0 ? dateMatches[0] : '[INSERT RELEVANT DATE]';

  const periodMatches = combinedSourceText.match(/\b(\d+\s*(?:days?|months?|years?))\b/gi);
  const detectedPeriod =
    periodMatches && periodMatches.length > 0 ? periodMatches[0] : '15 days';

  const multilingualNote =
    language === 'Hindi'
      ? `\n[विधिक अनुवाद एवं उद्धरण अखंडता नोट / TRANSLATION & CITATION INTEGRITY NOTE: सभी पक्षकारों के नाम, तिथियाँ (${detectedDate}), राशियाँ (${detectedAmount}), संदर्भ संख्या (${detectedRefId}), तथा मूल वैधानिक उद्धरण बिना किसी परिवर्तन के सुरक्षित रखे गए हैं ताकि विधिक अर्थ परिवर्तित न हो।]\n`
      : language === 'Hinglish'
      ? `\n[TRANSLATION & LEGAL MEANING NOTE: Hinglish explanation aapki clarity ke liye hai; formal legal enforceability ke liye exact dates (${detectedDate}), amounts (${detectedAmount}), reference numbers (${detectedRefId}), aur canonical statutory citations bina kisi badlav ke preserve kiye gaye hain.]\n`
      : '';

  const absentBlock =
    knowledgeResult.absentAuthorities.length > 0
      ? `\n------------------------------------------------------------------------\nOFFLINE AUTHORITY ABSENCE DISCLOSURE (MANDATORY):\n${knowledgeResult.absentAuthorities
          .map(
            (ab) =>
              `- Requested Authority "${ab.queriedAuthority}" (${ab.status}): ${ab.reason}`
          )
          .join('\n')}\n------------------------------------------------------------------------\n`
      : '';

  const corpusBlock = relevantCorpus
    .map(
      (c, idx) =>
        `${idx + 1}. ${c.canonicalCitation.replace(',', ' of the')}:\n   - Statutory Summary: ${c.summary}\n   - Stored Verbatim Excerpt (Bundled Local Corpus): "${c.verbatimExcerpt}"\n   - Official Reference URL (Not Checked Live Offline): ${c.officialSourceUrl}`
    )
    .join('\n\n');

  const refExcerptBlock = hasRefDoc
    ? `\nEXTRACTED PASSAGES FROM SESSION UPLOADED DOCUMENT ("${refDoc!.fileName}"):\n` +
      (knowledgeResult.uploadedDocMatches.length > 0
        ? knowledgeResult.uploadedDocMatches
            .map(
              (m, i) =>
                `[Passage ${i + 1} · Paragraph ${m.paragraphNumber}]: "${m.matchingExcerpt}"`
            )
            .join('\n')
        : `"${refDoc!.text.slice(0, 600).trim()}..."`) +
      '\n'
    : '';

  const headerNotice = fallbackReason
    ? `[OFFLINE FALLBACK MODE — DETERMINISTIC LOCAL TEMPLATE ENGINE]\nNotice: Online AI service was unreachable or failed (${fallbackReason}). This draft was assembled locally without generative AI using DraftMate's deterministic template engine and bundled local legal corpus.${multilingualNote}`
    : `[OFFLINE MODE — DETERMINISTIC LOCAL TEMPLATE ENGINE]\nNotice: Generated 100% locally without network requests. Full generative AI is not available offline; this working draft is assembled from deterministic legal templates, extracted user facts, and the bundled local legal corpus.${multilingualNote}`;

  let bodyText = '';

  if (payload.mode === 'summarize' && hasRefDoc) {
    const docText = refDoc!.text;
    const paragraphs = docText
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
    const detectedCitationsInDoc = verifyCitationsInText(docText, docText);

    bodyText = `${headerNotice}

========================================================================
DETERMINISTIC OFFLINE DOCUMENT ANALYSIS & EXTRACTION SUMMARY
Source Document: ${refDoc!.fileName} (Session In-Memory Document)
Selected Language: ${language}
========================================================================

1. DOCUMENT METADATA & EXTRACTED ENTITIES
- File Name: ${refDoc!.fileName}
- Total Character Length: ${docText.length} characters (${paragraphs.length} paragraphs)
- Detected Financial Figures: ${amountMatches ? amountMatches.join('; ') : 'None automatically matched'}
- Detected Dates: ${dateMatches ? dateMatches.join('; ') : 'None automatically matched'}
- Detected Reference / Instrument Numbers: ${invoiceMatches ? invoiceMatches.join('; ') : 'None automatically matched'}
- Detected Time Periods: ${periodMatches ? periodMatches.join('; ') : 'None automatically matched'}

2. KEY OPENING & OPERATIVE PASSAGES EXTRACTED FROM DOCUMENT
${paragraphs
  .slice(0, 4)
  .map((p, idx) => `[Paragraph ${idx + 1}]:\n${p}`)
  .join('\n\n')}

3. CITATIONS DETECTED IN UPLOADED DOCUMENT (${detectedCitationsInDoc.totalDetected})
${
  detectedCitationsInDoc.items.length > 0
    ? detectedCitationsInDoc.items
        .map(
          (item) =>
            `- ${item.rawCitation} -> Status: ${item.status} (${item.evidenceBasis})\n  Explanation: ${item.explanation}`
        )
        .join('\n')
    : '- No formal statutory or case citations detected in the uploaded document text.'
}

4. RELEVANT BUNDLED LOCAL CORPUS PROVISIONS FOR ${skillConfig.label.toUpperCase()}
${corpusBlock}
${absentBlock}`;
  } else if (payload.mode === 'revise' && payload.currentDraft) {
    bodyText = `${headerNotice}
${absentBlock}
${payload.currentDraft.trim()}

========================================================================
[OFFLINE DETERMINISTIC REVISION ADDENDUM (${language.toUpperCase()}) — ${new Date().toLocaleDateString()}]
Applied Revision Instruction:
"${instruction}"

Preserved & Updated Legally Significant Particulars:
- Preserved Instrument / Invoice: ${detectedRefId}
- Preserved / Updated Amount: ${detectedAmount}
- Preserved / Updated Date: ${detectedDate}
- Notice / Cure Period: ${detectedPeriod}
${refExcerptBlock}
Grounded Local Corpus Clauses Appended for ${skillConfig.label}:
${corpusBlock}
========================================================================`;
  } else if (skillConfig.id === 'legal_notice') {
    if (language === 'Hindi') {
      bodyText = `${headerNotice}
${absentBlock}
पंजीकृत डाक / स्पीड पोस्ट / ईमेल द्वारा
कानूनी नोटिस (LEGAL NOTICE — स्थानीय टेम्पलेट प्रारूप)

दिनांक: ${detectedDate}
संदर्भ संख्या: ${detectedRefId}

प्रेषक (नोटिसकर्ता के अधिवक्ता):
[INSERT SENDER / ADVOCATE NAME & ADDRESS]

प्रति (प्राप्तकर्ता / विपक्षी):
[INSERT RECIPIENT NAME & REGISTERED ADDRESS]

विषय: ${instruction} के संबंध में औपचारिक कानूनी नोटिस।

महोदय/महोदया,

मेरे मुवक्किल [INSERT CLIENT NAME] के निर्देशानुसार आपको निम्नलिखित कानूनी नोटिस दिया जाता है:

1. तथ्यात्मक विवरण (Statement of Facts):
   - आपके और मेरे मुवक्किल के मध्य दिनांक ${detectedDate} को संव्यवहार / अनुबंध (${detectedRefId}) हुआ था।
   - प्रस्तुत निर्देशों के अनुसार: "${instruction}"
   - बकाया / दावा राशि: ${detectedAmount}।
${refExcerptBlock}
2. लागू वैधानिक प्रावधान (Bundled Local Legal Corpus Provisions):
${corpusBlock}

3. मांग एवं समयावधि (Demand & Cure Period):
   - आपसे अपेक्षा की जाती है कि इस नोटिस की प्राप्ति के ${detectedPeriod} के भीतर राशि ${detectedAmount} का भुगतान करें अथवा अनुबंधीय दायित्वों का पालन करें, अन्यथा आपके विरुद्ध सक्षम न्यायालय में दीवानी/फौजदारी कार्यवाही प्रारंभ की जाएगी।

हस्ताक्षर:
[INSERT ADVOCATE / SENDER SIGNATURE]`;
    } else if (language === 'Hinglish') {
      bodyText = `${headerNotice}
${absentBlock}
REGISTERED AD / EMAIL
FORMAL LEGAL NOTICE (Offline Deterministic Working Draft — Hinglish)

Date: ${detectedDate}
Reference: ${detectedRefId}

To,
[INSERT RECIPIENT NAME & ADDRESS]

From,
[INSERT SENDER / COUNSEL NAME & ADDRESS]

Subject: Legal Notice regarding — ${instruction}

Dear Sir/Madam,

Mere client [INSERT CLIENT NAME] ke instructions par aapko yeh formal Legal Notice serve kiya ja raha hai:

1. Factual Background (Stated Facts Only):
   - User Instruction Summary: "${instruction}"
   - Relevant Reference / Invoice: ${detectedRefId} dated ${detectedDate}
   - Claimed / Disputed Amount: ${detectedAmount}
${refExcerptBlock}
2. Applicable Statutory Basis (From Bundled Local Legal Corpus):
${corpusBlock}

3. Final Demand & Cure Timeline:
   - Aapko notice milne ke ${detectedPeriod} ke andar ${detectedAmount} clear karne ka mauka diya jata hai. Failure hone par civil/criminal recovery proceedings initiate ki jayengi at your risk and cost.

Sincerely,
[INSERT ADVOCATE / AUTHORIZED SIGNATORY]`;
    } else {
      bodyText = `${headerNotice}
${absentBlock}
BY REGISTERED POST A.D. / SPEED POST / EMAIL
FORMAL LEGAL NOTICE

Date: ${detectedDate}
Reference: ${detectedRefId}

TO:
[INSERT RECIPIENT LEGAL ENTITY / INDIVIDUAL NAME]
[INSERT RECIPIENT REGISTERED ADDRESS]

FROM:
[INSERT SENDER / LEGAL COUNSEL NAME]
On behalf of: [INSERT CLAIMANT / CLIENT NAME]
[INSERT SENDER ADDRESS]

SUBJECT: FORMAL LEGAL NOTICE REGARDING — ${instruction.toUpperCase()}

Under instructions from and on behalf of my client, [INSERT CLAIMANT NAME], I hereby serve upon you the following Formal Legal Notice:

1. STATEMENT OF FACTS (STRICTLY AS PROVIDED):
   a. My client and your organization entered into the commercial/legal arrangement referenced as ${detectedRefId} on or around ${detectedDate}.
   b. Specifically, as stated in the drafting instructions: "${instruction}"
   c. The outstanding principal / claimed quantum stands at ${detectedAmount}.
${refExcerptBlock}
2. STATUTORY BASIS & BREACH (GROUNDED IN BUNDLED LOCAL LEGAL CORPUS):
${corpusBlock}

3. DEMAND & CURE PERIOD:
   You are hereby called upon to comply with the demands set out above and remit/resolve the claim of ${detectedAmount} within ${detectedPeriod} from the receipt of this Legal Notice, failing which my client shall institute appropriate civil, arbitral, or statutory proceedings without further reference to you.

Yours faithfully,

[INSERT ADVOCATE / AUTHORIZED SIGNATORY NAME]`;
    }
  } else if (skillConfig.id === 'contract_drafting') {
    bodyText = `${headerNotice}
${absentBlock}
COMMERCIAL AGREEMENT (OFFLINE DETERMINISTIC TEMPLATE — ${language.toUpperCase()})

This Agreement (${detectedRefId}) is executed on ${detectedDate}

BETWEEN:
1. [INSERT FIRST PARTY NAME], having its registered office at [INSERT ADDRESS] ("First Party");
AND
2. [INSERT SECOND PARTY NAME], having its registered office at [INSERT ADDRESS] ("Second Party").

1. PURPOSE & SCOPE OF AGREEMENT (FROM USER INSTRUCTIONS)
   ${instruction}
   Consideration / Contract Value: ${detectedAmount}
   Notice / Cure Period: ${detectedPeriod}
${refExcerptBlock}
2. STATUTORY FORMATION & ENFORCEABILITY CLAUSES (BUNDLED LOCAL CORPUS)
   - Formation & Free Consent: Governed by Section 10 of the Indian Contract Act, 1872.
   - Confidentiality & Trade Restraint Carve-Out: Governed by Section 27 of the Indian Contract Act, 1872 (post-termination restraints on lawful profession/trade are void; confidentiality of proprietary information remains protected during and as permitted by law).
   - Compensation for Breach & Liquidated Damages: Governed by Section 73 of the Indian Contract Act, 1872 and Section 74 of the Indian Contract Act, 1872.
   - Written Arbitration Agreement: Any dispute shall be referred to arbitration in writing in accordance with Section 7 of the Arbitration and Conciliation Act, 1996.

3. GROUNDED LOCAL CORPUS PROVISIONS REFERENCED
${corpusBlock}

IN WITNESS WHEREOF, the Parties have executed this Agreement on ${detectedDate}.

___________________________                 ___________________________
[FIRST PARTY SIGNATORY]                     [SECOND PARTY SIGNATORY]`;
  } else if (skillConfig.id === 'contract_review') {
    bodyText = `${headerNotice}
${absentBlock}
DETERMINISTIC CONTRACT RISK REVIEW & REDLINE CHECKLIST (${language.toUpperCase()})

Date of Audit: ${new Date().toLocaleDateString()}
Reviewed Instruction / Clause:
"${instruction}"
${refExcerptBlock}
1. AUTOMATED STATUTORY RISK AUDIT (AGAINST BUNDLED LOCAL CORPUS)
${corpusBlock}

2. MANDATORY SKILL CHECKLIST VERIFICATION
${skillConfig.skillChecklist.map((item, idx) => `   [${idx + 1}] ${item}`).join('\n')}

3. DETERMINISTIC REDLINE RECOMMENDATIONS
   - Replace any punitive penalty or forfeiture language with reasonable pre-estimated compensation compliant with Section 74 of the Indian Contract Act, 1872.
   - Remove post-termination non-compete restrictions that violate Section 27 of the Indian Contract Act, 1872 and replace with narrowly tailored confidentiality obligations.
   - Ensure direct damages are bounded under Section 73 of the Indian Contract Act, 1872 and dispute resolution is recorded in writing under Section 7 of the Arbitration and Conciliation Act, 1996.`;
  } else {
    bodyText = `${headerNotice}
${absentBlock}
OFFLINE LEGAL RESEARCH MEMORANDUM (LOCAL CORPUS & UPLOADED DOCS ONLY — ${language.toUpperCase()})

1. RESEARCH QUESTION PRESENTED
   ${instruction}

2. SCOPE & OFFLINE LIMITATION DISCLOSURE
   - ${OFFLINE_CORPUS_SCOPE_DISCLOSURE}
   - ${OFFLINE_AI_CAPABILITY_DISCLOSURE}
${refExcerptBlock}
3. MATCHING PROVISIONS IN BUNDLED LOCAL LEGAL CORPUS (${relevantCorpus.length})
${corpusBlock}

4. PROCEDURAL & STATUTORY TAKEAWAYS
${skillConfig.skillChecklist.map((item, idx) => `   ${idx + 1}. ${item}`).join('\n')}`;
  }

  const citationReport = verifyCitationsInText(
    bodyText,
    hasRefDoc ? refDoc!.text : undefined
  );

  return {
    draft: bodyText,
    skill: skillConfig.id,
    language,
    mode: payload.mode,
    ...(hasRefDoc ? { usedReferenceDocument: refDoc!.fileName } : {}),
    citationReport,
    model: 'Deterministic Local Template & Rule-Based Engine (Offline)',
    executionMode: fallbackReason
      ? 'online_failed_offline_fallback'
      : 'offline_deterministic_template',
    ...(fallbackReason ? { fallbackReason } : {}),
    offlineAiAvailable: false,
    networkRequestsMade: 0,
    timestamp: new Date().toISOString()
  };
}
