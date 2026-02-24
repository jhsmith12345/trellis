import { resolvePractice } from "./index";
import type { TemplateProps } from "./index";

export function ReleaseOfInfo({ content, practice: rawPractice }: TemplateProps) {
  const { client_name, date } = content;
  const practice = resolvePractice(rawPractice);

  return (
    <div className="prose prose-warm max-w-none">
      <h1 className="text-2xl font-display font-bold text-warm-800">
        Authorization for Release of Information
      </h1>
      <p className="text-sm text-warm-500">
        {practice.practice_name}
      </p>

      <p>
        I, <strong>{client_name}</strong>, authorize{" "}
        {practice.practice_name} to use and/or disclose my protected health
        information as described below.
      </p>

      <h2 className="text-lg font-semibold text-warm-800 mt-6">
        Information to Be Released
      </h2>
      <p className="text-sm text-warm-700">
        This authorization permits the release of treatment summaries, progress
        notes, diagnoses, and treatment plans as necessary for the coordination
        of care. Psychotherapy process notes, HIV/AIDS-related information, and
        substance use disorder records protected under 42 CFR Part 2 will{" "}
        <strong>not</strong> be disclosed unless separately authorized.
      </p>

      <h2 className="text-lg font-semibold text-warm-800 mt-6">
        Purpose of Disclosure
      </h2>
      <ul className="list-disc list-inside space-y-1 text-sm text-warm-700">
        <li>Coordination of care with other treating providers</li>
        <li>Communication with insurance companies for treatment authorization</li>
        <li>Communication with designated family members or support persons</li>
      </ul>

      <h2 className="text-lg font-semibold text-warm-800 mt-6">
        Duration &amp; Revocation
      </h2>
      <ul className="list-disc list-inside space-y-1 text-sm text-warm-700">
        <li>
          This authorization expires 12 months from the date of signature, or
          upon discharge from the program, whichever comes first.
        </li>
        <li>
          You may revoke this authorization at any time by submitting a written
          request. Revocation does not apply to information already released.
        </li>
        <li>
          Treatment, payment, enrollment, or eligibility for benefits will not be
          conditioned on signing this authorization.
        </li>
      </ul>

      <h2 className="text-lg font-semibold text-warm-800 mt-6">
        Re-disclosure Notice
      </h2>
      <p className="text-sm text-warm-700">
        Information disclosed pursuant to this authorization may be subject to
        re-disclosure by the recipient and may no longer be protected by federal
        privacy regulations. However, federal regulations (42 CFR Part 2)
        prohibit the recipient from making any further disclosure of substance
        use disorder records without specific written consent or as otherwise
        permitted by law.
      </p>

      <p className="mt-6 text-sm text-warm-600">
        By signing below on <strong>{date}</strong>, I acknowledge that I have
        read and understand this authorization and voluntarily agree to the
        release of my information as described above.
      </p>
    </div>
  );
}
