import { useState } from 'react';
import { Presets } from 'rete-react-plugin';
import { TextInputControl, TextAreaControl, SelectControl, CheckboxControl } from './nodes/controls';
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
const dispatchControlChange = () => {
  window.dispatchEvent(new CustomEvent('graph-control-change'));
};

// Custom control components with React state
// Changes are applied on blur (losing focus) for text inputs
function TextInputControlComponent({ control }: { control: TextInputControl }) {
  const [value, setValue] = useState(control.value);

  return (
    <div className="control-wrapper">
      <label className="control-label">{control.label}</label>
      <input
        type="text"
        className="control-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          control.value = value;
          control.onChange(value);
          dispatchControlChange();
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function TextAreaControlComponent({ control }: { control: TextAreaControl }) {
  const [value, setValue] = useState(control.value);

  return (
    <div className="control-wrapper">
      <label className="control-label">{control.label}</label>
      <textarea
        className="control-textarea"
        value={value}
        placeholder={control.placeholder}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          control.value = value;
          control.onChange(value);
          dispatchControlChange();
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// Select applies immediately since it's a single action
function SelectControlComponent({ control }: { control: SelectControl }) {
  const [value, setValue] = useState(control.value);

  return (
    <div className="control-wrapper">
      <label className="control-label">{control.label}</label>
      <select
        className="control-select"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          control.value = e.target.value;
          control.onChange(e.target.value);
          dispatchControlChange();
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
function CheckboxControlComponent({ control }: { control: CheckboxControl }) {
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
            dispatchControlChange();
          }}
          onPointerDown={(e) => e.stopPropagation()}
        />
        {control.label}
      </label>
    </div>
  );
}

// Custom control renderer
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomControl({ data }: { data: any }) {
  if (data instanceof TextInputControl) {
    return <TextInputControlComponent control={data} />;
  }
  if (data instanceof TextAreaControl) {
    return <TextAreaControlComponent control={data} />;
  }
  if (data instanceof SelectControl) {
    return <SelectControlComponent control={data} />;
  }
  if (data instanceof CheckboxControl) {
    return <CheckboxControlComponent control={data} />;
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

  return (
    <div
      className={`custom-node ${selected ? 'selected' : ''}`}
      style={{ width: width ?? 180, height: height ?? 'auto' }}
      data-testid="node"
      data-node-id={id}
    >
      {/* Input sockets at top */}
      <div className="custom-node-inputs">
        {sortedInputs.map(({ key, input }) =>
          input ? (
            <div
              className="custom-node-input"
              key={key}
              data-testid={`input-${key}`}
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
            <CustomControl key={key} data={control} />
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
