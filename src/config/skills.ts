import {
  DraftingLanguage,
  LegalCorpusRecord,
  LegalSkillConfig,
  LegalSkillId
} from '../types/legal';
import { LEGAL_CORPUS_RECORDS } from './citationVerifier';

export const SUPPORTED_LANGUAGES: { id: DraftingLanguage; label: string; description: string }[] = [
  {
    id: 'English',
    label: 'English',
    description: 'Formal legal English suitable for contracts, notices, and research notes.'
  },
  {
    id: 'Hindi',
    label: 'Hindi (हिन्दी)',
    description: 'Formal legal Hindi (Devanagari script) using standard judicial and contractual terminology.'
  },
  {
    id: 'Hinglish',
    label: 'Hinglish',
    description: 'Conversational Roman-script Hindi + English legal explanation and working draft format.'
  }
];

export const LEGAL_SKILLS: Record<LegalSkillId, LegalSkillConfig> = {
  legal_notice: {
    id: 'legal_notice',
    label: 'Legal Notice',
    description:
      'Draft formal demand notices, breach of contract notices, cheque dishonour notices, or tenancy termination notices.',
    placeholderPrompt:
      'Describe the sender, recipient, key facts, dates, amount or relief demanded, and notice cure period...',
    sampleInstruction:
      'Draft a formal legal notice for non-payment of commercial invoice #INV-2026-104 of INR 4,50,000 for software development services delivered on 10 September 2026, claiming damages for breach of contract under Section 73 of the Indian Contract Act, 1872 and granting 15 days to clear dues.',
    systemDirective:
      'Act as an experienced legal counsel drafting a formal Legal Notice. Structure the notice with clear headings, party placeholders, chronological statement of facts based strictly on user input, applicable statutory basis from the provided corpus records, specific demand/relief sought, and notice cure period.',
    skillChecklist: [
      'Sender & Recipient identification with registered address placeholders',
      'Chronological statement of facts & underlying transaction/invoice particulars',
      'Applicable statutory demand/breach basis (e.g., Section 73 ICA, Section 138 NI Act, Section 106 TPA)',
      'Specific cure timeline (e.g., 15 days) and consequences of non-compliance'
    ],
    corpusReferenceIds: ['ica-1872-s73', 'nia-1881-s138', 'tpa-1882-s106', 'cpc-1908-s80']
  },
  contract_drafting: {
    id: 'contract_drafting',
    label: 'Contract Drafting',
    description:
      'Generate structured commercial agreements, NDAs, service agreements, employment contracts, or lease deeds.',
    placeholderPrompt:
      'Specify the contract type, parties, scope of services/obligations, payment terms, term/termination, and governing law...',
    sampleInstruction:
      'Draft a Mutual Non-Disclosure Agreement between two technology companies evaluating a joint venture in Bengaluru, incorporating valid contract formation under Section 10 of the Indian Contract Act, 1872, restraint-of-trade compliance under Section 27 of the Indian Contract Act, 1872, and written arbitration under Section 7 of the Arbitration and Conciliation Act, 1996.',
    systemDirective:
      'Act as a commercial contracts counsel. Draft a clear, well-structured agreement with numbered clauses (Title, Parties, Recitals, Definitions, Core Obligations, Term & Termination, Confidentiality, Dispute Resolution, and Signature Blocks) grounded in the skill corpus records.',
    skillChecklist: [
      'Competent parties, free consent & lawful consideration (Section 10, Indian Contract Act, 1872)',
      'Enforceable confidentiality vs void restraint of trade carve-out (Section 27, Indian Contract Act, 1872)',
      'Direct damages & liquidated damages structure (Sections 73 & 74, Indian Contract Act, 1872)',
      'Written arbitration clause specifying seat and venue (Section 7, Arbitration and Conciliation Act, 1996)'
    ],
    corpusReferenceIds: ['ica-1872-s10', 'ica-1872-s27', 'ica-1872-s73', 'ica-1872-s74', 'aca-1996-s7']
  },
  contract_review: {
    id: 'contract_review',
    label: 'Contract Review',
    description:
      'Review existing contract text or clauses to identify ambiguities, missing protections, one-sided risks, and suggested redlines.',
    placeholderPrompt:
      'Paste the clause or describe what aspect of the current draft or uploaded reference document you want reviewed and redlined...',
    sampleInstruction:
      'Review the following clause for enforceability and risk under Section 27, Section 73, and Section 74 of the Indian Contract Act, 1872: "Vendor shall pay a punitive penalty of Rs. 50,00,000 for any delay and Vendor’s engineers shall not work in the software industry for 5 years after termination."',
    systemDirective:
      'Act as a contract review counsel. Analyze the provided text or uploaded document to identify commercial and statutory risks, unenforceable penalties or restraints of trade, and provide concrete, balanced redline wording citing the relevant corpus provisions.',
    skillChecklist: [
      'Identify void post-termination non-compete restraints (Section 27, Indian Contract Act, 1872)',
      'Audit uncapped indemnity & consequential loss exposure (Section 73, Indian Contract Act, 1872)',
      'Flag punitive penalties vs reasonable liquidated damages (Section 74, Indian Contract Act, 1872)',
      'Verify written arbitration & dispute resolution mechanics (Sections 7 & 21, Arbitration and Conciliation Act, 1996)'
    ],
    corpusReferenceIds: ['ica-1872-s27', 'ica-1872-s73', 'ica-1872-s74', 'aca-1996-s7']
  },
  legal_research: {
    id: 'legal_research',
    label: 'Legal Research',
    description:
      'Prepare structured legal research memoranda, statutory analyses, and procedural checklists.',
    placeholderPrompt:
      'State the legal question, factual context, and statutory provisions you want analyzed in a structured research memo...',
    sampleInstruction:
      'Prepare a structured legal research memorandum comparing post-employment restraint of trade under Section 27 of the Indian Contract Act, 1872 with damages for breach of confidentiality under Section 73 of the Indian Contract Act, 1872 and arbitration invocation under Section 21 of the Arbitration and Conciliation Act, 1996.',
    systemDirective:
      'Act as a legal research counsel. Produce a structured legal research memorandum organized into Issue Presented, Brief Answer, Statutory Framework (grounded in the provided corpus records), Application to Stated Facts, and Practical Takeaways.',
    skillChecklist: [
      'Precise formulation of Legal Issues Presented',
      'Statutory analysis grounded in verified corpus excerpts (citing canonical section & Act names)',
      'Explicit distinction between verified corpus statutes and unverified external authorities',
      'Practical compliance & risk-mitigation recommendations'
    ],
    corpusReferenceIds: [
      'ica-1872-s10',
      'ica-1872-s27',
      'ica-1872-s73',
      'ica-1872-s74',
      'nia-1881-s138',
      'aca-1996-s7',
      'aca-1996-s21',
      'tpa-1882-s106'
    ]
  }
};

export const LEGAL_SKILL_LIST: LegalSkillConfig[] = Object.values(LEGAL_SKILLS);

export function getSkillCorpusRecords(skillId: LegalSkillId): LegalCorpusRecord[] {
  const skill = LEGAL_SKILLS[skillId] || LEGAL_SKILLS.legal_notice;
  return LEGAL_CORPUS_RECORDS.filter((rec) => skill.corpusReferenceIds.includes(rec.id));
}

export function getLanguageSpecificSystemDirective(language: DraftingLanguage): string {
  if (language === 'Hindi') {
    return `LANGUAGE & MULTILINGUAL INTEGRITY DIRECTIVE (HINDI — हिन्दी):
- Write all operative legal headings, recitals, clauses, and analysis in formal legal Hindi (Devanagari script — औपचारिक विधिक हिन्दी).
- NEVER translate a legal citation in a way that changes its identity: whenever citing a statute or case, include the Hindi reference followed immediately by the exact canonical English citation in parentheses, e.g., "भारतीय संविदा अधिनियम, 1872 की धारा 73 (Section 73 of the Indian Contract Act, 1872)".
- Preserve all party names, dates, monetary amounts (e.g., INR 4,50,000), invoice/instrument numbers, section numbers, case names, and verbatim statutory or contractual quotations without alteration.
- If translating a technical legal term or clause between English and Hindi could alter its legal construction or statutory meaning, explicitly append a "[विधिक अनुवाद स्पष्टता नोट / TRANSLATION UNCERTAINTY FLAG: ...]" explaining the dual terms rather than silently changing the substance.`;
  }

  if (language === 'Hinglish') {
    return `LANGUAGE & MULTILINGUAL INTEGRITY DIRECTIVE (HINGLISH — BILINGUAL EXPLANATION + FORMAL CLAUSES):
- Because Hinglish is suitable for legal explanations and working instructions while operative legal instruments require formal precision, structure the output with:
  1. "HINGLISH LEGAL EXPLANATION & STRATEGY SUMMARY" (conversational Roman-script Hindi + English explaining the legal position, risks, and clause mechanics); AND
  2. "FORMAL OPERATIVE LEGAL CLAUSES / NOTICE TEXT" maintaining formal legal terminology while keeping conversational Hinglish explanatory notes alongside each section.
- NEVER translate or alter the identity of any legal citation: always preserve exact canonical citations such as "Section 73 of the Indian Contract Act, 1872" or "Section 138 of the Negotiable Instruments Act, 1881".
- Preserve all names, dates, amounts, invoice numbers, section numbers, case names, and quotations verbatim.
- Flag any vernacular phrasing that could affect strict legal meaning with "[TRANSLATION & LEGAL MEANING NOTE: ...]".`;
  }

  return `LANGUAGE & MULTILINGUAL INTEGRITY DIRECTIVE (FORMAL LEGAL ENGLISH):
- Draft in formal, precise legal English suitable for commercial contracts, statutory notices, and legal research memoranda.
- If the user's instruction or uploaded document contains Hindi or Hinglish facts, preserve all party names, dates, amounts, invoice/instrument numbers, section numbers, case names, and quotations accurately, and flag any cross-language term whose translation could affect legal meaning with "[TRANSLATION UNCERTAINTY FLAG: ...]".`;
}

export const CORE_SAFETY_AND_ACCURACY_RULES = `
CRITICAL DRAFTING, MULTILINGUAL & CITATION ACCURACY RULES (MANDATORY):
1. DO NOT INVENT MISSING FACTS: Use only the facts, dates, names, amounts, and particulars explicitly provided by the user or uploaded reference document. Whenever specific details are omitted, insert bracketed placeholders such as [INSERT DATE], [INSERT PARTY ADDRESS], or [INSERT AMOUNT].
2. PRESERVE LEGALLY SIGNIFICANT DETAILS ON REVISION OR TRANSLATION: When revising an existing draft or translating across English, Hindi, and Hinglish, strictly preserve all party names, dates, monetary amounts, invoice/reference numbers, section numbers, case names, and verbatim quotations unless the user explicitly instructs to change that specific fact.
3. NEVER TRANSLATE A CITATION IN A WAY THAT CHANGES ITS IDENTITY: Always preserve canonical statutory and case citations (e.g., "Section 73 of the Indian Contract Act, 1872", "Section 27 of the Indian Contract Act, 1872", "Section 74 of the Indian Contract Act, 1872", "Section 138 of the Negotiable Instruments Act, 1881", "Section 7 of the Arbitration and Conciliation Act, 1996", "Section 21 of the Arbitration and Conciliation Act, 1996", "Section 106 of the Transfer of Property Act, 1882") so the automated Citation Verifier can verify them. In Hindi output, pair the Devanagari reference with the exact canonical English citation in parentheses.
4. FLAG TRANSLATION UNCERTAINTY: If translating a legal term, representation, indemnity, or statutory concept between English and Hindi/Hinglish could alter its legal meaning or enforceability, include an explicit "[TRANSLATION UNCERTAINTY FLAG]" instead of silently altering the substance.
5. DO NOT INVENT OR FABRICATE LEGAL AUTHORITIES: Never fabricate case names, reporter citations, or non-existent statutory section numbers. If an authority outside the provided corpus is needed, state the legal principle and mark "[UNVERIFIED EXTERNAL AUTHORITY — REQUIRES INDEPENDENT CHECK]".
`.trim();

