import { Button } from "../Button";

interface SignatureConfirmProps {
  signaturePng: string;
  onConfirm: () => void;
  onDrawNew: () => void;
  disabled?: boolean;
}

export function SignatureConfirm({
  signaturePng,
  onConfirm,
  onDrawNew,
  disabled,
}: SignatureConfirmProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-warm-600">
        Use your saved signature:
      </p>
      <div className="border-2 border-warm-200 rounded-xl overflow-hidden bg-white p-4 flex items-center justify-center">
        <img
          src={signaturePng}
          alt="Your saved signature"
          className="max-h-32 object-contain"
        />
      </div>
      <div className="flex gap-3 justify-end">
        <Button variant="ghost" size="sm" onClick={onDrawNew} disabled={disabled}>
          Draw New Signature
        </Button>
        <Button size="sm" onClick={onConfirm} disabled={disabled}>
          Sign with Saved Signature
        </Button>
      </div>
    </div>
  );
}
