import { TEMAS, type TemaAyuda } from '../data/ayuda';

/** Minúsculas y sin tildes, manteniendo el MISMO largo que el original
 *  (así las posiciones sirven para resaltar el texto tal como se ve). */
export function normalizar(texto: string): string {
  let out = '';
  for (const c of texto) {
    const n = c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    out += n.length === 1 ? n : (n[0] ?? ' ');
    // Los caracteres de un solo "code point" extra (emojis) ocupan 2 en
    // el string original: se rellena para conservar el largo.
    if (c.length > 1) out += ' '.repeat(c.length - 1);
  }
  return out;
}

export function tokenizar(consulta: string): string[] {
  return normalizar(consulta)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 1);
}

function textoPlano(t: TemaAyuda): { titulo: string; palabras: string; resumen: string; cuerpo: string; seccion: string } {
  return {
    titulo: normalizar(t.titulo),
    palabras: normalizar(t.palabras.join(' ')),
    resumen: normalizar(t.resumen),
    cuerpo: normalizar([...(t.pasos ?? []), ...t.ejemplos, ...(t.notas ?? [])].join(' ')),
    seccion: normalizar(t.seccion),
  };
}

export interface ResultadoAyuda {
  tema: TemaAyuda;
  puntaje: number;
}

/** Busca por palabras clave. Todas las palabras escritas tienen que
 *  aparecer (en cualquier parte del tema). Ordena por relevancia: título >
 *  palabras clave > resumen > pasos/ejemplos/notas. */
export function buscarAyuda(consulta: string, opts: { esAdmin: boolean; seccion?: string | null; temas?: TemaAyuda[] }): ResultadoAyuda[] {
  const temas = (opts.temas ?? TEMAS).filter((t) => (opts.esAdmin || !t.soloAdmin) && (!opts.seccion || t.seccion === opts.seccion));
  const tokens = tokenizar(consulta);
  if (tokens.length === 0) return temas.map((tema) => ({ tema, puntaje: 0 }));

  const res: ResultadoAyuda[] = [];
  for (const tema of temas) {
    const p = textoPlano(tema);
    let total = 0;
    let ok = true;
    for (const tok of tokens) {
      let s = 0;
      if (p.titulo.includes(tok)) s += 10;
      if (p.palabras.includes(tok)) s += 6;
      if (p.seccion.includes(tok)) s += 2;
      if (p.resumen.includes(tok)) s += 3;
      if (p.cuerpo.includes(tok)) s += 1;
      if (s === 0) {
        ok = false;
        break;
      }
      total += s;
    }
    if (ok) res.push({ tema, puntaje: total });
  }
  return res.sort((a, b) => b.puntaje - a.puntaje);
}

export interface Trozo {
  texto: string;
  resaltado: boolean;
}

/** Parte `texto` en trozos marcando las apariciones de las palabras buscadas. */
export function resaltar(texto: string, tokens: string[]): Trozo[] {
  if (tokens.length === 0 || !texto) return [{ texto, resaltado: false }];
  const norm = normalizar(texto);
  const marcado = new Array<boolean>(texto.length).fill(false);
  for (const tok of tokens) {
    if (!tok) continue;
    let desde = 0;
    for (;;) {
      const i = norm.indexOf(tok, desde);
      if (i === -1) break;
      for (let k = i; k < i + tok.length; k++) marcado[k] = true;
      desde = i + tok.length;
    }
  }
  const trozos: Trozo[] = [];
  let ini = 0;
  for (let i = 1; i <= texto.length; i++) {
    if (i === texto.length || marcado[i] !== marcado[ini]) {
      trozos.push({ texto: texto.slice(ini, i), resaltado: marcado[ini] });
      ini = i;
    }
  }
  return trozos;
}
