import React from 'react';

interface DataPeekCardProps {
  title: string;
  columns: string[];
  rows: any[][]; // normalized rows
}

export function DataPeekCard({ title, columns, rows }: DataPeekCardProps) {
  const maxRows = Math.min(rows.length, 3);
  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} scope="col" style={{ textAlign: 'left', padding: '2px 6px', borderBottom: '1px solid var(--border)' }}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, maxRows).map((r, i) => (
              <tr key={i}>
                {columns.map((c, ci) => (
                  <td key={ci} style={{ padding: '2px 6px' }}>
                    {Array.isArray(r) ? String(r[ci]) : String((r as any)?.[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default DataPeekCard;


