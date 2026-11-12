// AG Grid v36 Community: module registration (once) + the Shelf theme derived from the locked palette.
// Imported only by client grid components.
import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";

const g = globalThis as unknown as { __shelfAgGridRegistered?: boolean };
if (!g.__shelfAgGridRegistered) {
  ModuleRegistry.registerModules([AllCommunityModule]);
  g.__shelfAgGridRegistered = true;
}

export const shelfTheme = themeQuartz.withParams({
  browserColorScheme: "light",
  accentColor: "var(--accent)",
  backgroundColor: "var(--surface)",
  foregroundColor: "var(--ink)",
  textColor: "var(--ink)",
  subtleTextColor: "var(--muted)",
  borderColor: "var(--line)",
  chromeBackgroundColor: "var(--bg)",
  headerBackgroundColor: "var(--bg)",
  headerTextColor: "var(--muted)",
  headerFontSize: 11,
  headerFontWeight: 500,
  headerHeight: 40,
  rowHoverColor: "color-mix(in srgb, var(--bg) 70%, var(--surface))",
  selectedRowBackgroundColor: "var(--accent-soft)",
  oddRowBackgroundColor: "var(--surface)",
  rangeSelectionBorderColor: "var(--accent)",
  valueChangeValueHighlightBackgroundColor: "var(--accent-soft)",
  cellEditingBorder: { color: "var(--accent)", width: 1 },
  inputFocusBorder: { color: "var(--ink)" },
  focusShadow: { radius: 0, spread: 2, color: "var(--accent-soft)" },
  fontFamily: "var(--font-sans)",
  fontSize: 14,
  dataFontSize: 14,
  iconColor: "var(--muted)",
  spacing: 8,
  cellHorizontalPadding: 14,
  borderRadius: 2,
  wrapperBorderRadius: 0,
  wrapperBorder: { color: "var(--line)" },
  columnBorder: false,
  headerColumnBorder: false,
  rowBorder: { color: "var(--line)" },
  headerRowBorder: { color: "var(--line)" },
  menuBackgroundColor: "var(--surface)",
  menuBorder: { color: "var(--line)" },
  popupShadow: "none",
  menuShadow: "none",
  dropdownShadow: "none",
  cardShadow: "none",
  dialogShadow: "none",
  tooltipBackgroundColor: "var(--ink)",
  tooltipTextColor: "var(--bg)",
  tooltipBorder: false,
  autoHeightMinBodyHeight: 104,
});
