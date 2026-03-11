import { useState, useRef, useEffect } from "react";

type Option = { value: string; label: string };

type Props = {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
};

export const CustomSelect = ({ options, value, onChange, className }: Props) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div className={`custom-select${className ? ` ${className}` : ""}`} ref={ref}>
      <button
        className="custom-select-trigger"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        type="button"
      >
        <span>{selected?.label ?? ""}</span>
        <span className="custom-select-arrow">{open ? "\u25B2" : "\u25BC"}</span>
      </button>
      {open && (
        <ul className="custom-select-menu">
          {options.map((opt) => (
            <li
              key={opt.value}
              className={`custom-select-option${opt.value === value ? " selected" : ""}`}
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
