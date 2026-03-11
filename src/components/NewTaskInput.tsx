import { forwardRef } from "react";

type Props = {
  value: string;
  onChange: (val: string) => void;
  onSubmit: () => void;
};

export const NewTaskInput = forwardRef<HTMLInputElement, Props>(
  ({ value, onChange, onSubmit }, ref) => {
    return (
      <div className="new-task" onClick={(e) => e.stopPropagation()}>
        <input
          ref={ref}
          type="text"
          placeholder="Add a new task"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim() !== "") onSubmit();
          }}
          autoFocus
        />
        <button onClick={onSubmit} disabled={value.trim() === ""}>
          Add
        </button>
      </div>
    );
  }
);
