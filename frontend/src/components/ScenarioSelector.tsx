import React from 'react';

export type Scenario = 'users' | 'events' | 'purchases';

interface ScenarioSelectorProps {
  value: Scenario;
  onChange: (s: Scenario) => void;
}

export function ScenarioSelector({ value, onChange }: ScenarioSelectorProps) {
  const scenarios: Scenario[] = ['users', 'events', 'purchases'];
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {scenarios.map((s) => (
        <button
          key={s}
          aria-pressed={value === s}
          onClick={() => onChange(s)}
          className="btn"
          style={{
            borderStyle: 'dashed',
            borderColor: value === s ? '#0ea5e9' : '#e8e8ec',
            background: value === s ? '#eef9ff' : '#fff',
          }}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

export default ScenarioSelector;


