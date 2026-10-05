/**
 * Español e inglés, de verdad.
 *
 * Huatulco es destino de turismo internacional y la mitad de quien reserva una
 * salida no habla español. Hasta ahora el pie decía «Español · English» sin
 * que el segundo hiciera nada; esto es lo que faltaba detrás.
 *
 * No se trajo una librería de internacionalización. Para un sitio de cinco
 * pantallas y dos idiomas, una librería trae un formato de archivos, un
 * cargador asíncrono y un vocabulario que aprender, a cambio de resolver
 * problemas que aquí no existen —treinta idiomas, plurales eslavos, textos que
 * llegan del servidor—. Lo que hay es un diccionario, una función que busca en
 * él y un contexto para no pasarla de mano en mano.
 *
 * Dos decisiones que sí importan:
 *
 * · **La clave es una frase en español, no un código.** `t('salida.titulo')`
 *   dice en qué pantalla vive y qué es. Con `t('k_1138')` habría que ir al
 *   diccionario para saber qué se está escribiendo.
 * · **Si falta una traducción, sale el español.** Una pantalla a medio traducir
 *   se lee; una pantalla con `undefined` donde iba el precio, no.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { TEXTOS } from './textos';

const IDIOMAS = ['es', 'en'];
const GUARDADO = 'parotas:idioma';

const Contexto = createContext(null);

/** Con qué idioma abrir: el que eligió antes, o el de su navegador. */
function inicial() {
  try {
    const guardado = localStorage.getItem(GUARDADO);
    if (IDIOMAS.includes(guardado)) return guardado;
  } catch {
    /* Modo privado o almacenamiento bloqueado: no es grave. */
  }
  const delNavegador = (navigator.language || 'es').slice(0, 2).toLowerCase();
  return delNavegador === 'en' ? 'en' : 'es';
}

export function ProveedorDeIdioma({ children }) {
  const [idioma, setIdioma] = useState(inicial);

  useEffect(() => {
    try {
      localStorage.setItem(GUARDADO, idioma);
    } catch {
      /* Si no se puede guardar, se pierde al recargar y ya. */
    }
    // Para los lectores de pantalla y para que el navegador sepa en qué
    // idioma ofrecer su traductor.
    document.documentElement.lang = idioma;
  }, [idioma]);

  /**
   * Busca una frase. `vars` rellena los huecos marcados con llaves:
   * `t('mapa.hoyo', { n: 5 })` sobre «Hoyo {n}» da «Hoyo 5».
   */
  const t = useCallback(
    (clave, vars) => {
      const texto = TEXTOS[idioma]?.[clave] ?? TEXTOS.es[clave];
      if (texto === undefined) {
        // En desarrollo se grita; en producción se devuelve la clave, que al
        // menos deja ver dónde falta en lugar de dejar un hueco en blanco.
        if (import.meta.env.DEV) console.warn('Falta la frase:', clave);
        return clave;
      }
      if (!vars) return texto;
      return Object.entries(vars).reduce(
        (acumulado, [k, v]) => acumulado.replaceAll(`{${k}}`, String(v)),
        texto,
      );
    },
    [idioma],
  );

  const valor = useMemo(
    () => ({ idioma, t, cambiar: (nuevo) => IDIOMAS.includes(nuevo) && setIdioma(nuevo) }),
    [idioma, t],
  );

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useIdioma() {
  const valor = useContext(Contexto);
  if (!valor) throw new Error('useIdioma necesita estar dentro de ProveedorDeIdioma');
  return valor;
}
