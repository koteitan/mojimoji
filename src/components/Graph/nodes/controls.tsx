import { ClassicPreset } from 'rete';

// Filter types for nostr filters (NIP-01)
export interface FilterElement {
  field: string;
  value: string;
}

export type Filter = FilterElement[];
export type Filters = Filter[];

// Available filter fields from NIP-01
export const FILTER_FIELDS = [
  { value: 'kinds', label: 'kinds' },
  { value: 'ids', label: 'ids' },
  { value: 'authors', label: 'authors' },
  { value: '#e', label: '#e' },
  { value: '#p', label: '#p' },
  { value: '#t', label: '#t' },
  { value: 'since', label: 'since' },
  { value: 'until', label: 'until' },
  { value: 'limit', label: 'limit' },
];

// Filter control for nostr filters
export class FilterControl extends ClassicPreset.Control {
  filters: Filters;
  label: string;
  onChange: (filters: Filters) => void;

  constructor(
    filters: Filters,
    label: string,
    onChange: (filters: Filters) => void
  ) {
    super();
    this.filters = filters;
    this.label = label;
    this.onChange = onChange;
  }
}

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
