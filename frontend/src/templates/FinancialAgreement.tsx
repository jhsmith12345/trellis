import { resolvePractice } from "./index";
import type { TemplateProps } from "./index";

export function FinancialAgreement({ content, practice: rawPractice }: TemplateProps) {
  const {
    client_name,
    date,
    copay,
    coinsurance,
    deductible,
    deductible_remaining,
    session_rate,
    payment_plan,
    insurance_provider,
    policy_number,
  } = content;
  const practice = resolvePractice(rawPractice);

  return (
    <div className="prose prose-warm max-w-none">
      <h1 className="text-2xl font-display font-bold text-warm-800">
        Financial Agreement
      </h1>
      <p className="text-sm text-warm-500">
        {practice.practice_name}
      </p>

      <p>
        This Financial Agreement is entered into between{" "}
        <strong>{client_name}</strong> ("Client") and {practice.practice_name}{" "}
        ("Provider") on <strong>{date}</strong>.
      </p>

      <h2 className="text-lg font-semibold text-warm-800 mt-6">
        Insurance Information
      </h2>
      {insurance_provider && (
        <table className="w-full text-sm border-collapse">
          <tbody>
            <tr className="border-b border-warm-200">
              <td className="py-2 font-medium text-warm-600 w-48">
                Insurance Provider
              </td>
              <td className="py-2 text-warm-800">{insurance_provider}</td>
            </tr>
            {policy_number && (
              <tr className="border-b border-warm-200">
                <td className="py-2 font-medium text-warm-600">
                  Policy Number
                </td>
                <td className="py-2 text-warm-800">{policy_number}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <h2 className="text-lg font-semibold text-warm-800 mt-6">
        Cost Summary
      </h2>
      <table className="w-full text-sm border-collapse">
        <tbody>
          {session_rate && (
            <tr className="border-b border-warm-200">
              <td className="py-2 font-medium text-warm-600 w-48">
                Session Rate
              </td>
              <td className="py-2 text-warm-800">${session_rate}</td>
            </tr>
          )}
          {copay != null && (
            <tr className="border-b border-warm-200">
              <td className="py-2 font-medium text-warm-600">Copay</td>
              <td className="py-2 text-warm-800">${copay}</td>
            </tr>
          )}
          {coinsurance != null && (
            <tr className="border-b border-warm-200">
              <td className="py-2 font-medium text-warm-600">Coinsurance</td>
              <td className="py-2 text-warm-800">{coinsurance}%</td>
            </tr>
          )}
          {deductible != null && (
            <tr className="border-b border-warm-200">
              <td className="py-2 font-medium text-warm-600">Deductible</td>
              <td className="py-2 text-warm-800">${deductible}</td>
            </tr>
          )}
          {deductible_remaining != null && (
            <tr className="border-b border-warm-200">
              <td className="py-2 font-medium text-warm-600">
                Deductible Remaining
              </td>
              <td className="py-2 text-warm-800">${deductible_remaining}</td>
            </tr>
          )}
        </tbody>
      </table>

      {payment_plan && (
        <>
          <h2 className="text-lg font-semibold text-warm-800 mt-6">
            Payment Plan
          </h2>
          <p>{payment_plan}</p>
        </>
      )}

      <h2 className="text-lg font-semibold text-warm-800 mt-6">
        Terms &amp; Conditions
      </h2>
      <ol className="list-decimal list-inside space-y-2 text-sm text-warm-700">
        <li>
          Client is responsible for all copays, coinsurance, and deductible
          amounts as determined by their insurance plan.
        </li>
        <li>
          Payment is due at the time of each session unless other arrangements
          have been made in writing.
        </li>
        <li>
          If insurance denies a claim, Client is responsible for the full session
          rate.
        </li>
        <li>
          A fee of $75 will be charged for missed appointments or cancellations
          with less than 24 hours notice.
        </li>
        <li>
          Provider will submit claims to Client's insurance on their behalf.
        </li>
        <li>
          This agreement remains in effect until services are terminated or a new
          agreement is executed.
        </li>
      </ol>

      <p className="mt-6 text-sm text-warm-600">
        By signing below, I acknowledge that I have read and understand this
        Financial Agreement, and I agree to the terms outlined above.
      </p>
    </div>
  );
}
