import { FinancialAgreement } from "./FinancialAgreement";
import { InformedConsent } from "./InformedConsent";
import { HipaaNotice } from "./HipaaNotice";
import { TelehealthConsent } from "./TelehealthConsent";
import { ProgramAgreement } from "./ProgramAgreement";
import { ReleaseOfInfo } from "./ReleaseOfInfo";
import type { ComponentType } from "react";

export interface PracticeInfo {
  practice_name: string;
  clinician_name: string;
  phone?: string | null;
  email?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
}

const DEFAULT_PRACTICE: PracticeInfo = {
  practice_name: "Practice",
  clinician_name: "Provider",
};

export function resolvePractice(practice?: PracticeInfo | null): PracticeInfo {
  if (!practice) return DEFAULT_PRACTICE;
  return {
    ...DEFAULT_PRACTICE,
    ...practice,
    practice_name: practice.practice_name || DEFAULT_PRACTICE.practice_name,
    clinician_name: practice.clinician_name || DEFAULT_PRACTICE.clinician_name,
  };
}

export interface TemplateProps {
  content: Record<string, any>;
  practice?: PracticeInfo | null;
}

export const templateRegistry: Record<string, ComponentType<TemplateProps>> = {
  financial_agreement: FinancialAgreement,
  informed_consent: InformedConsent,
  hipaa: HipaaNotice,
  telehealth_consent: TelehealthConsent,
  program_agreement: ProgramAgreement,
  release_of_info: ReleaseOfInfo,
};
