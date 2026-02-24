import { resolvePractice } from "./index";
import type { TemplateProps } from "./index";

export function HipaaNotice({ content, practice: rawPractice }: TemplateProps) {
  const { client_name, date } = content;
  const practice = resolvePractice(rawPractice);

  return (
    <div className="prose prose-warm max-w-none">
      <h1 className="text-2xl font-display font-bold text-warm-800">
        HIPAA Notice of Privacy Practices
      </h1>
      <p className="text-sm text-warm-500">
        {practice.practice_name}
      </p>
      <p className="text-sm text-warm-500 italic">
        Effective Date: January 1, 2026
      </p>

      <p>
        This notice describes how medical information about{" "}
        <strong>{client_name}</strong> may be used and disclosed and how you can
        get access to this information. Please review it carefully.
      </p>

      <h2 className="text-lg font-semibold text-warm-800 mt-6">
        Our Commitment
      </h2>
      <p className="text-sm text-warm-700">
        We are required by law to maintain the privacy of your protected health
        information (PHI), provide you with this notice of our legal duties and
        privacy practices, and follow the terms of the notice currently in
        effect.
      </p>

      <h2 className="text-lg font-semibold text-warm-800 mt-6">
        How We May Use &amp; Disclose Your PHI
      </h2>
      <ul className="list-disc list-inside space-y-1 text-sm text-warm-700">
        <li>
          <strong>Treatment:</strong> To provide, coordinate, or manage your
          care among your treatment team.
        </li>
        <li>
          <strong>Payment:</strong> To bill and collect payment from your
          insurance or you for services provided.
        </li>
        <li>
          <strong>Healthcare Operations:</strong> For quality improvement,
          training, and administrative functions.
        </li>
        <li>
          <strong>As Required by Law:</strong> When required by federal, state,
          or local law.
        </li>
        <li>
          <strong>Health &amp; Safety:</strong> To prevent a serious threat to
          your health or safety, or the health or safety of others.
        </li>
      </ul>

      <h2 className="text-lg font-semibold text-warm-800 mt-6">Your Rights</h2>
      <ul className="list-disc list-inside space-y-1 text-sm text-warm-700">
        <li>Request restrictions on certain uses and disclosures of your PHI.</li>
        <li>
          Receive confidential communications by alternative means or at
          alternative locations.
        </li>
        <li>Inspect and obtain a copy of your PHI.</li>
        <li>Request amendments to your PHI.</li>
        <li>
          Receive an accounting of disclosures of your PHI made in the prior six
          years.
        </li>
        <li>Obtain a paper copy of this notice upon request.</li>
      </ul>

      <h2 className="text-lg font-semibold text-warm-800 mt-6">
        Special Protections for Behavioral Health
      </h2>
      <p className="text-sm text-warm-700">
        Psychotherapy notes, substance use disorder treatment records, and HIV/AIDS
        information receive additional protections under federal and state law. These
        records will not be disclosed without your specific written authorization
        except as required by law.
      </p>

      <h2 className="text-lg font-semibold text-warm-800 mt-6">Complaints</h2>
      <p className="text-sm text-warm-700">
        If you believe your privacy rights have been violated, you may file a
        complaint with our Privacy Officer or with the U.S. Department of Health
        and Human Services. You will not be penalized for filing a complaint.
      </p>

      <p className="mt-6 text-sm text-warm-600">
        By signing below on <strong>{date}</strong>, I acknowledge that I have
        received and reviewed the HIPAA Notice of Privacy Practices for{" "}
        {practice.practice_name}.
      </p>
    </div>
  );
}
