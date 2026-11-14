import { useEffect, useRef } from 'react';
import { usePlayer } from '../context/PlayerContext.jsx';
import { useRadio } from '../context/RadioContext.jsx';
import { useToast } from '../components/Toast.jsx';

// MODO DJ (V1, sub-paso a): sólo la página y la CONVIVENCIA con el reproductor normal. Todavía sin
// AudioContext ni MIDI. Nada de esto toca PlayerContext: usa lo que el motor ya publica.
//
//  · Radio activa (fase distinta de 'sin-radio'): la página sólo pide salir de la radio y NO toma
//    nada (no pausa). La barra del reproductor sigue visible (Layout no pone .layout--dj).
//  · Sin radio: al entrar (o cuando la radio termina estando acá) se guarda si sonaba y se llama a
//    pause(). Al salir NO se reanuda solo: si sonaba, sale el aviso «Reanuda con play».
//  · Mientras la página está montada y SIN radio, un keydown en window en fase de CAPTURA hace
//    preventDefault de Espacio, ←, → y M y F. Los atajos globales (Espacio y ←/→ en PlayerContext, la M en
//    useMixShortcut, la F en useVideoFullscreenShortcut) escuchan en burbuja y lo primero que miran es
//    e.defaultPrevented, así que se callan sin tocarlos. No se tapa nada con Ctrl, Alt o Meta (Ctrl+F
//    busca en la página, Alt+← es el atrás del navegador), ni con el foco en un campo de texto.

export const TECLAS_TAPADAS = new Set(['Space', 'ArrowLeft', 'ArrowRight', 'KeyM', 'KeyF']);
const CAMPOS = 'input, textarea, select';

export default function DjPage() {
  const { isPlaying, pause } = usePlayer();
  const { fase } = useRadio();
  const toast = useToast();
  const radioActiva = fase !== 'sin-radio';

  // Se lee por ref: el efecto de la pausa NO depende de isPlaying (si no, volvería a correr al pausar).
  const sonandoRef = useRef(isPlaying);
  sonandoRef.current = isPlaying;
  const sonabaRef = useRef(false);   // ¿sonaba algo cuando el Modo DJ lo pausó?
  const avisoRef  = useRef(null);    // temporizador del aviso al salir (ver la limpieza)

  useEffect(() => {
    if (radioActiva) return undefined;
    // En desarrollo, StrictMode desmonta y vuelve a montar los efectos una vez: el aviso de esa
    // limpieza simulada se cancela acá y no sale. En producción no hay remontaje.
    clearTimeout(avisoRef.current);
    if (sonandoRef.current) {
      sonabaRef.current = true;
      pause();
    }
    return () => {
      if (!sonabaRef.current) return;
      avisoRef.current = setTimeout(() => {
        sonabaRef.current = false;
        toast('Reanuda con play', { icon: '⏸' });
      }, 0);
    };
  }, [radioActiva, pause, toast]);

  // Con radio activa no se tapa nada: el reproductor normal es el que suena y sus atajos siguen vivos.
  useEffect(() => {
    if (radioActiva) return undefined;
    const onKey = (e) => {
      if (!TECLAS_TAPADAS.has(e.code)) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const t = e.target;
      if (t?.closest?.(CAMPOS) || t?.isContentEditable) return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [radioActiva]);

  return (
    <div className="dj-page">
      <div className="section-header">
        <div className="lib-heading">
          <span className="lib-accent" aria-hidden="true"></span>
          <div className="lib-headtext">
            <h1 className="section-title">Modo DJ</h1>
          </div>
        </div>
      </div>

      {/* Sólo se ve por debajo de 900 px (main.css). */}
      <p className="dj-aviso dj-solo-escritorio" role="note">El Modo DJ es solo para escritorio</p>

      {radioActiva && (
        <p className="dj-aviso dj-aviso-radio" role="status">Sal de la radio para usar el Modo DJ</p>
      )}
    </div>
  );
}
