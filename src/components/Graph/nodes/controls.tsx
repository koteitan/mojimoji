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

// Filter fields for NostrFilter node (pass-through filter, no ids/limit)
export const NOSTR_FILTER_FIELDS = [
  { value: 'kinds', label: 'kinds' },
  { value: 'authors', label: 'authors' },
  { value: '#e', label: '#e' },
  { value: '#p', label: '#p' },
  { value: '#t', label: '#t' },
  { value: 'since', label: 'since' },
  { value: 'until', label: 'until' },
];

// Filter control for nostr filters
export class FilterControl extends ClassicPreset.Control {
  filters: Filters;
  label: string;
  onChange: (filters: Filters) => void;
  hideValues: boolean; // Hide value input (for modular relay where values come from sockets)

  constructor(
    filters: Filters,
    label: string,
    onChange: (filters: Filters) => void,
    hideValues: boolean = false
  ) {
    super();
    this.filters = filters;
    this.label = label;
    this.onChange = onChange;
    this.hideValues = hideValues;
  }
}

// Text input control
export class TextInputControl extends ClassicPreset.Control {
  value: string;
  label: string;
  placeholder: string;
  onChange: (value: string) => void;
  rebuildPipeline: boolean;

  constructor(
    value: string,
    label: string,
    onChange: (value: string) => void,
    rebuildPipeline: boolean = true,
    placeholder: string = ''
  ) {
    super();
    this.value = value;
    this.label = label;
    this.placeholder = placeholder;
    this.onChange = onChange;
    this.rebuildPipeline = rebuildPipeline;
  }
}

// Textarea control for multiple lines
export class TextAreaControl extends ClassicPreset.Control {
  value: string;
  label: string;
  placeholder: string;
  onChange: (value: string) => void;
  disabled: boolean;

  constructor(
    value: string,
    label: string,
    placeholder: string,
    onChange: (value: string) => void,
    disabled: boolean = false
  ) {
    super();
    this.value = value;
    this.label = label;
    this.placeholder = placeholder;
    this.onChange = onChange;
    this.disabled = disabled;
  }
}

// Select control
export class SelectControl extends ClassicPreset.Control {
  value: string;
  label: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled: boolean;

  constructor(
    value: string,
    label: string,
    options: { value: string; label: string }[],
    onChange: (value: string) => void,
    disabled: boolean = false
  ) {
    super();
    this.value = value;
    this.label = label;
    this.options = options;
    this.onChange = onChange;
    this.disabled = disabled;
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

// Checkbox group control for multiple selections
export class CheckboxGroupControl extends ClassicPreset.Control {
  selected: string[];
  label: string;
  options: { value: string; label: string }[];
  onChange: (selected: string[]) => void;

  constructor(
    selected: string[],
    label: string,
    options: { value: string; label: string }[],
    onChange: (selected: string[]) => void
  ) {
    super();
    this.selected = selected;
    this.label = label;
    this.options = options;
    this.onChange = onChange;
  }
}

// Simple filter control for NostrFilter node (single filter with AND logic)
export class SimpleFilterControl extends ClassicPreset.Control {
  elements: FilterElement[];
  exclude: boolean;
  excludeLabel: string;
  onChange: (elements: FilterElement[], exclude: boolean) => void;

  constructor(
    elements: FilterElement[],
    exclude: boolean,
    excludeLabel: string,
    onChange: (elements: FilterElement[], exclude: boolean) => void
  ) {
    super();
    this.elements = elements;
    this.exclude = exclude;
    this.excludeLabel = excludeLabel;
    this.onChange = onChange;
  }
}

// Toggle switch control for boolean values
export class ToggleControl extends ClassicPreset.Control {
  value: boolean;
  label: string;
  onChange: (value: boolean) => void;

  constructor(
    value: boolean,
    label: string,
    onChange: (value: boolean) => void
  ) {
    super();
    this.value = value;
    this.label = label;
    this.onChange = onChange;
  }
}
