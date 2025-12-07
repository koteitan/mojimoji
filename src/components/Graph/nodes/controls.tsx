import { ClassicPreset } from 'rete';

// Text input control
export class TextInputControl extends ClassicPreset.Control {
  value: string;
  label: string;
  onChange: (value: string) => void;

  constructor(
    value: string,
    label: string,
    onChange: (value: string) => void
  ) {
    super();
    this.value = value;
    this.label = label;
    this.onChange = onChange;
  }
}

// Textarea control for multiple lines
export class TextAreaControl extends ClassicPreset.Control {
  value: string;
  label: string;
  placeholder: string;
  onChange: (value: string) => void;

  constructor(
    value: string,
    label: string,
    placeholder: string,
    onChange: (value: string) => void
  ) {
    super();
    this.value = value;
    this.label = label;
    this.placeholder = placeholder;
    this.onChange = onChange;
  }
}

// Select control
export class SelectControl extends ClassicPreset.Control {
  value: string;
  label: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;

  constructor(
    value: string,
    label: string,
    options: { value: string; label: string }[],
    onChange: (value: string) => void
  ) {
    super();
    this.value = value;
    this.label = label;
    this.options = options;
    this.onChange = onChange;
  }
}

// Checkbox control
export class CheckboxControl extends ClassicPreset.Control {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;

  constructor(
    checked: boolean,
    label: string,
    onChange: (checked: boolean) => void
  ) {
    super();
    this.checked = checked;
    this.label = label;
    this.onChange = onChange;
  }
}
