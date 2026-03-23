import "./CustomSelect.css";
import { useState, useRef, useEffect, useCallback } from "react";

type Option = { value: string; label: string };

type Props = {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
};

export const CustomSelect = ({ options, value, onChange, className }: Props) => {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Scroll focused option into view
  useEffect(() => {
    if (!open || focusedIndex < 0) return;
    const list = listRef.current;
    if (!list) return;
    const item = list.children[focusedIndex] as HTMLElement | undefined;
    item?.scrollIntoView?.({ block: "nearest" });
  }, [open, focusedIndex]);

  // Open the menu and initialise keyboard focus to the currently selected option.
  // Centralised here so both click and keyboard open paths are consistent.
  const openMenu = useCallback(() => {
    const idx = options.findIndex((o) => o.value === value);
    setFocusedIndex(idx >= 0 ? idx : 0);
    setOpen(true);
  }, [options, value]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, options.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < options.length) {
          onChange(options[focusedIndex].value);
          setOpen(false);
        }
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
      case "Home":
        e.preventDefault();
        setFocusedIndex(0);
        break;
      case "End":
        e.preventDefault();
        setFocusedIndex(options.length - 1);
        break;
    }
  }, [open, focusedIndex, options, onChange, openMenu]);

  const selected = options.find((o) => o.value === value);

  return (
    <div
      className={`custom-select${className ? ` ${className}` : ""}`}
      ref={ref}
      onKeyDown={handleKeyDown}
      role="combobox"
      aria-expanded={open}
      aria-haspopup="listbox"
    >
      <button
        className="custom-select-trigger"
        onClick={(e) => { e.stopPropagation(); if (open) setOpen(false); else openMenu(); }}
        type="button"
        aria-label={`${selected?.label ?? ""}; activate to change`}
      >
        <span>{selected?.label ?? ""}</span>
        <span className="custom-select-arrow">{open ? "\u25B2" : "\u25BC"}</span>
      </button>
      {open && (
        <ul className="custom-select-menu" role="listbox" aria-label="Options" ref={listRef}>
          {options.map((opt, i) => (
            <li
              key={opt.value}
              role="option"
              aria-selected={opt.value === value}
              className={`custom-select-option${opt.value === value ? " selected" : ""}${i === focusedIndex ? " focused" : ""}`}
              onClick={(e) => { e.stopPropagation(); onChange(opt.value); setOpen(false); }}
            >
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
