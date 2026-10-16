import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, ChevronDown, Search, X } from 'lucide-react';
import { useDataStore } from '../data/DataContext';
import { SECCIONES, TEMAS } from '../data/ayuda';
import { buscarAyuda, resaltar, tokenizar } from '../lib/buscarAyuda';

const SUGERENCIAS = ['registrar pago', 'reembolso', 'zelle', 'plan de pago', 'dar de baja', 'importar', '1060DR', 'recordatorio'];

function Resaltado({ texto, tokens }: { texto: string; tokens: string[] }) {
  return (
    <>
      {resaltar(texto, tokens).map((t, i) =>
        t.resaltado ? (
          <mark key={i} style={{ background: 'color-mix(in srgb, var(--color-accent) 28%, transparent)', color: 'inherit', borderRadius: 2, padding: '0 1px' }}>
            {t.texto}
          </mark>
        ) : (
          <Fragment key={i}>{t.texto}</Fragment>
        )
      )}
    </>
  );
}

export function Help() {
  const { usuarioActual } = useDataStore();
  const esAdmin = usuarioActual?.rol === 'admin';
  const [params, setParams] = useSearchParams();
  const [consulta, setConsulta] = useState(params.get('q') ?? '');
  const [seccion, setSeccion] = useState<string | null>(null);
  const temaInicial = params.get('tema');
  const [abiertos, setAbiertos] = useState<Set<string>>(() => new Set(temaInicial ? [temaInicial] : []));
  const inputRef = useRef<HTMLInputElement>(null);

  const tokens = useMemo(() => tokenizar(consulta), [consulta]);
  const resultados = useMemo(() => buscarAyuda(consulta, { esAdmin, seccion }), [consulta, esAdmin, seccion]);

  // La consulta queda en la dirección (se puede compartir o volver con "atrás").
  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (consulta.trim()) next.set('q', consulta.trim());
      else next.delete('q');
      next.delete('tema');
      setParams(next, { replace: true });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta]);

  // Con pocos resultados se muestran abiertos; con muchos, plegados.
  useEffect(() => {
    if (tokens.length > 0 && resultados.length > 0 && resultados.length <= 3) {
      setAbiertos(new Set(resultados.map((r) => r.tema.id)));
    } else if (tokens.length === 0 && !temaInicial) {
      setAbiertos(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta, seccion]);

  // Atajo: "/" lleva el cursor al buscador.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      const escribiendo = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === '/' && !escribiendo) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Si se llega con ?tema=id, ese tema se abre y se muestra en pantalla.
  useEffect(() => {
    if (!temaInicial) return;
    const t = setTimeout(() => document.getElementById(`ayuda-${temaInicial}`)?.scrollIntoView({ block: 'start' }), 50);
    return () => clearTimeout(t);
  }, [temaInicial]);

  function alternar(id: string) {
    setAbiertos((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const hayConsulta = tokens.length > 0;
  const totalVisibles = TEMAS.filter((t) => esAdmin || !t.soloAdmin).length;

  // Sin consulta se agrupa por sección; con consulta se ordena por relevancia.
  const grupos = hayConsulta
    ? [{ titulo: null as string | null, items: resultados }]
    : SECCIONES.map((s) => ({ titulo: s as string | null, items: resultados.filter((r) => r.tema.seccion === s) })).filter((g) => g.items.length > 0);

  return (
    <div className="px-6 md:px-8 py-6 max-w-[900px]">
      <div className="mb-4">
        <h1 className="font-semibold text-[22px]">Ayuda</h1>
        <p className="text-ink-soft text-[13px]">
          Cómo funciona cada parte de tax.invoice, con ejemplos. Buscá por palabra clave: “pago”, “reembolso”, “zelle”…
        </p>
      </div>

      <div className="relative mb-3">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setConsulta('')}
          placeholder="Buscar en la ayuda…  (tocá / para escribir acá)"
          aria-label="Buscar en la ayuda"
          className="w-full h-10 pl-9 pr-9 border border-line rounded-[5px] bg-surface text-[14px] focus:outline-none focus:border-accent [&::-webkit-search-cancel-button]:hidden"
        />
        {consulta && (
          <button onClick={() => { setConsulta(''); inputRef.current?.focus(); }} aria-label="Borrar búsqueda" className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-ink-faint hover:text-ink">
            <X size={14} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4" role="group" aria-label="Filtrar por sección">
        <button className={seccion === null ? 'chip-accent' : 'chip'} aria-pressed={seccion === null} onClick={() => setSeccion(null)}>
          Todas
        </button>
        {SECCIONES.filter((s) => esAdmin || TEMAS.some((t) => t.seccion === s && !t.soloAdmin)).map((s) => (
          <button key={s} className={seccion === s ? 'chip-accent' : 'chip'} aria-pressed={seccion === s} onClick={() => setSeccion(seccion === s ? null : s)}>
            {s}
          </button>
        ))}
      </div>

      {!hayConsulta && (
        <div className="flex flex-wrap items-center gap-1.5 mb-5 text-[12.5px] text-ink-soft">
          <span>Probá con:</span>
          {SUGERENCIAS.map((s) => (
            <button key={s} className="chip hover:border-accent hover:text-accent" onClick={() => setConsulta(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div role="status" aria-live="polite" className="text-ink-faint text-[12px] mb-3">
        {hayConsulta
          ? resultados.length === 0
            ? ''
            : `${resultados.length} ${resultados.length === 1 ? 'tema encontrado' : 'temas encontrados'}`
          : `${totalVisibles} temas`}
      </div>

      {resultados.length === 0 && (
        <div className="panel p-6 text-center">
          <div className="font-semibold mb-1">No encontramos nada para “{consulta}”</div>
          <p className="text-ink-soft text-[13px] mb-3">Probá con una sola palabra, o con otra forma de decirlo (por ejemplo “devolución” en vez de “refund”).</p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {SUGERENCIAS.slice(0, 5).map((s) => (
              <button key={s} className="chip hover:border-accent hover:text-accent" onClick={() => { setSeccion(null); setConsulta(s); }}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {grupos.map((g) => (
        <section key={g.titulo ?? 'resultados'} className="mb-6" aria-label={g.titulo ?? 'Resultados'}>
          {g.titulo && <div className="th-label mb-2">{g.titulo}</div>}
          <div className="flex flex-col gap-2">
            {g.items.map(({ tema }) => {
              const abierto = abiertos.has(tema.id);
              return (
                <article key={tema.id} id={`ayuda-${tema.id}`} className="panel scroll-mt-20">
                  <h2 className="m-0">
                    <button
                      onClick={() => alternar(tema.id)}
                      aria-expanded={abierto}
                      aria-controls={`ayuda-cuerpo-${tema.id}`}
                      className="w-full text-left px-4 py-3 flex items-start gap-3 min-h-[44px]"
                    >
                      <span className="flex-1 min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-[14.5px]">
                            <Resaltado texto={tema.titulo} tokens={tokens} />
                          </span>
                          {hayConsulta && <span className="chip">{tema.seccion}</span>}
                          {tema.soloAdmin && <span className="chip">Solo admin</span>}
                        </span>
                        <span className="block text-ink-soft text-[13px] mt-0.5 font-normal">
                          <Resaltado texto={tema.resumen} tokens={tokens} />
                        </span>
                      </span>
                      <ChevronDown size={16} className={`mt-1 shrink-0 text-ink-faint transition-transform ${abierto ? 'rotate-180' : ''}`} aria-hidden />
                    </button>
                  </h2>

                  {abierto && (
                    <div id={`ayuda-cuerpo-${tema.id}`} className="px-4 pb-4 pt-1 border-t border-line-soft text-[13.5px] flex flex-col gap-3">
                      {tema.pasos && tema.pasos.length > 0 && (
                        <div className="mt-2">
                          <div className="th-label mb-1.5">Cómo se hace</div>
                          <ol className="list-decimal pl-5 flex flex-col gap-1">
                            {tema.pasos.map((p, i) => (
                              <li key={i}><Resaltado texto={p} tokens={tokens} /></li>
                            ))}
                          </ol>
                        </div>
                      )}

                      <div className={tema.pasos && tema.pasos.length > 0 ? '' : 'mt-2'}>
                        <div className="th-label mb-1.5">{tema.ejemplos.length > 1 ? 'Ejemplos' : 'Ejemplo'}</div>
                        <div className="flex flex-col gap-1.5">
                          {tema.ejemplos.map((e, i) => (
                            <div key={i} className="rounded-[5px] bg-surface-2 border border-line-soft px-3 py-2">
                              <Resaltado texto={e} tokens={tokens} />
                            </div>
                          ))}
                        </div>
                      </div>

                      {tema.notas && tema.notas.length > 0 && (
                        <div>
                          <div className="th-label mb-1.5">Tené en cuenta</div>
                          <ul className="list-disc pl-5 flex flex-col gap-1 text-ink-soft">
                            {tema.notas.map((n, i) => (
                              <li key={i}><Resaltado texto={n} tokens={tokens} /></li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {tema.ruta && (
                        <div>
                          <Link to={tema.ruta} className="btn-outline inline-flex items-center gap-1.5 !no-underline">
                            Ir a la pantalla <ArrowRight size={14} aria-hidden />
                          </Link>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
