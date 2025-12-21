import { useRef, useEffect } from 'react';
import { TextInputControl, TextAreaControl, SelectControl, CheckboxControl } from './nodes/controls';

interface TextInputProps {
  data: TextInputControl;
}

export function TextInputComponent({ data }: TextInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current && inputRef.current !== document.activeElement) {
      inputRef.current.value = data.value;
    }
  }, [data.value]);

  return (
    <div className="control-wrapper" onClick={(e) => e.stopPropagation()}>
      <label className="control-label">{data.label}</label>
      <input
        ref={inputRef}
        type="text"
        className="control-input"
        defaultValue={data.value}
        placeholder={data.placeholder}
        onChange={(e) => {
          data.value = e.target.value;
          data.onChange(e.target.value);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}

interface TextAreaProps {
  data: TextAreaControl;
}

export function TextAreaComponent({ data }: TextAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current && textareaRef.current !== document.activeElement) {
      textareaRef.current.value = data.value;
    }
  }, [data.value]);

  return (
    <div className="control-wrapper" onClick={(e) => e.stopPropagation()}>
      <label className="control-label">{data.label}</label>
      <textarea
        ref={textareaRef}
        className="control-textarea"
        defaultValue={data.value}
        placeholder={data.placeholder}
        onChange={(e) => {
          data.value = e.target.value;
          data.onChange(e.target.value);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        rows={3}
      />
    </div>
  );
}

interface SelectProps {
  data: SelectControl;
}

export function SelectComponent({ data }: SelectProps) {
  const selectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (selectRef.current) {
      selectRef.current.value = data.value;
    }
  }, [data.value]);

  return (
    <div className="control-wrapper" onClick={(e) => e.stopPropagation()}>
      <label className="control-label">{data.label}</label>
      <select
        ref={selectRef}
        className="control-select"
        defaultValue={data.value}
        onChange={(e) => {
          data.value = e.target.value;
          data.onChange(e.target.value);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {data.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface CheckboxProps {
  data: CheckboxControl;
}

export function CheckboxComponent({ data }: CheckboxProps) {
  const checkboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.checked = data.checked;
    }
  }, [data.checked]);

  return (
    <div className="control-wrapper control-checkbox-wrapper" onClick={(e) => e.stopPropagation()}>
      <label className="control-checkbox-label">
        <input
          ref={checkboxRef}
          type="checkbox"
          className="control-checkbox"
          defaultChecked={data.checked}
          onChange={(e) => {
            data.checked = e.target.checked;
            data.onChange(e.target.checked);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
        {data.label}
      </label>
    </div>
  );
}
