import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { filterProfiles, type ProfilePickerRow } from "./profile-picker-filter";

export type ProfilePickerProps = {
  profiles: ProfilePickerRow[];
  /** Id of the selected profile. Must name a row in `profiles`. */
  value: string;
  onChange: (id: string) => void;
  /** Ids that carry a local override, shown with an amber chip. */
  overriddenIds?: ReadonlySet<string>;
};

/**
 * Searchable combobox over the registered source profiles.
 *
 * Replaces the flat <select>, which stops being navigable somewhere around a
 * dozen sources. Typing filters by id, display name, source URL, and agency;
 * the list is virtualized so hundreds of rows stay cheap. Keyboard: arrows
 * move, Home/End jump, Enter/Tab commit, Escape reverts to the selection.
 * Keeps data-testid="source-profile-select" — it now names the combobox input.
 */
export function ProfilePicker({ profiles, value, onChange, overriddenIds }: ProfilePickerProps) {
  const selected = useMemo(() => profiles.find((row) => row.id === value) ?? null, [profiles, value]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const matches = useMemo(() => filterProfiles(profiles, query), [profiles, query]);

  const virtualizer = useVirtualizer({
    count: matches.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 52,
    overscan: 8
  });

  // Clamp the active option whenever the filter shrinks the list.
  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, matches.length - 1)));
  }, [matches.length]);

  useEffect(() => {
    if (open && matches.length > 0) {
      virtualizer.scrollToIndex(Math.min(activeIndex, matches.length - 1));
    }
  }, [open, activeIndex, matches.length, virtualizer]);

  // Close on any interaction outside the component, committing nothing.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        close();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const commit = (row: ProfilePickerRow | undefined) => {
    if (row) {
      onChange(row.id);
    }
    close();
  };

  const openList = () => {
    setOpen(true);
    const selectedIndex = matches.findIndex((row) => row.id === value);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter")) {
      event.preventDefault();
      openList();
      return;
    }
    if (!open) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, matches.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(Math.max(0, matches.length - 1));
        break;
      case "Enter":
        event.preventDefault();
        commit(matches[activeIndex]);
        break;
      case "Tab":
        // Commit the active option but let focus move on.
        commit(matches[activeIndex]);
        break;
      case "Escape":
        event.preventDefault();
        close();
        break;
    }
  };

  const activeId = matches[activeIndex] ? `profile-option-${matches[activeIndex].id}` : undefined;

  return (
    <div ref={rootRef} className="relative">
      <input
        ref={inputRef}
        data-testid="source-profile-select"
        role="combobox"
        aria-expanded={open}
        aria-controls="profile-picker-listbox"
        aria-activedescendant={open ? activeId : undefined}
        aria-autocomplete="list"
        aria-label="Source profile"
        className="mt-1 w-full rounded border border-slate-300 p-2"
        placeholder="Search profiles by name, id, or URL"
        value={open ? query : selected ? `${selected.displayName} · v${selected.version}` : ""}
        onChange={(event) => {
          if (!open) setOpen(true);
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onFocus={openList}
        onKeyDown={onKeyDown}
      />
      {selected && overriddenIds?.has(selected.id) && !open ? (
        <span className="pointer-events-none absolute right-2 top-1/2 mt-0.5 -translate-y-1/2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
          local override
        </span>
      ) : null}
      {open ? (
        <div
          id="profile-picker-listbox"
          role="listbox"
          ref={listRef}
          data-testid="profile-picker-listbox"
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded border border-slate-300 bg-white shadow-lg"
        >
          {matches.length === 0 ? (
            <div className="p-3 text-sm text-slate-500" data-testid="profile-picker-empty">
              No profiles match “{query}”.
            </div>
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((item) => {
                const row = matches[item.index];
                if (!row) return null;
                const isActive = item.index === activeIndex;
                const isSelected = row.id === value;
                return (
                  <div
                    key={row.id}
                    id={`profile-option-${row.id}`}
                    role="option"
                    aria-selected={isSelected}
                    data-testid={`profile-option-${row.id}`}
                    className={`absolute left-0 top-0 w-full cursor-pointer px-3 py-1.5 text-sm ${
                      isActive ? "bg-sky-100" : isSelected ? "bg-slate-100" : "bg-white"
                    }`}
                    style={{ transform: `translateY(${item.start}px)`, height: item.size }}
                    // pointerdown, not click: the outside-pointerdown closer runs first on click.
                    onPointerDown={(event) => {
                      event.preventDefault();
                      commit(row);
                    }}
                    onMouseEnter={() => setActiveIndex(item.index)}
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{row.displayName}</span>
                      <span className="shrink-0 rounded bg-slate-200 px-1 text-[10px] text-slate-700">v{row.version}</span>
                      {overriddenIds?.has(row.id) ? (
                        <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800">
                          local override
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {row.id} · {row.sourceUrl}
                      {row.agency ? ` · ${row.agency}` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
