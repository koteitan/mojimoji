import { TextInputControl, TextAreaControl, SelectControl, CheckboxControl } from './nodes/controls';

interface TextInputProps {
  data: TextInputControl;
}

export function TextInputComponent({ data }: TextInputProps) {
  return (
    <div className="control-wrapper" onClick={(e) => e.stopPropagation()}>
      <label className="control-label">{data.label}</label>
      <input
        type="text"
        className="control-input"
        value={data.value}
        onChange={(e) => {
          data.value = e.target.value;
          data.onChange(e.target.value);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}

interface TextAreaProps {
  data: TextAreaControl;
}

export function TextAreaComponent({ data }: TextAreaProps) {
  return (
    <div className="control-wrapper" onClick={(e) => e.stopPropagation()}>
      <label className="control-label">{data.label}</label>
      <textarea
        className="control-textarea"
        value={data.value}
        placeholder={data.placeholder}
        onChange={(e) => {
          data.value = e.target.value;
          data.onChange(e.target.value);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        rows={3}
      />
    </div>
  );
}

interface SelectProps {
  data: SelectControl;
}

export function SelectComponent({ data }: SelectProps) {
  return (
    <div className="control-wrapper" onClick={(e) => e.stopPropagation()}>
      <label className="control-label">{data.label}</label>
      <select
        className="control-select"
        value={data.value}
        onChange={(e) => {
          data.value = e.target.value;
          data.onChange(e.target.value);
        }}
        onPointerDown={(e) => e.stopPropagation()}
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
  return (
    <div className="control-wrapper control-checkbox-wrapper" onClick={(e) => e.stopPropagation()}>
      <label className="control-checkbox-label">
        <input
          type="checkbox"
          className="control-checkbox"
          checked={data.checked}
          onChange={(e) => {
            data.checked = e.target.checked;
            data.onChange(e.target.checked);
          }}
          onPointerDown={(e) => e.stopPropagation()}
        />
        {data.label}
      </label>
    </div>
  );
}
