import type { FieldDistribution } from "../../engine/field-view";

type FieldValueDistributionProps = {
  distribution: FieldDistribution;
  selectedValue: string | null;
  onSelectValue: (value: string | null) => void;
};

const VISIBLE_GROUP_LIMIT = 10;

/**
 * Distinct reference values as horizontal magnitude bars — one series, one
 * hue, counts as direct text labels. For a groupable field this list is the
 * primary control: each bar filters the record table to its value group.
 *
 * Singleton groups are always shown even past the visible limit: the lone
 * outlier value is precisely the row a top-N cut would hide, and precisely
 * the one a reviewer must not miss.
 */
export function FieldValueDistribution({ distribution, selectedValue, onSelectValue }: FieldValueDistributionProps) {
  if (distribution.populatedReferenceCount === 0) {
    return (
      <p className="text-sm text-slate-600" data-testid="distribution-empty">
        The reference file holds no values for this field; there is nothing to distribute.
      </p>
    );
  }

  if (!distribution.groupable) {
    const top = distribution.groups.slice(0, 5);
    return (
      <div data-testid="distribution-high-cardinality">
        <p className="text-sm text-slate-600">
          {distribution.distinctIsLowerBound ? "More than " : ""}
          {distribution.distinctCount} distinct reference values across {distribution.populatedReferenceCount} populated
          records — too varied to review by group. The most repeated:
        </p>
        <ul className="mt-1 flex flex-wrap gap-2 text-xs text-slate-700">
          {top.map((group) => (
            <li key={group.value} className="rounded bg-slate-100 px-2 py-0.5">
              {group.value} <span className="text-slate-500">×{group.count}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const visible = distribution.groups.filter(
    (group, index) => index < VISIBLE_GROUP_LIMIT || group.count === 1 || group.value === selectedValue
  );
  const hiddenCount = distribution.groups.length - visible.length;
  const max = distribution.groups[0]?.count ?? 1;

  return (
    <div data-testid="distribution-groups">
      <ul className="space-y-1">
        {visible.map((group) => {
          const isSelected = group.value === selectedValue;
          return (
            <li key={group.value}>
              <button
                type="button"
                aria-pressed={isSelected}
                data-testid={`value-group-${group.value}`}
                className={`flex w-full items-center gap-2 rounded p-1 text-left text-sm hover:bg-sky-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                  isSelected ? "bg-sky-100 ring-1 ring-inset ring-sky-300" : ""
                }`}
                onClick={() => onSelectValue(isSelected ? null : group.value)}
              >
                <span className="w-44 shrink-0 truncate" title={group.value}>
                  {group.value}
                </span>
                <span className="h-2 flex-1 rounded-sm bg-slate-100">
                  <span
                    className="block h-full rounded-sm bg-sky-600"
                    style={{ width: `${(group.count / max) * 100}%` }}
                    aria-hidden="true"
                  />
                </span>
                <span className="w-12 shrink-0 text-right text-xs text-slate-600">{group.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {hiddenCount > 0 ? (
        <p className="mt-1 text-xs text-slate-500">…and {hiddenCount} more distinct values.</p>
      ) : null}
      <p className="mt-2 text-xs text-slate-500" data-testid="value-group-caveat">
        Selecting a value filters the rows below. Any decision still writes each record's own reference value — never
        this group's value.
      </p>
    </div>
  );
}
