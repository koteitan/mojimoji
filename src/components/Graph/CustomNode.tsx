import { Presets } from 'rete-react-plugin';
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
            <Presets.classic.Control
              key={key}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              data={control as any}
            />
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
