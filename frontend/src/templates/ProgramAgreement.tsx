import { resolvePractice } from "./index";
import type { TemplateProps } from "./index";

export function ProgramAgreement({ content, practice: rawPractice }: TemplateProps) {
  const { client_name, date } = content;
  const practice = resolvePractice(rawPractice);

  return (
    <div className="prose prose-warm max-w-none">
      <h1 className="text-2xl font-display font-bold text-warm-800">
        Program Agreement
      </h1>
      <p className="text-sm text-warm-500">
        {practice.practice_name} — IOP/PHP Program
      </p>

      <p>
        I, <strong>{client_name}</strong>, agree to participate in the Intensive
        Outpatient Program (IOP) or Partial Hospitalization Program (PHP) at{" "}
        {practice.practice_name}, and agree to the following terms.
      </p>

      <h2 className="text-lg font-semibold text-warm-800 mt-6">
        Program Schedule
      </h2>
      <ul className="list-disc list-inside space-y-1 text-sm text-warm-700">
        <li>
          <strong>IOP:</strong> 3 hours per day, 3–5 days per week.
        </li>
        <li>
          <strong>PHP:</strong> 5–6 hours per day, 5 days per week.
        </li>
        <li>
          Your specific schedule will be provided during orientation and may be
          adjusted based on treatment progress.
        </li>
      </ul>

      <h2 className="text-lg font-semibold text-warm-800 mt-6">
        Attendance Policy
      </h2>
      <ol className="list-decimal list-inside space-y-2 text-sm text-warm-700">
        <li>
          Regular attendance is essential to treatment outcomes and may be
          required by your insurance for continued authorization.
        </li>
        <li>
          If you must miss a session, notify your clinician or the front desk as
          early as possible, ideally 24 hours in advance.
        </li>
        <li>
          Three or more unexcused absences may result in discharge from the
          program.
        </li>
        <li>
          Consistent lateness (more than 15 minutes) will be documented and
          addressed with your treatment team.
        </li>
      </ol>

      <h2 className="text-lg font-semibold text-warm-800 mt-6">
        Program Rules &amp; Expectations
      </h2>
      <ol className="list-decimal list-inside space-y-2 text-sm text-warm-700">
        <li>
          Treat all clients, staff, and visitors with respect and dignity.
        </li>
        <li>
          Maintain confidentiality of all group members — what is shared in group
          stays in group.
        </li>
        <li>
          No use of alcohol, drugs, or non-prescribed substances during the
          program. Random drug screening may be conducted.
        </li>
        <li>
          No weapons, violence, threats, or intimidation of any kind.
        </li>
        <li>
          Personal electronic devices must be silenced during group sessions.
        </li>
        <li>
          Romantic or sexual relationships between clients are prohibited during
          program participation.
        </li>
      </ol>

      <h2 className="text-lg font-semibold text-warm-800 mt-6">
        Discharge &amp; Aftercare
      </h2>
      <p className="text-sm text-warm-700">
        Discharge planning begins at admission. Your treatment team will work
        with you to develop an aftercare plan including step-down services,
        ongoing therapy, and community resources. Voluntary discharge is your
        right; however, we strongly recommend discussing discharge with your
        clinician before leaving the program.
      </p>

      <p className="mt-6 text-sm text-warm-600">
        By signing below on <strong>{date}</strong>, I confirm that I have read,
        understand, and agree to the program rules and expectations outlined
        above.
      </p>
    </div>
  );
}
