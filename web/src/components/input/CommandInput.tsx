import { useState, useCallback, useRef, useEffect } from 'react';

interface CommandInputProps {
  onSubmit: (input: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function CommandInput({ onSubmit, disabled = false, placeholder = 'What do you do?' }: CommandInputProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on mount and when re-enabled
  useEffect(() => {
    if (!disabled && inputRef.current) {
      inputRef.current.focus();
    }
  }, [disabled]);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue('');
  }, [value, disabled, onSubmit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  return (
    <div className="border-t border-omega-border p-3">
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => { setValue(e.target.value); }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={disabled ? 'Processing...' : placeholder}
          className="flex-1 bg-omega-input-bg text-omega-input-text px-4 py-2
                     border border-omega-border focus:border-omega-title
                     focus:bg-omega-input-focus outline-none text-sm
                     placeholder:text-omega-dim/50
                     disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <button
          onClick={handleSubmit}
          disabled={disabled || !value.trim()}
          className="px-4 py-2 text-sm border border-omega-border
                     bg-omega-input-bg text-omega-title
                     hover:bg-omega-input-focus
                     disabled:opacity-30 disabled:cursor-not-allowed
                     transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
}
