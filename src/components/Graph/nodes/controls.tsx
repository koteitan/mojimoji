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
  { value: '#q', label: '#q' },
  { value: '#t', label: '#t' },
  { value: 'since', label: 'since' },
  { value: 'until', label: 'until' },
  { value: 'limit', label: 'limit' },
];

// Filter fields for ModularRelayNode (includes both UI and socket options)
export const MODULAR_FILTER_FIELDS = [
  // UI fields (value input)
  { value: 'kinds', label: 'kinds' },
  { value: 'ids', label: 'ids' },
  { value: 'authors', label: 'authors' },
  { value: '#e', label: '#e' },
  { value: '#p', label: '#p' },
  { value: '#q', label: '#q' },
  { value: '#t', label: '#t' },
  { value: 'since', label: 'since' },
  { value: 'until', label: 'until' },
  { value: 'limit', label: 'limit' },
  // Socket fields (input socket)
  { value: 'kinds (socket)', label: 'kinds (socket)' },
  { value: 'ids (socket)', label: 'ids (socket)' },
  { value: 'authors (socket)', label: 'authors (socket)' },
  { value: '#e (socket)', label: '#e (socket)' },
  { value: '#p (socket)', label: '#p (socket)' },
  { value: '#q (socket)', label: '#q (socket)' },
  { value: 'since (socket)', label: 'since (socket)' },
  { value: 'until (socket)', label: 'until (socket)' },
  { value: 'limit (socket)', label: 'limit (socket)' },
];

// Helper to check if a field is a socket field
export function isSocketField(field: string): boolean {
  return field.endsWith(' (socket)');
}

// Helper to get the base field name from a socket field
export function getBaseField(field: string): string {
  return field.replace(' (socket)', '');
}

// Filter fields for NostrFilter node (pass-through filter, no ids/limit)
export const NOSTR_FILTER_FIELDS = [
  // UI fields (value input)
  { value: 'kinds', label: 'kinds' },
  { value: 'authors', label: 'authors' },
  { value: '#e', label: '#e' },
  { value: '#p', label: '#p' },
  { value: '#q', label: '#q' },
  { value: '#t', label: '#t' },
  { value: 'since', label: 'since' },
  { value: 'until', label: 'until' },
  // Socket fields (input socket)
  { value: 'authors (socket)', label: 'authors (socket)' },
  { value: '#e (socket)', label: '#e (socket)' },
  { value: '#p (socket)', label: '#p (socket)' },
  { value: '#q (socket)', label: '#q (socket)' },
  { value: 'since (socket)', label: 'since (socket)' },
  { value: 'until (socket)', label: 'until (socket)' },
];

// Filter control for nostr filters
export class FilterControl extends ClassicPreset.Control {
  filters: Filters;
  label: string;
  onChange: (filters: Filters) => void;
  hideValues: boolean; // Hide value input (for modular relay where values come from sockets)
  useModularFields: boolean; // Use MODULAR_FILTER_FIELDS (includes socket options)

  constructor(
    filters: Filters,
    label: string,
    onChange: (filters: Filters) => void,
    hideValues: boolean = false,
    useModularFields: boolean = false
  ) {
    super();
    this.filters = filters;
    this.label = label;
    this.onChange = onChange;
    this.hideValues = hideValues;
    this.useModularFields = useModularFields;
  }
}

// Text input control
export class TextInputControl extends ClassicPreset.Control {
  value: string;
  label: string;
  placeholder: string;
  onChange: (value: string) => void;
  rebuildPipeline: boolean;
  disabled: boolean;
  horizontal: boolean;
  suffix: string;

  constructor(
    value: string,
    label: string,
    onChange: (value: string) => void,
    rebuildPipeline: boolean = true,
    placeholder: string = '',
    disabled: boolean = false,
    horizontal: boolean = false,
    suffix: string = ''
  ) {
    super();
    this.value = value;
    this.label = label;
    this.placeholder = placeholder;
    this.onChange = onChange;
    this.rebuildPipeline = rebuildPipeline;
    this.disabled = disabled;
    this.horizontal = horizontal;
    this.suffix = suffix;
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
  offLabel: string;
  onLabel: string;

  constructor(
    value: boolean,
    label: string,
    onChange: (value: boolean) => void,
    offLabel: string = 'off',
    onLabel: string = 'on'
  ) {
    super();
    this.value = value;
    this.label = label;
    this.onChange = onChange;
    this.offLabel = offLabel;
    this.onLabel = onLabel;
  }
}

// Status lamp control for FunctionNode
export type StatusLampState = 'idle' | 'loading' | 'working' | 'error';

export class StatusLampControl extends ClassicPreset.Control {
  state: StatusLampState;
  caption: string;

  constructor(state: StatusLampState = 'idle', caption: string = 'idle') {
    super();
    this.state = state;
    this.caption = caption;
  }

  setState(state: StatusLampState, caption: string): void {
    this.state = state;
    this.caption = caption;
  }
}
