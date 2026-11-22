// LA VERSIÓN, leída UNA vez al importar este módulo (o sea, al arrancar el servidor).
//
// Hay dos y no son la misma, por eso viajan las dos:
//   · `version`: la primera versión numerada del CHANGELOG.md («## [1.43.0] - …»). Es la
//     que se despliega y la que ve la familia en Novedades.
//   · `version_paquete`: el "version" de music-server/package.json, que no se sube en cada
//     release (hoy va atrás del CHANGELOG).
// El CHANGELOG se busca en los mismos dos lugares que GET /api/changelog (api/changelog.js):
// la raíz del repo en desarrollo y music-server/ en la imagen Docker.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

function leer(ruta) {
  try { return readFileSync(ruta, 'utf8'); } catch { return null; }
}

function deChangelog() {
  for (const ruta of [join(__dir, '../../../CHANGELOG.md'), join(__dir, '../../CHANGELOG.md')]) {
    const txt = leer(ruta);
    const m = txt?.match(/^## \[(\d+\.\d+\.\d+)\]/m);
    if (m) return m[1];
  }
  return null;
}

function dePaquete() {
  try {
    const v = JSON.parse(leer(join(__dir, '../../package.json')) ?? 'null')?.version;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

export const VERSION = deChangelog();
export const VERSION_PAQUETE = dePaquete();
