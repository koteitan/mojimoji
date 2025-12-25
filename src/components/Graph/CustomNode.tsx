import { useState, useEffect } from 'react';
import { Presets } from 'rete-react-plugin';
import { TextInputControl, TextAreaControl, SelectControl, CheckboxControl, CheckboxGroupControl, FilterControl, SimpleFilterControl, ToggleControl, FILTER_FIELDS, NOSTR_FILTER_FIELDS, type Filters, type FilterElement } from './nodes/controls';
import './CustomNode.css';

const { RefSocket } = Presets.classic;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Props = { data: any; emit: any };

function sortByIndex<T extends { index?: number }[]>(entries: T): T {
  return [...entries].sort((a, b) => {
    const ai = a.index ?? 0;
    const bi = b.index ?? 0;
    return ai - bi;
  }) as T;
}

// Custom event to notify graph that a control value changed
const dispatchControlChange = (nodeId: string, rebuildPipeline: boolean = true) => {
  window.dispatchEvent(new CustomEvent('graph-control-change', { detail: { nodeId, rebuildPipeline } }));
};

// Custom control components with React state
// Changes are applied on blur (losing focus) for text inputs
function TextInputControlComponent({ control, nodeId }: { control: TextInputControl; nodeId: string }) {
  const [value, setValue] = useState(control.value);

  // Sync local state when control value changes (e.g., when type changes and control is recreated)
  useEffect(() => {
    setValue(control.value);
  }, [control.value]);

  return (
    <div className="control-wrapper">
      <label className="control-label">{control.label}</label>
      <input
        type="text"
        className="control-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          // Only dispatch change event if value actually changed
          if (value !== control.value) {
            control.value = value;
            control.onChange(value);
            dispatchControlChange(nodeId, control.rebuildPipeline);
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function TextAreaControlComponent({ control, nodeId }: { control: TextAreaControl; nodeId: string }) {
  const [value, setValue] = useState(control.value);
  const [, forceUpdate] = useState(0);

  // Listen for control changes to force re-render
  useEffect(() => {
    const handleControlChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      // Only update if this is for our node
      if (detail?.nodeId === nodeId) {
        forceUpdate(n => n + 1);
        // Also sync value if it changed externally
        setValue(control.value);
      }
    };
    window.addEventListener('graph-control-change', handleControlChange);
    return () => {
      window.removeEventListener('graph-control-change', handleControlChange);
    };
  }, [control, nodeId]);

  // Read disabled directly from control on each render
  const disabled = control.disabled;

  return (
    <div className="control-wrapper">
      <label className="control-label">{control.label}</label>
      <textarea
        className="control-textarea"
        value={value}
        placeholder={control.placeholder}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          // Only dispatch change event if value actually changed
          if (value !== control.value) {
            control.value = value;
            control.onChange(value);
            dispatchControlChange(nodeId);
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// Select applies immediately since it's a single action
function SelectControlComponent({ control, nodeId }: { control: SelectControl; nodeId: string }) {
  const [value, setValue] = useState(control.value);
  const [, forceUpdate] = useState(0);

  // Listen for control changes to update disabled state
  useEffect(() => {
    const handleControlChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.nodeId === nodeId) {
        forceUpdate(n => n + 1);
        setValue(control.value);
      }
    };
    window.addEventListener('graph-control-change', handleControlChange);
    return () => {
      window.removeEventListener('graph-control-change', handleControlChange);
    };
  }, [control, nodeId]);

  return (
    <div className="control-wrapper">
      <label className="control-label">{control.label}</label>
      <select
        className="control-select"
        value={value}
        disabled={control.disabled}
        onChange={(e) => {
          setValue(e.target.value);
          control.value = e.target.value;
          control.onChange(e.target.value);
          dispatchControlChange(nodeId);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {control.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// Checkbox applies immediately since it's a single action
function CheckboxControlComponent({ control, nodeId }: { control: CheckboxControl; nodeId: string }) {
  const [checked, setChecked] = useState(control.checked);

  return (
    <div className="control-wrapper control-checkbox-wrapper">
      <label className="control-checkbox-label">
        <input
          type="checkbox"
          className="control-checkbox"
          checked={checked}
          onChange={(e) => {
            setChecked(e.target.checked);
            control.checked = e.target.checked;
            control.onChange(e.target.checked);
            dispatchControlChange(nodeId);
          }}
          onPointerDown={(e) => e.stopPropagation()}
        />
        {control.label}
      </label>
    </div>
  );
}

// Toggle switch control for flag values
function ToggleControlComponent({ control, nodeId }: { control: ToggleControl; nodeId: string }) {
  const [value, setValue] = useState(control.value);

  // Sync when control value changes externally
  useEffect(() => {
    setValue(control.value);
  }, [control.value]);

  return (
    <div className="control-wrapper toggle-control-wrapper">
      <label className="control-label">{control.label}</label>
      <div className="toggle-switch-container">
        <span className={`toggle-label ${!value ? 'active' : ''}`}>off</span>
        <button
          className={`toggle-switch ${value ? 'on' : 'off'}`}
          onClick={() => {
            const newValue = !value;
            setValue(newValue);
            control.value = newValue;
            control.onChange(newValue);
            dispatchControlChange(nodeId);
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="toggle-slider" />
        </button>
        <span className={`toggle-label ${value ? 'active' : ''}`}>on</span>
      </div>
    </div>
  );
}

// Filter control component for nostr filters
function FilterControlComponent({ control, nodeId }: { control: FilterControl; nodeId: string }) {
  const [filters, setFilters] = useState<Filters>(control.filters);

  const updateFilters = (newFilters: Filters) => {
    setFilters(newFilters);
    control.filters = newFilters;
    control.onChange(newFilters);
    dispatchControlChange(nodeId);
  };

  const addFilter = () => {
    const newFilters = [...filters, [{ field: 'kinds', value: '' }]];
    updateFilters(newFilters);
  };

  const addElement = (filterIndex: number) => {
    const newFilters = filters.map((filter, i) =>
      i === filterIndex ? [...filter, { field: 'kinds', value: '' }] : filter
    );
    updateFilters(newFilters);
  };

  const removeFilter = (filterIndex: number) => {
    if (filters.length <= 1) return; // Keep at least one filter
    const newFilters = filters.filter((_, i) => i !== filterIndex);
    updateFilters(newFilters);
  };

  const removeElement = (filterIndex: number, elementIndex: number) => {
    const filter = filters[filterIndex];
    if (filter.length <= 1) return; // Keep at least one element
    const newFilters = filters.map((f, i) =>
      i === filterIndex ? f.filter((_, j) => j !== elementIndex) : f
    );
    updateFilters(newFilters);
  };

  const updateElement = (filterIndex: number, elementIndex: number, field: string, value: string) => {
    const newFilters = filters.map((filter, i) =>
      i === filterIndex
        ? filter.map((el, j) =>
            j === elementIndex ? { field, value } : el
          )
        : filter
    );
    setFilters(newFilters);
  };

  const commitChanges = () => {
    control.filters = filters;
    control.onChange(filters);
    dispatchControlChange(nodeId);
  };

  return (
    <div className="control-wrapper filter-control">
      <label className="control-label">{control.label}</label>
      {filters.map((filter, filterIndex) => (
        <div key={filterIndex} className="filter-item">
          <div className="filter-header">
            <span className="filter-label">Filter {filterIndex + 1}</span>
            {filters.length > 1 && (
              <button
                className="filter-remove-btn"
                onClick={() => removeFilter(filterIndex)}
                onPointerDown={(e) => e.stopPropagation()}
              >
                ×
              </button>
            )}
          </div>
          {filter.map((element, elementIndex) => (
            <div key={elementIndex} className="filter-element">
              <select
                className={control.hideValues ? "filter-field-select-wide" : "filter-field-select"}
                value={element.field}
                onChange={(e) => updateElement(filterIndex, elementIndex, e.target.value, element.value)}
                onBlur={commitChanges}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {FILTER_FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              {!control.hideValues && (
                <input
                  type="text"
                  className="filter-value-input"
                  value={element.value}
                  placeholder="value"
                  onChange={(e) => updateElement(filterIndex, elementIndex, element.field, e.target.value)}
                  onBlur={commitChanges}
                  onPointerDown={(e) => e.stopPropagation()}
                />
              )}
              {filter.length > 1 && (
                <button
                  className="filter-element-remove-btn"
                  onClick={() => removeElement(filterIndex, elementIndex)}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  ×
                </button>
              )}
              {elementIndex === filter.length - 1 && (
                <button
                  className="filter-element-add-btn"
                  onClick={() => addElement(filterIndex)}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  +
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
      <button
        className="filter-add-btn"
        onClick={addFilter}
        onPointerDown={(e) => e.stopPropagation()}
      >
        + Add Filter
      </button>
    </div>
  );
}

// Checkbox group control for multiple selections
function CheckboxGroupControlComponent({ control, nodeId }: { control: CheckboxGroupControl; nodeId: string }) {
  const [selected, setSelected] = useState<string[]>(control.selected);

  const handleChange = (value: string, checked: boolean) => {
    const newSelected = checked
      ? [...selected, value]
      : selected.filter((v) => v !== value);
    setSelected(newSelected);
    control.selected = newSelected;
    control.onChange(newSelected);
    dispatchControlChange(nodeId);
  };

  return (
    <div className="control-wrapper checkbox-group-control">
      <label className="control-label">{control.label}</label>
      <div className="checkbox-group-options">
        {control.options.map((opt) => (
          <label key={opt.value} className="checkbox-group-option">
            <input
              type="checkbox"
              checked={selected.includes(opt.value)}
              onChange={(e) => handleChange(opt.value, e.target.checked)}
              onPointerDown={(e) => e.stopPropagation()}
            />
            {opt.label}
          </label>
        ))}
      </div>
    </div>
  );
}

// Simple filter control component for NostrFilter node
function SimpleFilterControlComponent({ control, nodeId }: { control: SimpleFilterControl; nodeId: string }) {
  const [elements, setElements] = useState<FilterElement[]>(control.elements);
  const [exclude, setExclude] = useState(control.exclude);

  const commitChanges = (newElements: FilterElement[], newExclude: boolean) => {
    control.elements = newElements;
    control.exclude = newExclude;
    control.onChange(newElements, newExclude);
    dispatchControlChange(nodeId);
  };

  const removeElement = (index: number) => {
    if (elements.length <= 1) return;
    const newElements = elements.filter((_, i) => i !== index);
    setElements(newElements);
    commitChanges(newElements, exclude);
  };

  const updateElement = (index: number, field: string, value: string) => {
    const newElements = elements.map((el, i) =>
      i === index ? { field, value } : el
    );
    setElements(newElements);
  };

  const handleBlur = () => {
    commitChanges(elements, exclude);
  };

  const handleExcludeChange = (checked: boolean) => {
    setExclude(checked);
    commitChanges(elements, checked);
  };

  return (
    <div className="control-wrapper simple-filter-control">
      {elements.map((element, index) => (
        <div key={index} className="filter-element">
          <select
            className="filter-field-select"
            value={element.field}
            onChange={(e) => updateElement(index, e.target.value, element.value)}
            onBlur={handleBlur}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {NOSTR_FILTER_FIELDS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            className="filter-value-input"
            value={element.value}
            placeholder="value"
            onChange={(e) => updateElement(index, element.field, e.target.value)}
            onBlur={handleBlur}
            onPointerDown={(e) => e.stopPropagation()}
          />
          {elements.length > 1 && (
            <button
              className="filter-element-remove-btn"
              onClick={() => removeElement(index)}
              onPointerDown={(e) => e.stopPropagation()}
            >
              ×
            </button>
          )}
        </div>
      ))}
      <div className="control-checkbox-wrapper">
        <label className="control-checkbox-label">
          <input
            type="checkbox"
            className="control-checkbox"
            checked={exclude}
            onChange={(e) => handleExcludeChange(e.target.checked)}
            onPointerDown={(e) => e.stopPropagation()}
          />
          {control.excludeLabel}
        </label>
      </div>
    </div>
  );
}

// Custom control renderer
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomControl({ data, nodeId }: { data: any; nodeId: string }) {
  if (data instanceof SimpleFilterControl) {
    return <SimpleFilterControlComponent control={data} nodeId={nodeId} />;
  }
  if (data instanceof FilterControl) {
    return <FilterControlComponent control={data} nodeId={nodeId} />;
  }
  if (data instanceof TextInputControl) {
    return <TextInputControlComponent control={data} nodeId={nodeId} />;
  }
  if (data instanceof TextAreaControl) {
    return <TextAreaControlComponent control={data} nodeId={nodeId} />;
  }
  if (data instanceof SelectControl) {
    return <SelectControlComponent control={data} nodeId={nodeId} />;
  }
  if (data instanceof CheckboxControl) {
    return <CheckboxControlComponent control={data} nodeId={nodeId} />;
  }
  if (data instanceof CheckboxGroupControl) {
    return <CheckboxGroupControlComponent control={data} nodeId={nodeId} />;
  }
  if (data instanceof ToggleControl) {
    return <ToggleControlComponent control={data} nodeId={nodeId} />;
  }
  // Fallback to classic control
  return <Presets.classic.Control data={data} />;
}

export function CustomNode(props: Props) {
  const { data, emit } = props;
  const inputs = Object.entries(data.inputs || {});
  const outputs = Object.entries(data.outputs || {});
  const controls = Object.entries(data.controls || {});
  const selected = data.selected || false;
  const { id, label, width, height } = data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sortedInputs = sortByIndex(inputs.map(([key, input]: [string, any]) => ({ key, input, index: input?.index })));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sortedOutputs = sortByIndex(outputs.map(([key, output]: [string, any]) => ({ key, output, index: output?.index })));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sortedControls = sortByIndex(controls.map(([key, control]: [string, any]) => ({ key, control, index: control?.index })));

  // Handle tap/click on node to select it (for mobile touch support)
  const handleNodeInteraction = (e: React.MouseEvent | React.TouchEvent) => {
    // Don't select if clicking on input elements
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.tagName === 'BUTTON') {
      return;
    }
    emit({ type: 'nodepicked', data: { id } });
  };

  return (
    <div
      className={`custom-node ${selected ? 'selected' : ''}`}
      style={{ width: width ?? 180, height: height ?? 'auto' }}
      data-testid="node"
      data-node-id={id}
      onClick={handleNodeInteraction}
      onTouchEnd={handleNodeInteraction}
    >
      {/* Input sockets at top */}
      <div className="custom-node-inputs">
        {sortedInputs.map(({ key, input }) =>
          input ? (
            <div
              className="custom-node-input"
              key={key}
              data-testid={`input-${key}`}
              title={input.label || key}
            >
              <RefSocket
                name="input-socket"
                side="input"
                socketKey={key}
                nodeId={id}
                emit={emit}
                payload={input.socket}
              />
            </div>
          ) : null
        )}
      </div>

      {/* Title */}
      <div className="custom-node-title">{label}</div>

      {/* Controls */}
      <div className="custom-node-controls">
        {sortedControls.map(({ key, control }) =>
          control ? (
            <CustomControl key={key} data={control} nodeId={id} />
          ) : null
        )}
      </div>

      {/* Output sockets at bottom */}
      <div className="custom-node-outputs">
        {sortedOutputs.map(({ key, output }) =>
          output ? (
            <div
              className="custom-node-output"
              key={key}
              data-testid={`output-${key}`}
              title={output.label || key}
            >
              <RefSocket
                name="output-socket"
                side="output"
                socketKey={key}
                nodeId={id}
                emit={emit}
                payload={output.socket}
              />
            </div>
          ) : null
        )}
      </div>
    </div>
  );
}
