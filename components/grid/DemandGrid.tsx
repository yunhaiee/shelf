"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import type { ColDef, GetRowIdParams, GridApi, GridReadyEvent, RowClassParams } from "ag-grid-community";
import type { SearchLog } from "@/lib/types";
import { money, relativeTime } from "@/components/format";
import { shelfTheme } from "./setup";

export type DemandRow = SearchLog & { matched: boolean };

function MatchedCell({ data }: CustomCellRendererProps<DemandRow>) {
  if (!data) return null;
  return data.matched ? <span className="font-medium text-ok">Yes</span> : <span className="text-muted">No</span>;
}

function OnShelfCell({ data }: CustomCellRendererProps<DemandRow>) {
  if (!data) return null;
  if (data.shelf_hit_count === 0) return <span>Nothing on Shelf</span>;
  return <span className="mono text-[13px]">{data.shelf_hit_count}</span>;
}

/** Network-wide agent searches. Unmet searches (no Shelf result) are the demand signal for sellers. */
export function DemandGrid({ rows, now }: { rows: DemandRow[]; now: number }) {
  const apiRef = useRef<GridApi<DemandRow> | null>(null);
  const nowRef = useRef(now);
  nowRef.current = now;

  // Keep "2 min ago" fresh without rebuilding columns (which would reset sort/filter state).
  useEffect(() => {
    apiRef.current?.refreshCells({ columns: ["when"], force: true, suppressFlash: true });
  }, [now]);

  const onGridReady = useCallback((e: GridReadyEvent<DemandRow>) => {
    apiRef.current = e.api;
  }, []);

  const columnDefs = useMemo<ColDef<DemandRow>[]>(
    () => [
      {
        colId: "query",
        headerName: "Shopper asked",
        field: "query",
        minWidth: 240,
        flex: 2,
        filter: "agTextColumnFilter",
        tooltipValueGetter: (p) => (p.value ? String(p.value) : undefined),
      },
      {
        colId: "max_price",
        headerName: "Max price",
        field: "max_price",
        width: 116,
        valueFormatter: (p) => (p.value == null ? "—" : money(p.value as number)),
        cellClass: "cell-mono",
      },
      {
        colId: "client",
        headerName: "Assistant",
        field: "client_name",
        width: 128,
        valueFormatter: (p) => (p.value as string) || "AI agent",
      },
      {
        colId: "onshelf",
        headerName: "On Shelf",
        field: "shelf_hit_count",
        width: 150,
        cellRenderer: OnShelfCell,
        cellClass: "cell-onshelf",
      },
      { colId: "matched", headerName: "Matched you", field: "matched", width: 128, cellRenderer: MatchedCell },
      {
        colId: "when",
        headerName: "When",
        field: "created_at",
        width: 128,
        sort: "desc",
        valueFormatter: (p) => relativeTime(p.value as string, nowRef.current),
        cellClass: "cell-mono",
      },
    ],
    [],
  );

  const defaultColDef = useMemo<ColDef<DemandRow>>(
    () => ({ resizable: true, suppressMovable: true, sortable: true }),
    [],
  );

  const getRowId = useCallback((p: GetRowIdParams<DemandRow>) => p.data.id, []);
  const rowClassRules = useMemo(
    () => ({ "row-unmet": (p: RowClassParams<DemandRow>) => p.data?.shelf_hit_count === 0 }),
    [],
  );

  return (
    <div className="shelf-grid w-full" style={{ height: 460 }}>
      <AgGridReact<DemandRow>
        theme={shelfTheme}
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        getRowId={getRowId}
        onGridReady={onGridReady}
        rowClassRules={rowClassRules}
        rowHeight={46}
        suppressCellFocus
        enableCellTextSelection
        tooltipShowDelay={400}
        overlayNoRowsTemplate='<span style="color: var(--muted)">No agent searches yet.</span>'
      />
    </div>
  );
}
