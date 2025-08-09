import React from 'react';

export type ToolPanelEvent =
  | { type: 'business_insight'; result: { insight?: string; columns?: string[]; rows?: any[] } }
  | { type: 'chartjs_data'; result: { chartjs: any } }
  | { type: 'sql_tutor'; result: { tips?: string[]; schema?: Record<string, string[]>; examples?: string[] } }
  | { type: 'stakeholder_suggest'; result: { suggestions?: Array<{ role?: string; name?: string; email?: string }>; prompt?: string } }
  | { type: 'run_analysis_plan'; result: { columns?: string[]; rows?: any[]; python_code?: string } }
  | { type: 'unknown'; result: any };

export function ToolPanels({ panels }: { panels: ToolPanelEvent[] }) {
  if (panels.length === 0) return null;
  return (
    <div style={{ padding: '8px 12px', display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
      {panels.map((p, idx) => (
        <div key={idx} className="card" style={{ padding: 12 }}>
          {renderPanel(p)}
        </div>
      ))}
    </div>
  );
}

function renderPanel(p: ToolPanelEvent): React.ReactNode {
  switch (p.type) {
    case 'business_insight': {
      const insight = p.result?.insight;
      const columns = p.result?.columns ?? [];
      const rows = Array.isArray(p.result?.rows) ? p.result.rows : [];
      return (
        <>
          {insight && <div style={{ marginBottom: 8 }}>{insight}</div>}
          {columns.length > 0 && rows.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c} style={{ textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid var(--border)' }}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 20).map((r, i) => (
                    <tr key={i}>
                      {columns.map((c, ci) => (
                        <td key={ci} style={{ padding: '4px 6px' }}>{String(r?.[c] ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      );
    }
    case 'chartjs_data': {
      // If Chart.js available, render; otherwise show JSON preview
      const cfg = (p as any).result?.chartjs;
      return (
        <>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Chart</div>
          {typeof window !== 'undefined' && (window as any).Chart ? (
            <div style={{ height: 260, overflow: 'hidden' }}>
              <ChartCanvas config={cfg} />
            </div>
          ) : (
            <pre style={{ margin: 0, maxHeight: 180, overflow: 'auto' }}>{JSON.stringify(cfg, null, 2)}</pre>
          )}
        </>
      );
    }
    case 'sql_tutor': {
      const { tips = [], schema = {}, examples = [] } = p.result || {} as any;
      return (
        <>
          {tips.length > 0 && (
            <>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Tips</div>
              <ul style={{ margin: 0, paddingLeft: 16 }}>{tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </>
          )}
          {Object.keys(schema).length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer' }}>Schema</summary>
              <ul style={{ marginTop: 6 }}>
                {Object.entries(schema).map(([table, cols]) => (
                  <li key={table}><strong>{table}</strong>: {Array.isArray(cols) ? (cols as string[]).join(', ') : ''}</li>
                ))}
              </ul>
            </details>
          )}
          {examples.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Examples</div>
              {examples.map((ex, i) => (
                <pre key={i} style={{ background: '#f6f7f9', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
{ex}
                </pre>
              ))}
            </div>
          )}
        </>
      );
    }
    case 'run_analysis_plan': {
      const columns = (p.result as any)?.columns ?? [];
      const rows = Array.isArray((p.result as any)?.rows) ? (p.result as any).rows : [];
      const pythonCode = (p.result as any)?.python_code as string | undefined;
      return (
        <>
          {columns.length > 0 && rows.length > 0 && (
            <div style={{ overflowX: 'auto', marginBottom: 8 }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                <thead>
                  <tr>
                    {columns.map((c: string) => (
                      <th key={c} style={{ textAlign: 'left', padding: '4px 6px', borderBottom: '1px solid var(--border)' }}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 50).map((r: Record<string, unknown>, i: number) => (
                    <tr key={i}>
                      {columns.map((c: string, ci: number) => (
                        <td key={ci} style={{ padding: '4px 6px' }}>{String(r?.[c] ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {pythonCode && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div style={{ fontWeight: 600 }}>Reproducible Python</div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => navigator.clipboard?.writeText(pythonCode)}
                  style={{ padding: '4px 8px' }}
                >Copy</button>
              </div>
              <pre style={{ margin: 0, maxHeight: 240, overflow: 'auto', background: '#f6f7f9', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
{pythonCode}
              </pre>
            </div>
          )}
        </>
      );
    }
    case 'stakeholder_suggest': {
      const { suggestions = [], prompt } = p.result || {} as any;
      return (
        <>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Stakeholders</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 6 }}>
            {suggestions.map((s, i) => (
              <div key={i} className="card" style={{ padding: 8 }}>
                <div style={{ fontWeight: 600 }}>{s.role || 'Stakeholder'}</div>
                <div style={{ fontSize: 12, color: '#555' }}>{s.name} {s.email ? `• ${s.email}` : ''}</div>
              </div>
            ))}
          </div>
          {prompt && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#555' }}>Suggested prompt: “{prompt}”</div>
          )}
        </>
      );
    }
    default:
      return <pre style={{ margin: 0 }}>{JSON.stringify((p as any).result ?? p, null, 2)}</pre>;
  }
}

function ChartCanvas({ config }: { config: any }) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  React.useEffect(() => {
    const Chart = (window as any).Chart;
    if (!Chart || !canvasRef.current) return;
    // Ensure the chart doesn't blow up layout
    const safeConfig = {
      ...config,
      options: {
        ...(config?.options || {}),
        responsive: true,
        maintainAspectRatio: false,
      },
    };
    // Fix canvas height explicitly to fit container
    canvasRef.current.height = 240;
    const instance = new Chart(canvasRef.current, safeConfig);
    return () => instance?.destroy?.();
  }, [config]);
  return <canvas ref={canvasRef} style={{ width: '100%', height: '240px', display: 'block' }} />;
}


