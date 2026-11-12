"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import type { ColDef, GetRowIdParams, GridApi, GridReadyEvent, IRowNode } from "ag-grid-community";
import type { Order } from "@/lib/types";
import { clockTime, money } from "@/components/format";
import { shelfTheme } from "./setup";

export type OrderRow = Order & { product_title: string };

const FLASH_DELAY_MS = 80;

const STATUS_LABEL: Record<Order["status"], string> = {
  created: "Awaiting payment",
  approved: "Approved",
  paid: "Paid",
  refunded: "Refunded",
  failed: "Failed",
  cancelled: "Cancelled",
};

function StatusCell({ data }: CustomCellRendererProps<OrderRow>) {
  if (!data) return null;
  return <span className={`pill pill-${data.status}`}>{STATUS_LABEL[data.status] ?? data.status}</span>;
}

/** Orders grid. Rows whose id is in `flashIds` flash once after the grid applies the new data. */
export function OrdersGrid({ rows, flashIds }: { rows: OrderRow[]; flashIds: string[] }) {
  const apiRef = useRef<GridApi<OrderRow> | null>(null);
  const pending = useRef<string[]>([]);

  // Flash rows that exist in the grid; ids not applied yet stay pending until rowDataUpdated.
  const flashPending = useCallback(() => {
    const api = apiRef.current;
    if (!api || pending.current.length === 0) return;
    const found: IRowNode<OrderRow>[] = [];
    const missing: string[] = [];
    for (const id of pending.current) {
      const node = api.getRowNode(id);
      if (node) found.push(node);
      else missing.push(id);
    }
    pending.current = missing.slice(-50);
    if (found.length) api.flashCells({ rowNodes: found, flashDuration: 1400, fadeDuration: 2200 });
  }, []);

  useEffect(() => {
    if (!flashIds.length) return;
    pending.current = Array.from(new Set([...pending.current, ...flashIds]));
    const t = setTimeout(flashPending, FLASH_DELAY_MS);
    return () => clearTimeout(t);
  }, [flashIds, flashPending]);

  // Flash after AG Grid has applied the delta (rowDataUpdated), not when React state changes.
  const onRowDataUpdated = useCallback(() => {
    // AG Grid's React layer mounts new row cells asynchronously; flashCells only affects rendered cells.
    setTimeout(flashPending, FLASH_DELAY_MS);
  }, [flashPending]);

  const onGridReady = useCallback((e: GridReadyEvent<OrderRow>) => {
    apiRef.current = e.api;
  }, []);

  const columnDefs = useMemo<ColDef<OrderRow>[]>(
    () => [
      {
        colId: "when",
        headerName: "When",
        width: 150,
        valueGetter: (p) => p.data?.created_at ?? "",
        valueFormatter: (p) => clockTime(p.value as string),
        sort: "desc",
        cellClass: "cell-mono",
      },
      { colId: "product", headerName: "Product", field: "product_title", minWidth: 180, flex: 1.2 },
      { colId: "qty", headerName: "Qty", field: "qty", width: 72, cellClass: "cell-mono" },
      {
        colId: "amount",
        headerName: "Amount",
        field: "amount",
        width: 112,
        valueFormatter: (p) => money(p.value as number, p.data?.currency ?? "USD", { cents: true }),
        cellClass: "cell-mono",
      },
      { colId: "status", headerName: "Status", field: "status", width: 168, cellRenderer: StatusCell },
      {
        colId: "client",
        headerName: "Assistant",
        field: "client_name",
        width: 130,
        valueFormatter: (p) => (p.value as string) || "AI agent",
      },
      {
        colId: "query",
        headerName: "What they asked",
        field: "query",
        minWidth: 220,
        flex: 2,
        valueFormatter: (p) => (p.value ? `“${p.value}”` : "—"),
        tooltipValueGetter: (p) => (p.data?.query ? p.data.query : undefined),
      },
    ],
    [],
  );

  const defaultColDef = useMemo<ColDef<OrderRow>>(
    () => ({ resizable: true, suppressMovable: true, suppressHeaderMenuButton: true }),
    [],
  );

  const getRowId = useCallback((p: GetRowIdParams<OrderRow>) => p.data.id, []);

  return (
    <div className="shelf-grid w-full">
      <AgGridReact<OrderRow>
        theme={shelfTheme}
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        getRowId={getRowId}
        onGridReady={onGridReady}
        onRowDataUpdated={onRowDataUpdated}
        onFirstDataRendered={flashPending}
        domLayout={rows.length > 10 ? "normal" : "autoHeight"}
        containerStyle={rows.length > 10 ? { height: 560 } : undefined}
        rowHeight={52}
        suppressCellFocus
        enableCellTextSelection
        tooltipShowDelay={400}
        overlayNoRowsTemplate='<span style="color: var(--muted)">No orders yet. When an assistant sells something for you, it shows up here within seconds.</span>'
      />
    </div>
  );
}
