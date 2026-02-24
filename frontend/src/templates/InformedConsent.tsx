import { resolvePractice } from "./index";
import type { TemplateProps } from "./index";

export function InformedConsent({ content, practice: rawPractice }: TemplateProps) {
  const { client_name, date } = content;
  const practice = resolvePractice(rawPractice);

  return (
    <div className="prose prose-warm max-w-none">
      <h1 className="text-2xl font-display font-bold text-warm-800">
        Informed Consent for Treatment
      </h1>
      <p className="text-sm text-warm-500">
        {practice.practice_name}
      </p>

      <p>
        I, <strong>{client_name}</strong>, hereby consent to participate in
        behavioral health treatment services provided by{" "}
        {practice.practice_name} and its licensed clinicians.
      </p>

      <h2 className="text-lg font-semibold text-warm-800 mt-6">
        Nature of Services
      </h2>
      <p className="text-sm text-warm-700">
        Treatment may include individual therapy, group therapy, psychoeducation,
        crisis intervention, and care coordination. Your clinician will work with
        you to develop an individualized treatment plan based on your presenting
        needs and goals.
      </p>

      <h2 className="text-lg font-semibold text-warm-800 mt-6">
        Risks &amp; Benefits
      </h2>
      <p className="text-sm text-warm-700">
        Therapy may lead to improved coping, better relationships, and symptom
        reduction. However, it may also involve discussing uncomfortable
        feelings, memories, or experiences. There is no guarantee of specific
        outcomes.
      </p>

      <h2 className="text-lg font-semibold text-warm-800 mt-6">
        Confidentiality
      </h2>
      <p className="text-sm text-warm-700">
        Information disclosed in treatment is confidential and protected by state
        and federal law. Exceptions include: imminent danger to self or others,
        suspected abuse of a child or vulnerable adult, or when required by
        court order.
      </p>

      <h2 className="text-lg font-semibold text-warm-800 mt-6">
        Client Rights
      </h2>
      <ul className="list-disc list-inside space-y-1 text-sm text-warm-700">
        <li>You have the right to ask questions about your treatment at any time.</li>
        <li>You may refuse or discontinue treatment at any time.</li>
        <li>You have the right to request a copy of your records.</li>
        <li>
          You may file a complaint with the state licensing board if you believe
          your rights have been violated.
        </li>
      </ul>

      <h2 className="text-lg font-semibold text-warm-800 mt-6">
        Emergency Procedures
      </h2>
      <p className="text-sm text-warm-700">
        If you are in immediate danger, call 911 or go to your nearest emergency
        room. You may also contact the 988 Suicide &amp; Crisis Lifeline by
        calling or texting 988.
      </p>

      <p className="mt-6 text-sm text-warm-600">
        By signing below on <strong>{date}</strong>, I confirm that I have read
        and understand this Informed Consent, have had the opportunity to ask
        questions, and voluntarily consent to treatment.
      </p>
    </div>
  );
}
