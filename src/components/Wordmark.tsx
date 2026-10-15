/**
 * Logotipo de "tax.invoice". Ahora en IBM Plex Mono (según el diseño de
 * referencia más reciente — antes era Inter, ver nota en el manual de
 * marca original): siempre en minúsculas, "tax" en SemiBold 600, el
 * punto en el color de acento, "invoice" en Regular 400.
 * Escala de uso: 42px marca de página, 24px barra de navegación,
 * 15px pie de comprobante, 11px mínimo (ahí, monocromo obligado).
 */
export function Wordmark({ size = 24, monocromo = false, colorPunto }: { size?: number; monocromo?: boolean; colorPunto?: string }) {
  return (
    <span
      className="inline-flex items-baseline lowercase"
      style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: size, letterSpacing: '-0.02em', lineHeight: 1 }}
    >
      <span style={{ fontWeight: 600 }}>tax</span>
      <span style={{ fontWeight: 400, color: monocromo ? undefined : (colorPunto ?? 'var(--color-accent)') }}>.</span>
      <span style={{ fontWeight: 400 }}>invoice</span>
    </span>
  );
}
