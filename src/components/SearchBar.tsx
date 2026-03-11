import { useState, useRef, useEffect } from "react";

type Props = {
  query: string;
  onQueryChange: (query: string) => void;
};

export const SearchBar = ({ query, onQueryChange }: Props) => {
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const handleToggle = () => {
    if (expanded && query) {
      onQueryChange("");
    }
    setExpanded((prev) => !prev);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onQueryChange("");
      setExpanded(false);
    }
  };

  return (
    <div className={`search-bar${expanded ? " expanded" : ""}`}>
      <button
        className="search-toggle-btn"
        onClick={handleToggle}
        aria-label={expanded ? "Close search" : "Search tasks"}
        title="Search tasks"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
          <path d="M12.5 11h-.79l-.28-.27A6.471 6.471 0 0013 6.5 6.5 6.5 0 106.5 13c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L17.49 16l-4.99-5zm-6 0C4.01 11 2 8.99 2 6.5S4.01 2 6.5 2 11 4.01 11 6.5 8.99 11 6.5 11z" />
        </svg>
      </button>
      {expanded && (
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search all tasks..."
        />
      )}
    </div>
  );
};
