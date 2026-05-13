/**
 * SpecsTable — dossier-style architecture specification sheet.
 *
 * Two columns:  KEY (eyebrow mono) | VALUE (tabular mono, bone-50)
 * Rules between rows are hairline-fade. Press-kit aesthetic.
 */
import type { ReactNode } from "react";

export interface SpecRow {
  label: string;
  value: ReactNode;
  detail?: string;
}

export function SpecsTable({ rows }: { rows: SpecRow[] }) {
  return (
    <dl className="flex flex-col">
      {rows.map((r, i) => (
        <div
          key={r.label}
          className={`grid grid-cols-12 gap-4 py-5 ${i !== 0 ? "border-t border-white/[0.06]" : ""}`}
        >
          <dt className="col-span-12 sm:col-span-4 text-eyebrow self-start pt-0.5">
            {r.label}
          </dt>
          <dd className="col-span-12 sm:col-span-8 flex flex-col gap-1">
            <span className="text-tabular text-base text-bone-50">{r.value}</span>
            {r.detail && <span className="text-sm text-bone-400">{r.detail}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
