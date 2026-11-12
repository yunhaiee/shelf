"use client";

import { useCallback, useMemo } from "react";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import type { CellClassParams, CellEditRequestEvent, ColDef, GetRowIdParams, ValueGetterParams } from "ag-grid-community";
import type { DraftProduct, ProductAttributes } from "@/lib/types";
import { marketRange, money } from "@/components/format";
import { shelfTheme } from "./setup";

/** A catalog row: a draft (before publish) or a saved product (has `id`). `key` is stable for getRowId. */
export type CatalogRow = DraftProduct & { key: string; id?: string };

/** Field names as they appear in `ai_fields`. */
export type CatalogField =
  | "title"
  | "price"
  | "description"
  | "tags"
  | "stock"
  | "attributes.material"
  | "attributes.dimensions"
  | "attributes.capacity"
  | "attributes.care";

export type CatalogEdit = { field: CatalogField; value: string | number | string[] | null };

type AttrKey = "material" | "dimensions" | "capacity" | "care";

/** True if the AI wrote this field. A bare "attributes" entry marks every attribute. */
export function isAiField(row: Pick<DraftProduct, "ai_fields" | "attributes">, field: CatalogField) {
  const f = row.ai_fields ?? [];
  if (f.includes(field)) return true;
  if (field.startsWith("attributes.")) {
    const k = field.slice("attributes.".length);
    return f.includes("attributes") && row.attributes?.[k] != null && row.attributes[k] !== "";
  }
  return false;
}

/** ai_fields after the seller edits `field` (the edit makes it theirs). */
export function clearAiField(row: Pick<DraftProduct, "ai_fields" | "attributes">, field: CatalogField) {
  let next = (row.ai_fields ?? []).filter((f) => f !== field);
  if (field.startsWith("attributes.") && next.includes("attributes")) {
    // Expand the blanket marker into explicit keys, minus the one just edited.
    const edited = field.slice("attributes.".length);
    next = next.filter((f) => f !== "attributes");
    for (const k of Object.keys(row.attributes ?? {})) {
      if (k !== edited && !next.includes(`attributes.${k}`)) next.push(`attributes.${k}`);
    }
  }
  return next;
}

function attrText(attrs: ProductAttributes | undefined, key: string) {
  const v = attrs?.[key];
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
}

// ---------- cell renderers ----------

function ImageCell({ data }: CustomCellRendererProps<CatalogRow>) {
  const src = data?.image_url;
  return (
    <div className="flex h-full items-center">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          className="h-11 w-11 border border-line bg-bg object-cover"
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
        />
      ) : (
        <span className="block h-11 w-11 border border-dashed border-line" aria-label="No image" />
      )}
    </div>
  );
}

function PriceCell({ data }: CustomCellRendererProps<CatalogRow>) {
  if (!data) return null;
  const empty = data.price == null || data.price <= 0;
  return (
    <div className={`flex h-full items-center ${empty ? "text-warn" : ""}`}>
      {empty ? "Add price" : money(data.price!, data.currency || "USD", { cents: true })}
    </div>
  );
}

function MarketCell({ data }: CustomCellRendererProps<CatalogRow>) {
  if (!data) return null;
  const range = marketRange(data.market_low, data.market_high, data.currency || "USD");
  if (!range) return <span className="text-[13px] text-muted">No close matches</span>;
  return (
    <div className="flex h-full flex-col justify-center leading-tight">
      <span className="mono text-[13px] text-ink">{range}</span>
      <span className="mt-1 text-[11px] text-muted">
        {data.market_median != null ? `median ${money(Math.round(data.market_median), data.currency || "USD")}` : "Channel3"}
      </span>
    </div>
  );
}

function TextClampCell({ value }: CustomCellRendererProps<CatalogRow, string>) {
  return (
    <div className="flex h-full items-center">
      <div className="clamp-2 text-[13px] leading-[1.4]">{value || <span className="text-muted">—</span>}</div>
    </div>
  );
}

function RemoveCell({ data, context }: CustomCellRendererProps<CatalogRow, unknown, GridContext>) {
  if (!data || !context?.onRemove) return null;
  return (
    <button
      type="button"
      className="link text-[12px] text-muted"
      onClick={() => context.onRemove?.(data.key)}
      aria-label={`Remove ${data.title}`}
    >
      Remove
    </button>
  );
}

type GridContext = { onRemove?: (key: string) => void };

// ---------- grid ----------

const aiClass = (field: CatalogField) => ({
  "cell-ai": (p: CellClassParams<CatalogRow>) => !!p.data && isAiField(p.data, field),
});

export function CatalogGrid({
  rows,
  onEdit,
  onRemove,
  readOnly = false,
}: {
  rows: CatalogRow[];
  onEdit: (key: string, edit: CatalogEdit) => void;
  onRemove?: (key: string) => void;
  readOnly?: boolean;
}) {
  const editable = !readOnly;

  const columnDefs = useMemo<ColDef<CatalogRow>[]>(() => {
    const attrCol = (key: AttrKey, headerName: string, width: number): ColDef<CatalogRow> => ({
      colId: `attributes.${key}`,
      headerName,
      width,
      editable,
      cellDataType: "text",
      valueGetter: (p: ValueGetterParams<CatalogRow>) => attrText(p.data?.attributes, key),
      cellRenderer: TextClampCell,
      cellClassRules: aiClass(`attributes.${key}`),
      tooltipValueGetter: (p) => (p.value ? String(p.value) : undefined),
    });

    const cols: ColDef<CatalogRow>[] = [
      {
        colId: "image",
        headerName: "",
        width: 72,
        pinned: "left",
        sortable: false,
        resizable: false,
        cellRenderer: ImageCell,
        cellStyle: { paddingRight: 0 },
      },
      {
        colId: "title",
        headerName: "Product",
        field: "title",
        width: 180,
        pinned: "left",
        editable,
        cellDataType: "text",
        cellRenderer: TextClampCell,
        cellClassRules: aiClass("title"),
      },
      {
        colId: "price",
        headerName: "Price",
        field: "price",
        width: 100,
        editable,
        cellDataType: "number",
        cellEditor: "agNumberCellEditor",
        cellEditorParams: { min: 0, max: 100000, precision: 2, showStepperButtons: false },
        cellRenderer: PriceCell,
        cellClass: "cell-mono",
        cellClassRules: {
          ...aiClass("price"),
          "cell-warn": (p: CellClassParams<CatalogRow>) => !!p.data && (p.data.price == null || p.data.price <= 0),
        },
      },
      {
        colId: "market",
        headerName: "Channel3",
        headerTooltip: "What similar items sell for across online stores, from Channel3.",
        width: 140,
        sortable: false,
        valueGetter: (p) => p.data?.market_median ?? null,
        cellRenderer: MarketCell,
      },
      {
        colId: "description",
        headerName: "Description",
        field: "description",
        flex: 1,
        minWidth: 220,
        editable,
        cellDataType: "text",
        cellEditor: "agLargeTextCellEditor",
        cellEditorPopup: true,
        cellEditorParams: { maxLength: 2000, rows: 8, cols: 60 },
        cellRenderer: TextClampCell,
        cellClassRules: aiClass("description"),
        tooltipValueGetter: (p) => (p.value ? String(p.value) : undefined),
      },
      {
        colId: "tags",
        headerName: "Tags",
        width: 160,
        editable,
        cellDataType: "text",
        valueGetter: (p) => (p.data?.tags ?? []).join(", "),
        cellRenderer: TextClampCell,
        cellClassRules: aiClass("tags"),
        tooltipValueGetter: (p) => (p.value ? String(p.value) : undefined),
      },
      attrCol("dimensions", "Size", 120),
      attrCol("care", "Care", 140),
      {
        colId: "stock",
        headerName: "Stock",
        field: "stock",
        width: 80,
        editable,
        cellDataType: "number",
        cellEditor: "agNumberCellEditor",
        cellEditorParams: { min: 0, max: 100000, precision: 0, showStepperButtons: false },
        cellClass: "cell-mono",
        cellClassRules: aiClass("stock"),
      },
    ];

    if (editable && onRemove) {
      cols.push({ colId: "remove", headerName: "", width: 88, sortable: false, resizable: false, cellRenderer: RemoveCell });
    }
    return cols;
  }, [editable, onRemove]);

  const defaultColDef = useMemo<ColDef<CatalogRow>>(
    () => ({ sortable: false, resizable: true, suppressMovable: true, suppressHeaderMenuButton: true }),
    [],
  );

  const context = useMemo<GridContext>(() => ({ onRemove }), [onRemove]);

  const getRowId = useCallback((p: GetRowIdParams<CatalogRow>) => p.data.key, []);

  // readOnlyEdit: the grid never mutates rows; the parent owns state (draft or PATCHed product).
  const onCellEditRequest = useCallback(
    (e: CellEditRequestEvent<CatalogRow>) => {
      const field = e.colDef.colId as CatalogField | undefined;
      if (!field || !e.data) return;
      const raw = e.newValue;

      switch (field) {
        case "title": {
          const v = String(raw ?? "").trim();
          if (!v || v === e.data.title) return;
          onEdit(e.data.key, { field, value: v.slice(0, 200) });
          return;
        }
        case "description": {
          const v = String(raw ?? "").trim();
          if (v === (e.data.description ?? "")) return;
          onEdit(e.data.key, { field, value: v || null });
          return;
        }
        case "price": {
          const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? "").replace(/[^0-9.]/g, ""));
          if (!Number.isFinite(n) || n < 0) return;
          const v = Math.round(n * 100) / 100;
          if (v === e.data.price) return;
          onEdit(e.data.key, { field, value: v });
          return;
        }
        case "stock": {
          const n = typeof raw === "number" ? raw : Number.parseInt(String(raw ?? ""), 10);
          if (!Number.isFinite(n) || n < 0) return;
          const v = Math.floor(n);
          if (v === e.data.stock) return;
          onEdit(e.data.key, { field, value: v });
          return;
        }
        case "tags": {
          const seen = new Set<string>();
          const tags = String(raw ?? "")
            .split(/[,\n]/)
            .map((t) => t.trim().toLowerCase())
            .filter((t) => t && !seen.has(t) && (seen.add(t), true))
            .slice(0, 16);
          if (tags.join(",") === (e.data.tags ?? []).join(",")) return;
          onEdit(e.data.key, { field, value: tags });
          return;
        }
        default: {
          if (!field.startsWith("attributes.")) return;
          const v = String(raw ?? "").trim();
          const key = field.slice("attributes.".length);
          if (v === attrText(e.data.attributes, key)) return;
          onEdit(e.data.key, { field, value: v || null });
        }
      }
    },
    [onEdit],
  );

  return (
    <div className="shelf-grid w-full">
      <AgGridReact<CatalogRow>
        theme={shelfTheme}
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        context={context}
        getRowId={getRowId}
        readOnlyEdit
        onCellEditRequest={onCellEditRequest}
        singleClickEdit
        stopEditingWhenCellsLoseFocus
        domLayout="autoHeight"
        rowHeight={68}
        tooltipShowDelay={400}
        suppressCellFocus={readOnly}
        enableCellTextSelection={readOnly}
        overlayNoRowsTemplate='<span style="color: var(--muted)">No products yet. Add one below.</span>'
      />
    </div>
  );
}
