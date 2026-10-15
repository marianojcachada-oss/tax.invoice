// Recharts no reacciona a variables CSS de forma confiable en todos los
// props (stroke/fill), así que estos colores son un espejo manual de los
// tokens de src/index.css (paleta "libro contable" verde bosque + crema).
export const CHART_COLORS = {
  light: {
    grid: '#e3e3dc',
    axis: '#15181a',
    tick: '#8c938f',
    tooltipBorder: '#15181a',
    tooltipBg: '#ffffff',
    accent: '#10402f',
    accentSoft: '#9ed3b8',
    ink: '#15181a',
    danger: '#a83a2b',
  },
  dark: {
    grid: '#303430',
    axis: '#edeee9',
    tick: '#9ba39d',
    tooltipBorder: '#303430',
    tooltipBg: '#1e211f',
    accent: '#6fbf9c',
    accentSoft: '#2f5c47',
    ink: '#edeee9',
    danger: '#e2685a',
  },
} as const;
